# editors/nvim — configuración de Neovim

Configuración ligera de [Neovim](https://neovim.io) (`nvim`) pensada para trabajo de infraestructura
(YAML, Terraform, Bash, Dockerfile, JSON, Groovy): tema, barra de estado, búsqueda de ficheros/texto,
LSP (diagnósticos y navegación) y formateo bajo demanda. Copia literal de `~/.config/nvim` del Mac de
referencia (no contenía datos personales ni de clientes).

## Requisitos

- Neovim 0.10 o superior (probado con 0.12): `brew install neovim` (incluido en
  [`macos/setup/Brewfile`](../../macos/setup/Brewfile)).
- `git` (lazy.nvim descarga los plugins con git), `ripgrep` (`rg`) y `fd` para Telescope, un
  compilador C (Xcode CLT) para Treesitter, y Node.js para algunos servidores LSP (`yamlls`,
  `jsonls`, `bashls`, `dockerls`). Para `groovyls`, Java.
- Formateadores usados: `terraform` (para `terraform fmt`) y `shfmt`.
- Una **Nerd Font** en la terminal (p. ej. `brew install --cask font-hack-nerd-font`) para ver los
  iconos; sin ella salen cuadrados.

## Instalación

```bash
# 1) Backup de la config actual si existe (mv = mover/renombrar)
[ -e ~/.config/nvim ] && mv ~/.config/nvim ~/.config/nvim.bak

# 2a) Enlace simbólico: ~/.config/nvim apunta al repo; un `git pull` actualiza la config
ln -s <RUTA_DEL_REPO>/editors/nvim ~/.config/nvim     # -s = symlink (acceso directo)

# 2b) …o copia independiente (los cambios no vuelven al repo)
cp -R <RUTA_DEL_REPO>/editors/nvim ~/.config/nvim     # -R = recursivo (carpetas)

# 3) Primer arranque: lazy.nvim se instala solo y descarga los plugins
nvim
```

Dentro de nvim: `:Lazy` (estado de plugins), `:Mason` (servidores LSP instalados), `:checkhealth`
(diagnóstico general). La primera vez Mason descarga los LSP en segundo plano: puede tardar un minuto.

## Estructura

| Fichero | Qué hace |
|---|---|
| `init.lua` | Punto de entrada: carga `config.options`, `config.keymaps` y `config.lazy`, en ese orden |
| `lua/config/options.lua` | Opciones del editor: números de línea relativos, 2 espacios por tabulación, portapapeles del sistema, búsqueda insensible a mayúsculas salvo que escribas alguna, ratón desactivado |
| `lua/config/keymaps.lua` | Tecla *leader* = espacio y atajos básicos |
| `lua/config/lazy.lua` | Instala [lazy.nvim](https://github.com/folke/lazy.nvim) (gestor de plugins) si falta y carga la lista de `lua/plugins/` |
| `lua/plugins/init.lua` | Lista de plugins (qué se instala) |
| `after/plugin/*.lua` | Configuración de cada plugin. Neovim ejecuta `after/plugin/` **después** de cargar los plugins, por eso aquí ya se puede hacer `require("…")` |
| `lazy-lock.json` | Commit exacto de cada plugin (como un `package-lock.json`): reproduce las mismas versiones en otro Mac. `:Lazy update` lo actualiza; `:Lazy restore` vuelve a lo fijado |

## Plugins

| Plugin | Para qué |
|---|---|
| `folke/tokyonight.nvim` | Tema de colores |
| `nvim-tree/nvim-web-devicons` | Iconos (requiere Nerd Font) |
| `nvim-lualine/lualine.nvim` | Barra de estado inferior (modo, rama, fichero, diagnósticos) |
| `akinsho/bufferline.nvim` | Ficheros abiertos como pestañas arriba |
| `lukas-reineke/indent-blankline.nvim` | Guías verticales de indentación (útil en YAML) |
| `goolord/alpha-nvim` | Pantalla de inicio con accesos rápidos |
| `rcarriga/nvim-notify`, `folke/noice.nvim` (+ `nui.nvim`) | Notificaciones y línea de comandos más visuales |
| `folke/which-key.nvim` | Al pulsar *leader* muestra los atajos disponibles |
| `nvim-telescope/telescope.nvim` (+ `plenary.nvim`) | Buscador de ficheros (`fd`) y texto (`rg`) |
| `nvim-treesitter/nvim-treesitter` | Resaltado de sintaxis basado en el árbol del código |
| `williamboman/mason.nvim`, `mason-lspconfig.nvim`, `neovim/nvim-lspconfig` | Instalar y configurar servidores LSP: `terraformls`, `yamlls`, `bashls`, `dockerls`, `jsonls`, `groovyls` |
| `hrsh7th/nvim-cmp`, `cmp-nvim-lsp` | Autocompletado con las sugerencias del LSP |
| `stevearc/conform.nvim` | Formateo: `terraform_fmt` para Terraform, `shfmt` para shell; si no hay, usa el LSP |
| `vim-scripts/groovy.vim` | Sintaxis de Groovy |

**LSP** (*Language Server Protocol*): un programa aparte por lenguaje que analiza el código y le
dice al editor errores, definiciones, renombrados, etc. Mason los descarga a `~/.local/share/nvim/mason`.

## Atajos (`<leader>` = espacio)

| Atajo | Modo | Qué hace | Dónde se define |
|---|---|---|---|
| `<leader>w` / `<leader>q` | Normal | Guardar / cerrar | keymaps.lua |
| `Ctrl+h/j/k/l` | Normal | Moverse a la ventana izquierda/abajo/arriba/derecha | keymaps.lua |
| `<leader>fp` | Normal | Mostrar la ruta completa del fichero | keymaps.lua |
| `<leader>fwd` | Normal | Mostrar el directorio de trabajo | keymaps.lua |
| `<leader>ff` | Normal | Buscar ficheros | telescope.lua |
| `<leader>fg` | Normal | Buscar texto en el proyecto | telescope.lua |
| `<leader>fb` | Normal | Lista de ficheros abiertos (buffers) | telescope.lua |
| `<leader>f` | Normal | Formatear el fichero | format.lua |
| `gd` / `gr` / `K` | Normal (con LSP) | Ir a definición / referencias / documentación flotante | lsp.lua |
| `<leader>rn` / `<leader>ca` / `<leader>dd` | Normal (con LSP) | Renombrar / acción de código / ver diagnóstico | lsp.lua |
| `Ctrl+Space` / `Enter` | Inserción | Abrir menú de autocompletado / aceptar | lsp.lua |

Nota: `<leader>f` comparte prefijo con `<leader>ff`, `<leader>fg`… Al pulsar `<leader>f`, Neovim
espera `timeoutlen` (400 ms, en options.lua) por si sigue otra tecla antes de formatear.

## Notas

- Con el ratón desactivado (`mouse = ""`) la terminal gestiona la selección: puedes seleccionar y
  copiar texto con el ratón como en cualquier otra ventana.
- En Neovim 0.11+ `require("lspconfig")[server].setup()` sigue funcionando pero está marcado como
  obsoleto en favor de `vim.lsp.config()`/`vim.lsp.enable()`; y los plugins de Mason se han movido
  de `williamboman/` a `mason-org/` (GitHub redirige). Se deja como en el original.
