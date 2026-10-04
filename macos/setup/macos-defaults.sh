#!/usr/bin/env bash
set -euo pipefail
# macos-defaults.sh — aplica las preferencias de macOS (Dock, Finder, trackpad…) del Mac de referencia
#
# Qué hace:     Ejecuta `defaults write` para cada preferencia observada en el Mac de referencia
#               (snapshot 2026-10-05) y reinicia Dock, Finder y SystemUIServer para que se apliquen.
#               Cada línea indica qué cambia y cómo revertirla.
# Requisitos:   macOS. No necesita sudo (son preferencias de tu usuario).
# Uso:          ./macos-defaults.sh             # aplica los cambios
#               ./macos-defaults.sh --dry-run   # solo muestra lo que haría
#               ./macos-defaults.sh --help
# Variables:    SCREENSHOTS_DIR  carpeta de capturas (por defecto: $HOME/Pictures/Screenshots)
# Efectos:      ESCRIBE: preferencias de usuario en ~/Library/Preferences/*.plist y crea
#               SCREENSHOTS_DIR. Cierra y reabre Dock, Finder y la barra de menús (unos segundos).
#               Algunos cambios (modo oscuro, dirección del scroll) pueden requerir cerrar sesión.
# Salida:       Lista de comandos ejecutados (o que se ejecutarían con --dry-run).
#
# Explicación de `defaults` y los plist: EXPLICACIONES.md#defaults

DRY_RUN=0
SCREENSHOTS_DIR="${SCREENSHOTS_DIR:-$HOME/Pictures/Screenshots}"

usage() { sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; }

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: opción desconocida: $arg (usa --help)" >&2; exit 2 ;;
  esac
done

# run: imprime el comando y lo ejecuta salvo en --dry-run.
run() {
  echo "+ $*"
  if [[ "$DRY_RUN" -eq 0 ]]; then "$@"; fi
}

[[ "$(uname -s)" == "Darwin" ]] || { echo "ERROR: este script es solo para macOS" >&2; exit 1; }

# Cierra "Ajustes del Sistema" si está abierto: si no, puede sobrescribir lo que escribamos al salir.
run osascript -e 'tell application "System Settings" to quit' || true

# ── Dock ─────────────────────────────────────────────────────────────────────
# Ocultar el Dock automáticamente (aparece al llevar el ratón al borde).
# Revertir: defaults write com.apple.dock autohide -bool false
run defaults write com.apple.dock autohide -bool true

# ── Finder ───────────────────────────────────────────────────────────────────
# Vista por defecto en columnas. Valores: clmv=columnas, Nlsv=lista, icnv=iconos, glyv=galería.
# Revertir: defaults delete com.apple.finder FXPreferredViewStyle   (vuelve a iconos)
# Ojo: las carpetas que ya tengan una vista guardada (.DS_Store) mantienen la suya.
run defaults write com.apple.finder FXPreferredViewStyle -string "clmv"

# Mostrar siempre la extensión de los ficheros (informe.pdf en vez de "informe").
# NSGlobalDomain = preferencias globales que leen todas las apps.
# Revertir: defaults write NSGlobalDomain AppleShowAllExtensions -bool false
run defaults write NSGlobalDomain AppleShowAllExtensions -bool true

# ── Apariencia ───────────────────────────────────────────────────────────────
# Modo oscuro. Puede no verse hasta cerrar sesión; alternativa inmediata: Ajustes del Sistema →
# Apariencia → Oscuro.
# Revertir (modo claro): defaults delete NSGlobalDomain AppleInterfaceStyle
run defaults write NSGlobalDomain AppleInterfaceStyle -string "Dark"

# ── Capturas de pantalla ─────────────────────────────────────────────────────
# Guardar capturas (Cmd+Shift+3/4/5) en una carpeta propia en vez de en el Escritorio.
# En el Mac de referencia el valor estaba guardado como "~/Pictures/Screenshots" (con ~ literal);
# aquí se escribe la ruta absoluta, que es lo más fiable.
# Revertir: defaults delete com.apple.screencapture location   (vuelve al Escritorio)
run mkdir -p "$SCREENSHOTS_DIR"
run defaults write com.apple.screencapture location -string "$SCREENSHOTS_DIR"

# ── Trackpad ─────────────────────────────────────────────────────────────────
# "Tocar para hacer clic" DESACTIVADO (hay que presionar el trackpad). Es el valor de fábrica:
# se escribe para dejarlo explícito. Hay dos dominios: trackpad integrado y trackpad Bluetooth.
# Revertir (activar tocar para clic): mismos comandos con -bool true
run defaults write com.apple.AppleMultitouchTrackpad Clicking -bool false
run defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool false

# Desplazamiento "natural" DESACTIVADO: deslizar hacia abajo baja el contenido (como en Windows).
# Requiere cerrar sesión para aplicarse del todo.
# Revertir: defaults write NSGlobalDomain com.apple.swipescrolldirection -bool true
run defaults write NSGlobalDomain com.apple.swipescrolldirection -bool false

# ── Aplicar ──────────────────────────────────────────────────────────────────
# killall cierra el proceso; macOS los vuelve a abrir solos y releen sus preferencias.
# SystemUIServer = barra de menús (afecta a capturas de pantalla).
for app in Dock Finder SystemUIServer; do
  run killall "$app" || true
done

echo "Hecho. Si el modo oscuro o la dirección del scroll no cambian, cierra sesión y vuelve a entrar."
