#!/usr/bin/env bash
# atlas-latency-metrics.sh — recoge en SOLO LECTURA las métricas de Atlas para valorar el
#                            impacto de la latencia de red sobre un cluster concreto.
#
# Qué hace:     Para un cluster (p.ej. accedido cross-cloud vía Private Link) guarda:
#               1) su configuración (versión, tier, región, connection strings),
#               2) los puertos de Private Link usados por TODOS los clusters del proyecto,
#               3) los nodos (procesos) de su replica set,
#               4) métricas por nodo (tiempo de ejecución, opcounters, conexiones...),
#               5) un resumen min/media/p95/max por métrica y nodo.
# Requisitos:   atlas CLI autenticado (`atlas auth login`), jq, awk, grep, paste.
# Uso:          ./atlas-latency-metrics.sh <PROJECT_ID> <CLUSTER_NAME> [periodo] [granularidad]
#               ./atlas-latency-metrics.sh <PROJECT_ID> my-cluster P7D PT1H
#               OUTDIR=/tmp/latencia ./atlas-latency-metrics.sh <PROJECT_ID> my-cluster
# Variables:    $1 PROJECT_ID   ID del proyecto Atlas (`atlas projects list` o Project Settings).
#               $2 CLUSTER_NAME nombre del cluster (`atlas clusters list --projectId <PROJECT_ID>`).
#               $3 periodo      ventana en formato ISO 8601 duration (P7D = 7 días). Por defecto P7D.
#               $4 granularidad tamaño de cada punto (PT1H = 1 hora, PT5M = 5 min). Por defecto PT1H.
#               OUTDIR          (opcional) carpeta de salida. Por defecto
#                               ./output/atlas-latency-<CLUSTER_NAME>-<fecha> junto al script.
# Efectos:      SOLO LECTURA en Atlas (solo describe/list/metrics). ESCRIBE ficheros locales en OUTDIR.
# Salida:       OUTDIR/01-cluster-describe.json, 01-cluster-resumen.txt, 02-privatelink-ports.txt,
#               03-processes-raw.json, 03-nodos.txt, 04-metrics-<nodo>.json, 05-resumen-metricas.txt.

set -euo pipefail

PROJECT_ID="${1:?Uso: $0 <projectId> <clusterName> [periodo] [granularidad]}"
CLUSTER="${2:?Uso: $0 <projectId> <clusterName> [periodo] [granularidad]}"
PERIOD="${3:-P7D}"
GRANULARITY="${4:-PT1H}"

STAMP="$(date +%Y-%m-%d)"
OUTDIR="${OUTDIR:-$(dirname "$0")/output/atlas-latency-${CLUSTER}-${STAMP}}"
mkdir -p "$OUTDIR"

echo "==> Proyecto:   $PROJECT_ID"
echo "==> Cluster:    $CLUSTER"
echo "==> Periodo:    $PERIOD (granularidad $GRANULARITY)"
echo "==> Salida:     $OUTDIR"
echo

# ---------------------------------------------------------------------------
# 1. Configuracion del cluster: version, region, cadenas de conexion y, sobre
#    todo, los PUERTOS que el Private Link expone hoy para cada nodo.
# ---------------------------------------------------------------------------
echo "--> [1/5] Configuracion del cluster"
atlas clusters describe "$CLUSTER" --projectId "$PROJECT_ID" -o json \
  > "$OUTDIR/01-cluster-describe.json"

# Nombre del replica set: se extrae del parámetro replicaSet=... de la connection
# string del private endpoint (vacío si el cluster no tiene Private Link).
REPLICA_SET="$(jq -r '.connectionStrings.privateEndpoint[0].connectionString // ""' \
  "$OUTDIR/01-cluster-describe.json" | sed -n 's/.*replicaSet=\([^&]*\).*/\1/p')"

jq -r '
  "Cluster:      \(.name)",
  "Version:      \(.mongoDBVersion)",
  "Tier:         \(.replicationSpecs[0].regionConfigs[0].electableSpecs.instanceSize)",
  "Proveedor:    \(.replicationSpecs[0].regionConfigs[0].providerName)/\(.replicationSpecs[0].regionConfigs[0].regionName)",
  "SRV publico:  \(.connectionStrings.standardSrv // "-")",
  "SRV privado:  \(.connectionStrings.privateEndpoint[0].srvConnectionString // "-")",
  "Private Link: \(.connectionStrings.privateEndpoint[0].connectionString // "-")"
' "$OUTDIR/01-cluster-describe.json" | tee "$OUTDIR/01-cluster-resumen.txt"
echo

# ---------------------------------------------------------------------------
# 2. Puertos de Private Link en uso por TODOS los clusters del proyecto.
#    Es lo que determina que rango de puertos tiene que reenviar el
#    balanceador/firewall intermedio. Atlas los asigna por nodo y los puede
#    reasignar; el rango crece segun se anaden clusters al proyecto.
# ---------------------------------------------------------------------------
echo "--> [2/5] Puertos de Private Link usados en el proyecto"
: > "$OUTDIR/02-privatelink-ports.txt"
for c in $(atlas clusters list --projectId "$PROJECT_ID" -o json | jq -r '.results[].name'); do
  cs="$(atlas clusters describe "$c" --projectId "$PROJECT_ID" -o json \
        | jq -r '.connectionStrings.privateEndpoint[0].connectionString // "sin-private-link"')"
  ports="$(printf '%s' "$cs" | grep -oE ':[0-9]{4,5}' | tr -d ':' | paste -sd, - || true)"
  printf '%-35s %s\n' "$c" "${ports:-sin-private-link}" >> "$OUTDIR/02-privatelink-ports.txt"
done
sort "$OUTDIR/02-privatelink-ports.txt" -o "$OUTDIR/02-privatelink-ports.txt"
cat "$OUTDIR/02-privatelink-ports.txt"
echo

# ---------------------------------------------------------------------------
# 3. Nodos (procesos) del replica set del cluster.
# ---------------------------------------------------------------------------
echo "--> [3/5] Nodos del replica set ($REPLICA_SET)"
atlas processes list --projectId "$PROJECT_ID" -o json > "$OUTDIR/03-processes-raw.json"
# ${REPLICA_SET%-shard-0} quita el sufijo "-shard-0"; los ids de proceso del cluster
# contienen ese prefijo, así que se filtran con test() (regex de jq).
PROCESSES="$(jq -r --arg rs "${REPLICA_SET%-shard-0}" \
  '.results[] | select(.id | test($rs)) | .id' "$OUTDIR/03-processes-raw.json")"

jq -r --arg rs "${REPLICA_SET%-shard-0}" \
  '.results[] | select(.id | test($rs)) | "\(.id)\t\(.typeName)"' \
  "$OUTDIR/03-processes-raw.json" | tee "$OUTDIR/03-nodos.txt"
echo

# ---------------------------------------------------------------------------
# 4. Metricas por nodo.
#
#    OP_EXECUTION_TIME_*  -> tiempo que la operacion tarda DENTRO del servidor.
#                            Es la referencia contra la que hay que comparar
#                            la latencia de red: si el servidor tarda 40 ms,
#                            +7 ms de red es ruido; si tarda 1 ms, no lo es.
#    OPCOUNTER_*          -> volumen de operaciones (ops/segundo).
#    CONNECTIONS          -> conexiones abiertas; si oscila mucho, hay churn de
#                            pool y cada reconexion paga varios RTT de red.
#    QUERY_TARGETING_*    -> eficiencia de las consultas (docs examinados por
#                            documento devuelto).
# ---------------------------------------------------------------------------
echo "--> [4/5] Metricas por nodo"
METRICS=(
  OP_EXECUTION_TIME_READS
  OP_EXECUTION_TIME_WRITES
  OP_EXECUTION_TIME_COMMANDS
  OPCOUNTER_QUERY
  OPCOUNTER_INSERT
  OPCOUNTER_UPDATE
  OPCOUNTER_CMD
  CONNECTIONS
  QUERY_TARGETING_SCANNED_OBJECTS_PER_RETURNED
  NETWORK_NUM_REQUESTS
)
TYPE_ARGS=()
for m in "${METRICS[@]}"; do TYPE_ARGS+=(--type "$m"); done

for p in $PROCESSES; do
  safe="${p%%.*}"
  atlas metrics processes "$p" --projectId "$PROJECT_ID" \
    --granularity "$GRANULARITY" --period "$PERIOD" "${TYPE_ARGS[@]}" -o json \
    > "$OUTDIR/04-metrics-${safe}.json"
  echo "    guardado: 04-metrics-${safe}.json"
done
echo

# ---------------------------------------------------------------------------
# 5. Resumen estadistico legible: min / media / p95 / max por metrica y nodo.
# ---------------------------------------------------------------------------
echo "--> [5/5] Resumen estadistico"
{
  printf '%-46s %-42s %10s %10s %10s %10s %7s\n' \
    NODO METRICA MIN MEDIA P95 MAX MUESTRAS
  for f in "$OUTDIR"/04-metrics-*.json; do
    # jq: por cada métrica, valores no nulos ordenados ($s) → min ($s[0]), media,
    # p95 (posición floor(n*0.95)) y max ($s[-1]), redondeados a 3 decimales.
    jq -r '
      .hostId as $h
      | .measurements[]
      | . as $m
      | [ .dataPoints[] | select(.value != null) | .value ] as $v
      | select(($v | length) > 0)
      | ($v | sort) as $s
      | [ $h,
          ($m.name + " (" + ($m.units // "-") + ")"),
          ($s[0]                              | .*1000 | round / 1000),
          (($v | add) / ($v | length)          | .*1000 | round / 1000),
          ($s[ (($s|length) * 0.95 | floor) ]  | .*1000 | round / 1000),
          ($s[-1]                              | .*1000 | round / 1000),
          ($v | length)
        ] | @tsv
    ' "$f"
  done | awk -F'\t' '{printf "%-46s %-42s %10s %10s %10s %10s %7s\n",$1,$2,$3,$4,$5,$6,$7}'
} | tee "$OUTDIR/05-resumen-metricas.txt"

echo
echo "==> Listo. Resultados en: $OUTDIR"
