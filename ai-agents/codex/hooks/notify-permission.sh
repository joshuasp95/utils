#!/usr/bin/env bash
# notify-permission.sh — notificación de macOS cuando Codex CLI espera tu aprobación
#
# Qué hace:     Muestra una notificación del sistema ("Codex está esperando aprobación")
#               con sonido "Glass" y emite un pitido de terminal (carácter BEL, \a).
# Requisitos:   macOS (osascript). Registrado como hook PermissionRequest en
#               ~/.codex/hooks.json (ver README.md de ai-agents/).
# Uso:          Lo invoca Codex automáticamente. Prueba manual: ./notify-permission.sh
# Variables:    Ninguna.
# Efectos:      SOLO LECTURA (solo notifica).
# Salida:       Notificación en el Centro de notificaciones + BEL por stderr.

# osascript -e: ejecuta AppleScript en línea. "display notification <texto> with title
# <título> sound name <sonido>" usa los sonidos de /System/Library/Sounds.
osascript -e 'display notification "Codex está esperando aprobación" with title "Codex CLI" sound name "Glass"'
# \a por stderr: así el pitido llega a la terminal sin ensuciar la salida estándar del hook.
printf '\a' >&2
