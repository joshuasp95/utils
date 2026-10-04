# performance-completions.zsh — arranque más rápido de zsh y rutas de autocompletado
#
# Qué hace:     Ajustes que deben aplicarse ANTES de cargar Oh My Zsh: desactiva comprobaciones
#               lentas, evita un problema de rendimiento entre plugins y registra las carpetas
#               donde buscar autocompletados (Homebrew, Docker).
# Requisitos:   zsh + Oh My Zsh. Homebrew y Docker Desktop opcionales (si no existen sus
#               carpetas, no pasa nada).
# Uso:          Cargar desde ~/.zshrc ANTES de `source $ZSH/oh-my-zsh.sh` (ver zshrc.example),
#               porque compinit (el sistema de autocompletado) indexa fpath durante esa carga.
# Variables:    HOMEBREW_PREFIX  prefijo de Homebrew (defecto: /opt/homebrew, el de Apple Silicon;
#                                en Intel es /usr/local). Lo define `brew shellenv` en ~/.zprofile.
# Efectos:      Solo modifica variables de la shell.
# Salida:       Ninguna.

# No comprueba permisos de las carpetas de completions en cada arranque (compaudit).
# Acelera el inicio y evita avisos de "insecure directories" en algunos equipos.
ZSH_DISABLE_COMPFIX="true"

# zsh-autosuggestions vuelve a enganchar sus widgets en cada prompt. Junto con
# fast-syntax-highlighting, en sesiones largas eso acaba envolviendo `accept-line` muchas
# veces y la shell se vuelve lenta al pulsar Enter. Con MANUAL_REBIND solo lo hace al inicio.
ZSH_AUTOSUGGEST_MANUAL_REBIND="true"

# fpath = lista de carpetas donde zsh busca funciones de autocompletado (ficheros _<comando>).
# Homebrew instala ahí los completados de lo que instalas con brew (aws, gh, terraform…).
fpath=("${HOMEBREW_PREFIX:-/opt/homebrew}/share/zsh/site-functions" $fpath)

# Docker Desktop deja sus completados en ~/.docker/completions. Se antepone para que tengan prioridad.
[[ -d "$HOME/.docker/completions" ]] && fpath=("$HOME/.docker/completions" $fpath)

# typeset -U = "unique": elimina duplicados de PATH y fpath, lo que reduce trabajo al arrancar.
# (path y PATH son la misma variable vista como array y como texto.)
typeset -U path PATH fpath
