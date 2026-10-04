# functions.zsh — funciones de zsh para navegación, AWS/Kubernetes y utilidades varias
#
# Qué hace:     Define funciones de shell (no es un script ejecutable: se carga con `source`).
#               Explicación de cada función en README.md de shell/.
# Requisitos:   zsh (Oh My Zsh opcional). Según la función: fzf, fd, tree, rg, curl, aws CLI v2,
#               kubectl. Microsoft Edge para `edge`.
# Uso:          source /ruta/a/utils/shell/zsh/functions.zsh      (añadir a ~/.zshrc)
#               o copiar a $ZSH_CUSTOM/40-functions.zsh si usas Oh My Zsh.
# Variables:    NAV_PROJECTS_ROOT  raíz de proyectos para nav-projects-check (defecto: $HOME/dev/projects).
#               AWS_DEFAULT_REGION_FALLBACK región por defecto de aws-use (defecto: eu-central-1).
#               EKS_ENVS / AKS_ENVS  tablas de entornos para eks-use / aks-use; defínelas en un
#                                    fichero local NO versionado (ver ejemplo más abajo).
# Efectos:      Las funciones cambian el estado de la shell actual (cd, export de variables,
#               contexto activo de kubectl). Ninguna modifica recursos remotos.
# Salida:       Según la función.

# ── Navegación ──────────────────────────────────────────────────────────────

# power_cd_with_fzf [dir] — busca con fzf un fichero o carpeta bajo dir y hace cd allí
# (si eliges un fichero, entra en su carpeta).
power_cd_with_fzf() {
  local base p
  # si se pasa arg usarlo; si no, el default es '.'
  base="${1:-.}"
  # ejecutar fzf en esa ruta (fzf lista recursivamente los ficheros del directorio actual)
  p="$(cd "$base" 2>/dev/null && fzf)" || return 1
  [[ -n "$p" ]] || return 1
  # juntar base más resultado de búsqueda
  p="$base/$p"

  # normalizar ruta: modificador :A de zsh = ruta absoluta resolviendo symlinks
  p="${p:A}"

  # si es directorio cd
  if [[ -d "$p" ]]; then
    cd "$p" || return 1
  else
    # si es archivo sube al directorio (:h = "head", el directorio padre)
    cd "${p:h}" || return 1
  fi
}

# power_cd [dir] — lista solo directorios con fd y los elige con fzf, con vista previa en árbol
power_cd() {
  local base selected_dir
  base="${1:-.}"
  # fd -t d: solo directorios; fzf +m: selección única; --preview: muestra `tree -C` del candidato
  selected_dir=$(fd -t d . "$base" | fzf +m --height 50 --preview 'tree -C {}') || return 1
  if [[ -n "$selected_dir" ]]; then
    cd "$selected_dir" || return 1
  fi
}

# nav-aliases — lista los alias de navegación (los que son "cd /ruta/absoluta")
nav-aliases() {
  emulate -L zsh
  local name expansion path

  # ${(ok)aliases}: claves (k) del array asociativo de alias, ordenadas (o)
  for name in ${(ok)aliases}; do
    expansion="${aliases[$name]}"
    [[ "$expansion" == "cd "* ]] || continue
    # (Q) quita las comillas de la ruta
    path="${(Q)${expansion#cd }}"
    [[ "$path" == /* ]] || continue
    printf '%-24s %s\n' "$name" "$path"
  done
}

# nav-aliases-check — avisa de alias de navegación que apuntan a carpetas que ya no existen
nav-aliases-check() {
  emulate -L zsh
  local name expansion path
  local -i checked=0 missing=0

  for name in ${(ok)aliases}; do
    expansion="${aliases[$name]}"
    [[ "$expansion" == "cd "* ]] || continue
    path="${(Q)${expansion#cd }}"
    [[ "$path" == /* ]] || continue
    (( checked++ ))

    if [[ ! -d "$path" ]]; then
      printf 'MISSING %-16s %s\n' "$name" "$path"
      (( missing++ ))
    fi
  done

  if (( missing == 0 )); then
    print -r -- "OK: $checked navigation aliases point to existing directories"
    return 0
  fi

  print -r -- "ERROR: $missing of $checked navigation aliases are stale"
  return 1
}

# nav-projects-check — comprueba que cada carpeta de primer nivel de NAV_PROJECTS_ROOT
# tiene al menos un alias de navegación que apunte a ella o a algo dentro
nav-projects-check() {
  emulate -L zsh
  local projects_root="${NAV_PROJECTS_ROOT:-$HOME/dev/projects}"
  local name expansion path relative root_name project_dir project_name
  local -A covered
  local -i checked=0 missing=0

  [[ -d "$projects_root" ]] || {
    print -r -- "ERROR: projects root does not exist: $projects_root"
    return 1
  }

  for name in ${(ok)aliases}; do
    expansion="${aliases[$name]}"
    [[ "$expansion" == "cd "* ]] || continue
    path="${(Q)${expansion#cd }}"
    [[ "$path" == "$projects_root"/* ]] || continue
    relative="${path#$projects_root/}"
    root_name="${relative%%/*}"
    covered[$root_name]=1
  done

  # (/N): glob qualifiers de zsh → solo directorios (/), y sin error si no hay ninguno (N)
  for project_dir in "$projects_root"/*(/N); do
    project_name="${project_dir:t}"
    (( checked++ ))

    if (( ! ${+covered[$project_name]} )); then
      printf 'MISSING project alias  %s\n' "$project_dir"
      (( missing++ ))
    fi
  done

  if (( missing == 0 )); then
    print -r -- "OK: all $checked top-level projects have a navigation alias"
    return 0
  fi

  print -r -- "ERROR: $missing of $checked top-level projects have no navigation alias"
  return 1
}

# zsh-config-check — valida la sintaxis de ~/.zshrc y de $ZSH_CUSTOM/*.zsh (zsh -n)
# y además ejecuta los dos checks de alias anteriores
zsh-config-check() {
  emulate -L zsh
  local config_file
  local -i failed=0

  for config_file in "$HOME/.zshrc" "$ZSH_CUSTOM"/pre/*.zsh(N) "$ZSH_CUSTOM"/*.zsh(N); do
    zsh -n "$config_file" || failed=1
  done

  nav-aliases-check || failed=1
  nav-projects-check || failed=1

  if (( failed == 0 )); then
    print -r -- "OK: zsh configuration syntax and navigation aliases are valid"
  fi

  return "$failed"
}

# ── HTTP ────────────────────────────────────────────────────────────────────

# test_nodes — hace 10 peticiones HEAD a una URL y muestra la cookie JSESSIONID devuelta.
# Sirve para ver si el balanceador reparte entre nodos (cambia el sufijo del JSESSIONID).
test_nodes() {
  local url
  read "url?Enter url to test (sin https://): "
  for i in $(seq 1 10); do
    echo "$i -----"
    # curl -s: silencioso; -I: solo cabeceras (petición HEAD)
    curl -sI "https://$url" | rg "JSESSION"
  done
}

# ── AWS ─────────────────────────────────────────────────────────────────────

# aws-use <profile> [region] — fija el perfil y la región de AWS CLI para esta shell
aws-use() {
  local profile="${1:?usage: aws-use <profile> [region]}"
  local region="${2:-${AWS_DEFAULT_REGION_FALLBACK:-eu-central-1}}"

  export AWS_PROFILE="$profile"
  export AWS_REGION="$region"
  export AWS_DEFAULT_REGION="$region"

  echo "AWS_PROFILE=$AWS_PROFILE"
  echo "AWS_REGION=$AWS_REGION"
}

# aws-login [profile] — inicia sesión SSO (abre el navegador) para el perfil indicado o el actual
aws-login() {
  local profile="${1:-$AWS_PROFILE}"

  if [[ -z "$profile" ]]; then
    echo "usage: aws-login <profile>"
    return 1
  fi

  aws sso login --profile "$profile"
}

# aws-who — muestra con qué identidad (cuenta, ARN) estás autenticado
aws-who() {
  aws sts get-caller-identity --profile "${AWS_PROFILE:-default}" --output json
}

# ── Kubernetes ──────────────────────────────────────────────────────────────
# eks-use / aks-use leen sus entornos de tablas que defines tú en un fichero local NO
# versionado (p. ej. ~/.zshrc.local), así este fichero no contiene nombres reales.
#
# Formato EKS_ENVS: [nombre]="aws_profile|region|cluster|alias_contexto|kubeconfig|context|namespace"
#   - Con cluster: se ejecuta `aws eks update-kubeconfig` y se usa alias_contexto.
#   - Sin cluster (vacío) pero con context: solo se cambia a ese contexto existente.
#   - namespace vacío = no se cambia el namespace por defecto.
# Ejemplo:
#   typeset -gA EKS_ENVS=(
#     [qa]="<AWS_PROFILE_NONPROD>|eu-central-1|<EKS_CLUSTER_QA>|myapp-qa|$HOME/.kube/config-qa||"
#     [prod]="<AWS_PROFILE_PROD>|eu-central-1|<EKS_CLUSTER_PROD>|myapp-prod|$HOME/.kube/config-prod||"
#     [kafka-dev]="|eu-west-1|||$HOME/.kube/config|<KUBE_CONTEXT>|kafka"
#   )
#
# Formato AKS_ENVS: [nombre]="kubeconfig|context|namespace"
# Ejemplo:
#   typeset -gA AKS_ENVS=( [projects]="$HOME/.kube/config|<KUBE_CONTEXT>|<NAMESPACE>" )

# eks-use <env> — cambia a un clúster EKS: exporta perfil/región/KUBECONFIG y fija contexto
eks-use() {
  local env="${1:?usage: eks-use <env>  (envs: ${(k)EKS_ENVS})}"
  local profile region cluster alias_name kubeconfig context namespace

  if (( ! ${+EKS_ENVS} )) || [[ -z "${EKS_ENVS[$env]:-}" ]]; then
    echo "unknown EKS env: $env"
    echo "available: ${(k)EKS_ENVS}"
    return 1
  fi
  # Divide la entrada por "|" en las 7 variables (IFS = separador de campos)
  IFS='|' read -r profile region cluster alias_name kubeconfig context namespace <<< "${EKS_ENVS[$env]}"

  # Igual que el original: el entorno "solo contexto" exporta AWS_PROFILE vacío
  export AWS_PROFILE="$profile"
  export AWS_REGION="$region"
  export AWS_DEFAULT_REGION="$region"
  export KUBECONFIG="$kubeconfig"

  if [[ -n "$cluster" ]]; then
    # Escribe/actualiza en KUBECONFIG la entrada del clúster, con nombre de contexto --alias
    aws eks update-kubeconfig \
      --region "$region" \
      --name "$cluster" \
      --profile "$profile" \
      --alias "$alias_name" || return 1

    kubectl config use-context "$alias_name" || return 1
  else
    kubectl config use-context "$context" || return 1
  fi

  if [[ -n "$namespace" ]]; then
    kubectl config set-context --current --namespace="$namespace" >/dev/null
  fi

  kenv
}

# aks-use [env] — cambia a un contexto de AKS (u otro clúster ya presente en el kubeconfig)
# y limpia las variables de AWS para no mezclar credenciales
aks-use() {
  local env="${1:-projects}"
  local kubeconfig context namespace

  if (( ! ${+AKS_ENVS} )) || [[ -z "${AKS_ENVS[$env]:-}" ]]; then
    echo "unknown AKS env: $env"
    echo "available: ${(k)AKS_ENVS}"
    return 1
  fi
  IFS='|' read -r kubeconfig context namespace <<< "${AKS_ENVS[$env]}"

  export KUBECONFIG="$kubeconfig"
  unset AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION
  kubectl config use-context "$context" || return 1
  if [[ -n "$namespace" ]]; then
    kubectl config set-context --current --namespace="$namespace" >/dev/null
  fi

  kenv
}

# kenv — resume a qué kubeconfig/contexto/namespace (y perfil AWS) apunta la shell
kenv() {
  echo "KUBECONFIG=${KUBECONFIG:-$HOME/.kube/config}"
  echo "context=$(kubectl config current-context 2>/dev/null)"
  # --minify: solo el contexto actual; jsonpath {..namespace}: busca el campo namespace a cualquier nivel
  echo "namespace=$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null)"

  if [[ -n "$AWS_PROFILE" ]]; then
    echo "AWS_PROFILE=$AWS_PROFILE"
    echo "AWS_REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
  fi
}

# kcontexts — lista todos los contextos de kubectl (el activo lleva *)
kcontexts() {
  kubectl config get-contexts
}

# ── Utilidades macOS / texto ────────────────────────────────────────────────

# edge [ficheros...] — abre Microsoft Edge, o los ficheros indicados en Edge (macOS)
edge() {
  if [[ $# -eq 0 ]]; then
    open -a "Microsoft Edge"
    return
  fi

  # open -a <App>: abre con esa aplicación; "--" marca el fin de opciones (por si un fichero empieza por -)
  open -a "Microsoft Edge" -- "$@"
}

# bom fichero.txt — crea fichero-bom.txt con BOM UTF-8 (bytes EF BB BF) al principio.
# Algunos lectores (p. ej. Edge Read Aloud) lo usan para detectar la codificación.
bom() { printf '\xEF\xBB\xBF' | cat - "$1" > "${1%.txt}-bom.txt"; }

# ── Carga diferida de NVM y SDKMAN (de 20-env-paths.zsh) ────────────────────
# Cargar nvm.sh/sdkman-init.sh en cada terminal tarda; estas funciones "señuelo" cargan la
# herramienta real la primera vez que se usa uno de sus comandos y luego se autoeliminan.

export NVM_DIR="$HOME/.nvm"
# Prefijo de Homebrew detectado (Apple Silicon: /opt/homebrew, Intel: /usr/local)
_UTILS_BREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"

_lazy_load_nvm() {
  unset -f nvm node npm npx corepack 2>/dev/null
  [ -s "$_UTILS_BREW_PREFIX/opt/nvm/nvm.sh" ] && \. "$_UTILS_BREW_PREFIX/opt/nvm/nvm.sh"  # carga nvm
  [ -s "$_UTILS_BREW_PREFIX/opt/nvm/etc/bash_completion.d/nvm" ] && \. "$_UTILS_BREW_PREFIX/opt/nvm/etc/bash_completion.d/nvm"  # autocompletado
}

nvm() { _lazy_load_nvm; nvm "$@"; }
node() { _lazy_load_nvm; command node "$@"; }
npm() { _lazy_load_nvm; command npm "$@"; }
npx() { _lazy_load_nvm; command npx "$@"; }
corepack() { _lazy_load_nvm; command corepack "$@"; }

export SDKMAN_DIR="$HOME/.sdkman"
_lazy_load_sdkman() {
  unset -f sdk java javac mvn gradle kotlin 2>/dev/null
  [[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"
}

sdk() { _lazy_load_sdkman; sdk "$@"; }
java() { _lazy_load_sdkman; command java "$@"; }
javac() { _lazy_load_sdkman; command javac "$@"; }
mvn() { _lazy_load_sdkman; command mvn "$@"; }
gradle() { _lazy_load_sdkman; command gradle "$@"; }
kotlin() { _lazy_load_sdkman; command kotlin "$@"; }
