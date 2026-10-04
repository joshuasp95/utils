/**
 * dashboard-time-range.js — sección de ejemplo: vistas de una herramienta de dashboards
 * (tipo Kibana o Grafana) con un rango temporal fijado en la URL.
 *
 * Qué hace:     Para cada vista configurada construye la URL
 *               (baseUrl + /s/<space> opcional + path, o una url completa), le añade el
 *               rango temporal en el formato de la herramienta y hace captura.
 *               Así el monthly check ve "los últimos 30 días" sin tocar el selector
 *               de fechas de la UI (que es frágil de automatizar).
 * Requisitos:   Sesión iniciada en el perfil de la sección (npm run login -- <perfil>).
 * Uso:          { "id": "02-dashboard", "type": "dashboard-time-range", "profile": "dashboards",
 *                 "options": { "baseUrl": "{{env.dashboardUrl}}", "timeRangeStyle": "kibana",
 *                              "timeRange": { "from": "now-30d", "to": "now" },
 *                              "views": [ { "name": "01-discover", "path": "/app/discover" } ] } }
 * Variables:    baseUrl/space/views por config. timeRangeStyle:
 *                 kibana   añade _g=(time:(from:<from>,to:<to>))   (estado global de Kibana)
 *                 grafana  añade from=<from>&to=<to>                (query params de Grafana)
 *                 none     no toca la URL
 * Efectos:      SOLO LECTURA en la herramienta. ESCRIBE en local: <dir>/NN-*.png (+ .txt).
 * Salida:       PNG/TXT en output/<run>/<ENV>/<id-sección>/.
 *
 * Nota: el estado de Discover/dashboards (índice, query) va serializado en la URL y
 * cambia entre versiones; las consultas de referencia se documentan en el informe
 * (referenceQueries) para aplicarlas a mano si hace falta.
 */

import { gotoSettle, shot, dumpTable, withPage } from '../utils.js';

export const type = 'dashboard-time-range';

/**
 * Añade el rango temporal a una URL. En Kibana, si la vista usa rutas con "#"
 * (p.ej. dashboards#/view/<id>), el parámetro va en la query del fragmento;
 * en el resto de casos va en la query normal, antes del "#".
 */
export function withTimeRange(url, style, { from = 'now-30d', to = 'now' } = {}) {
  let param;
  if (style === 'kibana') param = `_g=(time:(from:${from},to:${to}))`;
  else if (style === 'grafana') param = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  else return url;

  const hashIdx = url.indexOf('#');
  if (style === 'kibana' && hashIdx !== -1) {
    const hash = url.slice(hashIdx);
    return url + (hash.includes('?') ? '&' : '?') + param;
  }
  const before = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : url.slice(hashIdx);
  return before + (before.includes('?') ? '&' : '?') + param + hash;
}

function viewUrl(options, view) {
  if (view.url) return view.url;
  if (!options.baseUrl) return '';
  const base = options.baseUrl.replace(/\/$/, '');
  const space = options.space ? `/s/${options.space}` : '';
  return `${base}${space}${view.path ?? ''}`;
}

export function loginUrls(options) {
  if (options.loginUrl) return [options.loginUrl];
  const first = (options.views ?? []).map((v) => viewUrl(options, v)).find(Boolean);
  return first ? [first] : [];
}

export async function capture({ context, env, dir, options, log, sectionId }) {
  const label = `${env?.name ?? 'SHARED'}/${sectionId}`;
  const views = (options.views ?? [])
    .map((v) => ({ ...v, fullUrl: viewUrl(options, v) }))
    .filter((v) => v.fullUrl);
  if (!views.length) { log(`[${label}] sin URL configurada — skip`); return; }

  await withPage(context, async (page) => {
    for (const view of views) {
      const url = view.timeRange === false
        ? view.fullUrl
        : withTimeRange(view.fullUrl, options.timeRangeStyle, options.timeRange);
      await gotoSettle(page, url, { log, settle: view.settleMs ?? 5_000 });
      await shot(page, dir, view.name, log);
      if (view.dumpTable) await dumpTable(page, dir, view.name, log);
      log(`  [${label}] ${view.name}`);
    }
  });
}
