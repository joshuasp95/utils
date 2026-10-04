# Inventario del Mac de referencia — snapshot 2026-10-05

Foto de lo instalado y configurado en el Mac de referencia, para saber qué replicar y cómo.
Se generó con comandos de solo lectura (los mismos de [`inventory.sh`](inventory.sh)).
Pasos para replicarlo: [README.md](README.md) · Conceptos: [EXPLICACIONES.md](EXPLICACIONES.md).

> Snapshot: puede quedarse desactualizado. Regenera con `./inventory.sh <carpeta>` y compara.

## Índice

- [Sistema](#sistema)
- [Qué cubre el Brewfile](#brewfile)
- [Apps instaladas fuera de Homebrew](#apps-fuera)
- [Node.js (nvm) y paquetes npm globales](#node)
- [Java y Groovy (SDKMAN)](#java)
- [Shell: Oh My Zsh, plugins y fuentes](#shell)
- [VS Code](#vscode)
- [Herramientas con configuración en `~/.config`](#config)
- [Dotfiles: copiar, recrear o nunca copiar](#dotfiles)
- [Preferencias de macOS](#preferencias)
- [Git](#git)
- [Limpieza pendiente en el Mac de referencia](#limpieza)

<a id="sistema"></a>
## Sistema

| Dato | Valor |
|---|---|
| macOS | 27.0.1 (build 26A434) |
| Arquitectura | `arm64` (Apple Silicon) → Homebrew en `/opt/homebrew` |
| Homebrew | 7.0.7 |
| Shell | zsh + Oh My Zsh (tema `robbyrussell`) |

<a id="brewfile"></a>
## Qué cubre el Brewfile

[`Brewfile`](Brewfile) = 11 taps, 76 fórmulas, 24 casks (+ la fuente Hack, añadida), 58 extensiones
de VS Code, 1 paquete `go` (`gopls`) y 1 plugin `krew` (`modify-secret`), en grupos:

| Grupo | Ejemplos | ¿Opcional? |
|---|---|---|
| 1. CLI básico | git, gh, glab, jq, yq, ripgrep, fd, fzf, bat, eza, neovim, shellcheck | No |
| 2. Cloud / Kubernetes / IaC | awscli, azure-cli, kubectl, helm, k9s, kind, terraform, terragrunt, sops | Según tu trabajo |
| 3. Datos | kafka, mongosh, mongodb-atlas-cli, servidor MongoDB 8.0, databricks | Sí |
| 4. Lenguajes y build | nvm, node, openjdk@21, maven, go, rust | No |
| 5. Documentos y multimedia | poppler, tesseract, ffmpeg | Sí |
| 6. IA | opencode, llmfit, claude-code, copilot-cli, codexbar | Sí |
| 7. Diversión | fastfetch, neofetch, cmatrix, lolcat | Sí |
| 8. Apps (casks) | iTerm2, Warp, VS Code, Docker Desktop, Raycast, Rectangle, Slack, Firefox… | Parcialmente |
| 9. Extensiones VS Code | 58 | Sí (alternativa: Settings Sync) |

Paquetes npm globales (`@openai/codex`, `mcp-remote`, `yarn`): los instala `bootstrap.sh` tras nvm.

<a id="apps-fuera"></a>
## Apps instaladas fuera de Homebrew

Apps de `/Applications` y `~/Applications` que **no** vienen de un cask del Brewfile.

### Apple / App Store

| App | Cómo reinstalar |
|---|---|
| Safari, Utilidades | Vienen con macOS |
| Keynote, Pages, Numbers, GarageBand, iMovie | App Store (gratis, con tu Apple ID) |
| Windows App (escritorio remoto de Microsoft) | App Store. Suele usarse para escritorios virtuales de empresa |

### Descarga manual

Entre paréntesis, el cask equivalente (comentado en la sección 8c del Brewfile; compruébalo con
`brew info --cask <nombre>`).

| App | Para qué | Fuente oficial |
|---|---|---|
| Google Chrome (`google-chrome`) | Navegador | google.com/chrome |
| Microsoft Edge (`microsoft-edge`) | Navegador | microsoft.com/edge |
| Claude (`claude`) | App de escritorio de Claude | claude.ai/download |
| ChatGPT / ChatGPT Classic (`chatgpt`) | App de escritorio de ChatGPT | openai.com/chatgpt/download |
| Obsidian (`obsidian`) | Notas en Markdown | obsidian.md |
| Fork (`fork`) | Cliente gráfico de git | git-fork.com |
| GitHub Desktop (`github`) | Cliente gráfico de GitHub | desktop.github.com |
| Lens (`lens`) | Interfaz gráfica de Kubernetes | k8slens.dev |
| MongoDB Compass (`mongodb-compass`) | Interfaz gráfica de MongoDB | mongodb.com/products/compass |
| VisualVM (`visualvm`) | Monitorizar/perfilar aplicaciones Java | visualvm.github.io |
| LM Studio (`lm-studio`) | Ejecutar LLMs en local | lmstudio.ai |
| Sublime Text (`sublime-text`, en `~/Applications`) | Editor de texto | sublimetext.com |
| Keeper Password Manager (`keeper-password-manager`) | Gestor de contraseñas (puede ser licencia de empresa) | keepersecurity.com |
| Discord (`discord`), Spotify (`spotify`) | Personal | discord.com, spotify.com |
| Audacity 4 (`audacity`) + Muse Hub | Edición de audio (Muse Hub es su instalador/gestor) | audacityteam.org |
| IntelliJ IDEA | IDE Java | Se instala desde **JetBrains Toolbox** (cask del Brewfile) |
| OpenWhispr | Dictado por voz | Web/GitHub del proyecto |
| Anarlog | Origen no identificado en el inventario | Revisar si sigue haciendo falta |

Se recrean solas (no instalar): `Chrome Apps.localized` (apps web creadas desde Chrome) y
`Claude Code URL Handler.app` (la crea Claude Code).

### Corporativas — dependen de la empresa

No instalar por cuenta propia: las proporciona IT, normalmente vía MDM / portal de empresa, y
cambian según el empleador.

| Tipo | Ejemplos en el Mac de referencia |
|---|---|
| Portal de gestión del dispositivo (MDM) | Company Portal |
| Seguridad del equipo (antivirus/EDR) | Microsoft Defender |
| VPN / acceso de red de confianza cero | Cisco (Secure Client), Zscaler |
| Escritorio virtual (VDI) | Citrix Workspace, Omnissa Horizon Client (+ "Next") |
| Ofimática con licencia | Microsoft Word, Excel, PowerPoint, Outlook, OneNote, Teams, OneDrive |

<a id="node"></a>
## Node.js (nvm) y paquetes npm globales

| Versiones instaladas | En `bootstrap.sh` |
|---|---|
| v24.18.0, v24.14.0 | `24` (por defecto) |
| v22.22.0 | `22` |
| v20.20.2 | `20` |
| v14.21.2, v10.24.1 | Omitidas (fuera de soporte). Añádelas a `NODE_VERSIONS` si un proyecto lo exige |

Globales: `@openai/codex`, `mcp-remote`, `yarn` (y `npm`, que viene con Node).

<a id="java"></a>
## Java y Groovy (SDKMAN)

| SDK | Versiones | En `bootstrap.sh` |
|---|---|---|
| java | 21.0.9-zulu, 17.0.16-zulu, 11.0.29-zulu, 8.0.472-zulu, 25.0.1-tem | Todas (`JAVA_DEFAULT=21.0.9-zulu`) |
| java | Una versión de Java 8 añadida **a mano** a SDKMAN (`sdk install java <nombre> <ruta-local>`) | No: no se descarga de SDKMAN. Si la necesitas, copia su JDK y vuelve a registrarla así |
| groovy | 5.0.4, 3.0.0 | Ambas |

Además Homebrew instala `openjdk@21` (dependencia de maven/kafka).

<a id="shell"></a>
## Shell: Oh My Zsh, plugins y fuentes

| Plugin | Origen | Estado |
|---|---|---|
| git, kubectl | Incluidos en Oh My Zsh | Activos |
| zsh-autosuggestions | Externo (git clone) | Activo |
| fast-syntax-highlighting | Externo | Activo |
| zsh-syntax-highlighting | Externo | Instalado, **no activado** (duplica a fast-syntax-highlighting) |
| zsh-autocomplete | Externo | Instalado, **no activado** |
| example | Plantilla de Oh My Zsh | Ignorar |

Configuración versionada en [`shell/zsh/`](../../shell/zsh/).

**Fuente:** Hack (Regular, Bold, Italic, BoldItalic) instalada a mano en `~/Library/Fonts`. En el
Brewfile se añadió `cask "font-hack"`. Para los iconos de Neovim hace falta una *Nerd Font*
(`font-hack-nerd-font`, comentada en el Brewfile).

<a id="vscode"></a>
## VS Code

58 extensiones, listadas y agrupadas en la sección 9 del [Brewfile](Brewfile). Ajustes
(`settings.json`, atajos, snippets): mejor con *Settings Sync* que copiando ficheros.

<a id="config"></a>
## Herramientas con configuración en `~/.config`

| Carpeta | ¿Copiar? | Nota |
|---|---|---|
| `nvim/` | Sí → versionada en [`editors/nvim/`](../../editors/nvim/README.md) | Enlazar con `ln -s` |
| `btop/` (`btop.conf`, `themes/`) | Sí | Texto plano |
| `htop/htoprc` | Sí | Texto plano |
| `neofetch/config.conf` | Sí | Texto plano |
| `opencode/opencode.json` | Revisar antes | Puede contener claves de API; `node_modules/` se regenera |
| `gh/config.yml` | Opcional | Alias y preferencias de `gh` |
| `gh/hosts.yml` | **No** | Contiene el token de GitHub → `gh auth login` |
| `argocd/config` | **No** | Contiene tokens de sesión → `argocd login` |
| `github-copilot/`, `configstore/` | **No** | Tokens/estado de sesión |
| `raycast/`, `iterm2/`, `codexbar/`, `cagent/`, `chatter/`, `jgit/` | No a mano | Estado interno; usar el export de cada app |

Fuera de `~/.config`: `~/.hammerspoon/init.lua` (copiar; script de automatización del escritorio).

<a id="dotfiles"></a>
## Dotfiles: copiar, recrear o nunca copiar

### Copiar (genéricos)

| Fichero | Cómo |
|---|---|
| `~/.zshrc` | Desde el repo (`bootstrap.sh --link-zshrc`); lo propio de la máquina en `~/.zshrc.local` |
| `~/.zprofile` | Lo recrea `bootstrap.sh` (línea de `brew shellenv`) |
| `~/.gitconfig`, `~/.gitconfig-personal` | **Recrear** con `git config` (runbook paso 7), no copiar: llevan tu identidad |
| `~/.config/nvim`, btop, htop, neofetch | Ver tabla anterior |
| `~/.hammerspoon/init.lua` | Copiar |
| `~/.yarnrc` | Copiar si tiene ajustes (revisar que no haya tokens) |

### Recrear (estado regenerable: no copiar)

`~/.oh-my-zsh`, `~/.nvm`, `~/.sdkman`, `~/.krew`, `~/.npm`, `~/.yarn`, `~/.bun`, `~/.cargo`, `~/go`,
`~/.cache`, `~/.gradle`, `~/.m2/repository`, `~/.terraform.d/plugin-cache`, `~/.minikube`,
`~/.localstack`, `~/.lmstudio`, `~/.sonarlint`, `~/.vscode` (extensiones: Brewfile o Settings Sync),
`~/.zcompdump*`, `~/.zsh_sessions`, `~/.v8flags.*`, `~/.lesshst`, `~/.viminfo`, `~/.wget-hsts`.

<a id="nunca-copiar"></a>
### Nunca al repo (credenciales)

Existen en el Mac de referencia. **Ninguno** debe acabar en este repo ni en un medio sin cifrar.

| Ruta | Qué contiene | Cómo migrar |
|---|---|---|
| `~/.ssh/` | Claves SSH privadas | Mejor generar una nueva (`ssh-keygen`) y registrarla; si no, gestor de contraseñas/AirDrop + `chmod 600` |
| `~/.gnupg/` | Claves GPG | `gpg --export-secret-keys` → canal seguro → `gpg --import` |
| `~/.aws/` | Perfiles y claves de AWS | Copiar solo `config` (perfiles SSO, sin claves) y `aws sso login` |
| `~/.azure/` | Sesión de Azure | `az login` |
| `~/.kube/` | Kubeconfigs con tokens/certificados | Regenerar: `aws eks update-kubeconfig`, `az aks get-credentials`, `oc login` |
| `~/.docker/config.json` | Logins a registros de contenedores | `docker login` |
| `~/.databrickscfg` (+ `.bak`) | Tokens de Databricks | `databricks auth login` |
| `~/.keeper/` | Sesión de Keeper Commander | Volver a iniciar sesión |
| `~/.secrets/` | Secretos varios | Gestor de contraseñas |
| `~/.confluent/` | Credenciales de Confluent | `confluent login` |
| `~/.mongodb/` | Config de Atlas CLI (claves API) | `atlas auth login` |
| `~/.config/gh/hosts.yml`, `~/.config/argocd/config` | Tokens | `gh auth login`, `argocd login` |
| `~/.mcp-auth/`, `~/.claude.json`, `~/.claude/`, `~/.codex/`, `~/.copilot/` | Sesiones de herramientas de IA | Volver a iniciar sesión (reutiliza ajustes no secretos a mano si quieres) |
| `~/.m2/settings.xml` (si existe) | Contraseñas de repositorios Maven | Recrear; contraseñas en el gestor |
| `~/.terraform.d/credentials.tfrc.json` (si existe) | Token de Terraform Cloud | `terraform login` |
| `~/.vpn`, `~/.cisco`, `~/.omnissa` | Perfiles de VPN/VDI corporativos | Los da IT de nuevo |
| `~/.zsh_history`, `~/.mysql_history` | Historial (puede tener tokens pegados) | No migrar, o revisar antes |

<a id="preferencias"></a>
## Preferencias de macOS

Observadas con `defaults read` (aplicables con [`macos-defaults.sh`](macos-defaults.sh)):

| Dominio | Clave | Valor |
|---|---|---|
| `com.apple.dock` | `autohide` | `1` (Dock oculto) |
| `com.apple.finder` | `FXPreferredViewStyle` | `clmv` (columnas) |
| `NSGlobalDomain` | `AppleShowAllExtensions` | `1` |
| `NSGlobalDomain` | `AppleInterfaceStyle` | `Dark` |
| `NSGlobalDomain` | `com.apple.swipescrolldirection` | `0` (scroll natural desactivado) |
| `com.apple.screencapture` | `location` | `~/Pictures/Screenshots` (guardado con `~` literal) |
| `com.apple.AppleMultitouchTrackpad` y `…BluetoothMultitouch.trackpad` | `Clicking` | `0` (sin tocar para clic) |

El resto (tamaño del Dock, repetición de teclas…) está en valores de fábrica.

<a id="git"></a>
## Git

Claves en `~/.gitconfig` (solo nombres, sin valores): `user.name`, `user.email`, `filter.lfs.*`
(de `git lfs install`), `includeIf "gitdir:~/dev/personal/repositories/".path` → `~/.gitconfig-personal`
(identidad distinta para repos personales) y `core.page=less`.

> **Errata**: `core.page` no existe en git (la clave es `core.pager`), así que no hace nada.
> `less` ya es el paginador por defecto: bórrala con `git config --global --unset core.page`.

<a id="limpieza"></a>
## Limpieza pendiente en el Mac de referencia

No se ha borrado nada; son sugerencias (revisa antes de borrar).

| Qué | Cuánto | Nota |
|---|---|---|
| `~/.claude.json.tmp.*` | 34 ficheros | Restos de escrituras interrumpidas de Claude Code. Pueden contener tokens: borrar (`rm ~/.claude.json.tmp.*`) |
| `~/.zcompdump-*` | 13 ficheros | Cachés de autocompletado de zsh de sesiones antiguas; se regeneran |
| `~/.v8flags.*` | 3 ficheros | Cachés de Node antiguos |
| `~/.gradle2` | ~3,7 GB | Copia antigua de la caché de Gradle (la activa es `~/.gradle`) |
| `~/.databrickscfg.bak` | 1 fichero | Copia de credenciales: borrar si ya no hace falta |
| Node v10 / v14 | — | `nvm uninstall 10` / `nvm uninstall 14` si ningún proyecto las usa |
| `~/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting`, `zsh-autocomplete` | — | Instalados sin usar |
