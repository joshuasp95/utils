# shell

Configuración reutilizable de zsh: funciones, alias, historial, completions, atajos de teclado y
un `~/.zshrc` de ejemplo que lo carga todo. Lo que sea de un cliente o una máquina concreta va en
`~/.zshrc.local`, que no se versiona.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `zsh/zshrc.example` | Esqueleto de `~/.zshrc`: carga todo lo de abajo en el orden correcto | — |
| `zsh/pre/plugins-theme.zsh` | Tema `robbyrussell` y plugins de Oh My Zsh (git, kubectl, autosuggestions, syntax highlighting) | Solo variables |
| `zsh/pre/performance-completions.zsh` | Arranque más rápido (sin `compaudit`, sin rebind continuo de autosuggestions), `fpath` de Homebrew/Docker, PATH sin duplicados | Solo variables |
| `zsh/history.zsh` | Historial grande (200k líneas), compartido entre terminales, con fecha, y backups automáticos cada 6 h o 500 líneas | Escribe el historial y backups en `~/.zsh_history_backups` |
| `zsh/functions.zsh` | Funciones de navegación con fzf, chequeos de alias, perfiles AWS, cambio de clúster EKS/AKS, utilidades (Edge, BOM) y carga diferida de NVM/SDKMAN | Cambian el estado de la shell (cd, variables, contexto kubectl). Nada remoto |
| `zsh/aliases.zsh` | Alias genéricos (atajos de herramientas, historial, fechas, kubectl, editores) | Solo define alias |
| `zsh/completions.zsh` | Activa completados estilo bash (`bashcompinit`) y el de Terraform | Solo configura la shell |
| `zsh/bindkeys.zsh` | Option/Alt + ←/→ para moverse por palabras | Solo configura la shell |

Ninguno es un script ejecutable: se cargan con `source`.

### Orden de carga (por qué importa)

1. **`pre/*`, antes de Oh My Zsh.** Oh My Zsh lee `$ZSH_THEME`, `$plugins` y `$fpath` en el momento
   en que se carga. Si se definen después, no tienen efecto.
2. **Oh My Zsh** (`source $ZSH/oh-my-zsh.sh`).
3. **El resto.** `functions.zsh` va antes que `aliases.zsh` porque algunos alias llaman a funciones.
4. **`~/.zshrc.local`, al final**, para poder sobrescribir cualquier cosa.

### Historial: claves de `history.zsh`

- `share_history`: un comando escrito en una terminal aparece con ↑ en las demás.
- `hist_ignore_space`: si empiezas un comando con un espacio, no se guarda. Úsalo cuando el comando
  lleve un token.
- Backups: copias `.zsh_history.persistent.<fecha>` en `ZSH_HISTORY_BACKUP_DIR`. No se rotan solas.
  Para recuperar una: `cp <backup> ~/.zsh_history_persistent` y abre una terminal nueva.
- Variables configurables (defínelas antes de cargar el fichero): `ZSH_PERSISTENT_HISTORY_FILE`,
  `ZSH_HISTORY_BACKUP_DIR`, `ZSH_HISTORY_BACKUP_CHECK_INTERVAL_SECONDS`,
  `ZSH_HISTORY_BACKUP_INTERVAL_SECONDS`, `ZSH_HISTORY_BACKUP_MIN_LINE_DELTA`. Tienes el detalle en la
  cabecera del fichero.

## Requisitos

- zsh (Oh My Zsh opcional; `zsh-config-check` usa `$ZSH_CUSTOM` si existe).
- Según la función/alias: `fzf`, `fd`, `tree`, `rg`, `curl`, `aws` CLI v2, `kubectl`, `gtime`
  (`brew install gnu-time`), `nvim`, `sops`, VS Code (`code`), Microsoft Edge.

## Instalación

Opción A: usar el esqueleto completo.

```bash
cp ~/.zshrc ~/.zshrc.bak                       # backup del tuyo
cp shell/zsh/zshrc.example ~/.zshrc            # y ajusta UTILS_REPO dentro
exec zsh                                       # reinicia la shell actual con la nueva config
```

Opción B: añadir solo lo que quieras a tu `~/.zshrc` actual.

```bash
# en ~/.zshrc (functions antes que aliases, porque algunos alias llaman a funciones)
source "$HOME/utils/shell/zsh/history.zsh"
source "$HOME/utils/shell/zsh/functions.zsh"
source "$HOME/utils/shell/zsh/aliases.zsh"
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local   # tus entornos EKS/AKS y alias de rutas, sin versionar
```

`[[ -f fichero ]] && source fichero`: solo lo carga si existe.

## Variables

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `UTILS_REPO` | No (`$HOME/utils`) | Dónde clonaste este repo (alias `actualizar`) | Tu ruta de clonado |
| `NAV_PROJECTS_ROOT` | No (`$HOME/dev/projects`) | Raíz de proyectos que revisa `nav-projects-check` | Tu organización de carpetas |
| `AWS_DEFAULT_REGION_FALLBACK` | No (`eu-central-1`) | Región que usa `aws-use` si no le pasas una | Región donde trabajas |
| `EKS_ENVS` | Para `eks-use` | Tabla de entornos EKS (formato abajo) | `aws eks list-clusters --profile <PERFIL>` y `aws configure list-profiles` |
| `AKS_ENVS` | Para `aks-use` | Tabla de entornos AKS (formato abajo) | `kubectl config get-contexts` |
| `HOMEBREW_PREFIX` | No (`/opt/homebrew`) | Prefijo de Homebrew para encontrar `nvm` | `brew --prefix` |

Formato de las tablas (defínelas en `~/.zshrc.local`, nunca en el repo):

```zsh
# [nombre]="aws_profile|region|cluster|alias_contexto|kubeconfig|context|namespace"
typeset -gA EKS_ENVS=(
  [qa]="<AWS_PROFILE>|eu-central-1|<EKS_CLUSTER>|myapp-qa|$HOME/.kube/config-qa||"
  [kafka-dev]="|eu-west-1|||$HOME/.kube/config|<KUBE_CONTEXT>|kafka"
)
# [nombre]="kubeconfig|context|namespace"
typeset -gA AKS_ENVS=( [projects]="$HOME/.kube/config|<KUBE_CONTEXT>|<NAMESPACE>" )
```

`typeset -gA`: declara un array asociativo (`-A`, clave → valor) global (`-g`). Campos vacíos se
dejan como `||`.

## Funciones (`functions.zsh`)

| Función | Qué hace |
|---|---|
| `power_cd_with_fzf [dir]` (alias `fcd`) | Abre `fzf` con todos los ficheros bajo `dir`; al elegir uno hace `cd` a él (si es carpeta) o a su carpeta (si es fichero) |
| `power_cd [dir]` (alias `cdd`) | Lista solo carpetas con `fd -t d`, las muestra en `fzf` con vista previa `tree -C` y hace `cd` a la elegida |
| `nav-aliases` (alias `navlist`) | Lista tus alias del tipo `alias x='cd /ruta/absoluta'` |
| `nav-aliases-check` (alias `navcheck`) | Avisa de los alias de navegación cuya carpeta ya no existe. Código 1 si hay alguno |
| `nav-projects-check` (alias `projcheck`) | Avisa de las carpetas de primer nivel de `NAV_PROJECTS_ROOT` que no tienen ningún alias de navegación |
| `zsh-config-check` (alias `zshcheck`) | `zsh -n` (comprobar sintaxis sin ejecutar) sobre `~/.zshrc` y `$ZSH_CUSTOM/*.zsh`, más los dos checks anteriores |
| `test_nodes` | Pide una URL (sin `https://`) y hace 10 peticiones `curl -sI` (solo cabeceras) mostrando la cookie `JSESSIONID`: si el sufijo cambia, el balanceador reparte entre nodos |
| `aws-use <perfil> [región]` (alias `awsp`) | Exporta `AWS_PROFILE`, `AWS_REGION` y `AWS_DEFAULT_REGION` para esta terminal |
| `aws-login [perfil]` (alias `awslogin`) | `aws sso login --profile <perfil>`: abre el navegador para iniciar sesión SSO |
| `aws-who` (alias `awswho`) | `aws sts get-caller-identity`: muestra cuenta y rol con los que estás autenticado |
| `eks-use <env>` | Según `EKS_ENVS[env]`: exporta perfil/región/`KUBECONFIG`, ejecuta `aws eks update-kubeconfig` (añade el clúster al kubeconfig con el nombre `--alias`), cambia de contexto y opcionalmente de namespace; termina con `kenv` |
| `aks-use [env]` | Según `AKS_ENVS[env]`: fija `KUBECONFIG`, **borra** las variables de AWS (para no mezclar), cambia de contexto y namespace; termina con `kenv` |
| `kenv` | Muestra `KUBECONFIG`, contexto y namespace activos, y el perfil AWS si lo hay |
| `kcontexts` | `kubectl config get-contexts` (el activo lleva `*`) |
| `edge [ficheros]` | Abre Microsoft Edge, o los ficheros indicados en Edge (`open -a`, solo macOS) |
| `bom fichero.txt` | Crea `fichero-bom.txt` con BOM UTF-8 al inicio (los bytes `EF BB BF`, que marcan el fichero como UTF-8 para algunos lectores) |
| `nvm`, `node`, `npm`, `npx`, `corepack` | Carga diferida de NVM: la primera llamada carga `nvm.sh` y luego ejecuta el comando real. Acelera la apertura de terminales |
| `sdk`, `java`, `javac`, `mvn`, `gradle`, `kotlin` | Igual, para SDKMAN (`$SDKMAN_DIR/bin/sdkman-init.sh`) |

Nota: varias funciones usan `emulate -L zsh` (activa las opciones por defecto de zsh solo dentro de
la función, para que tu configuración no cambie su comportamiento).

## Alias (`aliases.zsh`)

Ver los comentarios del fichero. Destacan: `hist` (historial con `fzf`), `hg <patrón>` (historial
filtrado con `rg`), `clock <comando>` (mide el tiempo), `fecha`/`hora` (fecha para nombres de fichero),
`kctx`/`kctxs` (contexto kubectl), `sopsvscode`/`kvscode` (editar con VS Code en `sops` y `kubectl edit`).

No se incluyen alias de navegación a rutas concretas: son personales. Crea los tuyos en `~/.zshrc.local`:

```zsh
alias pmiproyecto='cd ~/dev/projects/mi-proyecto'
```

## Ejemplos

```bash
fcd ~/dev            # elegir un fichero o carpeta bajo ~/dev y entrar
awsp mi-perfil eu-west-1 && awslogin && awswho
eks-use qa           # tras definir EKS_ENVS[qa]
navcheck             # ¿algún alias apunta a una carpeta borrada?
```
