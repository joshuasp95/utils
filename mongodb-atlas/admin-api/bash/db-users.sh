#!/usr/bin/env bash
# db-users.sh — gestión de usuarios de base de datos de un proyecto Atlas vía Admin API v2.
#
# Qué hace:     Lista, describe, crea, rota la contraseña o elimina usuarios de BD
#               (database users) del proyecto ATLAS_PROJECT_ID.
# Requisitos:   bash, curl, jq, column. .env configurado (ver ../.env.example).
# Uso:          bash bash/db-users.sh list
#               bash bash/db-users.sh get    <USERNAME> [authDb]
#               bash bash/db-users.sh create <USERNAME> <PASSWORD> <ROLE>
#               bash bash/db-users.sh rotate <USERNAME> <NEW_PASSWORD> [authDb]
#               bash bash/db-users.sh delete <USERNAME> [authDb]
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver common.sh / auth.sh).
#               authDb: base de datos de autenticación del usuario (por defecto admin).
# Efectos:      list, get → SOLO LECTURA.
#               create    → ESCRIBE: crea un usuario de BD con el rol indicado (sobre authDb admin).
#               rotate    → ESCRIBE: cambia la contraseña (las apps con la antigua dejan de conectar).
#               delete    → ESCRIBE (DESTRUCTIVO): elimina el usuario. Pide confirmación.
#               Ojo: la contraseña pasada como argumento queda en el historial del shell.
# Salida:       Tabla o JSON resumido por stdout.

set -euo pipefail
source "$(dirname "$0")/common.sh"

PROJECT="/groups/${ATLAS_PROJECT_ID}"
DEFAULT_AUTH_DB="admin"

cmd_list() {
  echo "==> Usuarios de BD del proyecto ${ATLAS_PROJECT_ID}"
  # jq: usuario, authDb y roles unidos por comas (map(.roleName) | join(","))
  atlas_request GET "${PROJECT}/databaseUsers" \
    | jq -r '.results[] | "\(.username)\t\(.databaseName)\t\(.roles | map(.roleName) | join(","))"' \
    | column -t -s $'\t'
}

cmd_get() {
  local username="${1:?Uso: db-users.sh get <username> [authDb]}"
  local auth_db="${2:-$DEFAULT_AUTH_DB}"
  echo "==> Usuario: $username (authDb: $auth_db)"
  atlas_request GET "${PROJECT}/databaseUsers/${auth_db}/${username}" \
    | jq '{username, databaseName, roles, scopes}'
}

# ESCRIBE: crea un usuario
cmd_create() {
  local username="${1:?Uso: db-users.sh create <username> <password> <role>}"
  local password="${2:?Falta contraseña}"
  local role="${3:?Falta rol (ej: readWriteAnyDatabase)}"

  # jq -n construye el JSON desde cero; --arg pasa valores escapados correctamente.
  local body
  body=$(jq -n \
    --arg u "$username" \
    --arg p "$password" \
    --arg r "$role" \
    '{
      username: $u,
      password: $p,
      databaseName: "admin",
      roles: [{roleName: $r, databaseName: "admin"}]
    }')

  echo "==> Creando usuario: $username con rol $role"
  atlas_request POST "${PROJECT}/databaseUsers" "$body" \
    | jq '{username, databaseName, roles}'
}

# ESCRIBE: rota la contraseña
cmd_rotate() {
  local username="${1:?Uso: db-users.sh rotate <username> <newPassword> [authDb]}"
  local new_password="${2:?Falta nueva contraseña}"
  local auth_db="${3:-$DEFAULT_AUTH_DB}"

  local body
  body=$(jq -n --arg p "$new_password" '{password: $p}')

  echo "==> Rotando contraseña de: $username"
  atlas_request PATCH "${PROJECT}/databaseUsers/${auth_db}/${username}" "$body" \
    | jq '{username, databaseName}'
  echo "Contraseña actualizada."
}

# ESCRIBE (DESTRUCTIVO): elimina el usuario
cmd_delete() {
  local username="${1:?Uso: db-users.sh delete <username> [authDb]}"
  local auth_db="${2:-$DEFAULT_AUTH_DB}"
  read -r -p "¿Eliminar usuario '${username}'? [y/N] " confirm
  [[ "${confirm}" =~ ^[yY]$ ]] || { echo "Cancelado."; exit 0; }
  atlas_request DELETE "${PROJECT}/databaseUsers/${auth_db}/${username}"
  echo "Usuario '${username}' eliminado."
}

case "${1:-}" in
  list)   cmd_list ;;
  get)    cmd_get    "${2:-}" "${3:-}" ;;
  create) cmd_create "${2:-}" "${3:-}" "${4:-}" ;;
  rotate) cmd_rotate "${2:-}" "${3:-}" "${4:-}" ;;
  delete) cmd_delete "${2:-}" "${3:-}" ;;
  *)
    echo "Uso: $0 {list|get|create|rotate|delete} [args]"
    exit 1
    ;;
esac
