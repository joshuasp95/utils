#!/usr/bin/env bash
set -uo pipefail   # -u: error si se usa una variable sin definir; -o pipefail: una tubería falla si
                   # falla cualquiera de sus comandos. SIN -e a propósito: si un paso falla, se sigue
                   # con los demás y el fallo queda registrado en su fichero (EXIT=<código>).
umask 077          # Los ficheros creados solo los puede leer tu usuario (las evidencias pueden ser sensibles).

# collect-evidence.sh — plantilla para recoger evidencias de un incidente en SOLO LECTURA, con trazabilidad.
#
# Qué hace:     Ejecuta una lista de comandos de consulta (kubectl / az / aws / lo que añadas) y guarda
#               la salida de cada uno en <EVIDENCE_ROOT>/<TICKET>/evidencias/NN-<nombre>.txt con una
#               cabecera: ticket, título del paso, fecha UTC, quién lo ejecutó y el COMANDO EXACTO.
#               Así cada evidencia adjunta a un ticket se puede reproducir y auditar.
#               Los comandos se editan en la función collect() (sección "COMANDOS"); los bloques de
#               ejemplo solo se ejecutan si defines sus variables (K8S_*, AZ_*, AWS_*).
# Requisitos:   bash. Según los bloques que actives: kubectl (contexto con acceso), az CLI (`az login`),
#               aws CLI (sesión válida en el perfil). perl si REDACT=1 (viene con macOS y casi todo Linux).
#               El script NUNCA inicia sesión ni cambia el contexto activo.
# Uso:          ./collect-evidence.sh <TICKET_ID>
#               K8S_NAMESPACE=<NAMESPACE> K8S_WORKLOAD=deploy/<NOMBRE> ./collect-evidence.sh <TICKET_ID>
#               AZ_SUBSCRIPTION=<SUB> AZ_RESOURCE_GROUP=<RG> AZ_WORKSPACE_ID=<GUID> \
#                 WINDOW_START=2026-01-31T13:00:00Z WINDOW_END=2026-01-31T14:30:00Z ./collect-evidence.sh <TICKET_ID>
# Variables:    $1                 id del ticket o del caso (letras, números, '.', '_', '-'). Obligatorio.
#               EVIDENCE_ROOT      carpeta raíz (def. directorio actual) → <EVIDENCE_ROOT>/<TICKET>/evidencias.
#               RUN_BY             quién ejecuta, para la cabecera (def. usuario del sistema).
#               REDACT             1 = enmascara emails, tokens, JWT y valores tipo password en la salida (def. 1).
#               WINDOW_START/END   ventana del incidente en UTC (YYYY-MM-DDTHH:MM:SSZ). Opcionales.
#               K8S_CONTEXT, K8S_NAMESPACE, K8S_WORKLOAD   bloque Kubernetes (ver README).
#               AZ_SUBSCRIPTION, AZ_RESOURCE_GROUP, AZ_WORKSPACE_ID   bloque Azure.
#               AWS_PROFILE, AWS_REGION, AWS_LOG_GROUP   bloque AWS (AWS_PROFILE/AWS_REGION los lee la propia CLI).
# Efectos:      SOLO LECTURA en los sistemas consultados (los comandos de ejemplo son get/list/show/query).
#               Si añades comandos, mantén esa regla. ESCRIBE: ficheros en .../<TICKET>/evidencias/
#               (sobreescribe los de una ejecución anterior con el mismo número y nombre).
# Salida:       Ficheros NN-<nombre>.txt y un resumen por pantalla.

usage() {
  sed -n '7,32p' "$0" | sed 's/^# \{0,1\}//'
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }
[[ $# -ge 1 ]] || { usage >&2; exit 2; }

TICKET="$1"
# Validación: evita rutas raras (../, espacios, /) en el nombre de la carpeta.
[[ "$TICKET" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { printf 'Id de ticket/caso inválido: %s\n' "$TICKET" >&2; exit 2; }

EVIDENCE_ROOT="${EVIDENCE_ROOT:-$PWD}"
OUT="$EVIDENCE_ROOT/$TICKET/evidencias"
RUN_BY="${RUN_BY:-$(id -un)}"
REDACT="${REDACT:-1}"
WINDOW_START="${WINDOW_START:-}"
WINDOW_END="${WINDOW_END:-}"
mkdir -p "$OUT"

for stamp in "$WINDOW_START" "$WINDOW_END"; do
  [[ -z "$stamp" || "$stamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || { printf 'Fecha inválida (usa YYYY-MM-DDTHH:MM:SSZ): %s\n' "$stamp" >&2; exit 2; }
done

# =============================================================================
# Helpers (normalmente no hace falta tocarlos)
# =============================================================================

STEP=0   # contador para el prefijo NN de cada fichero

# Enmascarado conservador de datos sensibles en la salida. No es una garantía: revisa antes de publicar.
#  - emails → [EMAIL REDACTADO]
#  - "password=..." / "authorization: ..." / "api_key: ..." etc. → [VALOR REDACTADO]
#  - "Bearer <token>" → Bearer [REDACTADO]
#  - JWT (tres bloques base64url separados por puntos) → [JWT REDACTADO]
redact() {
  if [[ "$REDACT" == "1" ]]; then
    perl -pe 's/[^\s\x22<>]+\@[^\s\x22<>]+/[EMAIL REDACTADO]/g; s/((?:authorization|set-cookie|cookie|client_secret|password|passwd|access_token|refresh_token|api[_-]?key)\s*[\x22\x27]?\s*[:=]).*/$1 [VALOR REDACTADO]/ig; s/Bearer\s+\S+/Bearer [REDACTADO]/ig; s/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[JWT REDACTADO]/g'
  else
    cat
  fi
}

# Cabecera de trazabilidad de cada fichero de evidencia.
cabecera() {
  local fichero="$1" titulo="$2" comando="$3"
  {
    echo "==============================================================================="
    echo "$TICKET — $titulo"
    echo "Ejecutado:   $(date -u '+%Y-%m-%dT%H:%M:%SZ') (UTC)"
    echo "Por:         $RUN_BY"
    echo "Ventana:     ${WINDOW_START:-n/a} → ${WINDOW_END:-n/a}"
    echo "Comando:"
    echo "$comando" | sed 's/^/    /'
    echo "==============================================================================="
    echo
  } > "$fichero"
}

# step <nombre> <título> <comando> [args...]
# Ejecuta un comando (sin shell intermedio) y guarda su salida con cabecera.
step() {
  local nombre="$1" titulo="$2"; shift 2
  local n fichero rc comando
  STEP=$((STEP + 1)); n="$(printf '%02d' "$STEP")"
  fichero="$OUT/${n}-${nombre}.txt"
  # %q: el comando tal cual, con comillas, para poder copiarlo y repetirlo.
  # step_sh pasa en DISPLAY_CMD la línea de shell original, más legible.
  comando="${DISPLAY_CMD:-$(printf '%q ' "$@")}"
  echo "  [$n] $titulo"
  cabecera "$fichero" "$titulo" "$comando"
  "$@" 2>&1 | redact >> "$fichero"
  rc=${PIPESTATUS[0]}   # código de salida del comando, no del redact
  printf '\nEXIT=%s\n' "$rc" >> "$fichero"
  [[ "$rc" == 0 ]] || echo "       (fallo EXIT=$rc; ver $(basename "$fichero"))"
}

# step_sh <nombre> <título> '<línea de shell>'
# Igual que step, pero para tuberías (cmd | grep | ...). La línea se guarda literal en la cabecera.
step_sh() {
  local nombre="$1" titulo="$2" linea="$3"
  DISPLAY_CMD="$linea" step "$nombre" "$titulo" bash -o pipefail -c "$linea"
}

# kql <nombre> <título> '<consulta KQL>'
# Consulta a Log Analytics (Azure) contra AZ_WORKSPACE_ID (GUID "Workspace ID" del workspace).
kql() {
  local nombre="$1" titulo="$2" query="$3"
  local -a extra=()
  [[ -n "${AZ_SUBSCRIPTION:-}" ]] && extra+=(--subscription "$AZ_SUBSCRIPTION")
  step "$nombre" "$titulo" az monitor log-analytics query "${extra[@]+"${extra[@]}"}" \
    --workspace "$AZ_WORKSPACE_ID" --analytics-query "$query" -o table
}

# =============================================================================
# COMANDOS — edita esta función para cada incidente.
# Regla: SOLO comandos de lectura (get, describe, list, show, query, logs, tail).
# Cada llamada a step/step_sh/kql genera un fichero NN-<nombre>.txt, en este orden.
# =============================================================================
collect() {
  # --- Contexto ----------------------------------------------------------------
  step contexto "Contexto de ejecución (hora y host)" bash -c 'date -u; hostname'

  # --- Kubernetes / OpenShift (se activa definiendo K8S_NAMESPACE) ---------------
  if [[ -n "${K8S_NAMESPACE:-}" ]]; then
    local -a K=(kubectl)
    [[ -n "${K8S_CONTEXT:-}" ]] && K+=(--context "$K8S_CONTEXT")
    step k8s-pods    "Pods del namespace"                "${K[@]}" -n "$K8S_NAMESPACE" get pods -o wide
    step k8s-events  "Eventos ordenados por fecha"       "${K[@]}" -n "$K8S_NAMESPACE" get events --sort-by=.lastTimestamp
    if [[ -n "${K8S_WORKLOAD:-}" ]]; then
      # K8S_WORKLOAD admite tipo/nombre: deploy/<NOMBRE>, sts/<NOMBRE> o pod/<NOMBRE>.
      step k8s-describe "Describe de $K8S_WORKLOAD"      "${K[@]}" -n "$K8S_NAMESPACE" describe "$K8S_WORKLOAD"
      step k8s-logs     "Últimas 500 líneas de log"      "${K[@]}" -n "$K8S_NAMESPACE" logs "$K8S_WORKLOAD" --tail=500 --all-containers --timestamps
      step_sh k8s-logs-errores "Errores en las últimas 2000 líneas" \
        "$(printf '%q ' "${K[@]}") -n $(printf '%q' "$K8S_NAMESPACE") logs $(printf '%q' "$K8S_WORKLOAD") --tail=2000 --all-containers | grep -iE 'error|exception|fatal' | tail -100"
    fi
  fi

  # --- Azure (se activa definiendo AZ_RESOURCE_GROUP y/o AZ_WORKSPACE_ID) ---------
  if [[ -n "${AZ_RESOURCE_GROUP:-}" ]]; then
    local -a AZS=()
    [[ -n "${AZ_SUBSCRIPTION:-}" ]] && AZS=(--subscription "$AZ_SUBSCRIPTION")
    step az-cuenta "Cuenta y suscripción activas" az account show --query "{usuario:user.name, suscripcion:name, id:id}" -o table
    step az-recursos "Recursos del resource group" az resource list "${AZS[@]+"${AZS[@]}"}" -g "$AZ_RESOURCE_GROUP" \
      --query "[].{nombre:name, tipo:type}" -o table
    if [[ -n "$WINDOW_START" && -n "$WINDOW_END" ]]; then
      step az-activity-log "Activity log en la ventana del incidente" az monitor activity-log list "${AZS[@]+"${AZS[@]}"}" \
        -g "$AZ_RESOURCE_GROUP" --start-time "$WINDOW_START" --end-time "$WINDOW_END" \
        --query "[].{hora:eventTimestamp, recurso:resourceId, operacion:operationName.localizedValue, estado:status.localizedValue}" -o table
    else
      step az-activity-log "Activity log de las últimas 24 h" az monitor activity-log list "${AZS[@]+"${AZS[@]}"}" \
        -g "$AZ_RESOURCE_GROUP" --offset 24h \
        --query "[].{hora:eventTimestamp, recurso:resourceId, operacion:operationName.localizedValue, estado:status.localizedValue}" -o table
    fi
  fi
  if [[ -n "${AZ_WORKSPACE_ID:-}" ]]; then
    local tf="where TimeGenerated > ago(24h)"
    [[ -n "$WINDOW_START" && -n "$WINDOW_END" ]] && tf="where TimeGenerated between (datetime($WINDOW_START) .. datetime($WINDOW_END))"
    # CONTROL primero: si no llega telemetría, un resultado vacío en los demás pasos NO prueba nada.
    kql az-control-telemetria "CONTROL — ¿llegan logs? (últimas 24 h)" \
"ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| summarize Lineas=count(), Ultima=max(TimeGenerated) by ContainerAppName_s"
    # Ejemplo: ajusta tabla y columnas a tu esquema (ContainerAppConsoleLogs, AppExceptions, ...).
    kql az-errores-ventana "Errores por app en la ventana" \
"ContainerAppConsoleLogs_CL
| $tf
| where Log_s has_any (\"ERROR\", \"Exception\", \"FATAL\")
| summarize Veces=count(), Primera=min(TimeGenerated), Ultima=max(TimeGenerated) by ContainerAppName_s
| order by Veces desc"
  fi

  # --- AWS (se activa definiendo AWS_PROFILE) --------------------------------------
  if [[ -n "${AWS_PROFILE:-}" ]]; then
    step aws-identidad "Identidad AWS (cuenta y rol)" aws sts get-caller-identity --output table
    step aws-alarmas   "Alarmas de CloudWatch en estado ALARM" aws cloudwatch describe-alarms --state-value ALARM \
      --query "MetricAlarms[].{nombre:AlarmName, desde:StateUpdatedTimestamp, motivo:StateReason}" --output table
    if [[ -n "${AWS_LOG_GROUP:-}" ]]; then
      # `aws logs tail` sin --follow lee y termina; --since 1h = última hora.
      step aws-logs-errores "Errores en $AWS_LOG_GROUP (última hora)" aws logs tail "$AWS_LOG_GROUP" \
        --since 1h --filter-pattern ERROR --format short
    fi
  fi

  # --- Añade aquí tus comandos ----------------------------------------------------
  # step     <nombre> "<título>" <comando> [args...]
  # step_sh  <nombre> "<título>" '<cmd> | grep ... | tail -50'
  # kql      <nombre> "<título>" '<consulta KQL>'
}

# =============================================================================
echo "==> $TICKET — recogida de evidencias (solo lectura)"
echo "    Salida en: $OUT"
collect
echo
echo "==> Terminado. Evidencias en: $OUT"
ls -1 "$OUT" | sed 's/^/    /'
echo
echo "SIGUIENTE PASO: revisa primero los pasos de CONTROL (p. ej. az-control-telemetria)."
echo "Si no llega telemetría, los resultados vacíos de los demás pasos NO significan 'todo bien'."
echo "Revisa el contenido antes de adjuntarlo: el enmascarado (REDACT=1) es conservador, no infalible."
