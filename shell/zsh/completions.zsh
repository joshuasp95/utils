# completions.zsh — autocompletados estilo bash dentro de zsh (Terraform)
#
# Qué hace:     Activa la compatibilidad con completados de bash (bashcompinit) y registra el de
#               Terraform, que se distribuye en formato bash ("complete -C").
# Requisitos:   zsh. terraform instalado (si no está, no se registra nada).
# Uso:          Cargar desde ~/.zshrc DESPUÉS de Oh My Zsh (ver zshrc.example).
# Variables:    ninguna; la ruta de terraform se obtiene con `command -v`.
# Efectos:      Solo configura la shell.
# Salida:       Ninguna.

# bashcompinit necesita que el sistema de completado de zsh (compinit) esté iniciado. Oh My Zsh
# ya lo hace; si usas este fichero sin Oh My Zsh, lo iniciamos aquí. $+functions[x] vale 1 si
# la función x existe.
(( $+functions[compdef] )) || { autoload -Uz compinit && compinit; }

# bashcompinit permite usar en zsh la orden `complete` de bash.
# -U: no expande alias al cargar; +X: carga la función ya (no al primer uso).
autoload -U +X bashcompinit && bashcompinit

# complete -C <programa> <comando>: para completar <comando>, zsh ejecuta <programa>, que devuelve
# las opciones. Terraform se completa a sí mismo así. -o nospace: no añade espacio tras completar.
# Funciona también con un alias tipo `alias tf=terraform`, porque el binario real sigue siendo terraform.
if _tf_bin="$(command -v terraform 2>/dev/null)"; then
  complete -o nospace -C "$_tf_bin" terraform
fi
unset _tf_bin
