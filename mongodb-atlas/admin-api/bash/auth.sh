#!/usr/bin/env bash
# auth.sh — obtiene un token OAuth2 (Bearer) para la Atlas Admin API con un Service Account.
#
# Qué hace:     Llama al endpoint OAuth2 de Atlas con grant_type=client_credentials,
#               autenticándose con Basic <base64(client_id:client_secret)>, y deja el
#               access_token en ATLAS_TOKEN. Si se hace `source`, lo exporta al shell;
#               si se ejecuta, lo imprime. Lo usa common.sh automáticamente.
# Requisitos:   bash, curl, jq, base64. Un Service Account de Atlas con permisos en el proyecto.
# Uso:          source bash/auth.sh     # carga ATLAS_TOKEN en el shell actual
#               bash bash/auth.sh       # imprime el token (cuidado: es una credencial)
# Variables:    ATLAS_CLIENT_ID      (obligatoria) Client ID del Service Account.
#               ATLAS_CLIENT_SECRET  (obligatoria) Client Secret del Service Account.
#               ATLAS_TOKEN_URL      (opcional) endpoint OAuth2; por defecto el de Atlas.
#               Se leen de ../.env si existe (ver .env.example) o del entorno.
# Efectos:      SOLO LECTURA sobre Atlas (solo emite un token; no cambia recursos).
# Salida:       ATLAS_TOKEN exportada (source) o token por stdout (ejecución directa).
#               El token caduca (expires_in, normalmente 3600 s).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

: "${ATLAS_CLIENT_ID:?Define ATLAS_CLIENT_ID (Client ID del Service Account de Atlas)}"
: "${ATLAS_CLIENT_SECRET:?Define ATLAS_CLIENT_SECRET (Client Secret del Service Account de Atlas)}"
: "${ATLAS_TOKEN_URL:=https://services.cloud.mongodb.com/api/oauth/token}"

# Cabecera HTTP Basic: base64("client_id:client_secret"). tr -d '\n' quita el salto
# de línea que algunas versiones de base64 añaden al final.
BASIC_TOKEN=$(printf '%s:%s' "${ATLAS_CLIENT_ID}" "${ATLAS_CLIENT_SECRET}" | base64 | tr -d '\n')

# -s: silencioso (sin barra de progreso). --data con grant_type=client_credentials es
# el flujo OAuth2 "máquina a máquina" (sin usuario humano).
response=$(curl -s -X POST "$ATLAS_TOKEN_URL" \
  -H "Authorization: Basic ${BASIC_TOKEN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Accept: application/json" \
  --data "grant_type=client_credentials")

# Si la respuesta trae el campo "error", la autenticación ha fallado.
error=$(echo "$response" | jq -r '.error // empty')
if [[ -n "$error" ]]; then
  echo "Error obteniendo token: $(echo "$response" | jq -r '.error_description // .error')" >&2
  exit 1
fi

export ATLAS_TOKEN
ATLAS_TOKEN=$(echo "$response" | jq -r '.access_token')
EXPIRES_IN=$(echo "$response" | jq -r '.expires_in')

# BASH_SOURCE[0] == $0 solo cuando el script se ejecuta (no cuando se hace source).
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Token obtenido (expira en ${EXPIRES_IN}s):"
  echo "$ATLAS_TOKEN"
else
  echo "Token cargado en \$ATLAS_TOKEN (expira en ${EXPIRES_IN}s)" >&2
fi
