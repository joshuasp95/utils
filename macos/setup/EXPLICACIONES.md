# Explicaciones: replicar el Mac en otro Mac

Documento de **por qué** y **cómo funciona** cada paso del [runbook (README.md)](README.md).
El runbook dice *qué* ejecutar; aquí está el razonamiento, el mecanismo y qué pasa si te saltas algo.

## Índice

- [Conceptos base](#conceptos-base)
  - [Terminal, shell, zsh y PATH](#shell-path)
  - [Xcode Command Line Tools (CLT)](#xcode-clt)
  - [Homebrew](#homebrew)
  - [Fórmula, cask y tap](#formula-cask-tap)
  - [Brewfile y `brew bundle`](#brewfile)
  - [`defaults` y los ficheros plist](#defaults)
  - [nvm y SDKMAN: gestores de versiones](#nvm-sdkman)
  - [Oh My Zsh y sus plugins](#oh-my-zsh)
  - [`~/.zprofile` frente a `~/.zshrc`](#zprofile-zshrc)
  - [Dotfiles](#dotfiles)
  - [`includeIf` en git: dos identidades](#git-includeif)
  - [Idempotencia y `--dry-run`](#idempotencia)
  - [`curl … | bash`: instaladores remotos](#curl-bash)
- [Explicación de cada paso del runbook](#pasos)
  - [Paso 0 — Inventario del Mac viejo](#paso-0)
  - [Paso 1 — Xcode CLT](#paso-1)
  - [Paso 2 — Clonar este repo](#paso-2)
  - [Paso 3 — `bootstrap.sh --dry-run`](#paso-3)
  - [Paso 4 — `bootstrap.sh`](#paso-4)
  - [Paso 5 — `~/.zshrc` y `~/.zshrc.local`](#paso-5)
  - [Paso 6 — Preferencias de macOS](#paso-6)
  - [Paso 7 — Git: identidad y `includeIf`](#paso-7)
  - [Paso 8 — Credenciales](#paso-8)
  - [Paso 9 — Apps fuera de Homebrew](#paso-9)
  - [Paso 10 — Ajustes de apps y editores](#paso-10)
  - [Paso 11 — Verificación final](#paso-11)

---

<a id="conceptos-base"></a>
## Conceptos base

<a id="shell-path"></a>
### Terminal, shell, zsh y PATH

- **Terminal** (Terminal.app, iTerm2, Warp): la ventana donde escribes.
- **Shell**: el programa que interpreta lo que escribes dentro de esa ventana. En macOS la shell por
  defecto es **zsh**. Los scripts de esta carpeta son de **bash** (otra shell, compatible en lo
  básico); por eso empiezan con `#!/usr/bin/env bash` (el *shebang*: le dice al sistema con qué
  programa ejecutar el fichero).
- **`PATH`**: variable con la lista de carpetas donde la shell busca los comandos. Si escribes `brew`
  y `/opt/homebrew/bin` no está en el `PATH`, verás `command not found` aunque esté instalado.
- **`$HOME`** o **`~`**: tu carpeta de usuario (en macOS, la que lleva tu nombre de usuario dentro de la carpeta Usuarios).

<a id="xcode-clt"></a>
### Xcode Command Line Tools (CLT)

Paquete de Apple con el compilador (`clang`), `make`, `git` y otras utilidades básicas de
desarrollo, **sin** la app Xcode completa (que ocupa >10 GB). Homebrew las necesita para compilar
y para usar `git`.

- `xcode-select -p` → imprime dónde están instaladas; si falla, no lo están.
- `xcode-select --install` → abre una ventana del sistema que las descarga. Es **asíncrono**: el
  comando termina enseguida pero la instalación sigue en segundo plano; por eso `bootstrap.sh` se
  detiene y te pide relanzarlo cuando acabe.
- En un Mac recién estrenado, escribir `git` en la terminal también lanza esa ventana.

<a id="homebrew"></a>
### Homebrew

Gestor de paquetes para macOS: instala, actualiza y desinstala software desde la terminal
(`brew install jq`) en vez de descargar instaladores a mano.

- Se instala en `/opt/homebrew` en Macs con Apple Silicon (chips M1, M2…; arquitectura `arm64`) y en
  `/usr/local` en Macs Intel (`x86_64`). `uname -m` te dice cuál tienes.
- Se instala con el script oficial de <https://brew.sh> (ver [`curl … | bash`](#curl-bash)).
  Pide tu contraseña de administrador porque crea esas carpetas.
- `brew shellenv` imprime las líneas `export PATH=…`, `HOMEBREW_PREFIX=…` necesarias para que la
  shell encuentre `brew` y lo que instala. Se ejecuta así: `eval "$(/opt/homebrew/bin/brew shellenv)"`
  (`$(…)` ejecuta el comando y sustituye su salida; `eval` ejecuta ese texto como código).
- Para actualizar todo lo instalado ya existe [`../brew-update.sh`](../brew-update.sh).

<a id="formula-cask-tap"></a>
### Fórmula, cask y tap

| Concepto | Qué es | Ejemplo | Se instala con |
|---|---|---|---|
| **Fórmula** (formula) | Programa de línea de comandos o librería. Homebrew lo descarga ya compilado (*bottle*) o lo compila | `jq`, `git`, `awscli` | `brew install jq` |
| **Cask** | Aplicación con interfaz gráfica (`.app`), fuente tipográfica o binario precompilado. Homebrew descarga el instalador oficial y lo coloca en `/Applications` | `iterm2`, `visual-studio-code`, `font-hack` | `brew install --cask iterm2` |
| **Tap** | Repositorio git **extra** con fórmulas/casks que no están en el catálogo oficial (normalmente mantenido por el fabricante) | `hashicorp/tap` (Terraform oficial) | `brew tap hashicorp/tap` |

- Una fórmula de un tap se nombra `usuario/tap/fórmula`, p. ej. `hashicorp/tap/terraform`.
- `brew leaves` lista las fórmulas que instalaste **tú** y de las que no depende ninguna otra (sin
  las dependencias arrastradas). Es la lista "limpia" de lo que usas.
- **Ejemplo análogo**: es como `apt` (Ubuntu) o `winget`/`choco` (Windows); un tap equivale a añadir
  un repositorio PPA en Ubuntu.

<a id="brewfile"></a>
### Brewfile y `brew bundle`

Un **Brewfile** es un fichero de texto (sintaxis Ruby simple) que declara todo lo que quieres
instalado. `brew bundle` lo lee y deja la máquina en ese estado.

| Línea | Significado |
|---|---|
| `tap "hashicorp/tap"` | añadir ese repositorio extra |
| `brew "jq"` | instalar la fórmula `jq` |
| `cask "iterm2"` | instalar la app iTerm2 |
| `vscode "redhat.vscode-yaml"` | instalar esa extensión de VS Code (usa el comando `code`) |
| `go "golang.org/x/tools/gopls"` | `go install` de ese paquete |
| `krew "modify-secret"` | instalar ese plugin de kubectl con krew |
| `npm "yarn"` | `npm install -g yarn` |
| `trusted: true` | (Homebrew 7) el tap es de confianza; `brew bundle` no se para a preguntar |
| `# …` | comentario; ignorado |

Comandos:

- `brew bundle --file=RUTA` → instala lo que falte. Lo ya instalado lo salta ([idempotente](#idempotencia)).
  Por defecto también **actualiza** lo que esté desactualizado.
- `brew bundle check --file=RUTA` → solo comprueba; sale con error si falta algo. No instala nada.
- `brew bundle list --all --file=RUTA` → lista las entradas (sirve para validar la sintaxis).
- `brew bundle dump --file=RUTA --force` → **genera** un Brewfile a partir de lo instalado
  (`--force` = sobrescribir si existe). Así se creó el de esta carpeta.
- `brew bundle cleanup --file=RUTA` → lista lo instalado que NO está en el Brewfile (con `--force`
  lo desinstala; úsalo con cuidado).

En el Brewfile de esta carpeta los paquetes npm están comentados a propósito: con nvm, cada versión
de Node tiene sus propios globales, así que `bootstrap.sh` los instala después de nvm (ver
[nvm](#nvm-sdkman)).

<a id="defaults"></a>
### `defaults` y los ficheros plist

macOS guarda las preferencias de cada app en ficheros **plist** (*property list*, formato XML o
binario) dentro de `~/Library/Preferences/`. Cada app tiene un **dominio** (normalmente su
identificador invertido, p. ej. `com.apple.dock`) y dentro claves con valor.

- `defaults read com.apple.dock autohide` → lee la clave `autohide` del Dock (`1` = activado).
- `defaults write com.apple.dock autohide -bool true` → la escribe. El tipo se indica con
  `-bool`, `-int`, `-float`, `-string`.
- `defaults delete com.apple.dock autohide` → borra la clave: la app vuelve a su valor de fábrica.
  Es la forma más limpia de **revertir**.
- `NSGlobalDomain` (o `-g`) → preferencias globales que leen todas las apps (modo oscuro,
  extensiones de fichero…).
- Las apps cargan las preferencias al arrancar y a veces las reescriben al cerrarse. Por eso
  `macos-defaults.sh` cierra *Ajustes del Sistema* antes y reinicia Dock/Finder/SystemUIServer
  después con `killall` (macOS los vuelve a abrir solos). Algunas claves (modo oscuro, dirección
  del scroll) solo se aplican del todo al cerrar sesión.
- Para descubrir qué clave cambia un ajuste: `defaults read > antes.txt`, cambia el ajuste en la
  interfaz, `defaults read > despues.txt` y `diff antes.txt despues.txt`.

<a id="nvm-sdkman"></a>
### nvm y SDKMAN: gestores de versiones

Distintos proyectos necesitan distintas versiones de Node.js o Java. En vez de una sola versión
global, un **gestor de versiones** instala varias en tu carpeta de usuario y te deja cambiar entre
ellas.

| | nvm | SDKMAN |
|---|---|---|
| Para | Node.js | Java, Groovy, Maven, Gradle, Kotlin… (ecosistema JVM) |
| Dónde instala | `~/.nvm/versions/node/` | `~/.sdkman/candidates/<sdk>/` |
| Instalar versión | `nvm install 22` (última 22.x) | `sdk install java 21.0.9-zulu` |
| Usar en esta terminal | `nvm use 22` | `sdk use java 21.0.9-zulu` |
| Versión por defecto | `nvm alias default 24` | `sdk default java 21.0.9-zulu` |
| Ver disponibles | `nvm ls-remote --lts` | `sdk list java` |
| Cómo se instala | fórmula `nvm` de Homebrew | script de <https://sdkman.io> |

- En SDKMAN el identificador de Java es `versión-distribución`: `zulu` = Azul Zulu, `tem` =
  Eclipse Temurin. Son builds de OpenJDK de distintos fabricantes, equivalentes en la práctica.
- Ambos funcionan cargando un script en la shell (`nvm.sh`, `sdkman-init.sh`) que define las
  funciones `nvm`/`sdk` y ajusta el `PATH`. Por eso `~/.zshrc` debe cargarlos.
- Los **paquetes npm globales** (`npm install -g`) se guardan dentro de cada versión de Node: si
  cambias de versión, no los verás. `bootstrap.sh` los instala en la versión por defecto.
- Homebrew también instala `node` y `openjdk@21` porque otras fórmulas dependen de ellos (p. ej.
  `maven`, `kafka`); para tus proyectos usa las de nvm/SDKMAN.

<a id="oh-my-zsh"></a>
### Oh My Zsh y sus plugins

[Oh My Zsh](https://ohmyz.sh) es un *framework* para zsh: un conjunto de scripts en `~/.oh-my-zsh`
que añade temas (aspecto del prompt), alias y autocompletados.

- `ZSH_THEME="robbyrussell"` elige el tema; `plugins=(git kubectl …)` los plugins. Deben definirse
  **antes** de `source $ZSH/oh-my-zsh.sh`, porque Oh My Zsh los lee al cargarse (por eso en
  [`../../shell/zsh/`](../../shell/zsh/) están en `pre/`).
- Plugins **incluidos** (`git`, `kubectl`): vienen con Oh My Zsh, solo hay que nombrarlos.
- Plugins **externos**: hay que clonarlos en `~/.oh-my-zsh/custom/plugins/<nombre>` con `git clone`.
  `bootstrap.sh` clona cuatro: `zsh-autosuggestions` y `fast-syntax-highlighting` (activos) y
  `zsh-syntax-highlighting` y `zsh-autocomplete` (instalados pero **no activados** en el Mac de
  referencia; `fast-syntax-highlighting` hace lo mismo que `zsh-syntax-highlighting`, no actives
  ambos).
- `git clone --depth 1`: descarga solo el último commit (más rápido; no necesitas el historial).

<a id="zprofile-zshrc"></a>
### `~/.zprofile` frente a `~/.zshrc`

zsh lee varios ficheros al arrancar:

- **`~/.zprofile`**: una vez por **sesión de login** (en macOS, cada ventana nueva de Terminal es
  de login). Lugar para el `PATH` base: la línea de `brew shellenv`.
- **`~/.zshrc`**: en cada shell **interactiva**. Lugar para Oh My Zsh, alias, funciones, nvm/SDKMAN.
- **`~/.zshrc.local`** (convención de este repo): lo específico de una máquina, que no va al repo
  (rutas de proyectos, tokens, inicialización de SDKMAN). Lo carga el final de `zshrc.example`.

`bootstrap.sh` solo añade la línea de Homebrew a `~/.zprofile` si no existe (busca el texto
`brew shellenv` con `grep -qs`: `-q` silencioso, `-s` sin error si el fichero no existe).

<a id="dotfiles"></a>
### Dotfiles

Ficheros y carpetas de configuración en tu `$HOME` cuyo nombre empieza por punto (`.zshrc`,
`.gitconfig`, `.config/`). El punto los oculta en Finder y en `ls` (se ven con `ls -A`).

Se dividen en tres grupos (detalle en [INVENTARIO.md](INVENTARIO.md#dotfiles)):

1. **Configuración genérica** → se versiona en este repo (zsh, nvim) o se copia.
2. **Estado regenerable** (cachés, versiones instaladas, históricos) → no se copia, se recrea.
3. **Credenciales** (claves SSH, tokens de nube, kubeconfigs) → **nunca** en un repo. Se migran por
   un canal seguro o, mejor, se regeneran con un login nuevo en el Mac nuevo.

<a id="git-includeif"></a>
### `includeIf` en git: dos identidades

`~/.gitconfig` es la configuración global de git. Con `includeIf` puedes cargar **otro** fichero
solo cuando el repositorio está dentro de cierta carpeta:

```ini
[user]
    name = <NOMBRE_TRABAJO>
    email = <EMAIL_TRABAJO>
[includeIf "gitdir:~/dev/personal/repositories/"]
    path = ~/.gitconfig-personal
```

y en `~/.gitconfig-personal`:

```ini
[user]
    name = <NOMBRE_PERSONAL>
    email = <EMAIL_PERSONAL>
```

- `gitdir:` compara con la ruta del `.git` del repo. La **barra final** importa: significa "esta
  carpeta y todo lo que hay debajo".
- El fichero incluido se lee **después**, así que sus valores ganan. Resultado: los commits en
  repos personales salen con la identidad personal y el resto con la de trabajo.
- Comprobar qué identidad se usa en un repo: `git config user.email` dentro de él;
  `git config --show-origin user.email` dice además de qué fichero sale.
- `filter.lfs.*`: líneas que añade `git lfs install` para que git delegue en git-lfs los ficheros
  grandes. Se recrean con ese comando; no hace falta copiarlas.
- **Errata detectada** en el Mac de referencia: existe `core.page=less`. La clave correcta es
  `core.pager`; `core.page` no la reconoce git y no hace nada. Como `less` ya es el paginador por
  defecto, basta con borrarla: `git config --global --unset core.page`.

<a id="idempotencia"></a>
### Idempotencia y `--dry-run`

- **Idempotente**: ejecutarlo una o diez veces deja el mismo resultado. Cada paso de `bootstrap.sh`
  comprueba antes de actuar (¿existe `~/.oh-my-zsh`?, ¿ya está la línea en `~/.zprofile`?), así que
  si algo falla a mitad puedes relanzarlo sin miedo.
- **`--dry-run`** ("ensayo"): imprime los comandos que ejecutaría (con `+` delante) sin ejecutarlos.
  Úsalo siempre antes de la ejecución real para ver qué va a pasar.
- **`set -euo pipefail`** (cabecera de los scripts): `-e` para el script si un comando falla, `-u`
  da error al usar una variable no definida, `-o pipefail` hace que una tubería `a | b` falle si
  falla `a`. `inventory.sh` no usa `-e` a propósito: si falta una herramienta, sigue con el resto.

<a id="curl-bash"></a>
### `curl … | bash`: instaladores remotos

Homebrew, Oh My Zsh y SDKMAN se instalan descargando un script y ejecutándolo:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- `curl` descarga una URL. `-f` falla si el servidor devuelve error (en vez de ejecutar una página
  de error), `-s` silencioso, `-S` muestra errores aunque esté en silencioso, `-L` sigue
  redirecciones.
- `bash -c "<texto>"` ejecuta ese texto como script.
- Implica confiar en esa URL: por eso solo se usan las **oficiales** de cada proyecto. Si quieres
  revisar antes: `curl -fsSL <URL> -o install.sh`, léelo y luego `bash install.sh`.

---

<a id="pasos"></a>
## Explicación de cada paso del runbook

<a id="paso-0"></a>
### Paso 0 — Inventario del Mac viejo

`inventory.sh` guarda en una carpeta lo que hay instalado y configurado (versión de macOS, Brewfile
actual, apps, extensiones, versiones de Node/Java, preferencias, **nombres** de dotfiles, si existen
ficheros de credenciales). Sirve para dos cosas:

1. **Detectar cambios** desde que se escribió el [Brewfile](Brewfile) de esta carpeta (has
   instalado algo nuevo): compara su `Brewfile` con este.
2. **Comprobar el Mac nuevo** al final: ejecútalo también allí y compara las dos carpetas con
   `diff -ru` (`-r` recursivo por carpetas, `-u` formato unificado: líneas con `-` solo en el
   primero, con `+` solo en el segundo).

Es de solo lectura: no guarda valores de git config ni contenido de credenciales. Aun así, revisa la
carpeta antes de compartirla (contiene nombres de apps y carpetas).

Si no haces este paso, te arriesgas a descubrir semanas después que faltaba una herramienta o una
credencial en el Mac nuevo, cuando el viejo ya está borrado.

<a id="paso-1"></a>
### Paso 1 — Xcode CLT

Sin las [CLT](#xcode-clt) no hay `git` para clonar este repo ni compilador para Homebrew. Se instala
primero a mano porque la instalación es asíncrona (una ventana del sistema). `bootstrap.sh` también
lo comprueba, pero es más cómodo hacerlo antes de clonar.

<a id="paso-2"></a>
### Paso 2 — Clonar este repo

El repo contiene el Brewfile, los scripts y la configuración de zsh/nvim. Se clona por **HTTPS**
porque en un Mac nuevo aún no tienes tu clave SSH registrada (eso llega en el [paso 8](#paso-8)).
Si el repo es privado, `git` te pedirá usuario y un *token* (no la contraseña); alternativa:
instalar antes `gh` y hacer `gh auth login`.

Más adelante puedes cambiar el remoto a SSH:
`git remote set-url origin git@github.com:<USUARIO>/<REPO>.git`.

<a id="paso-3"></a>
### Paso 3 — `bootstrap.sh --dry-run`

Ver [idempotencia y `--dry-run`](#idempotencia). Permite revisar qué va a instalar y en qué orden, y
ajustar las variables (`NODE_VERSIONS`, `JAVA_VERSIONS`…) o comentar grupos del Brewfile marcados
`[OPCIONAL]` antes de gastar tiempo y espacio en disco (el Brewfile completo son varios GB).

<a id="paso-4"></a>
### Paso 4 — `bootstrap.sh`

Ejecuta, en orden, los pasos 1-7 del script. El orden importa:

1. **CLT** antes que nada (Homebrew las necesita).
2. **Homebrew** antes que `brew bundle`, y `brew shellenv` en `~/.zprofile` para que esté en el
   `PATH` de las terminales futuras. Además el script hace `eval "$(brew shellenv)"` para usarlo en
   la ejecución actual.
3. **`brew bundle`** instala `nvm`, `git`, VS Code… que usan los pasos siguientes. Si un cask falla
   (p. ej. porque la app ya estaba instalada a mano en `/Applications`), el script avisa y sigue.
   Solución típica: borrar la app manual y relanzar, o quitar esa línea del Brewfile.
4. **Oh My Zsh** con `KEEP_ZSHRC=yes` (no sustituye tu `~/.zshrc`) y `RUNZSH=no` (no abre una zsh
   nueva que detendría el script). Luego clona los plugins externos.
5. **nvm**: carga `nvm.sh` (instalado por Homebrew) e instala las versiones LTS en uso. Las versiones
   10 y 14 del Mac de referencia se omiten por obsoletas (sin parches de seguridad); añádelas a
   `NODE_VERSIONS` si un proyecto antiguo las exige.
6. **npm globales** en la versión por defecto. Comprueba primero con `npm ls -g --depth=0 <paquete>`.
7. **SDKMAN** con `rcupdate=false` para que el instalador no edite `~/.zshrc` (lo gestiona el repo).
   `sdkman_auto_answer=true` evita que `sdk install` pregunte "¿usar como versión por defecto?".
   Si un identificador de Java ya no está en el catálogo (SDKMAN retira versiones antiguas), ese
   `sdk install` fallará con aviso y el script seguirá: busca el sustituto con `sdk list java`.

Desactivar `set -u` alrededor de `nvm`/`sdk` (`set +u … set -u`) es necesario porque sus scripts usan
variables sin definir y abortarían el nuestro.

<a id="paso-5"></a>
### Paso 5 — `~/.zshrc` y `~/.zshrc.local`

`--link-zshrc` hace backup de tu `~/.zshrc` (`~/.zshrc.bak.<fecha>`) y lo sustituye por una
**copia** de [`shell/zsh/zshrc.example`](../../shell/zsh/zshrc.example) con `UTILS_REPO` apuntando a
la ruta real del repo (con `sed`, que reemplaza el texto `$HOME/utils` por esa ruta). Se copia en vez
de enlazar (symlink) porque hay que ajustar esa ruta; los ficheros que carga sí se leen
directamente del repo, así que un `git pull` actualiza tu configuración.

`nvm` y `SDKMAN` no están en `zshrc.example`: añádelos a `~/.zshrc.local` (ver bloque en el runbook).
Sin eso, `nvm` y `sdk` no existirán en terminales nuevas aunque estén instalados.

<a id="paso-6"></a>
### Paso 6 — Preferencias de macOS

Ver [`defaults`](#defaults). Cada línea de `macos-defaults.sh` dice qué cambia y cómo revertirlo.
Valores observados en el Mac de referencia:

| Preferencia | Valor | Dónde se cambia a mano |
|---|---|---|
| Ocultar Dock | sí | Ajustes → Escritorio y Dock |
| Vista de Finder | columnas | Finder → Visualización |
| Mostrar extensiones | sí | Finder → Ajustes → Avanzado |
| Apariencia | oscura | Ajustes → Apariencia |
| Carpeta de capturas | `~/Pictures/Screenshots` | Cmd+Shift+5 → Opciones |
| Tocar para clic | no | Ajustes → Trackpad |
| Desplazamiento natural | no | Ajustes → Trackpad → Desplazar y ampliar |

En el Mac de referencia la ruta de capturas estaba guardada con `~` literal; el script escribe la
ruta absoluta, que macOS interpreta siempre bien.

<a id="paso-7"></a>
### Paso 7 — Git: identidad y `includeIf`

Ver [`includeIf`](#git-includeif). No se automatiza porque los valores (nombre, email) son personales
y no deben estar en el repo. `git lfs install` añade a `~/.gitconfig` los filtros de Git LFS (las
líneas `filter.lfs.*`); sin ellos, los repos que usan LFS bajarían ficheros "puntero" de texto en vez
del fichero real.

<a id="paso-8"></a>
### Paso 8 — Credenciales

Las credenciales **no se copian al repo nunca** (aunque sea privado: un repo se clona, se comparte y
su historial es permanente). Dos estrategias, por orden de preferencia:

1. **Regenerar** con un login nuevo en el Mac nuevo. Es lo más seguro: la credencial vieja se puede
   revocar al retirar el Mac antiguo, y cada máquina tiene la suya.
   - SSH: `ssh-keygen -t ed25519 -C "<ETIQUETA>"` crea un par de claves (`-t` tipo de clave,
     `ed25519` es el algoritmo moderno recomendado; `-C` un comentario para reconocerla). Registra la
     **pública** (`~/.ssh/id_ed25519.pub`) en GitHub/GitLab.
   - Nubes y Kubernetes: `aws configure sso` / `aws sso login`, `az login`, y regenerar
     kubeconfigs (`aws eks update-kubeconfig`, `az aks get-credentials`, `oc login`).
   - CLIs: `gh auth login`, `glab auth login`, `databricks auth login`, `atlas auth login`…
2. **Trasladar** solo lo que no se puede regenerar (p. ej. una clave GPG de firma, un fichero
   `.env` de un proyecto): mediante el **gestor de contraseñas** (nota segura / adjunto) o AirDrop
   directo entre tus dos Macs, y borrarlo del medio intermedio después. Nunca por email, chat o
   un USB sin cifrar. Permisos tras copiar: `chmod 700 ~/.ssh` y `chmod 600 ~/.ssh/id_*`
   (solo tu usuario puede leerlas; SSH rechaza claves con permisos abiertos).

El historial de zsh (`~/.zsh_history`) puede contener tokens que pegaste en algún comando: si lo
migras, revísalo antes.

<a id="paso-9"></a>
### Paso 9 — Apps fuera de Homebrew

Ver la clasificación en [INVENTARIO.md](INVENTARIO.md#apps-fuera). Tres orígenes:

- **Apple / App Store**: se reinstalan desde la App Store con tu Apple ID.
- **Descarga manual**: desde la web oficial, o con el cask equivalente (están comentados en la
  sección 8c del Brewfile). Tenerlas en Homebrew facilita actualizarlas con `brew upgrade`.
- **Corporativas** (VPN, seguridad, escritorio remoto, portal de dispositivos): las instala o
  autoriza el departamento de IT de tu empresa, normalmente vía **MDM** (*Mobile Device
  Management*, el sistema con el que la empresa gestiona sus equipos). No las instales por tu
  cuenta: pueden requerir perfiles de configuración o licencias.

<a id="paso-10"></a>
### Paso 10 — Ajustes de apps y editores

Algunas apps guardan su configuración en sitios difíciles de copiar a mano (plist binarios, bases de
datos) y ofrecen su propio export o sincronización, que es más fiable. Para los ficheros de texto
de `~/.config` basta con copiarlos. La configuración de Neovim está versionada en
[`editors/nvim/`](../../editors/nvim/) y se enlaza con `ln -s` (un *symlink*: un acceso directo; si
editas el fichero, editas el del repo).

<a id="paso-11"></a>
### Paso 11 — Verificación final

`brew bundle check` confirma que no falta nada del Brewfile; `brew doctor` revisa problemas
comunes de Homebrew (avisos de permisos, PATH…; muchos avisos son informativos). Comparar el
inventario de los dos Macs con `diff -ru` muestra lo que aún falta o sobra.
