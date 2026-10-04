// stream-transcript-export.js — Extrae la transcripción completa de una grabación de Microsoft Stream/SharePoint.
//
// Qué hace:     Recorre con scroll el panel "Transcript" de la grabación, acumulando cada intervención
//               antes de que desaparezca del DOM virtualizado (solo se pintan las filas visibles).
//               Deja los datos en window.streamTranscriptExport y ofrece funciones de descarga TXT/JSON.
// Requisitos:   Navegador de escritorio con acceso a la grabación. Panel Transcript abierto, búsqueda
//               del panel vacía y vídeo en pausa.
// Uso:          Pega el script completo en DevTools → Console y pulsa Enter. Al terminar:
//                 streamTranscriptExport.downloadText()   // descarga .txt
//                 streamTranscriptExport.downloadJson()   // descarga .json
//                 streamTranscriptExport.stop()           // parar antes (conserva lo capturado)
// Variables:    SETTINGS (abajo): waitMs, maxSteps, bottomChecks.
// Efectos:      SOLO LECTURA: no hace peticiones propias ni modifica la grabación (solo hace scroll).
//               ESCRIBE: descargas en la carpeta del navegador SOLO cuando llamas a download*().
// Salida:       <título de la página>-transcripcion.txt / .json
(async () => {
  'use strict';
  // waitMs: espera tras cada scroll (← CAMBIAR a 1500+ si se pierden filas)
  // maxSteps: límite de seguridad de pasos de scroll · bottomChecks: comprobaciones seguidas al final antes de dar por terminado
  const SETTINGS = { waitMs: 900, maxSteps: 4000, bottomChecks: 8 };
  const previous = window.streamTranscriptExport;
  if (previous?.running) {
    console.warn('Ya hay una extracción activa. Usa streamTranscriptExport.stop().');
    return;
  }
  // Cada intervención del panel es un elemento sub-entry-* dentro de entryRenderer.
  const selector = '[data-testid="entryRenderer"] [id^="sub-entry-"]';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const records = new Map();
  let requestedStop = false;
  const state = window.streamTranscriptExport = {
    running: true,
    status: 'iniciando',
    messages: [],
    expectedCount: null,
    missingPositions: [],
    stop() { requestedStop = true; },
    downloadText() { download('txt', state.messages.map(m => `${m.speakerAndTime}\n${m.text}`).join('\n\n')); },
    downloadJson() {
      download('json', JSON.stringify({
        title: document.title, exportedAt: new Date().toISOString(),
        status: state.status, expectedCount: state.expectedCount,
        missingPositions: state.missingPositions, messages: state.messages
      }, null, 2));
    }
  };
  function download(extension, content) {
    const blob = new Blob([content], { type: extension === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = (document.title || 'transcripcion').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120);
    a.download = `${name}-transcripcion.${extension}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function nodes() { return [...document.querySelectorAll(selector)]; }
  function capture() {
    for (const node of nodes()) {
      const text = (node.innerText || node.textContent || '').trim();
      if (!text) continue;
      const group = node.closest('[role="group"]');
      const speakerAndTime = clean(group?.getAttribute('aria-label') ||
        group?.querySelector('[id^="timestampSpeakerAriaLabel-"]')?.textContent);
      const position = Number(node.getAttribute('aria-posinset')) || null;
      const expected = Number(node.getAttribute('aria-setsize'));
      if (expected > 0) state.expectedCount = Math.max(state.expectedCount || 0, expected);
      const key = position !== null ? `position:${position}` : node.id || `${speakerAndTime}|${text}`;
      records.set(key, { id: node.id, position, speakerAndTime, text });
    }
    state.messages = [...records.values()].sort((a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  }
  function findPane() {
    for (let element = nodes()[0]?.parentElement; element && element !== document.body; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight + 2 &&
          /auto|scroll|overlay/.test(getComputedStyle(element).overflowY)) return element;
    }
    return null;
  }
  function move(pane, top) {
    pane.scrollTop = top;
    pane.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
  try {
    if (!nodes().length) throw new Error('No se encuentran intervenciones. Abre Transcript y ejecuta el script en el contexto de la página que contiene ese panel.');
    let pane = findPane();
    if (!pane) throw new Error('No se encuentra un panel con scroll. Amplía la transcripción o comprueba que contiene suficientes intervenciones para desplazarse.');
    // Start at the beginning: virtualized rows must be captured before they disappear.
    move(pane, 0);
    await sleep(SETTINGS.waitMs * 2);
    state.status = 'recorriendo';
    let stableBottom = 0;
    let reachedEnd = false;
    for (let step = 0; step < SETTINGS.maxSteps && !requestedStop; step++) {
      if (!pane.isConnected) {
        pane = findPane();
        if (!pane) throw new Error('Teams reemplazó el panel y no se ha podido localizar de nuevo.');
      }
      const beforeCount = records.size;
      capture();
      const beforeTop = pane.scrollTop;
      const beforeHeight = pane.scrollHeight;
      move(pane, beforeTop + Math.max(1, Math.floor(pane.clientHeight * 0.65)));
      await sleep(SETTINGS.waitMs);
      capture();
      const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4;
      const unchanged = records.size === beforeCount && Math.abs(pane.scrollTop - beforeTop) < 2 && pane.scrollHeight === beforeHeight;
      stableBottom = atBottom && unchanged ? stableBottom + 1 : 0;
      if (step % 20 === 0) console.info(`Transcripción: ${records.size} intervenciones capturadas.`, { expectedCount: state.expectedCount });
      if (stableBottom >= SETTINGS.bottomChecks) { reachedEnd = true; break; }
      if (!atBottom && unchanged && step > 0) {
        throw new Error('El panel ha dejado de avanzar antes de llegar al final. Los datos parciales siguen disponibles.');
      }
    }
    capture();
    state.status = requestedStop ? 'detenido: exportación parcial' : reachedEnd ? 'fin del panel alcanzado' : 'límite de pasos: exportación parcial';
    if (state.expectedCount && state.expectedCount <= 100000) {
      const positions = new Set(state.messages.map(m => m.position));
      state.missingPositions = Array.from({ length: state.expectedCount }, (_, i) => i + 1).filter(p => !positions.has(p));
      if (state.missingPositions.length) {
        state.status += ' (hay posiciones ARIA sin capturar; revisar integridad)';
        console.warn('El total ARIA puede incluir filas de sistema. Revisa las posiciones ausentes en streamTranscriptExport.missingPositions.');
      }
    }
    console.info(`${state.status}. ${state.messages.length} intervenciones.`,
      '\nDescargar TXT: streamTranscriptExport.downloadText()',
      '\nDescargar JSON: streamTranscriptExport.downloadJson()');
  } catch (error) {
    state.status = `error: ${error.message}`;
    console.error(error.message, 'Datos parciales: streamTranscriptExport.messages');
  } finally {
    state.running = false;
  }
})();
