# macos/setup — runbook para replicar el Mac en otro Mac

Pasos ordenados para dejar un Mac nuevo como el de referencia. Aquí solo el **qué hacer**; el
**por qué** de cada paso está en [EXPLICACIONES.md](EXPLICACIONES.md) (empieza por sus
[conceptos base](EXPLICACIONES.md#conceptos-base) si no conoces Homebrew, casks o `defaults`).
Qué hay instalado en el Mac de referencia: [INVENTARIO.md](INVENTARIO.md).

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| [`Brewfile`](Brewfile) | Lista de taps, fórmulas, casks, extensiones de VS Code, `go` y `krew`, agrupada y comentada | Lo lee `brew bundle` (el fichero en sí no ejecuta nada) |
| [`bootstrap.sh`](bootstrap.sh) | Instalador idempotente: CLT → Homebrew → Brewfile → Oh My Zsh → nvm → npm → SDKMAN → [`~/.zshrc`] → [preferencias] | ESCRIBE: instala software; añade una línea a `~/.zprofile`; con opciones, `~/.zshrc` (backup) y preferencias |
| [`macos-defaults.sh`](macos-defaults.sh) | Aplica las preferencias de macOS observadas (Dock, Finder, trackpad, capturas, modo oscuro) | ESCRIBE: `~/Library/Preferences`; reinicia Dock/Finder/barra de menús |
| [`inventory.sh`](inventory.sh) | Saca un inventario del Mac a una carpeta para documentar o comparar dos Macs | SOLO LECTURA del sistema · ESCRIBE en la carpeta de salida |
| [`INVENTARIO.md`](INVENTARIO.md) | Snapshot del Mac de referencia (2026-10-05) y qué copiar / recrear / no copiar nunca | — |
| [`EXPLICACIONES.md`](EXPLICACIONES.md) | Explicación detallada de cada concepto y paso | — |

## Requisitos

- macOS 14 o superior (probado en el diseño con macOS 27, Apple Silicon). Intel también funciona
  (Homebrew va a `/usr/local`).
- Cuenta de administrador, conexión a internet y unos 30-40 GB libres para el Brewfile completo.

## Opciones y variables de `bootstrap.sh`

| Opción | Qué hace |
|---|---|
| `--dry-run` | Solo imprime los comandos (con `+` delante); no cambia nada |
| `--skip-clt` / `--skip-brew` / `--skip-bundle` / `--skip-omz` / `--skip-node` / `--skip-npm` / `--skip-sdkman` | Salta ese paso |
| `--link-zshrc` | Copia `shell/zsh/zshrc.example` a `~/.zshrc` (backup previo `~/.zshrc.bak.<fecha>`) |
| `--with-defaults` | Ejecuta `macos-defaults.sh` al final |
| `--brewfile RUTA` | Usa otro Brewfile |
| `-h`, `--help` | Muestra la ayuda |

| Variable | Obligatoria | Qué es | Valor por defecto (Mac de referencia) |
|---|---|---|---|
| `NODE_VERSIONS` | No | Versiones de Node a instalar con nvm (separadas por espacio) | `20 22 24` |
| `NODE_DEFAULT` | No | Versión por defecto de Node | `24` |
| `NPM_GLOBALS` | No | Paquetes npm globales | `@openai/codex mcp-remote yarn` |
| `JAVA_VERSIONS` | No | Identificadores de SDKMAN (salen de `sdk list java`) | `21.0.9-zulu 17.0.16-zulu 11.0.29-zulu 8.0.472-zulu 25.0.1-tem` |
| `JAVA_DEFAULT` | No | Java por defecto | `21.0.9-zulu` |
| `GROOVY_VERSIONS` | No | Versiones de Groovy (`sdk list groovy`) | `5.0.4 3.0.0` |
| `OMZ_PLUGINS` | No | Plugins externos de Oh My Zsh, uno por línea, `nombre\|url` | 4 plugins (ver script) |
| `SCREENSHOTS_DIR` | No | (macos-defaults.sh) carpeta de capturas | `$HOME/Pictures/Screenshots` |

Ejemplo: `NODE_VERSIONS="22 24" JAVA_VERSIONS="21.0.9-zulu" ./bootstrap.sh` (las variables delante
del comando solo valen para esa ejecución).

---

## Runbook

### Paso 0 — En el Mac VIEJO: inventario y exportaciones

```bash
cd <RUTA_DEL_REPO>/macos/setup
./inventory.sh ~/inventario-mac-viejo   # 1er argumento = carpeta de salida
```

1. Compara el Brewfile actual con el del repo y añade lo nuevo:
   `diff ~/inventario-mac-viejo/Brewfile Brewfile` (líneas `<` = solo en el Mac, `>` = solo en el repo).
2. Exporta los ajustes de apps que lo permiten (tabla del [paso 10](#paso-10)).
3. Revisa `~/inventario-mac-viejo/secrets-presence.txt`: cada `EXISTE` es una credencial que tendrás
   que regenerar o migrar en el [paso 8](#paso-8).

Comprobación: la carpeta tiene ~20 ficheros `.txt` y un `Brewfile`.

→ Por qué: [Paso 0](EXPLICACIONES.md#paso-0)

### Paso 1 — Xcode Command Line Tools

```bash
xcode-select -p || xcode-select --install
```

- `-p` imprime la ruta de las CLT si ya están (y el `||` = "si falla, ejecuta lo siguiente").
- `--install` abre la ventana de instalación. Acepta y espera a que termine.

Comprobación: `xcode-select -p` imprime una ruta (p. ej. `/Library/Developer/CommandLineTools`).

→ Por qué: [Paso 1](EXPLICACIONES.md#paso-1) · Concepto: [Xcode CLT](EXPLICACIONES.md#xcode-clt)

### Paso 2 — Clonar este repo

```bash
mkdir -p ~/dev/personal/repositories        # -p: crea las carpetas intermedias, sin error si existen
git clone https://github.com/<USUARIO>/<REPO>.git ~/dev/personal/repositories/utils
cd ~/dev/personal/repositories/utils/macos/setup
```

Comprobación: `ls` muestra `bootstrap.sh`, `Brewfile`…

→ Por qué: [Paso 2](EXPLICACIONES.md#paso-2)

### Paso 3 — Ensayo

```bash
./bootstrap.sh --dry-run --link-zshrc --with-defaults
```

Revisa la lista. Si sobra algo, comenta (`#`) esas líneas del `Brewfile` (los grupos `[OPCIONAL]`
son los candidatos) o cambia las variables.

→ Por qué: [Paso 3](EXPLICACIONES.md#paso-3) · Concepto: [idempotencia y `--dry-run`](EXPLICACIONES.md#idempotencia)

### Paso 4 — Instalación

```bash
./bootstrap.sh
```

- Pedirá tu contraseña (Homebrew y algunos casks). Tarda de 30 a 90 minutos.
- Si falla algo, corrige y **vuelve a lanzar el mismo comando**: lo ya hecho se salta.
- Si un cask falla porque la app ya existe en `/Applications`, borra la app manual y relanza.

Comprobación (en una terminal **nueva**, para que lea `~/.zprofile`):

```bash
brew bundle check --file=Brewfile   # "The Brewfile's dependencies are satisfied."
ls ~/.oh-my-zsh/custom/plugins      # los 4 plugins externos
ls ~/.nvm/versions/node             # v20.x, v22.x, v24.x
ls ~/.sdkman/candidates/java        # las versiones de JAVA_VERSIONS
```

→ Por qué: [Paso 4](EXPLICACIONES.md#paso-4) · Conceptos: [Homebrew](EXPLICACIONES.md#homebrew),
[Brewfile](EXPLICACIONES.md#brewfile), [nvm y SDKMAN](EXPLICACIONES.md#nvm-sdkman),
[Oh My Zsh](EXPLICACIONES.md#oh-my-zsh), [`curl | bash`](EXPLICACIONES.md#curl-bash)

### Paso 5 — Shell: `~/.zshrc` y `~/.zshrc.local`

```bash
./bootstrap.sh --skip-clt --skip-brew --skip-bundle --skip-omz --skip-node --skip-npm --skip-sdkman --link-zshrc
```

(Todos los `--skip-*` para que solo haga el paso del `~/.zshrc`.) Después crea `~/.zshrc.local` con
lo propio de esta máquina. Mínimo, nvm y SDKMAN:

```zsh
# ~/.zshrc.local — NO versionado
export NVM_DIR="$HOME/.nvm"                                   # dónde guarda nvm las versiones
[ -s "$(brew --prefix nvm)/nvm.sh" ] && source "$(brew --prefix nvm)/nvm.sh"   # carga nvm
export SDKMAN_DIR="$HOME/.sdkman"                             # dónde vive SDKMAN
[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ] && source "$SDKMAN_DIR/bin/sdkman-init.sh"  # carga sdk
```

(`[ -s fichero ]` = "existe y no está vacío"; `&&` = "solo si lo anterior fue bien".)

Comprobación: abre una terminal nueva → `nvm current` (v24.x), `java -version` (21), `echo $UTILS_REPO`
(la ruta del repo).

→ Por qué: [Paso 5](EXPLICACIONES.md#paso-5) · Concepto: [`~/.zprofile` frente a `~/.zshrc`](EXPLICACIONES.md#zprofile-zshrc)

### Paso 6 — Preferencias de macOS

```bash
./macos-defaults.sh --dry-run   # ver qué cambia
./macos-defaults.sh             # aplicar
```

Dock y Finder parpadean unos segundos. Cierra sesión y vuelve a entrar para el modo oscuro y el
scroll. Comprobación: `defaults read com.apple.dock autohide` → `1`.

→ Por qué: [Paso 6](EXPLICACIONES.md#paso-6) · Concepto: [`defaults` y plist](EXPLICACIONES.md#defaults)

### Paso 7 — Git

```bash
git config --global user.name "<NOMBRE_TRABAJO>"
git config --global user.email "<EMAIL_TRABAJO>"
git config --global includeIf."gitdir:~/dev/personal/repositories/".path "~/.gitconfig-personal"
git config --file ~/.gitconfig-personal user.name "<NOMBRE_PERSONAL>"
git config --file ~/.gitconfig-personal user.email "<EMAIL_PERSONAL>"
git lfs install                      # añade los filtros de Git LFS a ~/.gitconfig
```

- `--global` escribe en `~/.gitconfig`; `--file RUTA` escribe en ese fichero concreto.
- No copies `core.page=less` del Mac viejo: es una errata (ver explicación).

Comprobación: en un repo personal, `git config --show-origin user.email` debe salir de
`~/.gitconfig-personal`; en cualquier otro, de `~/.gitconfig`.

→ Por qué: [Paso 7](EXPLICACIONES.md#paso-7) · Concepto: [`includeIf`](EXPLICACIONES.md#git-includeif)

<a id="paso-8"></a>
### Paso 8 — Credenciales (manual, NUNCA al repo)

Regenera con login nuevo siempre que puedas:

```bash
ssh-keygen -t ed25519 -C "<ETIQUETA_DEL_MAC>"   # nueva clave SSH; sube la .pub a GitHub/GitLab
gh auth login                                   # GitHub CLI
glab auth login                                 # GitLab CLI
aws configure sso                               # o copia la config SIN claves y haz aws sso login
az login                                        # Azure
```

Lo que no se pueda regenerar, trasládalo por el gestor de contraseñas o AirDrop. Lista completa en
[INVENTARIO.md → Nunca al repo](INVENTARIO.md#nunca-copiar).

Comprobación: `ssh -T git@github.com` saluda con tu usuario; `gh auth status` dice "Logged in".

→ Por qué: [Paso 8](EXPLICACIONES.md#paso-8) · Concepto: [dotfiles](EXPLICACIONES.md#dotfiles)

### Paso 9 — Apps fuera de Homebrew

1. App Store: Keynote, Pages, Numbers, GarageBand, iMovie, Windows App (si la usas).
2. Descarga manual (o descomenta su cask en la sección 8c del Brewfile y relanza el paso 4).
3. Corporativas: pídelas a IT / Portal de empresa.

Lista y origen de cada una: [INVENTARIO.md → Apps fuera de Homebrew](INVENTARIO.md#apps-fuera).

→ Por qué: [Paso 9](EXPLICACIONES.md#paso-9)

<a id="paso-10"></a>
### Paso 10 — Ajustes de apps y editores

| App / herramienta | Cómo llevar la configuración |
|---|---|
| Neovim | `ln -s <RUTA_DEL_REPO>/editors/nvim ~/.config/nvim` (ver [editors/nvim](../../editors/nvim/README.md)) |
| VS Code | Activar *Settings Sync* (icono de cuenta → Backup and Sync Settings) |
| iTerm2 | Settings → General → Settings → "Load settings from a custom folder" (exportar en el viejo, cargar en el nuevo) |
| Raycast | Settings → Advanced → Export (fichero `.rayconfig`, cifrado con contraseña) |
| Rectangle | Settings → Export / Import (JSON) |
| btop, htop, neofetch | Copiar `~/.config/btop/btop.conf`, `~/.config/htop/htoprc`, `~/.config/neofetch/config.conf` |
| Hammerspoon | Copiar `~/.hammerspoon/init.lua` |
| JetBrains (IntelliJ) | Settings Sync de JetBrains o *File → Manage IDE Settings → Export* |

→ Por qué: [Paso 10](EXPLICACIONES.md#paso-10)

### Paso 11 — Verificación final

```bash
brew bundle check --file=Brewfile
brew doctor                                      # avisos de Homebrew
./inventory.sh ~/inventario-mac-nuevo
diff -ru ~/inventario-mac-viejo ~/inventario-mac-nuevo | less   # -r recursivo, -u formato unificado
```

Diferencias esperadas: versiones algo más nuevas, apps corporativas, Node 10/14 (omitidas a propósito).

→ Por qué: [Paso 11](EXPLICACIONES.md#paso-11)
