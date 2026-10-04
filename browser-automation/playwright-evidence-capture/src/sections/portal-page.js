/**
 * portal-page.js — sección de ejemplo: capturas de páginas de un portal web genérico.
 *
 * Qué hace:     Ejecuta en orden una lista de "pasos" sobre una misma pestaña:
 *                 page            navega a una URL y hace captura (+ tabla opcional).
 *                 search          escribe un término en un buscador y captura resultados
 *                                 (+ primer resultado de detalle, opcional).
 *                 menu            entra en una vista y recorre enlaces del menú por su
 *                                 texto visible (para apps cuyo ID va en la URL y cambia).
 *                 discover-links  extrae de la página los enlaces que cumplen un patrón
 *                                 y captura cada uno (listas de recursos con IDs dinámicos).
 *               Cada paso es best-effort: si un click o selector falla, se captura lo
 *               que haya en pantalla y se sigue.
 * Requisitos:   Sesión iniciada en el perfil de la sección (npm run login -- <perfil>).
 * Uso:          { "id": "01-portal", "type": "portal-page", "profile": "sso",
 *                 "options": { "steps": [ { "type": "page", "name": "01-landing",
 *                                           "url": "{{env.portalUrl}}" } ] } }
 * Variables:    Las URLs/selectores llegan por config (con {{env.x}} / {{$VAR}}).
 * Efectos:      SOLO LECTURA en el portal (navega, escribe en un buscador, hace clic
 *               en enlaces de menú; no envía formularios de cambio).
 *               ESCRIBE en local: <dir>/NN-*.png y NN-*.txt.
 * Salida:       PNG/TXT en output/<run>/<ENV>/<id-sección>/.
 */

import { gotoSettle, shot, dumpTable, withPage, slug } from '../utils.js';
import { CONFIG } from '../config.js';

export const type = 'portal-page';

/** URL(s) que login.js abre para esta sección: loginUrl o la del primer paso. */
export function loginUrls(options) {
  return [options.loginUrl || options.steps?.find((s) => s.url)?.url].filter(Boolean);
}

async function stepPage(page, step, ctx) {
  await gotoSettle(page, step.url, { log: ctx.log, settle: step.settleMs });
  await shot(page, ctx.dir, step.name, ctx.log);
  if (step.dumpTable) await dumpTable(page, ctx.dir, step.name, ctx.log);
  ctx.log(`  [${ctx.label}] ${step.name}`);
}

/** Buscador: input → término → Enter → captura; opcionalmente abre el primer resultado. */
async function stepSearch(page, step, ctx) {
  await gotoSettle(page, step.url, { log: ctx.log, settle: step.settleMs });
  try {
    const box = page.locator(step.inputSelector || 'input[type="search"]').first();
    await box.waitFor({ timeout: CONFIG.timeouts.element });
    await box.click();
    await box.fill(step.term ?? '');
    await box.press('Enter');
    await page.waitForTimeout(step.waitMs ?? 3_000);
    await shot(page, ctx.dir, step.name, ctx.log);
    ctx.log(`  [${ctx.label}] ${step.name}`);

    if (step.resultSelector) {
      const first = page.locator(step.resultSelector).first();
      if (await first.count()) {
        await first.click({ timeout: CONFIG.timeouts.element });
        await page.waitForTimeout(2_000);
        const detail = step.detailName || `${step.name}-detail`;
        await shot(page, ctx.dir, detail, ctx.log);
        ctx.log(`  [${ctx.label}] ${detail}`);
      }
    }
  } catch (e) {
    ctx.log(`  [${ctx.label}] búsqueda no automatizable: ${e.message}`);
    await shot(page, ctx.dir, `${step.name}-state`, ctx.log);
  }
}

/** Menú: captura la vista inicial, entra (opcional) y hace clic en cada enlace por texto. */
async function stepMenu(page, step, ctx) {
  await gotoSettle(page, step.url, { log: ctx.log, settle: step.settleMs ?? 4_500 });
  await shot(page, ctx.dir, step.name, ctx.log);
  ctx.log(`  [${ctx.label}] ${step.name}`);

  if (step.enterSelector) {
    try {
      const link = page.locator(step.enterSelector).first();
      await link.waitFor({ timeout: CONFIG.timeouts.element });
      await link.click();
      await page.waitForTimeout(4_000);
    } catch (e) {
      ctx.log(`  [${ctx.label}] no pude entrar (${step.enterSelector}): ${e.message}`);
    }
    if (step.enterName) {
      await shot(page, ctx.dir, step.enterName, ctx.log);
      if (step.dumpTable) await dumpTable(page, ctx.dir, step.enterName, ctx.log);
    }
  }

  for (const { name, label } of step.links ?? []) {
    try {
      await page.getByRole('link', { name: label, exact: false }).first().click({ timeout: CONFIG.timeouts.element });
      await page.waitForTimeout(step.waitMs ?? 3_500);
    } catch (e) {
      ctx.log(`  [${ctx.label}] nav "${label}" falló: ${e.message}`);
    }
    await shot(page, ctx.dir, name, ctx.log);
    if (step.dumpTable) await dumpTable(page, ctx.dir, name, ctx.log);
    ctx.log(`  [${ctx.label}] ${name}`);
  }
}

/**
 * Descubre enlaces de detalle en una lista (p.ej. /deployments/<id-hex>) en vez de
 * mantener los IDs a mano en la config: se quedan los href que cumplen hrefPattern.
 */
async function stepDiscoverLinks(page, step, ctx) {
  await gotoSettle(page, step.url, { log: ctx.log, settle: step.settleMs ?? 5_000 });
  await shot(page, ctx.dir, step.name, ctx.log);
  ctx.log(`  [${ctx.label}] ${step.name}`);

  let hrefs = [];
  try {
    const all = await page.locator(step.linkSelector || 'a[href]').evaluateAll(
      (els) => [...new Set(els.map((e) => e.getAttribute('href')).filter(Boolean))],
    );
    const re = new RegExp(step.hrefPattern || '.');
    hrefs = all.filter((h) => re.test(h)).slice(0, step.max ?? 20);
  } catch (e) {
    ctx.log(`  ! [${ctx.label}] no pude extraer enlaces: ${e.message}`);
  }
  if (!hrefs.length) ctx.log(`  ! [${ctx.label}] sin enlaces que cumplan el patrón — solo queda la captura de la lista.`);

  const base = page.url();
  for (let i = 0; i < hrefs.length; i++) {
    const href = hrefs[i];
    const idx = String(i + 1).padStart(2, '0');
    const name = `${step.name}-${idx}-${slug(href.split('/').filter(Boolean).pop() ?? '').slice(0, 12)}`;
    await gotoSettle(page, new URL(href, base).toString(), { log: ctx.log, settle: step.settleMs ?? 5_000 });
    await shot(page, ctx.dir, name, ctx.log);
    ctx.log(`  [${ctx.label}] ${name}`);
  }
}

const STEPS = {
  page: stepPage,
  search: stepSearch,
  menu: stepMenu,
  'discover-links': stepDiscoverLinks,
};

export async function capture({ context, env, dir, options, log, sectionId }) {
  const label = `${env?.name ?? 'SHARED'}/${sectionId}`;
  // Pasos sin URL (variable de entorno vacía, campo no definido en ese entorno) => skip.
  const steps = (options.steps ?? []).filter((s) => s.url);
  if (!steps.length) { log(`[${label}] sin URL configurada — skip`); return; }

  await withPage(context, async (page) => {
    for (const step of steps) {
      const fn = STEPS[step.type || 'page'];
      if (!fn) { log(`  [${label}] tipo de paso desconocido: ${step.type} — skip`); continue; }
      try {
        await fn(page, step, { dir, log, label });
      } catch (e) {
        log(`  ! [${label}] paso ${step.name} falló: ${e.message}`);
      }
    }
  });
}
