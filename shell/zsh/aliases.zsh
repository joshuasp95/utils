# aliases.zsh — alias genéricos de zsh (atajos de herramientas, historial, fechas, Kubernetes)
#
# Qué hace:     Define alias. No es ejecutable: se carga con `source`. Algunos alias usan
#               funciones de functions.zsh, así que carga ese fichero ANTES que este.
# Requisitos:   zsh. Según el alias: fzf, rg, gtime (brew install gnu-time), terraform,
#               terragrunt, kubectl, argocd, nvim, sops, VS Code (`code` en el PATH).
# Uso:          source /ruta/a/utils/shell/zsh/functions.zsh
#               source /ruta/a/utils/shell/zsh/aliases.zsh
# Variables:    UTILS_REPO  ruta donde clonaste este repo (para el alias `actualizar`).
#                           Defecto: $HOME/utils.
# Efectos:      Solo define alias en la shell actual.
# Salida:       Ninguna.
#
# No se incluyen los alias de navegación a carpetas concretas (cdev, pproyecto...): son
# personales. Crea los tuyos con el patrón:  alias pmiproyecto='cd ~/dev/projects/mi-proyecto'
# y compruébalos con `navcheck` / `projcheck`.

# ── General ─────────────────────────────────────────────────────────────────
alias cls="clear"
alias et="exit"
alias tf="terraform"
alias tg="terragrunt"
alias k="kubectl"
alias argo="argocd"
alias hist="history | fzf"               # buscar en el historial de forma interactiva
alias hg="history | rg"                  # hg <patrón>: filtrar historial
alias hgi="history | rg -i"              # igual, sin distinguir mayúsculas
alias clock='gtime -f "Total: %E"'       # clock <comando>: mide cuánto tarda (%E = tiempo real)
alias lislas="ls -laht . | head -n 10"   # 10 ficheros más recientes (-t ordena por fecha)
alias fecha="date +%Y-%m-%d"             # 2026-01-31
alias hora="date +%Y%m%d_%H%M%S"         # 20260131_142530, útil para nombres de fichero

# ── Navegación (funciones de functions.zsh) ─────────────────────────────────
alias fcd="power_cd_with_fzf"
alias cdd="power_cd ."
alias navlist="nav-aliases"
alias navcheck="nav-aliases-check"
alias projcheck="nav-projects-check"

# ── Configuración de zsh ────────────────────────────────────────────────────
alias aliases='nvim "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/10-aliases.zsh"'   # editar tus alias
alias zshreload="source ~/.zshrc"
alias zshcheck="zsh-config-check"

# ── macOS ───────────────────────────────────────────────────────────────────
alias actualizar='bash "${UTILS_REPO:-$HOME/utils}/macos/brew-update.sh"'

# ── Cloud / Kubernetes (funciones de functions.zsh) ─────────────────────────
alias awswho="aws-who"
alias awsp="aws-use"
alias awslogin="aws-login"
alias kctx="kubectl config current-context"
alias kctxs="kubectl config get-contexts"
# Atajos a entornos definidos en EKS_ENVS / AKS_ENVS (ver functions.zsh), por ejemplo:
# alias eksqa="eks-use qa"
# alias aksprojects="aks-use projects"

# ── Usar VS Code como editor en CLIs que abren un editor ────────────────────
# "code --wait" bloquea hasta que cierras la pestaña, que es lo que esperan estas CLIs.
alias sopsvscode='SOPS_EDITOR="code --wait" sops edit'
alias kvscode='KUBE_EDITOR="code --wait" kubectl edit'
alias ksecedit='KUBE_EDITOR="code --wait" kubectl modify-secret'   # requiere el plugin kubectl-modify-secret
