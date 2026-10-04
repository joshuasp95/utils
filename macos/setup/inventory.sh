#!/usr/bin/env bash
set -uo pipefail
# inventory.sh — saca una "foto" (inventario) del software y preferencias de este Mac a una carpeta
#
# Qué hace:     Ejecuta comandos de solo lectura (sw_vers, brew, code, npm, nvm, SDKMAN, defaults,
#               git config…) y guarda cada resultado en un .txt dentro de la carpeta de salida.
#               Sirve para documentar un Mac y para comparar dos Macs con `diff -ru`.
#               No guarda NINGÚN valor secreto: de git config solo los nombres de clave, y de los
#               ficheros de credenciales solo si existen o no.
# Requisitos:   macOS. Opcionales (si faltan, ese fichero queda vacío/con aviso): brew, code, npm,
#               nvm, SDKMAN, Oh My Zsh.
# Uso:          ./inventory.sh ./inventario-mac-a          # carpeta de salida
#               ./inventory.sh                             # por defecto ./mac-inventory-AAAA-MM-DD
#               diff -ru ./inventario-mac-a ./inventario-mac-b   # comparar dos Macs
# Variables:    1er argumento: carpeta de salida (se crea si no existe).
# Efectos:      SOLO LECTURA del sistema · ESCRIBE: ficheros .txt y un Brewfile en la carpeta
#               de salida (sobrescribe los de una ejecución anterior en esa carpeta).
# Salida:       <carpeta>/*.txt + <carpeta>/Brewfile
#
# Sin `set -e` a propósito: si un comando falla (herramienta no instalada) se sigue con el resto.

case "${1:-}" in
  -h|--help) sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

OUT="${1:-./mac-inventory-$(date +%Y-%m-%d)}"
mkdir -p "$OUT" || { echo "ERROR: no se puede crear $OUT" >&2; exit 1; }
echo "Inventario en: $OUT"

# cap <fichero> <comando...>: ejecuta el comando y guarda stdout en <carpeta>/<fichero>.
# Los errores van al mismo fichero precedidos de "#" para que se vea por qué está vacío.
cap() {
  local file="$OUT/$1"; shift
  { "$@" 2>&1 || echo "# (comando falló o herramienta no instalada: $*)"; } > "$file"
  printf '  %-22s %s líneas\n' "$(basename "$file")" "$(wc -l < "$file" | tr -d ' ')"
}
have() { command -v "$1" >/dev/null 2>&1; }

# ── Sistema ──────────────────────────────────────────────────────────────────
cap sw.txt sh -c 'sw_vers; uname -m'                       # versión de macOS y arquitectura

# ── Homebrew ─────────────────────────────────────────────────────────────────
if have brew; then
  cap brewver.txt brew --version
  cap taps.txt brew tap                                   # repos extra de fórmulas
  cap formulae.txt brew leaves                            # fórmulas instaladas que nada más necesita
  cap casks.txt brew list --cask                          # apps instaladas con Homebrew
  # --force sobrescribe el Brewfile si ya existe. (Las versiones recientes de Homebrew ya incluyen
  # la descripción de cada paquete como comentario; la antigua opción --describe está retirada.)
  cap brew-bundle-dump.log brew bundle dump --file="$OUT/Brewfile" --force
else
  echo "# brew no instalado" > "$OUT/brewver.txt"
fi

# ── Aplicaciones (incluye las instaladas fuera de Homebrew) ──────────────────
cap apps.txt ls /Applications
cap userapps.txt ls "$HOME/Applications"

# ── Editores y lenguajes ─────────────────────────────────────────────────────
if have code; then cap vscode.txt code --list-extensions; fi
if have npm; then cap npmg.txt npm ls -g --depth=0; fi    # paquetes npm globales del node activo
cap nvm.txt ls "$HOME/.nvm/versions/node"                  # versiones de Node instaladas con nvm
cap sdkman.txt sh -c 'for c in "$HOME"/.sdkman/candidates/*/; do printf "%s: " "$(basename "$c")"; ls "$c" | grep -v "^current$" | tr "\n" " "; echo; done'
if have pipx; then cap pipx.txt pipx list --short; fi

# ── Shell ────────────────────────────────────────────────────────────────────
cap omzplugins.txt ls "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins"
# Tema y plugins ACTIVOS: se buscan las líneas plugins=/ZSH_THEME= en ~/.zshrc y en los .zsh de
# $ZSH_CUSTOM (sin entrar en custom/plugins, que son el código de los propios plugins).
cap omz-enabled.txt sh -c 'C="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"; { grep -hE "^[[:space:]]*(plugins=|ZSH_THEME=)" "$HOME/.zshrc"; find "$C" -name "*.zsh" -not -path "*/plugins/*" -not -path "*/themes/*" -exec grep -hE "^[[:space:]]*(plugins=|ZSH_THEME=)" {} +; } 2>/dev/null; true'
cap fonts.txt sh -c 'ls "$HOME/Library/Fonts" | sed "s/\.[^.]*$//" | sort'

# ── Preferencias de macOS (las que gestiona macos-defaults.sh y algunas más) ─
cap defaults.txt sh -c '
for pair in \
  "com.apple.dock autohide" "com.apple.dock tilesize" "com.apple.dock show-recents" \
  "com.apple.finder FXPreferredViewStyle" "com.apple.finder ShowPathbar" \
  "NSGlobalDomain AppleShowAllExtensions" "NSGlobalDomain AppleInterfaceStyle" \
  "NSGlobalDomain com.apple.swipescrolldirection" "NSGlobalDomain KeyRepeat" \
  "NSGlobalDomain InitialKeyRepeat" "com.apple.screencapture location" \
  "com.apple.AppleMultitouchTrackpad Clicking" \
  "com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking"; do
  set -- $pair
  printf "%s %s = %s\n" "$1" "$2" "$(defaults read "$1" "$2" 2>/dev/null || echo "(no definido)")"
done'

# ── Git: SOLO nombres de clave, nunca valores (contienen nombre/email) ───────
cap gitconfig-keys.txt sh -c 'git config --global --list --name-only | sort -u'

# ── Ficheros de configuración: SOLO nombres ──────────────────────────────────
cap dotconfig.txt ls -A "$HOME/.config"
cap dotfiles.txt sh -c 'ls -A "$HOME" | grep "^\." | grep -vE "^\.(claude\.json\.tmp|zcompdump|v8flags)"'
cap cleanup-candidates.txt sh -c 'cd "$HOME" && for p in ".claude.json.tmp.*" ".zcompdump-*" ".v8flags.*" ".*.bak"; do n=$(ls -d $p 2>/dev/null | wc -l | tr -d " "); echo "$p: $n"; done'

# ── Credenciales: SOLO si existen (nunca su contenido) ───────────────────────
cap secrets-presence.txt sh -c '
for p in .aws .azure .kube .ssh .gnupg .secrets .databrickscfg .keeper .docker/config.json \
         .config/gh/hosts.yml .config/argocd/config .confluent .mcp-auth .m2/settings.xml \
         .terraform.d/credentials.tfrc.json .mongodb .npmrc; do
  if [ -e "$HOME/$p" ]; then echo "EXISTE    ~/$p"; else echo "no existe ~/$p"; fi
done'

echo "Hecho. Compara con otro Mac: diff -ru <carpeta-mac-a> <carpeta-mac-b>"
