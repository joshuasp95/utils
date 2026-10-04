#!/usr/bin/env bash
set -euo pipefail

# azure-readonly-sweep.sh — barrido mensual de salud de una suscripción Azure, en SOLO LECTURA.
#
# Qué hace:     Para cada entorno (dev/qa/prod por defecto) recoge en ficheros de texto: inventario
#               del resource group, salud y métricas de Container Apps, operaciones fallidas del
#               Activity Log (30 días), enrutado y patrones de error en Log Analytics, telemetría de
#               Application Insights, salud y métricas de PostgreSQL Flexible Server y Front Door/CDN.
#               Al final, inventario de Data Factory (con ejecuciones de pipelines) y Databricks.
# Requisitos:   az CLI (con extensiones containerapp, datafactory, databricks; az las ofrece instalar
#               al primer uso), jq, awk. Sesión iniciada con `az login` y lectura sobre la suscripción.
# Uso:          AZ_SUBSCRIPTION="<SUBSCRIPTION_NAME_O_ID>" ./azure-readonly-sweep.sh <DIRECTORIO_SALIDA>
#               AZ_SUBSCRIPTION=... ENVIRONMENTS="qa prod" CONTAINER_APPS="ca-api-{env}" ./azure-readonly-sweep.sh out/
# Variables:    $1                  directorio de salida (se crea si no existe). Obligatorio.
#               AZ_SUBSCRIPTION     nombre o id de la suscripción (`az account list -o table`). Obligatoria.
#               ENVIRONMENTS        entornos separados por espacios (def. "dev qa prod").
#               Plantillas de nombres: `{env}` se sustituye por cada entorno.
#               RG_TEMPLATE         resource group                 (def. "rg-app-{env}")
#               CONTAINER_APPS      Container Apps, separadas por espacios (def. "ca-api-{env} ca-worker-{env}")
#               LAW_TEMPLATE        workspace de Log Analytics     (def. "law-app-{env}")
#               CAE_TEMPLATE        Container Apps Environment     (def. "cae-app-{env}")
#               APPI_TEMPLATE       componente Application Insights (def. "appi-{env}")
#               POSTGRES_SERVERS    PostgreSQL Flexible Servers, separados por espacios (def. "psql-app-{env}")
#               AZ_BIN              binario de az (def. "az"); RUN_DATE fecha mostrada (def. hoy).
#               Los nombres reales se ven en `az resource list -g <RG> -o table`.
# Efectos:      SOLO LECTURA en Azure (show/list/query). ESCRIBE: ficheros en <DIRECTORIO_SALIDA>.
# Salida:       <DIR>/00-account-and-window.txt, <DIR>/<env>/NN-*.txt|tsv por entorno y
#               <DIR>/shared-10-data-platform-inventory.txt.

: "${AZ_SUBSCRIPTION:?Define AZ_SUBSCRIPTION (ej: AZ_SUBSCRIPTION='<SUBSCRIPTION_NAME_O_ID>')}"
SUBSCRIPTION="$AZ_SUBSCRIPTION"
AZ_BIN="${AZ_BIN:-az}"
RUN_DATE="${RUN_DATE:-$(date +%F)}"
OUT_DIR="${1:?Usage: $0 <output-directory>}"
ENVIRONMENTS="${ENVIRONMENTS:-dev qa prod}"
# Marcador literal que tpl() sustituye por el entorno (variable aparte por compatibilidad con bash 3.2).
E='{env}'
RG_TEMPLATE="${RG_TEMPLATE:-rg-app-$E}"
CONTAINER_APPS="${CONTAINER_APPS:-ca-api-$E ca-worker-$E}"
LAW_TEMPLATE="${LAW_TEMPLATE:-law-app-$E}"
CAE_TEMPLATE="${CAE_TEMPLATE:-cae-app-$E}"
APPI_TEMPLATE="${APPI_TEMPLATE:-appi-$E}"
POSTGRES_SERVERS="${POSTGRES_SERVERS:-psql-app-$E}"

# Ventana de 30 días en UTC. `date -v-30d` es la sintaxis BSD (macOS); si falla, se usa la de
# GNU date (Linux): `date -d '30 days ago'`.
START_UTC="$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
END_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT_DIR"

# Todas las llamadas a az pasan por aquí para fijar siempre la suscripción (evita leer otra por error).
az_ro() {
  "$AZ_BIN" "$@" --subscription "$SUBSCRIPTION"
}

# Sustituye `{env}` por el entorno actual ($env) en una plantilla de nombre.
tpl() {
  local t="$1"
  printf '%s' "${t//\$E/$env}"
}

section() {
  printf '\n================================================================\n%s\n================================================================\n' "$1"
}

# Resume métricas de PostgreSQL (30 días, granularidad 1 h) en una tabla TSV:
# máximo de las medias, máximo, mínimo, total y último valor con su hora.
metric_summary() {
  local resource_id="$1"
  local destination="$2"
  local metric_json
  metric_json="$(mktemp)"

  if az_ro monitor metrics list \
    --resource "$resource_id" \
    --metrics cpu_percent memory_percent storage_percent connections_failed is_db_alive \
    --aggregation Average Maximum Minimum Total \
    --interval PT1H \
    --start-time "$START_UTC" \
    --end-time "$END_UTC" \
    -o json > "$metric_json" 2>/dev/null; then
    # jq: por cada métrica junta todos los puntos de la serie y calcula los agregados; @tsv = tabulado.
    jq -r '
      .value[] |
      .name.value as $metric |
      [(.timeseries[]?.data[]?)] as $points |
      ([$points[]? | select(.average != null or .maximum != null or .minimum != null or .total != null)][-1] // {}) as $latest |
      [$metric,
       (([$points[]?.average // empty] | max) // "n/a"),
       (([$points[]?.maximum // empty] | max) // "n/a"),
       (([$points[]?.minimum // empty] | min) // "n/a"),
       (([$points[]?.total // empty] | add) // "n/a"),
       ($latest.average // $latest.maximum // $latest.minimum // $latest.total // "n/a"),
       ($latest.timeStamp // "n/a")]
      | @tsv
    ' "$metric_json" | awk 'BEGIN {print "Metric\tMaxAvg\tMax\tMin\tTotal\tLatest\tLatestTime"} {print}' > "$destination"
  else
    printf 'Metrics query failed or the requested metrics are unavailable.\n' > "$destination"
  fi

  rm -f "$metric_json"
}

# Igual que metric_summary pero para Container Apps: una consulta por métrica con su agregación
# (las métricas de Container Apps no admiten todas las agregaciones a la vez).
container_metric_summary() {
  local resource_id="$1"
  local destination="$2"
  local metric aggregation result

  printf 'Metric\tAggregation\tMaximumObserved\tLatestObserved\tLatestTime\n' > "$destination"
  while IFS='|' read -r metric aggregation; do
    result="$(az_ro monitor metrics list \
      --resource "$resource_id" \
      --metrics "$metric" \
      --aggregation "$aggregation" \
      --interval PT1H \
      --start-time "$START_UTC" \
      --end-time "$END_UTC" \
      -o json 2>/dev/null || true)"

    if [[ -n "$result" ]]; then
      jq -r --arg metric "$metric" --arg aggregation "$aggregation" '
        [(.value[0].timeseries[]?.data[]?)] as $points |
        ($aggregation | ascii_downcase) as $field |
        [
          $metric,
          $aggregation,
          (([$points[]? | .[$field] // empty] | max) // "n/a"),
          (([$points[]? | select(.[$field] != null)][-1][$field]) // "n/a"),
          (([$points[]? | select(.[$field] != null)][-1].timeStamp) // "n/a")
        ] | @tsv
      ' <<< "$result" >> "$destination"
    else
      printf '%s\t%s\tn/a\tn/a\tn/a\n' "$metric" "$aggregation" >> "$destination"
    fi
  done <<'METRICS'
CpuPercentage|Average
MemoryPercentage|Average
ResponseTime|Average
Replicas|Average
Requests|Total
METRICS
}

# Ejecuta una consulta KQL (lenguaje de consulta de Log Analytics) sobre los últimos 30 días (P30D,
# formato ISO 8601) y guarda el resultado en tabla. Si falla, deja el error en el propio fichero.
run_log_query() {
  local workspace_id="$1"
  local query="$2"
  local destination="$3"

  if ! az_ro monitor log-analytics query \
    --workspace "$workspace_id" \
    --analytics-query "$query" \
    --timespan "P30D" \
    -o table > "$destination" 2>&1; then
    printf '\nQUERY_STATUS: failed; inspect the concise CLI error above.\n' >> "$destination"
  fi
}

{
  section "MONTHLY CHECK AZURE SWEEP"
  printf 'Run date: %s\nWindow: %s to %s\n' "$RUN_DATE" "$START_UTC" "$END_UTC"
  az_ro account show --query '{Subscription:name,User:user.name,Tenant:tenantId}' -o table
} > "$OUT_DIR/00-account-and-window.txt"

for env in $ENVIRONMENTS; do
  rg="$(tpl "$RG_TEMPLATE")"
  law="$(tpl "$LAW_TEMPLATE")"
  cae="$(tpl "$CAE_TEMPLATE")"
  appi="$(tpl "$APPI_TEMPLATE")"
  env_out="$OUT_DIR/$env"
  mkdir -p "$env_out"

  # Lista de Container Apps del entorno y la misma lista en formato KQL: "a", "b", "c"
  apps=()
  apps_csv=""
  for app_tpl in $CONTAINER_APPS; do
    app="$(tpl "$app_tpl")"
    apps+=("$app")
    apps_csv="${apps_csv}${apps_csv:+, }\"$app\""
  done

  {
    section "RESOURCE GROUP $rg"
    az_ro group show --name "$rg" --query '{Name:name,Location:location,Provisioning:properties.provisioningState}' -o table
    printf '\nResource inventory by type:\n'
    az_ro resource list --resource-group "$rg" \
      --query "[].{Name:name,Type:type,Location:location}" -o table
  } > "$env_out/01-resource-group-inventory.txt"

  {
    section "CONTAINER APPS $env"
    for app in "${apps[@]}"; do
      printf '\n-- %s --\n' "$app"
      az_ro containerapp show --resource-group "$rg" --name "$app" \
        --query '{Name:name,Running:properties.runningStatus,Provisioning:properties.provisioningState,LatestReadyRevision:properties.latestReadyRevisionName,MinReplicas:properties.template.scale.minReplicas,MaxReplicas:properties.template.scale.maxReplicas}' -o table
      # Solo revisiones activas ([?properties.active] es un filtro JMESPath).
      az_ro containerapp revision list --resource-group "$rg" --name "$app" \
        --query "[?properties.active].{Revision:name,Active:properties.active,Health:properties.healthState,Replicas:properties.replicas,Created:properties.createdTime}" -o table
      latest_ready="$(az_ro containerapp show --resource-group "$rg" --name "$app" --query properties.latestReadyRevisionName -o tsv)"
      printf 'Current replica/container state:\n'
      az_ro containerapp replica list --resource-group "$rg" --name "$app" --revision "$latest_ready" \
        --query '[].{Replica:name,Running:properties.runningState,Containers:properties.containers[].{Name:name,Ready:ready,Restarts:restartCount}}' -o json \
        | jq -r '.[] as $replica | $replica.Containers[] | [$replica.Replica, $replica.Running, .Name, .Ready, .Restarts] | @tsv' \
        | awk 'BEGIN {print "Replica\tRunning\tContainer\tReady\tRestarts"} {print}'
      resource_id="$(az_ro containerapp show --resource-group "$rg" --name "$app" --query id -o tsv)"
      container_metric_summary "$resource_id" "$env_out/02-container-metrics-$app.tsv"
      sed -n '1,12p' "$env_out/02-container-metrics-$app.tsv"
    done
  } > "$env_out/02-container-apps-health.txt"

  {
    section "FAILED AZURE OPERATIONS $env (30d)"
    failed_count="$(az_ro monitor activity-log list --resource-group "$rg" --start-time "$START_UTC" --end-time "$END_UTC" --status Failed --query 'length(@)' -o tsv)"
    printf 'Failed operation count: %s\n' "$failed_count"
    if [[ "$failed_count" != "0" ]]; then
      # Agrupa por operación+recurso: cuántas veces, primera y última vez.
      az_ro monitor activity-log list --resource-group "$rg" --start-time "$START_UTC" --end-time "$END_UTC" --status Failed \
        --query "[].{Time:eventTimestamp,Operation:operationName.localizedValue,Resource:resourceId}" -o json \
        | jq -r 'group_by(.Operation + "|" + .Resource)[] | [length, .[0].Operation, .[0].Resource, (map(.Time) | min), (map(.Time) | max)] | @tsv' \
        | awk 'BEGIN {print "Count\tOperation\tResource\tFirstSeen\tLastSeen"} {print}'
    fi
  } > "$env_out/03-activity-failures.txt"

  # customerId = "Workspace ID" (GUID) que pide `az monitor log-analytics query --workspace`.
  workspace_id="$(az_ro monitor log-analytics workspace show --resource-group "$rg" --workspace-name "$law" --query customerId -o tsv)"
  # Workspace al que el Container Apps Environment envía realmente los logs (puede no ser $law).
  configured_logs_workspace_id="$(az_ro containerapp env show --resource-group "$rg" --name "$cae" --query properties.appLogsConfiguration.logAnalyticsConfiguration.customerId -o tsv 2>/dev/null || true)"
  logs_workspace_id="$workspace_id"

  {
    section "CONTAINER APP LOG ROUTING $env"
    printf '%s customerId: %s\n' "$law" "$workspace_id"
    printf '%s configured customerId: %s\n' "$cae" "${configured_logs_workspace_id:-not-configured}"
    if [[ -n "$configured_logs_workspace_id" && "$configured_logs_workspace_id" != "$workspace_id" ]]; then
      printf 'ROUTING_STATUS: mismatch; the Container Apps environment does not target %s.\n' "$law"
      # Consulta mínima (print Probe=1) solo para comprobar si tenemos acceso a ese workspace.
      if az_ro monitor log-analytics query --workspace "$configured_logs_workspace_id" --analytics-query 'print Probe=1' -o none >/dev/null 2>&1; then
        logs_workspace_id="$configured_logs_workspace_id"
        printf 'QUERY_TARGET: configured Container Apps workspace (accessible).\n'
      else
        printf 'QUERY_TARGET: %s fallback; configured workspace is not accessible to the current Azure identity.\n' "$law"
      fi
    else
      printf 'ROUTING_STATUS: configured workspace matches %s.\n' "$law"
    fi
  } > "$env_out/04-loganalytics-routing.txt"

  # La tabla de logs de consola puede existir con el esquema nuevo (ContainerAppConsoleLogs) o el
  # antiguo con sufijo _CL y columnas con sufijo _s. `take 0` comprueba que existe sin traer filas.
  if az_ro monitor log-analytics query --workspace "$logs_workspace_id" --analytics-query 'ContainerAppConsoleLogs | take 0' -o none >/dev/null 2>&1; then
    logs_table="ContainerAppConsoleLogs"
    app_name_column="ContainerAppName"
    log_column="Log"
  elif az_ro monitor log-analytics query --workspace "$logs_workspace_id" --analytics-query 'ContainerAppConsoleLogs_CL | take 0' -o none >/dev/null 2>&1; then
    logs_table="ContainerAppConsoleLogs_CL"
    app_name_column="ContainerAppName_s"
    log_column="Log_s"
  else
    logs_table=""
    app_name_column=""
    log_column=""
  fi

  if [[ -n "$logs_table" ]]; then
    printf 'TABLE_SELECTED: %s\n' "$logs_table" >> "$env_out/04-loganalytics-routing.txt"
    log_presence_query="$logs_table
| where TimeGenerated > ago(30d)
| where $app_name_column in ($apps_csv)
| summarize LastSeen=max(TimeGenerated), Count=count() by $app_name_column
| order by $app_name_column asc"
    run_log_query "$logs_workspace_id" "$log_presence_query" "$env_out/04-loganalytics-presence.txt"

    # Errores: nivel ERROR/FATAL del JSON del log o palabras clave típicas (ajústalas a tu aplicación).
    log_errors_query="$logs_table
| where TimeGenerated > ago(30d)
| where $app_name_column in ($apps_csv)
| extend Parsed=parse_json($log_column)
| extend Level=toupper(tostring(Parsed.log.level)), Message=tostring(Parsed.message)
| where Level in (\"ERROR\", \"FATAL\") or $log_column has_any (\"CredentialUnavailableException\", \"KafkaException\", \"Connection refused\", \"KeyVaultException\")
| extend Pattern=case(Message has \"Broken pipe\", \"Broken pipe/client abort\", Message has \"CredentialUnavailable\", \"Credential unavailable\", Message has \"Kafka\", \"Kafka\", Message has \"Connection refused\", \"Connection refused\", isempty(Level), \"Keyword match\", Level)
| summarize Count=count(), FirstSeen=min(TimeGenerated), LastSeen=max(TimeGenerated) by $app_name_column, Pattern
| order by Count desc"
    run_log_query "$logs_workspace_id" "$log_errors_query" "$env_out/05-loganalytics-error-patterns.txt"
  else
    printf 'No supported Container Apps console-log table was found in workspace %s.\n' "$logs_workspace_id" > "$env_out/04-loganalytics-presence.txt"
    printf 'Error-pattern query skipped because no supported console-log table was found.\n' > "$env_out/05-loganalytics-error-patterns.txt"
  fi

  # Application Insights "workspace-based": su telemetría vive en tablas App* del workspace;
  # _ResourceId identifica el componente de App Insights que la envió.
  appi_query="union withsource=TableName isfuzzy=true AppDependencies, AppExceptions, AppTraces
| where TimeGenerated > ago(30d)
| where _ResourceId endswith \"/$appi\"
| summarize Count=count(), LastSeen=max(TimeGenerated) by TableName
| order by TableName asc"
  run_log_query "$workspace_id" "$appi_query" "$env_out/06-appinsights-telemetry.txt"

  appi_exception_query="AppExceptions
| where TimeGenerated > ago(30d)
| where _ResourceId endswith \"/$appi\"
| extend Pattern=coalesce(OuterType, ProblemId, \"Unknown\")
| summarize Count=sum(ItemCount), LastSeen=max(TimeGenerated) by Pattern
| top 10 by Count desc"
  run_log_query "$workspace_id" "$appi_exception_query" "$env_out/07-appinsights-top-exceptions.txt"

  {
    section "POSTGRESQL $env"
    for server_tpl in $POSTGRES_SERVERS; do
      server="$(tpl "$server_tpl")"
      printf '\n-- %s --\n' "$server"
      az_ro postgres flexible-server show --resource-group "$rg" --name "$server" \
        --query '{Name:name,State:state,Version:version,Tier:sku.tier,Sku:sku.name,StorageGB:storage.storageSizeGb,AutoGrow:storage.autoGrow,BackupDays:backup.backupRetentionDays,HA:highAvailability.mode}' -o table
      resource_id="$(az_ro postgres flexible-server show --resource-group "$rg" --name "$server" --query id -o tsv)"
      metric_summary "$resource_id" "$env_out/08-postgresql-$server-metrics.tsv"
      sed -n '1,20p' "$env_out/08-postgresql-$server-metrics.tsv"
    done
  } > "$env_out/08-postgresql-health.txt"

  {
    section "FRONT DOOR / CDN $env"
    az_ro resource list --resource-group "$rg" \
      --query "[?type=='Microsoft.Cdn/profiles' || type=='Microsoft.Network/frontDoors'].{Name:name,Type:type,Location:location}" -o table
  } > "$env_out/09-front-door-inventory.txt"
done

# Sección común a toda la suscripción (no depende del entorno).
{
  section "DATA FACTORY INVENTORY"
  az_ro datafactory list --query '[].{Name:name,ResourceGroup:resourceGroup,Location:location,Provisioning:provisioningState}' -o table
  while IFS=$'\t' read -r factory factory_rg; do
    [[ -z "$factory" ]] && continue
    printf '\n-- %s (%s) pipeline runs, 30d --\n' "$factory" "$factory_rg"
    # Ejecuciones de pipelines en la ventana, agrupadas por pipeline y estado (Succeeded/Failed...).
    az_ro datafactory pipeline-run query-by-factory \
      --factory-name "$factory" \
      --resource-group "$factory_rg" \
      --last-updated-after "$START_UTC" \
      --last-updated-before "$END_UTC" \
      --query 'value[].{Pipeline:pipelineName,Status:status}' -o json \
      | jq -r 'group_by(.Pipeline + "|" + .Status)[] | [.[0].Pipeline, .[0].Status, length] | @tsv' \
      | awk 'BEGIN {print "Pipeline\tStatus\tCount"} {print}'
  done < <(az_ro datafactory list --query '[].[name,resourceGroup]' -o tsv)
  section "DATABRICKS WORKSPACE INVENTORY"
  az_ro databricks workspace list --query '[].{Name:name,ResourceGroup:resourceGroup,Location:location,Provisioning:provisioningState}' -o table
} > "$OUT_DIR/shared-10-data-platform-inventory.txt"

printf 'Azure sweep completed: %s\n' "$OUT_DIR"
