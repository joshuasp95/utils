/**
 * utils.js — helpers de navegación, captura y plantillas, compartidos por las secciones.
 *
 * Qué hace:     gotoSettle (navegar y esperar a que la SPA se asiente), shot (captura
 *               full-page), dumpTable (texto de tablas a .txt), withPage (abre/cierra
 *               una pestaña), interpolate (sustituye {{env.x}} / {{$VAR}} en la config),
 *               azureResourceUrl (URL directa a un recurso en un portal tipo Azure).
 *               Todo es "best-effort": ante un fallo se registra y se continúa; nunca
 *               se aborta la ejecución completa. Correctitud de evidencias > completitud.
 * Requisitos:   Node.js >= 18; un Page de Playwright para los helpers de navegación.
 * Uso:          import { gotoSettle, shot, dumpTable, withPage } from '../utils.js';
 * Variables:    CONFIG.timeouts (vía config.js). interpolate() lee process.env.
 * Efectos:      ESCRIBE en local: PNG y TXT dentro de la carpeta del run.
 * Salida:       Funciones exportadas.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { CONFIG } from './config.js';

/**
 * Navega y espera a que la SPA se asiente: domcontentloaded + networkidle (best-effort)
 * + pausa fija `settle`. Las SPAs pesadas (consolas cloud, Kibana...) casi nunca
 * llegan a networkidle pleno, por eso la pausa fija es la barrera final.
 */
export async function gotoSettle(page, url, { settle = CONFIG.timeouts.settle, log } = {}) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.navigation });
  } catch (e) {
    log?.(`    ! goto falló ${url}: ${e.message}`);
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: CONFIG.timeouts.networkIdle });
  } catch { /* SPAs que nunca quedan idle: seguimos */ }
  await page.waitForTimeout(settle);
}

/**
 * Captura full-page (contenido de la página, no la barra del navegador: no salen
 * URLs con tokens). Crea la carpeta si no existe. Devuelve la ruta del PNG.
 */
export async function shot(page, dir, name, log = console.warn) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch (e) {
    log(`    ! screenshot falló [${name}]: ${e.message}`);
  }
  return file;
}

/**
 * Volcado best-effort del texto de las filas de tabla visibles (`table tbody tr`)
 * a <name>.txt, como ayuda para redactar el informe sin releer la captura píxel a
 * píxel. Si no hay tabla o falla, no pasa nada. Solo lee texto visible: nunca
 * cookies, localStorage ni tokens.
 */
export async function dumpTable(page, dir, name, log) {
  try {
    const rows = await page.locator('table tbody tr').allInnerTexts();
    if (!rows.length) return;
    await mkdir(dir, { recursive: true });
    const body = rows.map((r) => r.replace(/\s+\n/g, '\n').trim()).join('\n---\n');
    await writeFile(join(dir, `${name}.txt`), body, 'utf8');
  } catch (e) {
    log?.(`    ! dumpTable ${name}: ${e.message}`);
  }
}

/** Abre una pestaña nueva, ejecuta fn(page) y la cierra siempre (aunque fn falle). */
export async function withPage(context, fn) {
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/** "Mi Recurso/1" => "mi-recurso-1" (seguro para nombres de fichero). */
export const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "a,b" => ['a','b']; un array se devuelve tal cual; vacío => []. */
export function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Sustituye marcadores en las opciones de una sección (recorre strings, arrays y objetos):
 *   {{env.<campo>}}          campo del entorno actual (ENVIRONMENTS[<env>].<campo>).
 *                            Si el string es SOLO ese marcador, se devuelve el valor
 *                            tal cual (útil para listas: "resources": "{{env.apps}}").
 *   {{$VAR}}                 variable de entorno del proceso (vacío si no existe).
 *   {{$VAR:-defecto}}        variable de entorno o, si está vacía, "defecto".
 */
export function interpolate(value, env = {}) {
  if (Array.isArray(value)) return value.map((v) => interpolate(v, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, env)]));
  }
  if (typeof value !== 'string') return value;

  const whole = value.match(/^\{\{\s*env\.([\w-]+)\s*\}\}$/);
  if (whole) return env?.[whole[1]] ?? '';

  return value.replace(/\{\{\s*(\$?)([\w.-]+?)(?::-([^}]*))?\s*\}\}/g, (_, isVar, key, def = '') => {
    if (isVar) return process.env[key] || def;
    if (key.startsWith('env.')) {
      const v = env?.[key.slice(4)];
      return v === undefined || v === null || v === '' ? def : String(v);
    }
    return def;
  });
}

/**
 * URL directa a un recurso en un portal con rutas tipo Azure Resource Manager.
 * Con subscriptionId: URL directa (más fiable que el buscador del portal, que carga
 * de forma asíncrona). Sin subscriptionId: URL de búsqueda por nombre del recurso.
 *
 * Formato del fragmento (#) del portal:
 *   Con tenant:  #@<tenantId>/resource/subscriptions/<sub>/...
 *   Sin tenant:  #resource/subscriptions/<sub>/...        (nunca "#@/" vacío)
 */
export function azureResourceUrl({ portalUrl = 'https://portal.azure.com', tenantId, subscriptionId, resourceGroup, provider, resourceType, resourceName }) {
  if (subscriptionId) {
    const tenantPrefix = tenantId ? `@${tenantId}/` : '';
    const base = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
    const tail = resourceName ? `/providers/${provider}/${resourceType}/${resourceName}` : '/overview';
    return `${portalUrl}/#${tenantPrefix}resource${base}${tail}`;
  }
  return `${portalUrl}/#search=${encodeURIComponent(resourceName || resourceGroup || '')}`;
}
