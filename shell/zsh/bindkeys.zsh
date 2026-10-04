# bindkeys.zsh — atajos de teclado de la línea de comandos
#
# Qué hace:     Option/Alt + ← / → mueven el cursor palabra a palabra (como en un editor).
# Requisitos:   zsh. En iTerm2/Terminal.app la tecla Option debe enviar "Esc+"
#               (iTerm2: Settings → Profiles → Keys → Left Option key → Esc+).
# Uso:          source desde ~/.zshrc (ver zshrc.example).
# Variables:    ninguna.
# Efectos:      Solo configura la shell.
# Salida:       Ninguna.
#
# Para averiguar qué secuencia envía una combinación: ejecuta `cat -v` y pulsa la tecla
# (^[ equivale a \e). bindkey sin argumentos lista los atajos activos.

bindkey $'\e[1;3D' backward-word   # Option/Alt + ←
bindkey $'\e[1;3C' forward-word    # Option/Alt + →
