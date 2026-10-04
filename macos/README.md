# macos

Utilidades específicas de macOS y, en [`setup/`](setup/README.md), todo lo necesario para replicar un Mac en otro.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `brew-update.sh` | `brew update` + `brew upgrade` + `brew upgrade --cask` + `brew cleanup` | ESCRIBE: actualiza paquetes y borra versiones antiguas |

## Requisitos

- macOS con [Homebrew](https://brew.sh) instalado y `brew` en el `PATH`.

## Variables

Ninguna. La ruta de `brew` se detecta con `command -v brew` (devuelve la ruta del ejecutable:
`/opt/homebrew/bin/brew` en Apple Silicon, `/usr/local/bin/brew` en Intel).

## Uso

```bash
./brew-update.sh
```

Qué hace cada comando:

- `brew update`: descarga la lista actualizada de paquetes (no actualiza nada instalado).
- `brew upgrade`: actualiza las **fórmulas** (CLIs y librerías) instaladas.
- `brew upgrade --cask`: actualiza los **casks** (aplicaciones con interfaz gráfica). Las que se
  autoactualizan solas (`auto_updates`) se saltan salvo que añadas `--greedy`.
- `brew cleanup`: borra versiones antiguas y descargas en caché para liberar espacio.

Si un paso falla, el script continúa con los siguientes (no usa `set -e`), igual que el original.

Alias sugerido (en `shell/zsh/aliases.zsh`): `actualizar`.

## setup/ — replicar este Mac en otro

Runbook paso a paso, Brewfile e instaladores para dejar un Mac nuevo igual que el de referencia.
Empieza por [`setup/README.md`](setup/README.md) (runbook); el porqué de cada paso está en
[`setup/EXPLICACIONES.md`](setup/EXPLICACIONES.md) y la foto del Mac en
[`setup/INVENTARIO.md`](setup/INVENTARIO.md).

| Fichero | Qué hace | Efectos |
|---|---|---|
| `setup/Brewfile` | Taps, fórmulas, casks, extensiones de VS Code… agrupados y comentados | Lo lee `brew bundle` |
| `setup/bootstrap.sh` | Instalador idempotente (CLT, Homebrew, Brewfile, Oh My Zsh, nvm, npm, SDKMAN; opcional `~/.zshrc` y preferencias). `--dry-run` para ensayar | ESCRIBE: instala software, `~/.zprofile`; con opciones `~/.zshrc` (backup) y preferencias |
| `setup/macos-defaults.sh` | Preferencias de macOS (Dock, Finder, trackpad, capturas, modo oscuro). `--dry-run` | ESCRIBE: `~/Library/Preferences`; reinicia Dock/Finder |
| `setup/inventory.sh` | Inventario del Mac a una carpeta para comparar dos Macs con `diff -ru` | SOLO LECTURA · ESCRIBE en la carpeta de salida |
