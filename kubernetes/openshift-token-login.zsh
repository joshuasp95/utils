#!/usr/bin/env zsh
set -u

# openshift-token-login.zsh — login interactivo por TOKEN en varios clusters OpenShift (zsh), con
# comprobación de acceso de lectura.
#
# Qué hace:     Igual que openshift-token-login-all.sh (abre la página de token, pegas el token o el
#               comando `oc login --token=...`, hace login, renombra el contexto y fija el namespace),
#               y además comprueba con `oc auth can-i get pods` que tienes lectura en el namespace.
#               Termina con código 1 si algún entorno falla (útil para encadenar en otros scripts).
#               El eco del terminal se desactiva al pegar; el token no se imprime ni se guarda en
#               ningún fichero por este script (oc sí lo guarda en tu kubeconfig).
# Requisitos:   zsh, `oc` (macOS: brew install openshift-cli), sesión SSO en el navegador.
# Uso:          ./openshift-token-login.zsh            # todos los entornos del fichero
#               ./openshift-token-login.zsh int pro    # solo esos
# Variables:    $@              entornos (primera columna del fichero); def. todos.
#               CLUSTERS_FILE   fichero `entorno|api_server|namespace` (def. clusters.conf junto al script).
#               CONTEXT_PREFIX  prefijo del nombre de contexto (def. "ocp-").
# Efectos:      ESCRIBE: tu kubeconfig (contextos y namespace por defecto). No toca el cluster.
# Salida:       Una línea ✓/✗ por entorno; código de salida 0 si todo OK, 1 si algo falló.

if ! command -v oc >/dev/null 2>&1; then
  print -u2 "oc is not installed (macOS: brew install openshift-cli)"
  exit 1
fi

# ${0:A:h}: directorio absoluto del script (modificadores de zsh: A = ruta absoluta, h = dirname).
CLUSTERS_FILE="${CLUSTERS_FILE:-${0:A:h}/clusters.conf}"
CONTEXT_PREFIX="${CONTEXT_PREFIX:-ocp-}"
if [[ ! -r "$CLUSTERS_FILE" ]]; then
  print -u2 "Cannot read $CLUSTERS_FILE (copy clusters.conf.example and fill it in, or set CLUSTERS_FILE)"
  exit 1
fi

# Arrays asociativos entorno -> api server / namespace, cargados del fichero (env|server|namespace).
typeset -A servers namespaces
typeset -a known
while IFS='|' read -r env_name env_server env_ns; do
  [[ -z "$env_name" || "$env_name" == \#* ]] && continue
  servers[$env_name]="$env_server"
  namespaces[$env_name]="$env_ns"
  known+=("$env_name")
done < "$CLUSTERS_FILE"

environments=("$@")
if (( $# == 0 )); then
  environments=("${known[@]}")
fi

failures=0
for environment in "${environments[@]}"; do
  if [[ -z "${servers[$environment]-}" ]]; then
    print -u2 "Unknown environment: $environment (expected one of: ${known[*]})"
    (( failures++ ))
    continue
  fi

  server="${servers[$environment]}"
  namespace="${namespaces[$environment]}"
  context="${CONTEXT_PREFIX}$environment"
  # https://api.<host>:6443 -> <host>; la página de token cuelga de la ruta apps del cluster.
  apps_host="${server#https://api.}"
  apps_host="${apps_host%:6443}"
  token_page="https://oauth-openshift.apps.$apps_host/oauth/token/request"

  print "\n── ${environment:u} OpenShift ──"
  print "Open this page with your SSO session: $token_page"
  if command -v open >/dev/null 2>&1; then
    open "$token_page" >/dev/null 2>&1 || true
  fi
  # read -s: sin eco; "raw?texto" es la sintaxis de zsh para mostrar un prompt.
  read -r -s "raw?Paste the token (sha256~...) or the full 'oc login ...' command, then press Enter: "
  print

  token="$raw"
  if [[ "$raw" == *'--token='* ]]; then
    token="$(printf '%s' "$raw" | sed -n 's/.*--token=\([^ ]*\).*/\1/p')"
  fi
  token="$(printf '%s' "$token" | tr -d '[:space:]')"
  unset raw

  if [[ -z "$token" ]]; then
    print -u2 "No token provided; ${environment:u} was skipped."
    (( failures++ ))
    continue
  fi

  if oc login --token="$token" --server="$server" --insecure-skip-tls-verify=true >/dev/null 2>&1; then
    unset token
    current_context="$(oc config current-context 2>/dev/null || true)"
    if [[ -n "$current_context" && "$current_context" != "$context" ]]; then
      oc config delete-context "$context" >/dev/null 2>&1 || true
      oc config rename-context "$current_context" "$context" >/dev/null 2>&1 || true
    fi
    oc config set-context "$context" --namespace "$namespace" >/dev/null 2>&1 || true
    # auth can-i: pregunta al API server si tu usuario puede hacer esa acción (no ejecuta nada).
    if oc --context "$context" -n "$namespace" auth can-i get pods --quiet >/dev/null 2>&1; then
      print "✓ ${environment:u}: context $context, namespace $namespace, read access confirmed"
    else
      print -u2 "✗ ${environment:u}: login succeeded, but pod read access could not be confirmed"
      (( failures++ ))
    fi
  else
    unset token
    print -u2 "✗ ${environment:u}: login failed (invalid/expired token, VPN or cluster access)"
    (( failures++ ))
  fi
done

print "\nContexts: oc config get-contexts"
exit $(( failures > 0 ? 1 : 0 ))
