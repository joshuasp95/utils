#!/usr/bin/env bash
# atlas-readonly-inventory.sh — inventario de MongoDB Atlas en SOLO LECTURA, en un único JSON.
#
# Qué hace:     Ejecuta un conjunto cerrado de comandos `atlas` de lectura sobre un proyecto
#               (identidad, clusters, procesos, alertas abiertas y, opcionalmente,
#               índices sugeridos por Performance Advisor) y emite un JSON compacto por
#               stdout, pensado para soporte/triage o para que lo interprete un asistente.
# Requisitos:   atlas CLI autenticado (`atlas auth login` o perfil con API key), jq.
# Uso:          ./atlas-readonly-inventory.sh --project-id <PROJECT_ID>
#               ./atlas-readonly-inventory.sh --project-id <PROJECT_ID> --section clusters,alerts
#               ./atlas-readonly-inventory.sh --project-id <PROJECT_ID> --section advisor
#               ./atlas-readonly-inventory.sh --project-id <PROJECT_ID> --dry-run
# Variables:    --project-id  ID del proyecto Atlas (Atlas UI → Project Settings, o `atlas projects list`).
#                             Obligatorio salvo para la sección whoami.
#               --section     lista separada por comas de: whoami,clusters,processes,alerts,advisor.
#                             Por defecto: whoami,clusters,processes,alerts (advisor es opt-in, lento).
#               --dry-run     imprime por stderr los comandos atlas que lanzaría, sin llamar a Atlas.
# Efectos:      SOLO LECTURA. Toda llamada pasa por atlas_ro(), que rechaza cualquier comando
#               que no esté exactamente en la allowlist ALLOWED_CALLS. No hay ningún camino
#               de código que cree, modifique, borre, pause o reanude nada. No envuelve
#               `atlas logs download` (escribe ficheros: se deja como paso manual).
# Salida:       JSON compacto por stdout: {"projectId":..., "sections":{...}}. Avisos por stderr.
#               Códigos de salida: 0 ok | 1 error de uso | 2 falta dependencia | 3 éxito parcial
#               (alguna sección falló; el JSON se emite igualmente).


set -uo pipefail

SCRIPT_NAME="$(basename "$0")"
ALL_SECTIONS=(whoami clusters processes alerts advisor)

# Closed allowlist of the exact positional command shapes this script may invoke.
# Every one is read-only. Nothing outside this list can be executed — see atlas_ro().
ALLOWED_CALLS=(
  "auth whoami"
  "clusters list"
  "processes list"
  "alerts list"
  "performanceAdvisor suggestedIndexes list"
)

PROJECT_ID=""
SECTIONS=""
DRY_RUN=0
PARTIAL=0

usage() {
  cat <<EOF
$SCRIPT_NAME — read-only MongoDB Atlas inventory (JSON to stdout)

Usage:
  $SCRIPT_NAME --project-id <id> [--section <list>] [--dry-run]

Options:
  --project-id <id>  Atlas project id (required for everything except 'whoami').
  --section <list>   Comma-separated subset of: ${ALL_SECTIONS[*]}
                     Default: whoami,clusters,processes,alerts
                     ('advisor' is opt-in — it is one call per process and is slower.)
  --dry-run          Print the atlas commands that would run, and exit without calling Atlas.
  -h, --help         Show this help.

Sections:
  whoami     Authenticated identity — recorded so the output states whose view this is.
  clusters   Clusters with MongoDB version, tier and state. Version spread across
             clusters is a recurring finding worth seeing at a glance.
  processes  Running processes (host:port), the input for per-process diagnostics.
  alerts     Open alerts. Remember an auto-closed alert only means the value fell
             back under threshold — recurrence still indicates an active problem.
  advisor    Performance Advisor suggested indexes per process. Opt-in.

Safety:
  Calls are restricted to a closed allowlist of exact read-only command shapes; anything
  else is refused before execution. No connection strings, credentials or data are printed.

Examples:
  $SCRIPT_NAME --project-id <id>
  $SCRIPT_NAME --project-id <id> --section clusters,alerts
  $SCRIPT_NAME --project-id <id> --section advisor
  $SCRIPT_NAME --project-id <id> --dry-run
EOF
}

die() { printf '%s: %s\n' "$SCRIPT_NAME" "$1" >&2; exit "${2:-1}"; }
warn() { printf '%s: warning: %s\n' "$SCRIPT_NAME" "$1" >&2; PARTIAL=1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project-id) [ $# -ge 2 ] || die "--project-id requires a value"; PROJECT_ID="$2"; shift 2 ;;
    --section)    [ $# -ge 2 ] || die "--section requires a value";    SECTIONS="$2";   shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

command -v atlas >/dev/null 2>&1 || die "atlas CLI not found in PATH" 2
command -v jq    >/dev/null 2>&1 || die "jq not found in PATH" 2

if [ -z "$SECTIONS" ]; then
  REQUESTED=(whoami clusters processes alerts)
else
  IFS=',' read -r -a REQUESTED <<< "$SECTIONS"
  for s in "${REQUESTED[@]}"; do
    found=0
    for known in "${ALL_SECTIONS[@]}"; do [ "$s" = "$known" ] && found=1 && break; done
    [ "$found" -eq 1 ] || die "unknown section: $s (valid: ${ALL_SECTIONS[*]})"
  done
fi

needs_project=0
for s in "${REQUESTED[@]}"; do [ "$s" != "whoami" ] && needs_project=1; done
if [ "$needs_project" -eq 1 ] && [ -z "$PROJECT_ID" ]; then
  usage >&2; die "--project-id is required for the requested sections" 1
fi

# The single choke point for every Atlas call.
#
# Validation is a CLOSED ALLOWLIST of exact positional command shapes, not a verb pattern.
# A verb-pattern check is unsafe here because the Atlas CLI takes positional arguments after
# the verb, so "clusters delete list" (deleting a cluster named "list") can smuggle a
# mutating verb past any "does some token look like a read?" test. Matching the full
# positional prefix exactly removes that whole class of bypass.
#
# To add a section, add its exact command shape here deliberately.
atlas_ro() {
  local -a positional=()
  local tok
  for tok in "$@"; do
    case "$tok" in
      -*) break ;;
      *) positional+=("$tok") ;;
    esac
  done

  local shape="${positional[*]}"
  local allowed=0 candidate
  for candidate in "${ALLOWED_CALLS[@]}"; do
    [ "$shape" = "$candidate" ] && allowed=1 && break
  done

  if [ "$allowed" -ne 1 ]; then
    warn "refused atlas call not in the read-only allowlist: ${shape:-<empty>}"
    printf 'null\n'
    return 1
  fi

  local -a cmd=(atlas "$@" --output json)
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%q ' "${cmd[@]}" >&2; printf '\n' >&2
    printf 'null\n'
    return 0
  fi

  local out
  if ! out="$("${cmd[@]}" 2>/dev/null)"; then
    warn "call failed: atlas $*"
    printf 'null\n'
    return 1
  fi
  printf '%s\n' "${out:-null}"
}

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s: dry run — the following atlas calls would be made:\n' "$SCRIPT_NAME" >&2
fi

# ---- sections -------------------------------------------------------------

sec_whoami() {
  atlas_ro auth whoami | jq -c '.' 2>/dev/null || printf 'null\n'
}

sec_clusters() {
  atlas_ro clusters list --projectId "$PROJECT_ID" \
    | jq -c '[.results[]? | {name: .name, version: .mongoDBVersion, tier: .clusterType, state: .stateName}]' 2>/dev/null \
    || printf 'null\n'
}

sec_processes() {
  atlas_ro processes list --projectId "$PROJECT_ID" \
    | jq -c '[.results[]? | {id: .id, hostname: .hostname, port: .port, version: .version, type: .typeName}]' 2>/dev/null \
    || printf 'null\n'
}

sec_alerts() {
  atlas_ro alerts list --projectId "$PROJECT_ID" \
    | jq -c '[.results[]? | {id: .id, status: .status, created: .created, updated: .updated, eventType: .eventTypeName, metric: .metricName}]' 2>/dev/null \
    || printf 'null\n'
}

sec_advisor() {
  local procs out=()
  procs="$(atlas_ro processes list --projectId "$PROJECT_ID")"
  if [ "$DRY_RUN" -eq 1 ] || [ -z "$procs" ] || [ "$procs" = "null" ]; then
    printf '%s\n' "${procs:-null}"; return
  fi
  local p sugg entry
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    sugg="$(atlas_ro performanceAdvisor suggestedIndexes list --processName "$p" --projectId "$PROJECT_ID")"
    entry="$(jq -c -n --arg process "$p" --argjson suggestions "${sugg:-null}" \
      '{process: $process, suggestions: $suggestions}' 2>/dev/null)"
    [ -n "$entry" ] && out+=("$entry")
  done < <(printf '%s' "$procs" | jq -r '.results[]? | "\(.hostname):\(.port)"' 2>/dev/null)
  if [ ${#out[@]} -eq 0 ]; then printf '[]\n'; else printf '%s\n' "${out[@]}" | jq -c -s '.'; fi
}

# ---- assemble -------------------------------------------------------------

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for s in "${REQUESTED[@]}"; do
  case "$s" in
    whoami)    sec_whoami ;;
    clusters)  sec_clusters ;;
    processes) sec_processes ;;
    alerts)    sec_alerts ;;
    advisor)   sec_advisor ;;
  esac > "$TMP/$s.json"
done

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s: dry run complete — no Atlas calls were made.\n' "$SCRIPT_NAME" >&2
  exit 0
fi

{
  printf '{"projectId":%s,"sections":{' "$(jq -Rn --arg v "${PROJECT_ID:-none}" '$v')"
  first=1
  for s in "${REQUESTED[@]}"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '%s:%s' "$(jq -Rn --arg v "$s" '$v')" "$(cat "$TMP/$s.json" 2>/dev/null || printf 'null')"
  done
  printf '}}'
} | jq -c '.' 2>/dev/null || {
  printf '%s: failed to assemble JSON output\n' "$SCRIPT_NAME" >&2
  exit 3
}

[ "$PARTIAL" -eq 1 ] && exit 3
exit 0
