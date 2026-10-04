#!/usr/bin/env bash
# Sin -e a propósito (igual que el original): si un paso falla, se intentan los siguientes.
set -uo pipefail
# brew-update.sh — actualiza Homebrew, sus fórmulas y casks, y limpia versiones antiguas
#
# Qué hace:     brew update (refresca el catálogo) → brew upgrade (fórmulas: CLIs/librerías)
#               → brew upgrade --cask (apps gráficas) → brew cleanup (borra versiones viejas
#               y cachés de descargas).
# Requisitos:   macOS con Homebrew instalado.
# Uso:          ./brew-update.sh
#               (alias sugerido en shell/zsh/aliases.zsh: actualizar)
# Variables:    Ninguna. La ruta de brew se detecta con `command -v brew`
#               (/opt/homebrew/bin/brew en Apple Silicon, /usr/local/bin/brew en Intel).
# Efectos:      ESCRIBE: instala versiones nuevas de los paquetes y borra las antiguas.
#               Una app abierta puede necesitar reiniciarse tras actualizarse.
# Salida:       Log de brew en la terminal.

BREW="$(command -v brew)" || { echo "ERROR: brew no está en el PATH" >&2; exit 1; }

"$BREW" update
"$BREW" upgrade
"$BREW" upgrade --cask
"$BREW" cleanup
