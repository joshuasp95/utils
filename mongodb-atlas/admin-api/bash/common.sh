#!/usr/bin/env bash
# common.sh — funciones compartidas (carga de .env, token y llamada genérica a la API).
#
# Qué hace:     Se carga con `source` desde los demás scripts. Lee ../.env, valida
#               ATLAS_PROJECT_ID, obtiene token vía auth.sh si no existe ATLAS_TOKEN
#               y define atlas_request <METHOD> <path> [body_json].
# Requisitos:   bash, curl, jq.
# Uso:          source "$(dirname "$0")/common.sh"   (no se ejecuta directamente)
# Variables:    ATLAS_PROJECT_ID   (obligatoria) ID del proyecto (groupId).
#               ATLAS_API_BASE     (opcional) URL base de la Admin API v2.
#               ATLAS_API_VERSION  (opcional) versión de API para la cabecera Accept.
#               ATLAS_TOKEN        (opcional) si ya existe, se reutiliza.
# Efectos:      Ninguno por sí mismo; el efecto lo decide el METHOD que pase quien llame
#               (GET = lectura; POST/PATCH/DELETE = escritura).
# Salida:       atlas_request imprime el JSON de respuesta por stdout; errores por stderr.

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${COMMON_DIR}/../.env"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

: "${ATLAS_API_BASE:=https://cloud.mongodb.com/api/atlas/v2}"
: "${ATLAS_API_VERSION:=2023-02-01}"
: "${ATLAS_PROJECT_ID:?Define ATLAS_PROJECT_ID (Atlas UI → Project Settings → Project ID)}"

# Obtiene token si no está ya en el entorno
atlas_ensure_token() {
  if [[ -z "${ATLAS_TOKEN:-}" ]]; then
    # shellcheck disable=SC1091
    source "${COMMON_DIR}/auth.sh"
  fi
}

# Llamada genérica a la API
# Uso: atlas_request <METHOD> <path> [body_json]
#   <path> es relativo a ATLAS_API_BASE, p.ej. /groups/<ATLAS_PROJECT_ID>/clusters
atlas_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${ATLAS_API_BASE}${path}"

  atlas_ensure_token

  # Accept: application/vnd.atlas.<fecha>+json selecciona la versión de la API v2
  # (Atlas versiona por fecha; sin esta cabecera la petición falla).
  local curl_args=(
    -s -X "$method" "$url"
    -H "Authorization: Bearer ${ATLAS_TOKEN}"
    -H "Accept: application/vnd.atlas.${ATLAS_API_VERSION}+json"
    -H "Content-Type: application/json"
  )

  [[ -n "$body" ]] && curl_args+=(-d "$body")

  response=$(curl "${curl_args[@]}")
  # La API devuelve un objeto con "error" (código HTTP) cuando algo falla.
  http_status=$(echo "$response" | jq -r '.error // "ok"')

  if [[ "$http_status" != "ok" ]]; then
    echo "Error de API: $(echo "$response" | jq -r '.detail // .reason // .error')" >&2
    echo "$response" | jq . >&2
    return 1
  fi

  echo "$response"
}

# Pretty-print JSON
pp() { jq .; }
