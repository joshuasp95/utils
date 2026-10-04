# browser-console

Scripts para **pegar y ejecutar en la consola de DevTools** del navegador sobre una web en la que ya tienes sesión iniciada. No necesitan instalar nada: usan el DOM (el HTML que la página ya ha pintado) y tu sesión actual. Ninguno envía datos a terceros; las descargas las genera el propio navegador.

| Fichero | Qué hace | Efectos |
|---|---|---|
| `linkedin/linkedin-saved-posts-export.js` | Exporta tus publicaciones guardadas de LinkedIn (título, autor, texto, fecha relativa, URL) | Solo lectura en LinkedIn · descarga 2 ficheros (JSON + TXT) automáticamente al terminar |
| `linkedin/linkedin-reactions-export.js` | Exporta las publicaciones a las que has reaccionado, incluido el enlace a cada post (lo lee del aviso "Ver publicación" que LinkedIn muestra tras "Copiar enlace") | Solo lectura en LinkedIn · **sobrescribe tu portapapeles** (lo hace la acción "Copiar enlace" de LinkedIn) · descarga 2 ficheros al terminar |
| `microsoft-stream/stream-transcript-export.js` | Extrae la transcripción completa de una grabación de Stream/SharePoint | Solo lectura · descarga solo si llamas a `downloadText()`/`downloadJson()` → ver [README](microsoft-stream/README.md) |
| `workday/workday-time-entries-export.js` | Exporta las entradas de tiempo de Workday desde una fecha hasta hoy | Solo lectura (navega semanas) · descarga solo si llamas a `downloadWorkdayJson()`/`downloadWorkdayText()` |

## Requisitos

- Navegador de escritorio (Chrome, Edge o Firefox) con sesión iniciada en la web correspondiente.
- La web en el idioma indicado en cada script (los textos de botones se buscan literalmente).

## Cómo ejecutar cualquiera de ellos

1. Abre la página indicada en la cabecera del script (comentario `Uso:`).
2. Abre DevTools: `Cmd+Option+I` (macOS) o `F12` (Windows/Linux) → pestaña **Console**.
3. Copia el contenido del fichero. En macOS: `pbcopy < <RUTA_AL_FICHERO>` (`pbcopy` copia al portapapeles lo que recibe por la entrada estándar; `<` le pasa el fichero).
4. Pega en la consola y pulsa Enter. Chrome puede pedirte escribir `allow pasting` la primera vez: es una protección contra pegar código ajeno; escríbelo y vuelve a pegar.
5. No cambies de pestaña ni hagas scroll mientras trabaja.

## Configuración (variables)

Los scripts no usan variables de entorno: cada uno tiene un objeto `CONFIG` o `SETTINGS` al principio con comentarios `← CAMBIAR`.

| Script | Clave | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|---|
| `linkedin-saved-posts-export.js` | `textoVerMas`, `textoMostrarMas` | No | Textos de los botones "Ver más" / "Mostrar más resultados" | Cámbialos si LinkedIn está en otro idioma (ej. `See more`, `/Show more results/i`) |
| `linkedin-reactions-export.js` | `prefijoMenu`, `textoCopiarEnlace`, `textoVerPublicacion`, `textoMas`, `prefijoReaccion`, `prefijoVisibilidad` | No | Textos y `aria-label` (etiqueta de accesibilidad) de la interfaz en español | Inspecciona el botón con DevTools → Inspector si tu interfaz es otra |
| `linkedin-reactions-export.js` | `esperaLoteMs`, `esperasMaximas` | No | Cuánto espera a un lote nuevo tras el scroll (15000 ms) y cuántas esperas seguidas sin tarjetas nuevas antes de terminar (3) | Súbelos si LinkedIn tarda en cargar y la exportación se corta antes de tiempo |
| ambos LinkedIn | `prefijoArchivo` | No | Prefijo del nombre de los ficheros descargados | Libre |
| `stream-transcript-export.js` | `waitMs`, `maxSteps`, `bottomChecks` | No | Ritmo y límites del scroll | Ver [README de Stream](microsoft-stream/README.md) |
| `workday-time-entries-export.js` | `since` | **Sí** | Primer día a exportar (`YYYY-MM-DD`) | El periodo que quieras revisar |
| `workday-time-entries-export.js` | `waitMs` | No | Ms de espera tras cambiar de semana (1500) | Súbelo si Workday va lento y salen semanas vacías |
| `workday-time-entries-export.js` | `maxWeeks` | No | Límite de semanas (52) | Súbelo para rangos mayores de un año |

## Ejemplos de uso

Workday — exportar desde el 1 de marzo:

```js
// 1. Edita la línea de SETTINGS antes de pegar:  since: "<YYYY-MM-DD>",
// 2. Pega el script en Time → Week. Cuando termine:
downloadWorkdayJson()
downloadWorkdayText()
```

LinkedIn — abre `https://www.linkedin.com/my-items/saved-posts/` (guardados) o `https://www.linkedin.com/in/<TU_PERFIL>/recent-activity/reactions/` (reacciones), pega el script y espera a las dos descargas.

## Limitaciones

- Dependen de selectores del DOM (`data-automation-id`, clases CSS, `aria-label`) que cada web puede cambiar sin aviso. Si un script deja de encontrar elementos, inspecciona la página y ajusta el selector.
- LinkedIn: la fecha es la relativa que muestra la web ("2 sem"), no una fecha absoluta.
- LinkedIn reacciones: termina tras 3 esperas seguidas de 15 s sin lote nuevo (unos 45 s al final). El campo `fin` del JSON dice por qué terminó (`interrumpido` = hubo un error; revisa `errores`). Si alguna publicación sale con `url_post: null`, el aviso "Ver publicación" no apareció a tiempo.
- Workday: cada tarjeta se asigna a un día según su posición horizontal; si la ventana es muy estrecha o el calendario no está en vista semanal, puede salir `date: "unknown"` (esas entradas se descartan).
