// time-type-record.js — Normaliza una ruta del árbol de Time Types de Workday en un registro.
//
// Qué hace:     Recibe la ruta navegada (ej. ['Project Plan Tasks', 'Proyecto', 'Fase', 'Hoja'])
//               y devuelve categoría, ruta completa, etiqueta original y el tipo "estable"
//               (sin el sufijo de fechas "(Starts: ...)" que Workday añade a algunas hojas).
// Uso:          import { record } from './time-type-record.js';
// Efectos:      Función pura, sin efectos.
//
// Workday devuelve hojas con su jerarquía completa incluso al navegar el árbol
// (la etiqueta de la hoja ya puede ser "Proyecto > Fase > Hoja"); en ese caso no se duplica.
export function record(path, kind) {
  const category = path[0];
  const rest = path.length > 1 ? path.slice(1) : path;
  const label = path.at(-1);
  const fullType = kind === 'leaf' && label.includes(' > ') ? label : rest.join(' > ');
  const stable = fullType.replace(/\s*\((?:Starts:|Ends:|\d{2}\/\d{2}\/\d{4})[^)]*\)\s*$/, '').trim();
  return {
    category,
    path: fullType.split(' > '),
    navigation_path: path,
    raw_label: label,
    full_type_with_dates: fullType,
    confirmed_full_type: kind === 'leaf' ? stable : null,
    kind,
  };
}
