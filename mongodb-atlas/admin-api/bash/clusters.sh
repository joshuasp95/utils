#!/usr/bin/env bash
# clusters.sh — operaciones sobre clusters de un proyecto Atlas vía Admin API v2.
#
# Qué hace:     Lista, describe, pausa, reanuda o elimina clusters del proyecto
#               ATLAS_PROJECT_ID usando la Atlas Admin API (OAuth2 Service Account).
# Requisitos:   bash, curl, jq, column. .env configurado (ver ../.env.example).
# Uso:          bash bash/clusters.sh list
#               bash bash/clusters.sh get    <CLUSTER_NAME>
#               bash bash/clusters.sh pause  <CLUSTER_NAME>
#               bash bash/clusters.sh resume <CLUSTER_NAME>
#               bash bash/clusters.sh delete <CLUSTER_NAME>
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver common.sh / auth.sh).
# Efectos:      list, get → SOLO LECTURA.
#               pause     → ESCRIBE: PATCH paused=true (detiene el cluster; las apps pierden conexión).
#               resume    → ESCRIBE: PATCH paused=false (vuelve a arrancar el cluster).
#               delete    → ESCRIBE (DESTRUCTIVO): borra el cluster y sus datos. Pide confirmación.
# Salida:       Tabla o JSON resumido por stdout.

set -euo pipefail
source "$(dirname "$0")/common.sh"

PROJECT="/groups/${ATLAS_PROJECT_ID}"

cmd_list() {
  echo "==> Clusters del proyecto ${ATLAS_PROJECT_ID}"
  # jq: una línea por cluster con nombre, estado, versión y tipo, separadas por TAB;
  # column -t -s $'\t' las alinea como tabla.
  atlas_request GET "${PROJECT}/clusters" \
    | jq -r '.results[] | "\(.name)\t\(.stateName)\t\(.mongoDBVersion)\t\(.clusterType)"' \
    | column -t -s $'\t'
}

cmd_get() {
  local name="${1:?Uso: clusters.sh get <clusterName>}"
  echo "==> Cluster: $name"
  atlas_request GET "${PROJECT}/clusters/${name}" | jq '{
    name, stateName, clusterType, mongoDBVersion,
    paused, diskSizeGB,
    replicationSpecs: [.replicationSpecs[]? | {zoneName, numShards}]
  }'
}

# ESCRIBE: pausa el cluster
cmd_pause() {
  local name="${1:?Uso: clusters.sh pause <clusterName>}"
  echo "==> Pausando cluster: $name"
  atlas_request PATCH "${PROJECT}/clusters/${name}" '{"paused": true}' \
    | jq '{name, stateName, paused}'
}

# ESCRIBE: reanuda el cluster
cmd_resume() {
  local name="${1:?Uso: clusters.sh resume <clusterName>}"
  echo "==> Reanudando cluster: $name"
  atlas_request PATCH "${PROJECT}/clusters/${name}" '{"paused": false}' \
    | jq '{name, stateName, paused}'
}

# ESCRIBE (DESTRUCTIVO): elimina el cluster
cmd_delete() {
  local name="${1:?Uso: clusters.sh delete <clusterName>}"
  read -r -p "¿Seguro que quieres eliminar el cluster '${name}'? [y/N] " confirm
  [[ "${confirm}" =~ ^[yY]$ ]] || { echo "Cancelado."; exit 0; }
  atlas_request DELETE "${PROJECT}/clusters/${name}"
  echo "Cluster '${name}' eliminado."
}

case "${1:-}" in
  list)   cmd_list ;;
  get)    cmd_get    "${2:-}" ;;
  pause)  cmd_pause  "${2:-}" ;;
  resume) cmd_resume "${2:-}" ;;
  delete) cmd_delete "${2:-}" ;;
  *)
    echo "Uso: $0 {list|get|pause|resume|delete} [clusterName]"
    exit 1
    ;;
esac
