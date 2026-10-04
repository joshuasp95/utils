# Extraer una transcripción de Stream/SharePoint

`stream-transcript-export.js` recorre con scroll el panel **Transcript** de una grabación de reunión. Acumula las filas antes de que desaparezcan del DOM virtualizado (la página solo pinta las filas que están en pantalla) y permite descargar texto y JSON. No necesita dependencias ni hace peticiones de red propias; el scroll puede hacer que la página cargue más transcripción normalmente.

| Fichero | Qué hace | Efectos |
|---|---|---|
| `stream-transcript-export.js` | Captura todas las intervenciones del panel Transcript | Solo lectura; descarga ficheros solo cuando llamas a `download*()` |

## Ejecución

1. Abre la grabación en el navegador, pausa el vídeo y abre **Transcript**. Deja vacía la búsqueda de ese panel.
2. Copia el archivo completo. Desde Terminal en macOS (`pbcopy` copia la entrada estándar al portapapeles; `<` le pasa el fichero como entrada):

   ```sh
   pbcopy < <RUTA_AL_REPO>/browser-console/microsoft-stream/stream-transcript-export.js
   ```

3. En Firefox abre las herramientas de desarrollo con `Cmd+Option+I` y selecciona **Console** (no Inspector). En Chrome/Edge también puedes usar **Sources → Snippets**.
4. Pega el script completo y ejecútalo. Si la consola usa edición multilínea, usa su botón de ejecución o `Cmd+Enter`.
5. Mantén la pestaña activa. No cambies la búsqueda, cierres el panel, hagas scroll manual ni reproduzcas el vídeo durante la extracción: la sincronización con el vídeo puede mover el panel. Puede tardar varios minutos.
6. Espera al mensaje `fin del panel alcanzado` y descarga desde Console:

   ```js
   streamTranscriptExport.downloadText()
   streamTranscriptExport.downloadJson()
   ```

Los archivos se guardan mediante el gestor de descargas del navegador. No se descargan automáticamente.

## Configuración

Objeto `SETTINGS` al principio del script:

| Clave | Por defecto | Qué es |
|---|---|---|
| `waitMs` | `900` | Milisegundos de espera tras cada paso de scroll. Súbelo (1500+) si faltan filas. |
| `maxSteps` | `4000` | Límite de seguridad de pasos de scroll. Si se alcanza, la exportación se marca como parcial. |
| `bottomChecks` | `8` | Comprobaciones seguidas "al final y sin cambios" antes de dar el panel por terminado. |

## Control y verificación

```js
streamTranscriptExport.messages.length // Número de intervenciones acumuladas
streamTranscriptExport.status          // Estado y posibles errores
streamTranscriptExport.stop()          // Parar; conserva lo capturado
streamTranscriptExport.missingPositions // Posiciones ARIA no capturadas
```

Las descargas también funcionan tras una parada o un error, pero serán parciales. Ejecutar de nuevo el script tras terminar inicia una extracción nueva.

Comprueba el principio y el final del archivo contra el panel. Si hay posiciones ausentes, revisa el JSON: `aria-setsize` (atributo de accesibilidad con el total de filas de la lista) puede contar también filas del sistema, por lo que el número anunciado no garantiza por sí solo una transcripción completa. Si hay errores o lagunas, vuelve a ejecutarlo con `waitMs: 1500` o más.

## Alcance

- Extrae texto de la transcripción y la etiqueta de hablante/tiempo que expone la página. Conserva esa etiqueta sin intentar interpretar su idioma.
- No extrae el chat, el vídeo ni los adjuntos; no modifica la grabación.
- Basado en el DOM observado en septiembre de 2026: `entryRenderer`, `sub-entry-*`, `role="group"` y atributos ARIA. Si Microsoft cambia esos selectores, habrá que adaptarlo.
- Solo obtiene el contenido que tu sesión puede mostrar. No cambia permisos ni habilita la descarga nativa desactivada.
