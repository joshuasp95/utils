#!/usr/bin/env bash
set -euo pipefail

# azure-readonly-supplemental.sh — consultas KQL complementarias al barrido mensual, en SOLO LECTURA.
#
# Qué hace:     Para cada entorno lanza consultas a Log Analytics que azure-readonly-sweep.sh no cubre:
#               cobertura por tabla de logs de consola (esquema nuevo y antiguo a la vez), patrones de
#               error de Container Apps unificando ambos esquemas, volumen de telemetría de Application
#               Insights (incluye AppRequests), tasas de fallo de requests/dependencias, top de
#               excepciones y su distribución diaria por rol.
# Requisitos:   az CLI (extensión containerapp), sesión `az login` con lectura sobre la suscripción.
# Uso:          AZ_SUBSCRIPTION="<SUBSCRIPTION_NAME_O_ID>" ./azure-readonly-supplemental.sh <DIRECTORIO_SALIDA>
#               Usa las MISMAS variables que azure-readonly-sweep.sh; puedes apuntar al mismo directorio
#               de salida (los ficheros van numerados 10-15 y no pisan los del barrido).
# Variables:    $1                  directorio de salida. Obligatorio.
#               AZ_SUBSCRIPTION     nombre o id de la suscripción (`az account list -o table`). Obligatoria.
#               ENVIRONMENTS        entornos separados por espacios (def. "dev qa prod").
#               RG_TEMPLATE, CONTAINER_APPS, LAW_TEMPLATE, CAE_TEMPLATE, APPI_TEMPLATE: plantillas de
#               nombres con `{env}` (ver azure-readonly-sweep.sh y el README).
# Efectos:      SOLO LECTURA en Azure. ESCRIBE: ficheros en <DIRECTORIO_SALIDA>/<env>/.
# Salida:       <DIR>/<env>/10-loganalytics-table-coverage.txt ... 15-appinsights-exception-distribution.txt

: "${AZ_SUBSCRIPTION:?Define AZ_SUBSCRIPTION (ej: AZ_SUBSCRIPTION='<SUBSCRIPTION_NAME_O_ID>')}"
subscription="$AZ_SUBSCRIPTION"
out_root="${1:?Usage: $0 <output-directory>}"
ENVIRONMENTS="${ENVIRONMENTS:-dev qa prod}"
# Marcador literal que tpl() sustituye por el entorno (variable aparte por compatibilidad con bash 3.2).
E='{env}'
RG_TEMPLATE="${RG_TEMPLATE:-rg-app-$E}"
CONTAINER_APPS="${CONTAINER_APPS:-ca-api-$E ca-worker-$E}"
LAW_TEMPLATE="${LAW_TEMPLATE:-law-app-$E}"
CAE_TEMPLATE="${CAE_TEMPLATE:-cae-app-$E}"
APPI_TEMPLATE="${APPI_TEMPLATE:-appi-$E}"
mkdir -p "$out_root"

# Fija siempre la suscripción en cada llamada.
az_ro() {
  az "$@" --subscription "$subscription"
}

# Sustituye `{env}` por el entorno actual ($env).
tpl() {
  local t="$1"
  printf '%s' "${t//\{env\}/$env}"
}

# Consulta KQL de los últimos 30 días (P30D) a fichero; si falla, el error queda en el fichero.
query_to_file() {
  local workspace="$1"
  local query="$2"
  local destination="$3"
  if ! az_ro monitor log-analytics query \
    --workspace "$workspace" \
    --analytics-query "$query" \
    --timespan P30D \
    -o table > "$destination" 2>&1; then
    printf '\nQUERY_STATUS: failed; inspect the concise error above.\n' >> "$destination"
  fi
}

for env in $ENVIRONMENTS; do
  rg="$(tpl "$RG_TEMPLATE")"
  law="$(tpl "$LAW_TEMPLATE")"
  cae="$(tpl "$CAE_TEMPLATE")"
  appi="$(tpl "$APPI_TEMPLATE")"
  env_out="$out_root/$env"
  mkdir -p "$env_out"
  law_id="$(az_ro monitor log-analytics workspace show --resource-group "$rg" --workspace-name "$law" --query customerId -o tsv)"
  # Si el Container Apps Environment envía los logs a otro workspace accesible, se consulta ese.
  configured_id="$(az_ro containerapp env show --resource-group "$rg" --name "$cae" --query properties.appLogsConfiguration.logAnalyticsConfiguration.customerId -o tsv 2>/dev/null || true)"
  target_id="$law_id"
  if [[ -n "$configured_id" ]] && az_ro monitor log-analytics query --workspace "$configured_id" --analytics-query 'print Probe=1' -o none >/dev/null 2>&1; then
    target_id="$configured_id"
  fi

  # isfuzzy=true: el union no falla si alguna de las tablas no existe en el workspace.
  table_probe='union withsource=TableName isfuzzy=true ContainerAppConsoleLogs, ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(30d)
| summarize Count=count(), LastSeen=max(TimeGenerated) by TableName
| order by Count desc'
  query_to_file "$target_id" "$table_probe" "$env_out/10-loganalytics-table-coverage.txt"

  # Lista de apps en formato KQL: "a", "b"
  apps=""
  for app_tpl in $CONTAINER_APPS; do
    apps="${apps}${apps:+, }\"$(tpl "$app_tpl")\""
  done
  # Une ambos esquemas renombrando columnas a App/Raw. Las palabras clave son ejemplos: ajústalas.
  logs_query="union isfuzzy=true
(ContainerAppConsoleLogs | project TimeGenerated, App=ContainerAppName, Raw=tostring(Log)),
(ContainerAppConsoleLogs_CL | project TimeGenerated, App=ContainerAppName_s, Raw=tostring(Log_s))
| where TimeGenerated > ago(30d)
| where App in ($apps)
| extend Parsed=parse_json(Raw)
| extend Level=toupper(tostring(Parsed.log.level)), Message=tostring(Parsed.message)
| where Level in (\"ERROR\", \"FATAL\") or Raw has_any (\"CredentialUnavailableException\", \"KafkaException\", \"Connection refused\", \"KeyVaultException\", \"Job state is locked\", \"Failed to release advisory lock\")
| extend Pattern=case(Raw has \"Job state is locked\", \"Job state is locked\", Raw has \"Failed to release advisory lock\", \"Failed to release advisory lock\", Raw has \"KafkaException\", \"KafkaException\", Raw has \"CredentialUnavailable\", \"Credential unavailable\", Raw has \"Connection refused\", \"Connection refused\", isempty(Level), \"Keyword match\", Level)
| summarize Count=count(), FirstSeen=min(TimeGenerated), LastSeen=max(TimeGenerated) by App, Pattern
| order by Count desc"
  query_to_file "$target_id" "$logs_query" "$env_out/11-loganalytics-errors-corrected.txt"

  # Telemetría de Application Insights (workspace-based) filtrada por el componente $appi.
  appi_query="union withsource=TableName isfuzzy=true AppDependencies, AppExceptions, AppRequests, AppTraces
| where TimeGenerated > ago(30d)
| where _ResourceId endswith \"/$appi\"
| summarize Count=sum(ItemCount), LastSeen=max(TimeGenerated) by TableName
| order by TableName asc"
  query_to_file "$law_id" "$appi_query" "$env_out/12-appinsights-current-resource.txt"

  # Tasa de fallo: ItemCount refleja el muestreo (sampling), por eso se suma en lugar de contar filas.
  appi_failures_query="union
(AppRequests
| where TimeGenerated > ago(30d) and _ResourceId endswith \"/$appi\"
| summarize Total=sum(ItemCount), Failed=sumif(ItemCount, Success == false)
| extend Signal=\"Requests\"),
(AppDependencies
| where TimeGenerated > ago(30d) and _ResourceId endswith \"/$appi\"
| summarize Total=sum(ItemCount), Failed=sumif(ItemCount, Success == false)
| extend Signal=\"Dependencies\")
| extend FailureRatePercent=round(100.0 * todouble(Failed) / todouble(Total), 4)
| project Signal, Total, Failed, FailureRatePercent"
  query_to_file "$law_id" "$appi_failures_query" "$env_out/13-appinsights-failure-rates.txt"

  appi_exception_query="AppExceptions
| where TimeGenerated > ago(30d)
| where _ResourceId endswith \"/$appi\"
| extend Pattern=coalesce(OuterType, ProblemId, InnermostType, \"Unknown\")
| summarize Count=sum(ItemCount), FirstSeen=min(TimeGenerated), LastSeen=max(TimeGenerated) by Pattern
| top 15 by Count desc"
  query_to_file "$law_id" "$appi_exception_query" "$env_out/14-appinsights-top-exceptions.txt"

  # Distribución diaria por rol (AppRoleName = servicio que emitió la excepción) de excepciones de interés.
  appi_exception_distribution_query="AppExceptions
| where TimeGenerated > ago(30d)
| where _ResourceId endswith \"/$appi\"
| extend Pattern=coalesce(OuterType, ProblemId, InnermostType, \"Unknown\")
| where Pattern has_any (\"KafkaException\", \"TopicAuthorizationException\", \"RestClientException\", \"OutOfMemoryError\", \"CannotCreateTransactionException\", \"CannotGetJdbcConnectionException\")
| summarize Count=sum(ItemCount) by AppRoleName, Pattern, Day=bin(TimeGenerated, 1d)
| top 60 by Count desc"
  query_to_file "$law_id" "$appi_exception_distribution_query" "$env_out/15-appinsights-exception-distribution.txt"
done

printf 'Supplemental Azure queries completed: %s\n' "$out_root"
