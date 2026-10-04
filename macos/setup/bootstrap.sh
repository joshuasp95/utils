#!/usr/bin/env bash
set -euo pipefail
# bootstrap.sh — prepara un Mac nuevo con las herramientas del Mac de referencia (idempotente)
#
# Qué hace:     Por orden: 1) comprueba Xcode Command Line Tools, 2) instala Homebrew si falta y lo
#               añade a ~/.zprofile, 3) `brew bundle` con el Brewfile, 4) Oh My Zsh + plugins,
#               5) versiones de Node con nvm, 6) paquetes npm globales, 7) SDKMAN + Java/Groovy,
#               8) [opcional] copia shell/zsh/zshrc.example a ~/.zshrc (con backup),
#               9) [opcional] ejecuta macos-defaults.sh.
#               Idempotente: puedes relanzarlo; lo que ya está instalado se salta.
# Requisitos:   macOS (Apple Silicon o Intel), conexión a internet, contraseña de administrador
#               (la piden el instalador de Homebrew y algunos casks).
# Uso:          ./bootstrap.sh --dry-run                    # ver qué haría, sin cambiar nada
#               ./bootstrap.sh                              # instalación completa (pasos 1-7)
#               ./bootstrap.sh --link-zshrc --with-defaults # + pasos 8 y 9
#               ./bootstrap.sh --skip-bundle --skip-sdkman  # saltar pasos concretos
# Opciones:     --dry-run        solo imprime los comandos
#               --skip-clt | --skip-brew | --skip-bundle | --skip-omz | --skip-node | --skip-npm |
#               --skip-sdkman    salta ese paso
#               --link-zshrc     paso 8 (por defecto NO se toca ~/.zshrc)
#               --with-defaults  paso 9 (por defecto NO se tocan las preferencias de macOS)
#               --brewfile RUTA  Brewfile alternativo (por defecto: el de esta carpeta)
# Variables:    NODE_VERSIONS, NODE_DEFAULT, NPM_GLOBALS, JAVA_VERSIONS, JAVA_DEFAULT,
#               GROOVY_VERSIONS, OMZ_PLUGINS: se pueden sobrescribir por entorno, p. ej.
#               NODE_VERSIONS="22 24" ./bootstrap.sh
# Efectos:      ESCRIBE: instala software (Homebrew en /opt/homebrew, ~/.oh-my-zsh, ~/.nvm,
#               ~/.sdkman), añade una línea a ~/.zprofile, y con las opciones de los pasos 8-9
#               modifica ~/.zshrc (backup previo) y preferencias de macOS.
#               NO copia credenciales ni toca git config (ver README.md, pasos manuales).
# Salida:       Log por pasos en la terminal.
#
# Runbook: README.md · Explicaciones: EXPLICACIONES.md

# ── Configuración (valores del Mac de referencia, snapshot 2026-10-05) ───────
# Node: solo las LTS en uso (20, 22, 24). Las antiguas (10, 14) se omiten: añádelas si un
# proyecto legacy las necesita. nvm acepta "24" = la última 24.x.
NODE_VERSIONS="${NODE_VERSIONS:-20 22 24}"
NODE_DEFAULT="${NODE_DEFAULT:-24}"
# Paquetes npm globales (se instalan en la versión NODE_DEFAULT).
NPM_GLOBALS="${NPM_GLOBALS:-@openai/codex mcp-remote yarn}"
# Java/Groovy: identificadores de SDKMAN (ver `sdk list java`). Si alguno ya no existe en el
# catálogo, SDKMAN fallará en esa línea: cámbialo por el más parecido de `sdk list java`.
JAVA_VERSIONS="${JAVA_VERSIONS:-21.0.9-zulu 17.0.16-zulu 11.0.29-zulu 8.0.472-zulu 25.0.1-tem}"
JAVA_DEFAULT="${JAVA_DEFAULT:-21.0.9-zulu}"
GROOVY_VERSIONS="${GROOVY_VERSIONS:-5.0.4 3.0.0}"
# Plugins de Oh My Zsh que no vienen incluidos: "nombre|url-del-repo". Los dos primeros son los
# activos en shell/zsh/pre/plugins-theme.zsh; los otros dos estaban instalados pero sin activar.
OMZ_PLUGINS="${OMZ_PLUGINS:-zsh-autosuggestions|https://github.com/zsh-users/zsh-autosuggestions
fast-syntax-highlighting|https://github.com/zdharma-continuum/fast-syntax-highlighting
zsh-syntax-highlighting|https://github.com/zsh-users/zsh-syntax-highlighting
zsh-autocomplete|https://github.com/marlonrichert/zsh-autocomplete}"

# ── Rutas ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # carpeta de este script
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"                 # raíz del repo utils
BREWFILE="$SCRIPT_DIR/Brewfile"

# ── Opciones ─────────────────────────────────────────────────────────────────
DRY_RUN=0; SKIP_CLT=0; SKIP_BREW=0; SKIP_BUNDLE=0; SKIP_OMZ=0; SKIP_NODE=0; SKIP_NPM=0
SKIP_SDKMAN=0; LINK_ZSHRC=0; WITH_DEFAULTS=0

usage() { sed -n '3,33p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=1 ;;
    --skip-clt)      SKIP_CLT=1 ;;
    --skip-brew)     SKIP_BREW=1 ;;
    --skip-bundle)   SKIP_BUNDLE=1 ;;
    --skip-omz)      SKIP_OMZ=1 ;;
    --skip-node)     SKIP_NODE=1 ;;
    --skip-npm)      SKIP_NPM=1 ;;
    --skip-sdkman)   SKIP_SDKMAN=1 ;;
    --link-zshrc)    LINK_ZSHRC=1 ;;
    --with-defaults) WITH_DEFAULTS=1 ;;
    --brewfile)      BREWFILE="${2:?--brewfile necesita una ruta}"; shift ;;
    -h|--help)       usage; exit 0 ;;
    *) echo "ERROR: opción desconocida: $1 (usa --help)" >&2; exit 2 ;;
  esac
  shift
done

# ── Utilidades ───────────────────────────────────────────────────────────────
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }   # título de paso en azul
info() { printf '    %s\n' "$*"; }
# run: imprime y ejecuta un comando (en --dry-run solo lo imprime).
run() {
  echo "    + $*"
  if [[ "$DRY_RUN" -eq 0 ]]; then "$@"; fi
}
# run_sh: igual que run pero para una línea con tuberías/subshells (se pasa a bash -c).
run_sh() {
  echo "    + $1"
  if [[ "$DRY_RUN" -eq 0 ]]; then bash -c "$1"; fi
}

[[ "$(uname -s)" == "Darwin" ]] || { echo "ERROR: este script es solo para macOS" >&2; exit 1; }
[[ "$DRY_RUN" -eq 1 ]] && echo "MODO --dry-run: no se cambiará nada."

# Prefijo de Homebrew según la arquitectura: arm64 (Apple Silicon) → /opt/homebrew; x86_64 → /usr/local
if [[ "$(uname -m)" == "arm64" ]]; then BREW_PREFIX="/opt/homebrew"; else BREW_PREFIX="/usr/local"; fi
BREW_BIN="$BREW_PREFIX/bin/brew"

# ── 1) Xcode Command Line Tools ──────────────────────────────────────────────
if [[ "$SKIP_CLT" -eq 0 ]]; then
  step "1/9 Xcode Command Line Tools"
  # xcode-select -p imprime la ruta de las CLT si están instaladas; si no, falla.
  if xcode-select -p >/dev/null 2>&1; then
    info "Ya instaladas en $(xcode-select -p)"
  else
    # --install abre una ventana del sistema; la instalación sigue en segundo plano.
    run xcode-select --install || true
    if [[ "$DRY_RUN" -eq 0 ]]; then
      echo "Acepta la ventana de instalación, espera a que termine y vuelve a lanzar este script." >&2
      exit 1
    fi
  fi
fi

# ── 2) Homebrew ──────────────────────────────────────────────────────────────
if [[ "$SKIP_BREW" -eq 0 ]]; then
  step "2/9 Homebrew"
  if command -v brew >/dev/null 2>&1 || [[ -x "$BREW_BIN" ]]; then
    info "Ya instalado"
  else
    # Instalador oficial (https://brew.sh). NONINTERACTIVE=1 evita la pregunta "Press RETURN".
    run_sh 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  fi
  # Añadir brew al PATH de las shells de login, solo si la línea no existe ya.
  ZPROFILE_LINE="eval \"\$($BREW_BIN shellenv)\""
  if grep -qs 'brew shellenv' "$HOME/.zprofile"; then
    info "$HOME/.zprofile ya contiene 'brew shellenv'"
  else
    run_sh "printf '\n# Homebrew (añadido por bootstrap.sh)\n%s\n' '$ZPROFILE_LINE' >> \"\$HOME/.zprofile\""
  fi
fi
# Cargar brew en ESTA ejecución del script (el ~/.zprofile solo afecta a terminales nuevas).
if [[ -x "$BREW_BIN" ]]; then eval "$("$BREW_BIN" shellenv)"; fi

# ── 3) Brewfile ──────────────────────────────────────────────────────────────
if [[ "$SKIP_BUNDLE" -eq 0 ]]; then
  step "3/9 brew bundle ($BREWFILE)"
  [[ -f "$BREWFILE" ]] || { echo "ERROR: no existe $BREWFILE" >&2; exit 1; }
  if command -v brew >/dev/null 2>&1 && brew bundle check --file="$BREWFILE" >/dev/null 2>&1; then
    info "Todo lo del Brewfile ya está instalado"
  else
    # Sin set -e para este paso: si un cask falla (p. ej. ya instalado a mano) queremos seguir.
    run brew bundle --file="$BREWFILE" || info "AVISO: brew bundle terminó con errores; revisa el log y relanza."
  fi
fi

# ── 4) Oh My Zsh + plugins ───────────────────────────────────────────────────
if [[ "$SKIP_OMZ" -eq 0 ]]; then
  step "4/9 Oh My Zsh"
  ZSH_DIR="$HOME/.oh-my-zsh"
  if [[ -d "$ZSH_DIR" ]]; then
    info "Ya instalado en $ZSH_DIR"
  else
    # RUNZSH=no: no abrir una zsh nueva al terminar. KEEP_ZSHRC=yes: no sustituir ~/.zshrc.
    # --unattended: sin preguntas (tampoco cambia la shell por defecto; en macOS ya es zsh).
    run_sh 'RUNZSH=no KEEP_ZSHRC=yes sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended'
  fi
  ZSH_CUSTOM_DIR="${ZSH_CUSTOM:-$ZSH_DIR/custom}"
  while IFS='|' read -r name url; do
    [[ -z "$name" ]] && continue
    if [[ -d "$ZSH_CUSTOM_DIR/plugins/$name" ]]; then
      info "Plugin $name ya presente"
    else
      # --depth 1: solo el último commit (más rápido, no hace falta el historial).
      run git clone --depth 1 "$url" "$ZSH_CUSTOM_DIR/plugins/$name"
    fi
  done <<< "$OMZ_PLUGINS"
fi

# ── 5) Node.js con nvm ───────────────────────────────────────────────────────
if [[ "$SKIP_NODE" -eq 0 || "$SKIP_NPM" -eq 0 ]]; then
  export NVM_DIR="$HOME/.nvm"   # donde nvm guarda las versiones de Node
  NVM_SH=""
  if command -v brew >/dev/null 2>&1; then NVM_SH="$(brew --prefix nvm 2>/dev/null)/nvm.sh"; fi
  if [[ -n "$NVM_SH" && -s "$NVM_SH" ]]; then
    if [[ "$DRY_RUN" -eq 0 ]]; then
      mkdir -p "$NVM_DIR"
      # nvm.sh no es compatible con `set -u` (usa variables sin definir): lo desactivamos al cargarlo.
      set +u
      # shellcheck disable=SC1090
      source "$NVM_SH"
      set -u
    fi
  else
    NVM_SH=""
  fi
fi

if [[ "$SKIP_NODE" -eq 0 ]]; then
  step "5/9 Node.js con nvm ($NODE_VERSIONS; por defecto $NODE_DEFAULT)"
  if [[ -z "$NVM_SH" ]]; then
    info "AVISO: nvm no está instalado (va en el Brewfile). Salto este paso."
  else
    set +u
    for v in $NODE_VERSIONS; do
      # nvm install es idempotente: si la versión ya existe, solo lo indica.
      run nvm install "$v"
    done
    run nvm alias default "$NODE_DEFAULT"   # versión activa en cada terminal nueva
    set -u
  fi
fi

# ── 6) Paquetes npm globales ─────────────────────────────────────────────────
if [[ "$SKIP_NPM" -eq 0 ]]; then
  step "6/9 npm globales en Node $NODE_DEFAULT ($NPM_GLOBALS)"
  if [[ -z "${NVM_SH:-}" ]]; then
    info "AVISO: nvm no disponible. Salto este paso."
  else
    set +u
    if [[ "$DRY_RUN" -eq 0 ]]; then nvm use "$NODE_DEFAULT" >/dev/null; fi
    set -u
    for pkg in $NPM_GLOBALS; do
      # npm ls -g <pkg> devuelve error si el paquete global no está instalado.
      if [[ "$DRY_RUN" -eq 0 ]] && npm ls -g --depth=0 "$pkg" >/dev/null 2>&1; then
        info "$pkg ya instalado"
      else
        run npm install -g "$pkg"
      fi
    done
  fi
fi

# ── 7) SDKMAN + Java/Groovy ──────────────────────────────────────────────────
if [[ "$SKIP_SDKMAN" -eq 0 ]]; then
  step "7/9 SDKMAN (Java: $JAVA_VERSIONS · Groovy: $GROOVY_VERSIONS)"
  SDKMAN_DIR="$HOME/.sdkman"
  if [[ -d "$SDKMAN_DIR" ]]; then
    info "SDKMAN ya instalado"
  else
    # rcupdate=false: el instalador NO edita ~/.zshrc (la inicialización va en ~/.zshrc.local,
    # ver README.md paso 5).
    run_sh 'curl -s "https://get.sdkman.io?rcupdate=false" | bash'
  fi
  if [[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]]; then
    export SDKMAN_DIR
    set +u
    if [[ "$DRY_RUN" -eq 0 ]]; then
      # shellcheck disable=SC1091
      source "$SDKMAN_DIR/bin/sdkman-init.sh"
    fi
    # shellcheck disable=SC2034
    sdkman_auto_answer=true   # responder "sí" a las preguntas de sdk install
    for v in $JAVA_VERSIONS; do
      if [[ -d "$SDKMAN_DIR/candidates/java/$v" ]]; then info "java $v ya instalada"
      else run sdk install java "$v" || info "AVISO: no se pudo instalar java $v (¿cambió el identificador?)"; fi
    done
    for v in $GROOVY_VERSIONS; do
      if [[ -d "$SDKMAN_DIR/candidates/groovy/$v" ]]; then info "groovy $v ya instalado"
      else run sdk install groovy "$v" || info "AVISO: no se pudo instalar groovy $v"; fi
    done
    run sdk default java "$JAVA_DEFAULT" || true
    set -u
  elif [[ "$DRY_RUN" -eq 1 ]]; then
    for v in $JAVA_VERSIONS; do info "+ sdk install java $v"; done
    for v in $GROOVY_VERSIONS; do info "+ sdk install groovy $v"; done
  fi
fi

# ── 8) [Opcional] ~/.zshrc desde el repo ─────────────────────────────────────
if [[ "$LINK_ZSHRC" -eq 1 ]]; then
  step "8/9 ~/.zshrc desde shell/zsh/zshrc.example"
  SRC="$REPO_ROOT/shell/zsh/zshrc.example"
  [[ -f "$SRC" ]] || { echo "ERROR: no existe $SRC" >&2; exit 1; }
  if [[ -f "$HOME/.zshrc" ]]; then
    # Backup con fecha y hora: nunca se pierde el ~/.zshrc anterior.
    run cp "$HOME/.zshrc" "$HOME/.zshrc.bak.$(date +%Y%m%d-%H%M%S)"
  fi
  # Se COPIA (no symlink) y se fija UTILS_REPO a la ruta real del repo en esta máquina.
  run_sh "sed 's|\\\$HOME/utils}|$REPO_ROOT}|' \"$SRC\" > \"\$HOME/.zshrc\""
  info "Pon lo específico de esta máquina (SDKMAN, rutas, tokens) en ~/.zshrc.local (no versionado)."
else
  step "8/9 ~/.zshrc: no se toca (usa --link-zshrc para copiar shell/zsh/zshrc.example)"
fi

# ── 9) [Opcional] Preferencias de macOS ──────────────────────────────────────
if [[ "$WITH_DEFAULTS" -eq 1 ]]; then
  step "9/9 Preferencias de macOS (macos-defaults.sh)"
  if [[ "$DRY_RUN" -eq 1 ]]; then run "$SCRIPT_DIR/macos-defaults.sh" --dry-run
  else run "$SCRIPT_DIR/macos-defaults.sh"; fi
else
  step "9/9 Preferencias de macOS: no se tocan (usa --with-defaults)"
fi

step "Terminado. Pendiente a mano (ver README.md): git config, credenciales, apps fuera de Homebrew."
