/**
 * args.js — parser mínimo de argumentos de línea de comandos (sin dependencias).
 *
 * Qué hace:     Convierte process.argv en { opts, positional }. Soporta las dos
 *               formas habituales para que los comandos del README funcionen tal cual:
 *                 --clave=valor   (forma con igual)
 *                 --clave valor   (forma con espacio; consume el siguiente token
 *                                  si no empieza por "-")
 *                 --flag          (booleano => true)
 * Requisitos:   Node.js >= 18.
 * Uso:          import { parseArgs, csv } from './args.js';
 * Variables:    Ninguna.
 * Efectos:      Ninguno (función pura).
 * Salida:       Objeto { opts, positional }.
 */

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        opts[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          opts[body] = next;
          i++;
        } else {
          opts[body] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

/** "dev,prod" => ['dev','prod']; vacío/ausente/flag sin valor => fallback. */
export function csv(value, fallback) {
  if (!value || value === true) return fallback;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}
