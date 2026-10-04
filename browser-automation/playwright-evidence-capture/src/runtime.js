/**
 * runtime.js — estado de la ejecución en curso (carpeta del run y marcas de fecha).
 *
 * Qué hace:     Cada `npm run capture` crea un subdirectorio único bajo outputDir con
 *               la marca de tiempo de inicio (p.ej. output/2026-07-02_10-30-22/).
 *               Dentro cuelgan las evidencias por entorno y sección. Módulo "singleton":
 *               capture.js llama a initRun() una vez y el resto lee getRunDir().
 * Requisitos:   Node.js >= 18.
 * Uso:          import { initRun, getRunDir, dateStamp } from './runtime.js';
 * Variables:    Ninguna (usa CONFIG.outputDir).
 * Efectos:      Ninguno (no crea carpetas; las crean los helpers al guardar).
 * Salida:       Funciones runIdNow, dateStamp, initRun, getRunDir y RUN_ID_PATTERN.
 */

import { join } from 'path';
import { CONFIG } from './config.js';

let runDir = CONFIG.outputDir;

/** Patrón de los run-id que genera runIdNow(): YYYY-MM-DD_HH-MM-SS. */
export const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');

/** Timestamp ordenable y seguro para nombre de carpeta: "2026-07-02_10-30-22". */
export function runIdNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Fecha ISO corta para nombrar el informe: "2026-07-02". */
export function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function initRun(runId = runIdNow()) {
  runDir = join(CONFIG.outputDir, runId);
  return runDir;
}

export function getRunDir() {
  return runDir;
}
