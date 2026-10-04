#!/usr/bin/env bash
set -uo pipefail
# paginated-api-loop.sh — pide un listado a una API REST y luego el detalle de cada id
#
# Qué hace:     1) Hace un GET al endpoint de listado pidiendo una página grande
#                  (?<PAGE_SIZE_PARAM>=<PAGE_SIZE>) y extrae los ids con LIST_JQ.
#               2) Para cada id hace GET <ENDPOINT>/<id>, filtra la respuesta con DETAIL_JQ
#                  y la añade a OUTPUT_FILE.
#               Patrón típico "get all + get by id" para revisar todos los elementos de una API.
# Requisitos:   bash, curl, jq. Token Bearer válido para la API.
# Uso:          API_TOKEN=<TOKEN> BASE_URL=https://api.example.com ENDPOINT=/rest/items/v1 ./paginated-api-loop.sh
#               API_TOKEN=<TOKEN> BASE_URL=... ENDPOINT=... LIST_JQ='.courses[].id' \
#                 DETAIL_JQ='select(.active == true) | {id, name}' ./paginated-api-loop.sh
# Variables:    API_TOKEN        (obligatoria) token Bearer (JWT u otro). Se envía en la cabecera
#                                Authorization. Sale del login de la API o de tu gestor de secretos.
#               BASE_URL         (obligatoria) esquema + host, sin barra final.
#               ENDPOINT         (obligatoria) ruta del recurso, empezando por "/".
#               PAGE_SIZE_PARAM  (opcional, defecto: pageSize) nombre del parámetro de tamaño de página.
#               PAGE_SIZE        (opcional, defecto: 1000) cuántos elementos pedir en el listado.
#               LIST_JQ          (opcional, defecto: .items[].id) filtro jq que extrae los ids del listado.
#               DETAIL_JQ        (opcional, defecto: .) filtro jq aplicado a cada detalle.
#               OUTPUT_FILE      (opcional, defecto: response.log) fichero donde se acumulan resultados.
# Efectos:      SOLO LECTURA en la API (solo GET). ESCRIBE: añade (>>) a OUTPUT_FILE en local.
# Salida:       URL consultada por pantalla; resultados filtrados + marca de fin y fecha en OUTPUT_FILE.

: "${API_TOKEN:?Define API_TOKEN (token Bearer de la API)}"
: "${BASE_URL:?Define BASE_URL (ej: https://api.example.com)}"
: "${ENDPOINT:?Define ENDPOINT (ej: /rest/items/v1)}"
PAGE_SIZE_PARAM="${PAGE_SIZE_PARAM:-pageSize}"
PAGE_SIZE="${PAGE_SIZE:-1000}"
LIST_JQ="${LIST_JQ:-.items[].id}"
DETAIL_JQ="${DETAIL_JQ:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-response.log}"

# 1) Listado: un único GET con página grande. jq -r → ids sin comillas, uno por línea.
#    curl -sS: sin barra de progreso pero mostrando errores.
ids=$(curl -sS "$BASE_URL$ENDPOINT/?$PAGE_SIZE_PARAM=$PAGE_SIZE" \
  -H "Authorization: Bearer $API_TOKEN" | jq -r "$LIST_JQ")

# 2) Detalle de cada id. Errores de jq (p. ej. respuesta no JSON) también van al fichero.
for id in $ids; do
  echo "$BASE_URL$ENDPOINT/$id"
  curl -sS "$BASE_URL$ENDPOINT/$id" -H "Authorization: Bearer $API_TOKEN" |
    jq "$DETAIL_JQ" >> "$OUTPUT_FILE" 2>> "$OUTPUT_FILE"
done

echo "----------end----------------" >> "$OUTPUT_FILE"
date '+%Y-%m-%d  %H:%M:%S' >> "$OUTPUT_FILE"
