#!/usr/bin/env bash
set -uo pipefail

# openshift-collect-evidence.sh — recoge evidencias de un namespace de OpenShift/Kubernetes en SOLO LECTURA.
#
# Qué hace:     Ejecuta solo `get` y `logs` sobre un namespace y guarda cada salida en
#               <OUT>/<ENV>/NN-<nombre>.txt, con el comando exacto en la primera línea: pods,
#               statefulsets, deployments, services, routes, events y pods no Running.
#               Opcionalmente filtra los logs de un pod por una expresión (p. ej. errores de licencia).
# Requisitos:   `oc` (OpenShift CLI) o, si no está, `kubectl`. Sesión iniciada en el cluster
#               (`oc login --token=...` o un contexto de kubeconfig con acceso; ver
#               openshift-token-login-all.sh). Permiso de lectura en el namespace.
# Uso:          ./openshift-collect-evidence.sh --ns <NAMESPACE> [--env <ENTORNO>] [--context <CONTEXTO>] [--out <DIR>]
#               ./openshift-collect-evidence.sh --env PRE --ns <NAMESPACE> --context ocp-pre \
#                   --log-pod <POD> --log-pattern 'license|expired|402'
# Variables:    --ns           namespace a revisar (`oc get projects` / `kubectl get ns`). Obligatorio.
#               --env          etiqueta del entorno, solo para el nombre de carpeta (def. = namespace).
#               --context      contexto de kubeconfig (`oc config get-contexts`); def. el actual.
#               --out          directorio raíz de salida (def. output-cli).
#               --log-pod      (opcional) pod cuyos logs se filtran; también por env LOG_POD.
#               --log-pattern  (opcional) regex extendida para grep -iE (def. 'error|exception|fatal');
#                              también por env LOG_PATTERN.
#               --log-tail     (opcional) líneas de log a leer (def. 800); también por env LOG_TAIL.
# Efectos:      SOLO LECTURA en el cluster. ESCRIBE: ficheros .txt en <OUT>/<ENV>/.
# Salida:       <OUT>/<ENV>/01-pods.txt ... 07-pods-no-ready.txt y, si hay --log-pod, 08-log-grep.txt.

CTX=""; NS=""; ENVN=""; OUT="output-cli"
LOG_POD="${LOG_POD:-}"
LOG_PATTERN="${LOG_PATTERN:-error|exception|fatal}"
LOG_TAIL="${LOG_TAIL:-800}"
while [ $# -gt 0 ]; do
  case "$1" in
    --context)     CTX="${2:-}"; shift 2;;
    --ns)          NS="${2:-}"; shift 2;;
    --env)         ENVN="${2:-}"; shift 2;;
    --out)         OUT="${2:-}"; shift 2;;
    --log-pod)     LOG_POD="${2:-}"; shift 2;;
    --log-pattern) LOG_PATTERN="${2:-}"; shift 2;;
    --log-tail)    LOG_TAIL="${2:-}"; shift 2;;
    # --help imprime la cabecera de comentarios de este fichero.
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "arg desconocido: $1"; exit 1;;
  esac
done
[ -z "$NS" ] && { echo "Falta --ns <namespace>"; exit 1; }
[ -z "$ENVN" ] && ENVN="$NS"

# Usa "oc" si está instalado; si no, "kubectl". $CLI se expande sin comillas a propósito para que
# "oc --context X" se parta en palabras.
if command -v oc >/dev/null 2>&1; then CLI="oc"; else CLI="kubectl"; fi
[ -n "$CTX" ] && CLI="$CLI --context $CTX"

DIR="$OUT/$ENVN"
mkdir -p "$DIR"
echo "[collect] cli=$CLI entorno=$ENVN ns=$NS -> $DIR"

# run <nombre-fichero> <comando...>: guarda "$ comando" + salida (stdout y stderr) en $DIR/<nombre>.txt
run() {
  local name="$1"; shift
  echo "  - $name"
  { echo "\$ $*"; echo; "$@"; } > "$DIR/$name.txt" 2>&1 || echo "    (fallo; ver $name.txt)"
}

run 01-pods          $CLI -n "$NS" get pods -o wide
run 02-statefulsets  $CLI -n "$NS" get statefulsets -o wide
run 03-deployments   $CLI -n "$NS" get deployments -o wide
run 04-services      $CLI -n "$NS" get services -o wide
# routes.route.openshift.io: nombre completo del recurso Route (solo existe en OpenShift).
run 05-routes        $CLI -n "$NS" get routes.route.openshift.io -o wide
run 06-events        $CLI -n "$NS" get events --sort-by=.lastTimestamp
# --field-selector filtra en el servidor: pods cuya fase NO es Running (Pending, Failed, ...).
run 07-pods-no-ready $CLI -n "$NS" get pods --field-selector=status.phase!=Running

# Filtro opcional de logs de un pod (p. ej. errores de licencia de un componente). Se queda con las
# últimas 40 coincidencias de las últimas $LOG_TAIL líneas.
if [ -n "$LOG_POD" ]; then
  echo "  - 08-log-grep"
  { echo "\$ $CLI -n $NS logs $LOG_POD --tail=$LOG_TAIL | grep -iE '$LOG_PATTERN'"; echo;
    $CLI -n "$NS" logs "$LOG_POD" --tail="$LOG_TAIL" 2>/dev/null | grep -iE "$LOG_PATTERN" | tail -40; } \
    > "$DIR/08-log-grep.txt" 2>&1 || echo "    (fallo o sin coincidencias; ver 08-log-grep.txt)"
fi

echo "[collect] hecho: $DIR"
