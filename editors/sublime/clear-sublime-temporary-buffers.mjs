#!/usr/bin/env node
// clear-sublime-temporary-buffers.mjs — Elimina de la sesión de Sublime Text todas las pestañas temporales (sin guardar).
//
// Qué hace:     Lee el fichero de sesión de Sublime (JSON), quita de cada ventana los buffers que no
//               tienen fichero en disco (notas "Untitled") y las pestañas (sheets) que los mostraban,
//               reindexa las pestañas restantes y reescribe la sesión.
// Requisitos:   Node.js 16+. Sublime Text CERRADO (si está abierto, al salir reescribe la sesión y
//               deshace el cambio, o peor, pisa tu edición).
// Uso:          cp "<RUTA_SESION>" "<RUTA_SESION>.bak"       # copia de seguridad, MUY recomendable
//               node clear-sublime-temporary-buffers.mjs "<RUTA_SESION>"
//               macOS: <RUTA_SESION> = "$HOME/Library/Application Support/Sublime Text/Local/Session.sublime_session"
// Variables:    session-path (1er arg, obligatorio) ruta del fichero .sublime_session.
// Efectos:      ESCRIBE: SOBRESCRIBE el fichero de sesión (vía temporal + rename atómico, modo 0600).
//               El contenido de las notas temporales se PIERDE: extráelas antes con
//               extract-sublime-notes.mjs y haz copia de la sesión.
// Salida:       JSON por stdout: { removedBuffers, removedSheets, retainedBuffers }.
import fs from 'node:fs';

const [sessionPath] = process.argv.slice(2);
if (!sessionPath) {
  throw new Error('Usage: node clear-sublime-temporary-buffers.mjs <session-path>');
}

const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
let removedBuffers = 0;
let removedSheets = 0;
let retainedBuffers = 0;

for (const window of session.windows ?? []) {
  const originalBuffers = window.buffers ?? [];
  const retained = [];
  const indexMap = new Map();

  // indexMap: índice antiguo del buffer → índice nuevo tras quitar los temporales.
  originalBuffers.forEach((buffer, oldIndex) => {
    if (buffer.file) {
      indexMap.set(oldIndex, retained.length);
      retained.push(buffer);
    } else {
      removedBuffers += 1;
    }
  });

  window.buffers = retained;
  retainedBuffers += retained.length;

  // Cada pestaña (sheet) apunta a su buffer por índice: se descartan las de buffers eliminados
  // y se actualiza el índice de las demás.
  for (const group of window.groups ?? []) {
    const originalSheets = group.sheets ?? [];
    const retainedSheets = originalSheets
      .filter((sheet) => indexMap.has(sheet.buffer))
      .map((sheet) => ({ ...sheet, buffer: indexMap.get(sheet.buffer) }));
    removedSheets += originalSheets.length - retainedSheets.length;
    group.sheets = retainedSheets;
  }
}

// Escribe en un temporal y lo renombra encima: si algo falla a mitad, la sesión original queda intacta.
const tempPath = `${sessionPath}.clean.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(session, null, 4)}\n`, { mode: 0o600 });
fs.renameSync(tempPath, sessionPath);
fs.chmodSync(sessionPath, 0o600);

process.stdout.write(JSON.stringify({ removedBuffers, removedSheets, retainedBuffers }));
