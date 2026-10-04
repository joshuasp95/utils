# plugins-theme.zsh — tema y plugins de Oh My Zsh
#
# Qué hace:     Define el tema y la lista de plugins que Oh My Zsh activará.
# Requisitos:   Oh My Zsh. zsh-autosuggestions y fast-syntax-highlighting NO vienen con Oh My Zsh:
#                 git clone https://github.com/zsh-users/zsh-autosuggestions \
#                   "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions"
#                 git clone https://github.com/zdharma-continuum/fast-syntax-highlighting \
#                   "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/plugins/fast-syntax-highlighting"
# Uso:          Cargar desde ~/.zshrc ANTES de `source $ZSH/oh-my-zsh.sh` (ver zshrc.example):
#               Oh My Zsh lee $ZSH_THEME y $plugins en el momento de cargarse.
# Variables:    ninguna.
# Efectos:      Solo define variables de la shell.
# Salida:       Ninguna.

ZSH_THEME="robbyrussell"

# git                     → alias de git (gst, gco, gl…) e info de rama en el prompt
# kubectl                 → alias k, kgp, kdp… y autocompletado de kubectl
# zsh-autosuggestions     → sugiere en gris el comando según el historial (→ para aceptar)
# fast-syntax-highlighting→ colorea el comando mientras escribes (rojo = comando inexistente)
plugins=(git kubectl zsh-autosuggestions fast-syntax-highlighting)
