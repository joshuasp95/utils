# documents

Utilidades de línea de comandos para convertir, inspeccionar y validar documentos (Markdown, Word, Excel, PDF, NDJSON). Todas son scripts sueltos: se ejecutan con `python3` o `node` sin instalar nada, salvo `pdf-inspect-annotations.py` (necesita `pypdf`).

| Fichero | Qué hace | Efectos |
|---|---|---|
| `ndjson-to-html.py` | Informe HTML de **registros de tiempo** (imputaciones) a partir de un NDJSON: totales, balance frente a 8 h/día, calendario y detalle por día | ESCRIBE el `.html` de salida (sobrescribe) |
| `md-to-docx.py` | Convierte un Markdown sencillo en un `.docx` mínimo (cada línea = párrafo; títulos solo cambian tamaño) | ESCRIBE el `.docx` de salida (sobrescribe) |
| `xlsx-to-tables.py` | Primera hoja de un `.xlsx` (o un `.csv`) → `.md`, `.csv`, `.tsv` y `.docx` con tabla | ESCRIBE 4 ficheros en `--out-dir` (sobrescribe) |
| `pdf-inspect-annotations.py` | Lista las anotaciones de cada página de un PDF (enlaces, comentarios, resaltados) | SOLO LECTURA |
| `verify-dual-shell-docs.mjs` | Linter de documentación con comandos para zsh y PowerShell 7 (marcadores, sintaxis cruzada, explicaciones, glosario) | SOLO LECTURA (JSON por stdout) |

## Requisitos

- Python 3.10+ para `ndjson-to-html.py`; 3.8+ para el resto de `.py`.
- `pypdf` solo para `pdf-inspect-annotations.py`: `python3 -m pip install pypdf` (`-m pip` ejecuta el pip del mismo Python que vas a usar).
- Node.js 16+ para `verify-dual-shell-docs.mjs`.

## Variables y argumentos

| Script | Variable / argumento | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|---|
| `ndjson-to-html.py` | `input` | Sí | Ruta al `.ndjson` | Tu export de imputaciones |
| `ndjson-to-html.py` | `-o, --output` | No | Ruta del HTML (por defecto, junto al `.ndjson`) | Libre |
| `ndjson-to-html.py` | `--highlight-months` | No | Meses `YYYY-MM,YYYY-MM` para una tarjeta de balance combinado | Los meses que quieras comparar |
| `md-to-docx.py` | `input`, `-o/--output` | `input` sí | Markdown de entrada y `.docx` de salida | Libre |
| `xlsx-to-tables.py` | `input` | Sí | `.xlsx` (se lee solo la primera hoja) o `.csv` | Libre |
| `xlsx-to-tables.py` | `--out-dir`, `--title`, `--subtitle` | No | Carpeta de salida, título del `.md`/`.docx`, subtítulo del `.docx` | Libre |
| `pdf-inspect-annotations.py` | `pdf` | Sí | Ruta al PDF | Libre |
| `verify-dual-shell-docs.mjs` | argumentos posicionales | No | Carpetas raíz con `.md` a revisar | Tu repo de documentación |
| `verify-dual-shell-docs.mjs` | `DUAL_SHELL_DOC_ROOTS` | No | Alternativa a los argumentos: carpetas separadas por comas. Sin nada: `docs/operacion`, `docs/runbooks`, `docs/aprendizaje` | — |
| `verify-dual-shell-docs.mjs` | `DUAL_SHELL_CONVENTION_FILE` | No | Fichero de convenciones que cada `.md` debe enlazar (por defecto `command-conventions-pwsh-zsh.md`) | Tu repo |

### Formato esperado por `ndjson-to-html.py`

**No es un visor NDJSON genérico**: está pensado para registros de tiempo. NDJSON = un objeto JSON por línea. Cada línea:

```json
{"date": "2026-04-01", "hours": 8, "type": "Work", "project": "<PROYECTO>", "task": "<TAREA>", "client": "<CLIENTE>", "start": "09:00", "end": "17:00", "weekday": "miércoles"}
```

- `date` y `hours` son obligatorios. El resto se muestra si existe.
- `type` decide cómo cuenta la entrada: `Break` (pausa, no suma trabajo), `Absence`/`Sickness`/`Vacation` (cubren jornada), `Public Holiday` (o `task` con "festivo"/"public holiday": reduce el objetivo), cualquier otro valor = trabajo.
- El objetivo es 8 h por día laborable (lunes-viernes), fijo en el código.
- Los valores se insertan en el HTML sin escapar: úsalo solo con datos tuyos.

## Ejemplos de uso

```bash
# Informe de imputaciones; -o: fichero de salida; --highlight-months: tarjeta con el saldo de abril+mayo
python3 documents/ndjson-to-html.py <RUTA>/imputaciones-2026.ndjson -o informe.html --highlight-months 2026-04,2026-05

# Markdown → Word (sin -o, crea notas.docx junto a notas.md)
python3 documents/md-to-docx.py notas.md

# Excel → md/csv/tsv/docx en ./salida, con título propio
python3 documents/xlsx-to-tables.py matriz.xlsx --out-dir salida --title "Matriz de skills"

# Anotaciones (enlaces, comentarios) de un PDF
python3 documents/pdf-inspect-annotations.py "<RUTA_AL_PDF>"

# Linter dual-shell sobre dos carpetas; jq filtra solo los bloques sin marcador
node documents/verify-dual-shell-docs.mjs docs/runbooks docs/operacion \
  | jq '.issues[] | select(.reason == "unmarked-shell-block")'
```

## Convención que valida `verify-dual-shell-docs.mjs`

- Cada bloque de shell lleva antes un marcador HTML invisible: `<!-- dual-shell: common -->` (mismo comando en ambos shells → bloque ` ```text `), `<!-- dual-shell: explicit -->` (un bloque ` ```zsh ` y otro ` ```powershell `) o `<!-- shell-remoto: … -->` (comando que se ejecuta en una máquina remota → ` ```zsh `).
- Tras cada marcador debe haber una explicación en negrita: `**Comandos y opciones:**`, `**Variables:**`, `**Referencia:**`, `**Descripción:**`, `**Qué comprueba:**`, etc.
- Cada `.md` enlaza al fichero de convenciones con un texto que contenga "convenciones" y tiene una sección `## Glosario`.
- La salida incluye `counts` (recuentos) e `issues` (`file`, `line`, `language`, `reason`, `sample`). El código de salida siempre es 0: usa `issueCount`.

## Notas de origen

- `xlsx-to-tables.py` une dos scripts originales casi idénticos (uno leía un `.xlsx` y otro un `.csv` para generar el mismo `.docx`); ahora acepta ambos. El original solo volcaba la primera fila de datos al Markdown; aquí se vuelcan todas.
