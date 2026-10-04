#!/usr/bin/env bash
# ip-access-list.sh — gestión de la IP Access List (lista blanca de IPs) de un proyecto Atlas.
#
# Qué hace:     Lista, añade o elimina entradas IP/CIDR de la IP Access List del
#               proyecto ATLAS_PROJECT_ID (las IPs desde las que se permite conectar).
# Requisitos:   bash, curl, jq, column. .env configurado (ver ../.env.example).
# Uso:          bash bash/ip-access-list.sh list
#               bash bash/ip-access-list.sh add    <CIDR> ["comentario"]   # ej: 203.0.113.5/32
#               bash bash/ip-access-list.sh delete <CIDR>
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver common.sh / auth.sh).
# Efectos:      list   → SOLO LECTURA.
#               add    → ESCRIBE: abre acceso de red al proyecto desde ese CIDR.
#               delete → ESCRIBE: quita la entrada (los clientes desde esa IP dejan de conectar).
#                        Pide confirmación.
# Salida:       Tabla o JSON resumido por stdout.

set -euo pipefail
source "$(dirname "$0")/common.sh"

PROJECT="/groups/${ATLAS_PROJECT_ID}"

cmd_list() {
  echo "==> IP Access List del proyecto ${ATLAS_PROJECT_ID}"
  # Cada entrada trae cidrBlock o ipAddress según cómo se creó.
  atlas_request GET "${PROJECT}/accessList" \
    | jq -r '.results[] | "\(.cidrBlock // .ipAddress)\t\(.comment // "-")"' \
    | column -t -s $'\t'
}

# ESCRIBE: añade una entrada
cmd_add() {
  local cidr="${1:?Uso: ip-access-list.sh add <cidr> [comment]}"
  local comment="${2:-Añadido via script}"

  # La API espera un ARRAY de entradas.
  local body
  body=$(jq -n \
    --arg cidr "$cidr" \
    --arg c "$comment" \
    '[{cidrBlock: $cidr, comment: $c}]')

  echo "==> Añadiendo $cidr al access list"
  atlas_request POST "${PROJECT}/accessList" "$body" \
    | jq '.results[] | {cidrBlock, ipAddress, comment}'
}

# ESCRIBE: elimina una entrada
cmd_delete() {
  # La API espera la IP/CIDR URL-encoded (/ → %2F)
  local cidr="${1:?Uso: ip-access-list.sh delete <cidr>}"
  local encoded="${cidr//\//%2F}"
  read -r -p "¿Eliminar '${cidr}' del access list? [y/N] " confirm
  [[ "${confirm}" =~ ^[yY]$ ]] || { echo "Cancelado."; exit 0; }
  atlas_request DELETE "${PROJECT}/accessList/${encoded}"
  echo "Entrada '${cidr}' eliminada."
}

case "${1:-}" in
  list)   cmd_list ;;
  add)    cmd_add    "${2:-}" "${3:-}" ;;
  delete) cmd_delete "${2:-}" ;;
  *)
    echo "Uso: $0 {list|add|delete} [args]"
    exit 1
    ;;
esac
