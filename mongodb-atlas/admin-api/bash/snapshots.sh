#!/usr/bin/env bash
# snapshots.sh — snapshots (copias de seguridad) y restauraciones de clusters Atlas.
#
# Qué hace:     Lista snapshots de un cluster, crea un snapshot on-demand o lanza una
#               restauración (restore job) de un snapshot sobre un cluster destino.
# Requisitos:   bash, curl, jq, column. .env configurado (ver ../.env.example).
#               El cluster debe tener Cloud Backup activado (tiers dedicados, M10+).
# Uso:          bash bash/snapshots.sh list    <CLUSTER_NAME>
#               bash bash/snapshots.sh create  <CLUSTER_NAME> ["descripción"] [retentionDays]
#               bash bash/snapshots.sh restore <CLUSTER_NAME> <SNAPSHOT_ID> <TARGET_CLUSTER_NAME>
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver common.sh / auth.sh).
#               retentionDays: días que Atlas conserva el snapshot (por defecto 7).
# Efectos:      list    → SOLO LECTURA.
#               create  → ESCRIBE: crea un snapshot on-demand (consume almacenamiento de backup).
#               restore → ESCRIBE (DESTRUCTIVO para el destino): SOBRESCRIBE los datos del
#                         cluster destino con el snapshot. NO pide confirmación.
# Salida:       Tabla o JSON resumido por stdout.

set -euo pipefail
source "$(dirname "$0")/common.sh"

PROJECT="/groups/${ATLAS_PROJECT_ID}"

cmd_list() {
  local cluster="${1:?Uso: snapshots.sh list <clusterName>}"
  echo "==> Snapshots del cluster: $cluster"
  atlas_request GET "${PROJECT}/clusters/${cluster}/backup/snapshots" \
    | jq -r '.results[] | "\(.id)\t\(.type)\t\(.status)\t\(.createdAt)\t\(.storageSizeBytes // "-")"' \
    | column -t -s $'\t'
}

# ESCRIBE: snapshot on-demand
cmd_create() {
  local cluster="${1:?Uso: snapshots.sh create <clusterName> [description] [retentionDays]}"
  local description="${2:-Snapshot on-demand via script}"
  local retention="${3:-7}"

  # --argjson pasa el número como número JSON (no como string).
  local body
  body=$(jq -n \
    --arg d "$description" \
    --argjson r "$retention" \
    '{description: $d, retentionInDays: $r}')

  echo "==> Creando snapshot on-demand del cluster: $cluster"
  atlas_request POST "${PROJECT}/clusters/${cluster}/backup/snapshots" "$body" \
    | jq '{id, type, status, description, createdAt, retentionInDays}'
}

# ESCRIBE (DESTRUCTIVO para el destino): restaura un snapshot
cmd_restore() {
  local cluster="${1:?Uso: snapshots.sh restore <clusterName> <snapshotId> <targetCluster>}"
  local snapshot_id="${2:?Falta snapshotId}"
  local target_cluster="${3:?Falta targetCluster}"

  # deliveryType "automated": Atlas copia el snapshot directamente sobre el cluster
  # destino (targetClusterName) del proyecto targetGroupId.
  local body
  body=$(jq -n \
    --arg s "$snapshot_id" \
    --arg t "$target_cluster" \
    --arg p "$ATLAS_PROJECT_ID" \
    '{
      snapshotId: $s,
      deliveryType: "automated",
      targetClusterName: $t,
      targetGroupId: $p
    }')

  echo "==> Restaurando snapshot $snapshot_id en $target_cluster"
  atlas_request POST "${PROJECT}/clusters/${cluster}/backup/restoreJobs" "$body" \
    | jq '{id, deliveryType, status, targetClusterName}'
}

case "${1:-}" in
  list)    cmd_list    "${2:-}" ;;
  create)  cmd_create  "${2:-}" "${3:-}" "${4:-}" ;;
  restore) cmd_restore "${2:-}" "${3:-}" "${4:-}" ;;
  *)
    echo "Uso: $0 {list|create|restore} [args]"
    exit 1
    ;;
esac
