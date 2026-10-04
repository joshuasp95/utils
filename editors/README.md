# editors

Utilidades y configuración para editores de texto: **Sublime Text** (abajo) y **Neovim** ([sección propia](#neovim-nvim)). Sublime Text: rescatar y limpiar las pestañas temporales ("Untitled", nunca guardadas) que Sublime conserva dentro de su fichero de sesión.

| Fichero | Qué hace | Efectos |
|---|---|---|
| `sublime/extract-sublime-notes.mjs` | Extrae cada pestaña temporal a un `.md` con front matter (fechas mencionadas, temas, nº de redacciones), redactando posibles secretos, y genera `manifest.json` + `index.md` | SOLO LECTURA de la sesión · ESCRIBE en `<salida>/extracted/AAAA/MM/DD/` y **BORRA antes** su subcarpeta `notes/` |
| `sublime/clear-sublime-temporary-buffers.mjs` | Quita de la sesión todas las pestañas temporales | **ESCRIBE: SOBRESCRIBE el fichero de sesión de Sublime.** El texto de esas pestañas se pierde |

## Requisitos

- Node.js 16+ (solo módulos nativos, sin `npm install`).
- **Sublime Text cerrado** durante ambos scripts: Sublime reescribe la sesión al salir, así que con el editor abierto la extracción puede leer datos antiguos y la limpieza se perdería (o pisaría cambios).

## Dónde está el fichero de sesión

| Sistema | Ruta habitual (Sublime Text 4) |
|---|---|
| macOS | `$HOME/Library/Application Support/Sublime Text/Local/Session.sublime_session` |
| Linux | `$HOME/.config/sublime-text/Local/Session.sublime_session` |
| Windows | `%APPDATA%\Sublime Text\Local\Session.sublime_session` |

Puede existir también `Auto Save Session.sublime_session` en la misma carpeta (copia de seguridad automática de Sublime).

## Variables y argumentos

| Script | Variable / argumento | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|---|
| extract | 1er arg `session` | Sí | Ruta del `.sublime_session` | Tabla anterior |
| extract | 2º arg `output-root` | Sí | Carpeta raíz de salida | Libre (p. ej. un repo privado de notas) |
| extract | 3er arg `snapshot-date` | No | Fecha `YYYY-MM-DD` que se usa como carpeta y en el front matter. **Por defecto, hoy** | Sublime no guarda fecha por pestaña: usa la fecha en que copiaste la sesión |
| extract | `SUBLIME_NOTES_TOPICS_FILE` | No | JSON `{ "tema": "regex" }` que sustituye las reglas de temas por defecto | Crea tu propio fichero (ver ejemplo) |
| clear | 1er arg `session-path` | Sí | Ruta del `.sublime_session` a limpiar | Tabla anterior |

## Ejemplos de uso

```bash
# Ruta de la sesión (macOS). Comillas porque contiene espacios.
SESSION="$HOME/Library/Application Support/Sublime Text/Local/Session.sublime_session"

# 1) Copia de seguridad ANTES de nada (cp = copiar; .bak = sufijo de backup)
cp "$SESSION" "$SESSION.bak"

# 2) Extraer notas a ./notas-sublime/extracted/<hoy>/
node editors/sublime/extract-sublime-notes.mjs "$SESSION" ./notas-sublime

# 2b) Con fecha explícita y temas propios
echo '{"proyecto-x": "proyecto ?x|px-\\d+", "personal": "m[eé]dico|banco"}' > temas.json
SUBLIME_NOTES_TOPICS_FILE=temas.json \
  node editors/sublime/extract-sublime-notes.mjs "$SESSION" ./notas-sublime 2026-07-15

# 3) Solo cuando hayas revisado lo extraído: limpiar las pestañas temporales
node editors/sublime/clear-sublime-temporary-buffers.mjs "$SESSION"
```

Para deshacer la limpieza: cierra Sublime y restaura la copia (`cp "$SESSION.bak" "$SESSION"`).

## Qué se redacta

Antes de escribir cada nota se sustituyen por `[REDACTED]`: JWT (`eyJ…`), cabeceras `Bearer`, pares `password=`/`token:`/`api_key=`…, parámetros de URL sensibles (`?token=`, `&code=`…), `p_p_auth`, campos SAML, cookies y cualquier cadena de 20+ caracteres que mezcle letras y dígitos. Si la nota entera parece una contraseña suelta (o el título sugiere credenciales y el contenido es una línea corta), se sustituye completa. Es una heurística: **revisa** las notas antes de compartirlas.

## Notas de origen

- La fecha por defecto era fija en el script original; ahora es la fecha local de hoy.
- Las reglas de temas originales eran específicas; se sustituyeron por ejemplos genéricos configurables con `SUBLIME_NOTES_TOPICS_FILE`.
- Corregido un fallo del original: las redacciones tipo `password=…` dejaban el texto literal `$1[REDACTED]` en vez de `password=[REDACTED]`.

<a id="neovim-nvim"></a>
## Neovim (`nvim/`)

Configuración completa de Neovim (tema, Telescope, LSP con Mason, formateo con conform) lista para
enlazar en `~/.config/nvim`. Estructura, plugins, atajos e instalación en
[`nvim/README.md`](nvim/README.md).

| Fichero | Qué hace | Efectos |
|---|---|---|
| `nvim/init.lua`, `nvim/lua/**`, `nvim/after/**` | Configuración de Neovim | Al abrir `nvim` por primera vez descarga plugins y servidores LSP en `~/.local/share/nvim` |
| `nvim/lazy-lock.json` | Versiones fijadas de los plugins | — |

```bash
ln -s <RUTA_DEL_REPO>/editors/nvim ~/.config/nvim   # -s: enlace simbólico (haz antes backup si ya existe)
```
