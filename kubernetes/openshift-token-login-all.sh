#!/usr/bin/env bash
set -uo pipefail

# openshift-token-login-all.sh — login por TOKEN en varios clusters OpenShift, uno tras otro (bash).
#
# Qué hace:     Para cada entorno del fichero de clusters abre en el navegador la página de token de
#               OpenShift, te pide que pegues el token (o el comando `oc login --token=...` entero),
#               hace `oc login`, renombra el contexto a <CONTEXT_PREFIX><env> y le fija el namespace.
#               Por qué por token y no `oc login --web`: el flujo web pasa por la ruta oauth-openshift,
#               que puede llevar un certificado corporativo no confiado que --insecure-skip-tls-verify
#               NO cubre. El login por token solo habla con el API server.
#               El token NO se muestra al pegarlo (read -s), NO se imprime y NO se guarda en ningún
#               fichero por este script (oc sí lo guarda en tu kubeconfig, como cualquier `oc login`).
# Requisitos:   `oc` (macOS: brew install openshift-cli). Sesión SSO en el navegador. `open` (macOS)
#               para abrir la página automáticamente; si no existe, ábrela a mano.
# Uso:          ./openshift-token-login-all.sh                 # todos los entornos del fichero
#               ./openshift-token-login-all.sh int pre pro     # solo esos
#               CLUSTERS_FILE=~/ocp-clusters.conf ./openshift-token-login-all.sh
# Variables:    $@              entornos a loguear (primera columna del fichero); def. todos.
#               CLUSTERS_FILE   fichero `entorno|api_server|namespace` (def. clusters.conf junto al
#                               script; copia clusters.conf.example y rellénalo).
#               CONTEXT_PREFIX  prefijo del nombre de contexto (def. "ocp-").
# Efectos:      ESCRIBE: tu kubeconfig (~/.kube/config): crea/renombra contextos y fija su namespace.
#               No toca nada en el cluster.
# Salida:       Resumen por pantalla (OK / FALLO / SALTADO por entorno) y lista de contextos.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTERS_FILE="${CLUSTERS_FILE:-$SCRIPT_DIR/clusters.conf}"
CONTEXT_PREFIX="${CONTEXT_PREFIX:-ocp-}"

case "${1:-}" in -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;; esac
command -v oc >/dev/null 2>&1 || { echo "oc no esta instalado (brew install openshift-cli)"; exit 1; }
[ -r "$CLUSTERS_FILE" ] || { echo "No encuentro $CLUSTERS_FILE (copia clusters.conf.example y rellénalo, o define CLUSTERS_FILE)"; exit 1; }

# Formato: entorno|api server|namespace. Se ignoran líneas vacías y las que empiezan por '#'.
CLUSTERS="$(grep -vE '^[[:space:]]*(#|$)' "$CLUSTERS_FILE")"
WANT="${*:-$(printf '%s\n' "$CLUSTERS" | cut -d'|' -f1 | tr '\n' ' ')}"
summary=""

for env in $WANT; do
  # awk -F'|': separa por '|' y devuelve la primera línea cuya columna 1 sea el entorno.
  line=$(printf '%s\n' "$CLUSTERS" | awk -F'|' -v e="$env" '$1==e{print; exit}')
  if [ -z "$line" ]; then echo "entorno desconocido: $env (revisa $CLUSTERS_FILE)"; continue; fi
  server=$(printf '%s' "$line" | cut -d'|' -f2)
  ns=$(printf '%s' "$line" | cut -d'|' -f3)
  ctx="${CONTEXT_PREFIX}$env"
  # host de la ruta apps para la pagina del token: https://api.<host>:6443 -> <host>
  host=$(printf '%s' "$server" | sed -E 's#https://api\.([^:]+):6443#\1#')
  tokenpage="https://oauth-openshift.apps.$host/oauth/token/request"

  echo
  echo "==================================================================="
  echo " $env  ->  $server"
  echo " Abriendo la pagina del token: $tokenpage"
  echo "==================================================================="
  command -v open >/dev/null 2>&1 && open "$tokenpage" >/dev/null 2>&1 || echo " (abrela a mano en el navegador con tu sesion SSO)"

  printf "Pega el token (sha256~...) o el comando 'oc login ...' y pulsa ENTER: "
  # -s: no muestra lo que se pega; -r: no interpreta barras invertidas.
  IFS= read -r -s RAW
  echo
  # admite pegar el comando entero: extrae lo que venga tras --token=
  case "$RAW" in
    *--token=*) TOKEN=$(printf '%s' "$RAW" | sed -n 's/.*--token=\([^ ]*\).*/\1/p');;
    *) TOKEN="$RAW";;
  esac
  TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
  if [ -z "$TOKEN" ]; then echo "sin token; salto $env"; summary="$summary\n  SALTADO $env"; continue; fi

  # --insecure-skip-tls-verify: acepta el certificado autofirmado del API server (no el de las rutas).
  if oc login --token="$TOKEN" --server="$server" --insecure-skip-tls-verify=true >/dev/null 2>&1; then
    cur=$(oc config current-context 2>/dev/null || true)
    if [ -n "$cur" ]; then
      oc config delete-context "$ctx" >/dev/null 2>&1 || true
      oc config rename-context "$cur" "$ctx" >/dev/null 2>&1 || true
      oc config set-context "$ctx" --namespace "$ns" >/dev/null 2>&1 || true
    fi
    who=$(oc --context "$ctx" whoami 2>/dev/null || echo "?")
    echo "OK $env: contexto $ctx (ns $ns) usuario $who"
    summary="$summary\n  OK      $env -> $ctx (ns $ns, usuario $who)"
  else
    echo "FALLO login $env (token invalido o caducado?)"
    summary="$summary\n  FALLO   $env ($server)"
  fi
  unset TOKEN RAW
done

echo
echo "=== Resumen de logins ==="
printf '%b\n' "$summary"
echo
echo "Contextos ${CONTEXT_PREFIX}* en tu kubeconfig:"
oc config get-contexts 2>/dev/null | awk -v p="$CONTEXT_PREFIX" 'NR==1 || index($0, p)' || true
echo
echo "Siguiente: recoger evidencias, p.ej.:"
printf '%s\n' "$CLUSTERS" | while IFS='|' read -r e _ n; do
  echo "  $SCRIPT_DIR/openshift-collect-evidence.sh --env $e --ns $n --context ${CONTEXT_PREFIX}$e"
done
