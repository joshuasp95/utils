#!/usr/bin/env bash
# notify-stop.sh — notificación de macOS cuando Codex CLI termina su turno
#
# Qué hace:     Muestra una notificación del sistema ("Codex ha terminado el turno") con
#               sonido "Submarine" y emite un pitido de terminal (BEL, \a).
# Requisitos:   macOS (osascript). Registrado como hook Stop en ~/.codex/hooks.json
#               (ver README.md de ai-agents/).
# Uso:          Lo invoca Codex automáticamente. Prueba manual: ./notify-stop.sh
# Variables:    Ninguna.
# Efectos:      SOLO LECTURA (solo notifica).
# Salida:       Notificación en el Centro de notificaciones + BEL por stderr.

osascript -e 'display notification "Codex ha terminado el turno" with title "Codex CLI" sound name "Submarine"'
printf '\a' >&2
