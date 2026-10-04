#!/usr/bin/env node
/**
 * extract-time-types.js — Extrae el catálogo de Time Types (tipos de tiempo imputables) de Workday.
 *
 * Qué hace:     Abre Workday en un Chromium controlado por Playwright, entra en Time, abre el
 *               diálogo "Enter Time" del día indicado y recorre en profundidad el selector
 *               jerárquico "Time Type" (categoría raíz > proyecto > fase > hoja). Vuelca todas
 *               las hojas encontradas a JSON + TXT.
 * Requisitos:   Node.js 18+, `npm install` en esta carpeta (instala playwright) y
 *               `npx playwright install chromium` (descarga el navegador) salvo que uses CHROMIUM_PATH.
 *               Cuenta Workday con login SSO (Microsoft Entra ID) o sesión ya guardada.
 * Uso:          node extract-time-types.js
 *               node extract-time-types.js --max-depth=5 --out=out/mi-catalogo
 *               node extract-time-types.js --roots-only          # solo primer nivel (rápido)
 *               node extract-time-types.js --only=<TEXTO>        # solo ramas que contengan ese texto
 *               node extract-time-types.js --debug               # capturas en tmp/debug/ + diagnóstico DOM
 *               node extract-time-types.js --day=<YYYY-MM-DD>    # día donde abrir el diálogo (por defecto hoy)
 *               node extract-time-types.js --config=config.json  # lee workdayUrl/email de un JSON en vez de env
 * Variables:    WORKDAY_URL (obligatoria*): URL de login de tu tenant Workday
 *                 (ej: https://<HOST>.myworkday.com/wday/authgwy/<TENANT>/login.htmld).
 *               WORKDAY_EMAIL (obligatoria*): email corporativo para el SSO.
 *                 *Obligatorias salvo que pases --config=<json> con { "workdayUrl", "email" }.
 *               WORKDAY_PASSWORD (opcional): si existe, se rellena en el login de Microsoft;
 *                 si no, completas el login (y MFA) a mano en la ventana.
 *               WORKDAY_USER_DATA_DIR (opcional): carpeta del perfil persistente del navegador
 *                 (por defecto ./.browser-session junto al script). Guarda cookies → reutiliza sesión.
 *               CHROMIUM_PATH (opcional): ejecutable de Chrome/Chromium; si no, el de Playwright.
 * Efectos:      SOLO LECTURA en Workday: abre el diálogo "Enter Time", navega el desplegable y
 *               cierra con Cancel. Nunca pulsa OK ni guarda nada.
 *               ESCRIBE en local: <out>.json y <out>.txt, el perfil del navegador (WORKDAY_USER_DATA_DIR)
 *               y, con --debug, capturas en tmp/debug/.
 * Salida:       out/time-types-<hoy>[-filter-<texto>][.partial].json / .txt
 *               Código de salida 2 si el resultado es parcial; 1 si hay error.
 */

import { chromium } from 'playwright';
import { navigateToTime, waitForWorkdayHome } from './navigation.js';
import { record } from './time-type-record.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

// ─── Argumentos ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const hasFlag = name => argv.includes(`--${name}`);

if (hasFlag('help')) {
  console.log('Uso: node extract-time-types.js [--day=YYYY-MM-DD] [--only=texto] [--roots-only] [--max-depth=5] [--config=ruta] [--out=ruta] [--debug]');
  console.log('Variables: WORKDAY_URL y WORKDAY_EMAIL (o --config), WORKDAY_PASSWORD, WORKDAY_USER_DATA_DIR, CHROMIUM_PATH (opcionales)');
  process.exit(0);
}
const allowed = new Set(['day', 'only', 'roots-only', 'max-depth', 'config', 'out', 'debug']);
for (const arg of argv) {
  const name = arg.replace(/^--/, '').split('=')[0];
  if (!arg.startsWith('--') || !allowed.has(name) ||
      (['roots-only', 'debug'].includes(name) ? arg.includes('=') : !/^--[^=]+=.+$/.test(arg))) {
    throw new Error(`Argumento no válido: ${arg}. Usa --help.`);
  }
}
const MAX_DEPTH = Number(getArg('max-depth', 5));
if (!Number.isInteger(MAX_DEPTH) || MAX_DEPTH < 1 || MAX_DEPTH > 20) {
  throw new Error('--max-depth debe ser un entero entre 1 y 20');
}
const ROOTS_ONLY = hasFlag('roots-only');
const ONLY = getArg('only', null);           // filtra ramas de primer nivel por substring
const CONFIG_PATH = getArg('config', null);   // opcional: JSON con { workdayUrl, email }
const DEBUG = hasFlag('debug');
// Día en el que se abre el diálogo "Enter Time". Por defecto HOY: Workday puede
// bloquear la entrada de tiempo en periodos futuros aún no abiertos, y entonces
// el clic en el día no abre ningún diálogo.
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const targetDay = getArg('day', localDay(new Date()));
const TARGET_DATE = new Date(`${targetDay}T12:00:00`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay) || Number.isNaN(TARGET_DATE.getTime()) || localDay(TARGET_DATE) !== targetDay) {
  throw new Error('--day debe ser una fecha válida YYYY-MM-DD');
}
// Las celdas solo identifican mes y día; no permiten verificar otro año.
if (TARGET_DATE.getFullYear() !== new Date().getFullYear()) {
  throw new Error('--day debe pertenecer al año actual; el calendario no verifica años');
}
const stamp = localDay(new Date());
const filterSuffix = ONLY ? `-filter-${encodeURIComponent(ONLY)}` : '';
const OUT_BASE = getArg('out', `out/time-types-${stamp}${filterSuffix}`);

// ─── Config: variables de entorno (o un JSON con --config) ───────────────────
// Se lee DESPUÉS de validar los argumentos, para que --help y los errores de
// argumentos funcionen sin configuración.
const fileConfig = CONFIG_PATH ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) : {};
const workdayUrl = process.env.WORKDAY_URL || fileConfig.workdayUrl;
const email = process.env.WORKDAY_EMAIL || fileConfig.email;
if (!workdayUrl || !email) {
  throw new Error('Define WORKDAY_URL y WORKDAY_EMAIL (ver .env.example) o pasa --config=<json> con workdayUrl y email');
}
const password = process.env.WORKDAY_PASSWORD;

// Perfil persistente del navegador: conserva cookies para no repetir el login cada vez.
const USER_DATA_DIR = process.env.WORKDAY_USER_DATA_DIR
  || fileURLToPath(new URL('./.browser-session', import.meta.url));
// undefined → Playwright usa su Chromium descargado con `npx playwright install chromium`.
const EXECUTABLE_PATH = process.env.CHROMIUM_PATH || undefined;

let shotCount = 0;
async function debugShot(page, tag) {
  if (!DEBUG) return;
  mkdirSync('tmp/debug', { recursive: true });
  const path = `tmp/debug/${String(++shotCount).padStart(2, '0')}-${tag}.png`;
  await page.screenshot({ path, fullPage: false }).catch(() => {});
  console.log(`  [debug] captura: ${path}`);
}

// Vuelca qué hay realmente en pantalla cuando algo no aparece.
async function dumpDiagnostics(page, tag) {
  const info = await page.evaluate(() => {
    const visible = el => el.offsetParent !== null;
    const ids = [...document.querySelectorAll('[data-automation-id]')]
      .filter(visible)
      .map(el => el.getAttribute('data-automation-id'));
    const counts = {};
    for (const id of ids) counts[id] = (counts[id] || 0) + 1;
    return {
      origin: location.origin,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible)
        .map(el => (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').slice(0, 120)),
      alerts: [...document.querySelectorAll('[role="alert"]')].filter(visible)
        .map(el => (el.innerText || '').replace(/\s+/g, ' ').slice(0, 200)),
      topAutomationIds: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40),
    };
  }).catch(e => ({ error: e.message }));
  console.error(`\n  [diag:${tag}] ${JSON.stringify(info, null, 2)}\n`);
}

function waitForEnter() {
  let rl, resolveFn;
  const p = new Promise(resolve => {
    resolveFn = resolve;
    rl = createInterface({ input: process.stdin });
    rl.once('line', () => { rl.close(); resolve(); });
  });
  p.cancel = () => { rl.close(); resolveFn(); };
  return p;
}

// ─── Login: SSO SAML → Microsoft Entra ID (email, contraseña opcional, MFA a mano) ─
async function login(page) {
  await page.goto(workdayUrl);
  try {
    const ssoBtn = page.locator('a[href*="login-saml2.htmld"]').first();
    await ssoBtn.waitFor({ timeout: 10_000 });
    await ssoBtn.click();
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('input[type="email"], input[name="loginfmt"], input#i0116').first();
    await emailInput.waitFor({ timeout: 10_000 });
    await emailInput.fill(email);
    await page.locator('input[type="submit"], button:has-text("Next")').first().click();

    if (password) {
      const pw = page.locator('input[type="password"], input[name="passwd"], input#i0118').first();
      await pw.waitFor({ timeout: 10_000 });
      await pw.fill(password);
      await page.locator('input[type="submit"], button:has-text("Sign in")').first().click();
    }
    console.log('Esperando login (se autodetecta, o pulsa Enter cuando termines)...');

    page.locator('[data-testid="btn-skip"]').waitFor({ state: 'visible', timeout: 120_000 })
      .then(() => page.locator('[data-testid="btn-skip"]').click()).catch(() => {});

    const enterPromise = waitForEnter();
    waitForWorkdayHome(page)
      .then(() => { console.log('  Login detectado.'); enterPromise.cancel(); })
      .catch(() => {});
    await enterPromise;
  } catch {
    console.log('Comprobando si existe una sesión válida...');
    await waitForWorkdayHome(page, 60_000);
  }
}

// ─── Navegación a Time y apertura del diálogo ────────────────────────────────
async function currentShownMonth(page) {
  const ids = await page.locator('[data-automation-id^="calendarDateCell-"]')
    .evaluateAll(els => els.map(e => e.getAttribute('data-automation-id')).filter(Boolean));
  const counts = new Map();
  for (const id of ids) {
    const m = id.match(/^calendarDateCell-(\d{1,2})-(\d{1,2})$/);
    if (!m) continue;
    const month = Number(m[1]);
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// Navega el calendario (prev/next) hasta el mes indicado (0 = enero).
async function clickCalNav(page, dir) {
  const sel = dir === 'prev'
    ? '[data-automation-id="navigateBackwardButton"], button[aria-label*="previous" i], button[title*="previous" i], button[aria-label*="anterior" i]'
    : '[data-automation-id="navigateForwardButton"], button[aria-label*="next" i], button[title*="next" i], button[aria-label*="siguiente" i]';
  const btn = page.locator(sel).filter({ visible: true }).first();
  if (await btn.count() === 0) throw new Error(`Botón de calendario "${dir}" no encontrado`);
  const before = await page.locator('[data-automation-id^="calendarDateCell-"]')
    .evaluateAll(els => els.map(e => e.getAttribute('data-automation-id')).join('|'));
  await btn.click();
  await page.waitForFunction(prev => {
    const now = [...document.querySelectorAll('[data-automation-id^="calendarDateCell-"]')]
      .map(e => e.getAttribute('data-automation-id')).join('|');
    return now && now !== prev;
  }, before, { timeout: 30_000 });
}

async function ensureMonthView(page, targetMonth) {
  let cur = await currentShownMonth(page);
  if (cur == null) throw new Error('No se detecta el mes mostrado en el calendario');
  let guard = 0;
  while (cur !== targetMonth && guard++ < 14) {
    await clickCalNav(page, targetMonth < cur ? 'prev' : 'next');
    cur = await currentShownMonth(page);
  }
  if (cur !== targetMonth) throw new Error(`No se pudo navegar al mes ${targetMonth}`);
  console.log(`  calendario en mes índice ${cur}`);
}

const DIALOG_SEL = '[data-automation-id="popUpDialog"], [role="dialog"]';

// El buscador de Time Type es el <input> con data-uxi-widget-type="selectinput",
// dentro de un multiSelectContainer. Aceptamos varios ids por si Workday cambia uno.
const SEARCH_SEL = [
  '[data-uxi-widget-type="selectinput"]',
  '[data-automation-id="searchBox"]',
  '[data-automation-id="multiSelectContainer"] input',
  '[data-automation-id="monikerSearchBox"] input',
].join(', ');

// Puede haber varios [role="dialog"] visibles a la vez; nos quedamos con el que
// realmente contiene el buscador, y preferimos siempre popUpDialog si existe.
async function resolveDialog(page) {
  const byId = page.locator('[data-automation-id="popUpDialog"]').filter({ visible: true }).first();
  if (await byId.count() > 0 && await byId.locator(SEARCH_SEL).count() > 0) return byId;

  const withSearch = page.locator('[role="dialog"]')
    .filter({ visible: true, has: page.locator(SEARCH_SEL) }).first();
  if (await withSearch.count() > 0) return withSearch;

  if (await byId.count() > 0) return byId;
  return page.locator(DIALOG_SEL).filter({ visible: true }).first();
}

async function openEnterTimeDialog(page, date) {
  const monthIndex = date.getMonth();
  const dayNumber = date.getDate();
  const cellSel = `[data-automation-id="calendarDateCell-${monthIndex}-${dayNumber}"]`;
  console.log(`Abriendo "Enter Time" en ${date.toISOString().slice(0, 10)} (celda ${cellSel})...`);

  const cell = page.locator(cellSel).first();
  if (await cell.count() === 0) {
    await dumpDiagnostics(page, 'celda-no-encontrada');
    throw new Error(`No existe la celda ${cellSel}. ¿El calendario muestra otro mes?`);
  }
  await cell.waitFor({ state: 'visible', timeout: 15_000 });
  await cell.scrollIntoViewIfNeeded();

  // Workday no siempre reacciona al mismo elemento: probamos label, celda y
  // doble clic antes de rendirnos.
  const attempts = [
    ['label', () => page.locator(`${cellSel} [data-automation-id="calendarDateLabel"]`).first().click()],
    ['celda', () => cell.click()],
    ['doble clic celda', () => cell.dblclick()],
  ];

  for (const [name, doClick] of attempts) {
    console.log(`  intento: clic en ${name}`);
    await doClick().catch(e => console.log(`    clic falló: ${e.message.split('\n')[0]}`));
    try {
      await page.locator(DIALOG_SEL).filter({ has: page.locator(SEARCH_SEL) }).locator(SEARCH_SEL).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 8_000 });
      console.log('  diálogo abierto.');
      await debugShot(page, 'dialogo-abierto');
      return await resolveDialog(page);
    } catch {
      console.log('    sin diálogo tras este intento');
    }
  }

  await debugShot(page, 'sin-dialogo');
  await dumpDiagnostics(page, 'sin-dialogo');
  throw new Error(
    `El clic en ${date.toISOString().slice(0, 10)} no abrió ningún diálogo. ` +
    'Causa típica: ese periodo no admite entrada de tiempo (futuro no abierto o semana ya aprobada). ' +
    'Prueba otro día: --day=YYYY-MM-DD'
  );
}

// ─── Lectura del dropdown ────────────────────────────────────────────────────
// Devuelve las filas actualmente renderizadas del nivel abierto.
//
// OJO con el DOM de Workday: el contenedor de fila tiene id="menuItem-1732$3749"
// pero su data-automation-id es literalmente "menuItem" (sin sufijo). Por eso
// partimos del promptOption (que sí lleva el label) y subimos al ancestro.
//
// Rama vs hoja se decide por el aria-label de esa fila:
//   "Submenu X"            -> rama (tiene hijos)
//   "X Related Actions"    -> hoja (seleccionable)
const ROW_SEL = '[data-automation-id="menuItem"], [role="menuitem"][aria-label]';

// IMPORTANTE: hay promptOption FUERA del dropdown (p. ej. el moniker con tu nombre
// "<NOMBRE APELLIDOS>" en la cabecera del diálogo). Solo cuentan los que cuelgan de una fila
// de menú real, así que exigimos que exista el ancestro ROW_SEL.
//
// La visibilidad se mide con getClientRects(): offsetParent es null en elementos
// position:fixed, y el dropdown de Workday se renderiza en un portal flotante.
async function listVisibleRows(page) {
  return page.evaluate(rowSel => {
    const isVisible = el => el.getClientRects().length > 0;
    return [...document.querySelectorAll('[data-automation-id="promptOption"]')]
      .filter(isVisible)
      .map(opt => {
        const row = opt.closest(rowSel);
        if (!row || (!row.getAttribute('aria-label') && !row.closest('[role="listbox"]'))) return null;                       // no pertenece al dropdown
        const label = (opt.getAttribute('data-automation-label') || opt.textContent || '').trim();
        const aria = (row.getAttribute('aria-label') || '').trim();
        let kind = 'unknown';
        if (/^Submenu\s/i.test(aria)) kind = 'branch';
        else if (/Related Actions$/i.test(aria)) kind = 'leaf';
        else if (row.querySelector('input[type="radio"], [role="radio"], [role="checkbox"]')) kind = 'leaf';
        return { label, aria, kind };
      })
      .filter(r => r && r.label);
  }, ROW_SEL);
}

// El dropdown usa scroll virtual (ReactVirtualized): hay que bajar para
// materializar las filas que aún no están en el DOM. El contenedor scrollable se
// localiza subiendo desde una FILA del dropdown (no desde cualquier promptOption:
// el moniker de la cabecera daría un contenedor equivocado).
function scrollerFinder(rowSel) {
  return `(() => {
    const rowSel = ${JSON.stringify(rowSel)};
    const opt = [...document.querySelectorAll('[data-automation-id="promptOption"]')]
      .filter(e => e.getClientRects().length > 0)
      .find(e => { const row = e.closest(rowSel); return row && (row.getAttribute('aria-label') || row.closest('[role="listbox"]')); });
    if (!opt) return null;
    let el = opt.parentElement;
    while (el && el.scrollHeight <= el.clientHeight + 10) el = el.parentElement;
    return el;
  })()`;
}

async function scrollDropdown(page) {
  return page.evaluate(`(() => {
    const el = ${scrollerFinder(ROW_SEL)};
    if (!el) return false;
    const before = el.scrollTop;
    el.scrollTop = before + Math.max(120, el.clientHeight * 0.8);
    return el.scrollTop !== before;
  })()`);
}

async function resetDropdownScroll(page) {
  await page.evaluate(`(() => {
    const el = ${scrollerFinder(ROW_SEL)};
    if (el) el.scrollTop = 0;
  })()`);
  await page.waitForTimeout(250);
}

// Espera las filas reales: las respuestas del selector pueden tardar varios segundos.
async function waitForRows(page) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const rows = await listVisibleRows(page);
    if (rows.length) return rows;
    await page.waitForTimeout(250);
  }
  throw new Error('El selector no cargó filas en 20 segundos');
}

// Recorre el nivel abierto de arriba a abajo acumulando filas únicas.
async function collectLevel(page) {
  await waitForRows(page);
  await resetDropdownScroll(page);
  const seen = new Map();
  for (let i = 0; i < 60; i++) {
    for (const row of await waitForRows(page)) {
      if (!seen.has(row.label)) seen.set(row.label, row);
    }
    const moved = await scrollDropdown(page);
    if (!moved) return [...seen.values()];
    await page.waitForTimeout(350);
  }
  throw new Error('Se alcanzó el límite de scroll del selector; el nivel no está completo');
}

const cssEscape = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Busca una fila por label (scrolleando si hace falta) y la clica.
async function clickRowByLabel(page, label) {
  const sel = `[data-automation-id="promptOption"][data-automation-label="${cssEscape(label)}"]`;
  await resetDropdownScroll(page);
  for (let i = 0; i < 60; i++) {
    const loc = page.locator(sel).filter({ visible: true }).first();
    if (await loc.count() > 0) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click();
      await page.waitForTimeout(700);
      return true;
    }
    if (!await scrollDropdown(page)) break;
    await page.waitForTimeout(300);
  }
  return false;
}

// Botón "←" de la cabecera del submenú.
async function goBack(page) {
  const back = page.locator([
    '[data-automation-id="backButton"]',
    '[data-automation-id="menuBackButton"]',
    'button[aria-label*="back" i]',
    'button[aria-label*="atrás" i]',
    'button[title*="back" i]',
  ].join(', ')).filter({ visible: true }).first();
  if (await back.count() === 0) return false;
  await back.click();
  await page.waitForTimeout(700);
  return true;
}

// Reabre el dropdown y baja por la ruta indicada (fallback si "back" falla).
async function navigateToPath(popup, page, path) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  await openDropdown(popup, page);
  for (const label of path) {
    if (!await clickRowByLabel(page, label)) {
      throw new Error(`No se pudo re-navegar a "${path.join(' > ')}" (falló en "${label}")`);
    }
  }
}

// Abre el dropdown de Time Type. Si ya está abierto no vuelve a clicar: un
// segundo clic lo cerraría.
async function openDropdown(popup, page) {
  if ((await listVisibleRows(page)).length > 0) {
    console.log('  el dropdown ya estaba abierto');
    return;
  }

  // Buscamos primero dentro del diálogo; si no aparece, en toda la página.
  let widget = popup.locator(SEARCH_SEL).filter({ visible: true }).first();
  if (await widget.count() === 0) {
    console.log('  buscador no hallado dentro del diálogo; buscando en toda la página');
    widget = page.locator(SEARCH_SEL).filter({ visible: true }).first();
  }
  if (await widget.count() === 0) {
    await debugShot(page, 'sin-buscador');
    await dumpDiagnostics(page, 'sin-buscador');
    throw new Error(`No se encontró el buscador de Time Type (${SEARCH_SEL})`);
  }

  await widget.click();

  // Esperamos a que aparezcan filas de menú reales (no otros promptOption).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const rows = await listVisibleRows(page);
    if (rows.length > 0) {
      console.log(`  dropdown abierto: ${rows.length} entradas en el primer nivel`);
      return;
    }
    await page.waitForTimeout(400);
  }

  await debugShot(page, 'dropdown-vacio');
  await dumpDiagnostics(page, 'dropdown-vacio');
  throw new Error('El buscador recibió el clic pero no apareció ninguna fila de menú.');
}

// ─── DFS sobre el árbol ──────────────────────────────────────────────────────
const leaves = [];
const unknowns = [];
let visitedBranches = 0;

async function walk(popup, page, path, depth) {
  const rows = await collectLevel(page);
  const where = path.join(' > ') || 'RAÍZ';
  console.log(`${'  '.repeat(depth)}[${where}] ${rows.length} entradas`);

  if (rows.length === 0) {
    await debugShot(page, `nivel-vacio-${depth}`);
    await dumpDiagnostics(page, `nivel-vacio:${where}`);
    if (depth === 0) throw new Error('El nivel raíz del dropdown salió vacío: el selector de filas no casa con el DOM actual.');
    throw new Error(`La rama ${where} está vacía o no se ha cargado`);
  }

  if (DEBUG) {
    for (const r of rows) console.log(`${'  '.repeat(depth)}  · [${r.kind}] ${r.label}  (aria="${r.aria}")`);
  }

  for (const row of rows) {
    const childPath = [...path, row.label];

    if (row.kind === 'branch') {
      if (ROOTS_ONLY && depth >= 1) { unknowns.push(record(childPath, 'branch-not-expanded')); continue; }
      if (depth + 1 > MAX_DEPTH) { unknowns.push(record(childPath, 'max-depth-reached')); continue; }
      if (depth === 1 && ONLY && !row.label.toLowerCase().includes(ONLY.toLowerCase())) continue;

      if (!await clickRowByLabel(page, row.label)) {
        unknowns.push(record(childPath, 'no-clickable'));
        continue;
      }
      visitedBranches++;
      await walk(popup, page, childPath, depth + 1);

      if (!await goBack(page)) {
        await navigateToPath(popup, page, path);   // fallback
      }
      await page.waitForTimeout(300);
    } else if (row.kind === 'leaf') {
      if (ONLY && !childPath.join(' > ').toLowerCase().includes(ONLY.toLowerCase())) continue;
      leaves.push(record(childPath, 'leaf'));
    } else {
      unknowns.push(record(childPath, `unknown-aria:${row.aria}`));
    }
  }
}

// El primer segmento es la categoría ("Project Plan Tasks", "Projects",
// "Time Entry Codes", "Most Recently Used"…). confirmed_full_type (ver
// time-type-record.js) es la ruta SIN categoría y SIN el rango de fechas final.
// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // viewport: null -> la pagina usa el tamaño real de la ventana; con el viewport
  // por defecto la barra lateral deja "Personal" fuera de pantalla.
  // headless: false -> ventana visible (necesaria para completar el login/MFA a mano).
  // slowMo: 50 -> 50 ms de pausa entre acciones; Workday reacciona mal a clics muy rápidos.
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, slowMo: 50, executablePath: EXECUTABLE_PATH,
    viewport: null, args: ['--start-maximized'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);

  let popup;
  let failure = null;
  try {
    await login(page);
    await navigateToTime(page);
    await debugShot(page, 'vista-mes');
    await ensureMonthView(page, TARGET_DATE.getMonth());
    popup = await openEnterTimeDialog(page, TARGET_DATE);

    console.log('\nAbriendo el selector Time Type...');
    await openDropdown(popup, page);
    await debugShot(page, 'dropdown-abierto');

    console.log(`Recorriendo el árbol (max-depth=${MAX_DEPTH}${ONLY ? `, only="${ONLY}"` : ''})...\n`);
    await walk(popup, page, [], 0);
  } catch (err) {
    failure = err.message;
    await debugShot(page, 'error');
    console.error(`\nFallo: ${err.message}`);
    throw err;
  } finally {
    try {
      if (popup) {
        await page.keyboard.press('Escape').catch(() => {});
        const cancel = popup.getByRole('button', { name: /^(Cancel|Cancelar)$/ }).filter({ visible: true }).first();
        if (await cancel.count()) await cancel.click().catch(() => {});
      }
      writeOutput(failure);
    } finally {
      await context.close();
    }
  }
}

function writeOutput(failure) {
  const partial = Boolean(failure || unknowns.length || ROOTS_ONLY || leaves.length === 0);
  const outputBase = partial ? `${OUT_BASE}.partial` : OUT_BASE;
  const byCategory = {};
  for (const l of leaves) (byCategory[l.category] ||= []).push(l);

  const payload = {
    extracted_at: new Date().toISOString(),
    target_day: targetDay,
    status: partial ? 'partial' : 'complete',
    scope: ONLY ? 'filtered' : ROOTS_ONLY ? 'roots-only' : 'all',
    errors: failure ? [failure] : [],
    max_depth: MAX_DEPTH,
    filter: ONLY,
    counts: {
      leaves: leaves.length,
      branches_visited: visitedBranches,
      unknown: unknowns.length,
    },
    categories: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, v.length])),
    leaves,
    unknown: unknowns,
  };

  mkdirSync(dirname(outputBase), { recursive: true });
  writeFileSync(`${outputBase}.json`, JSON.stringify(payload, null, 2));

  const txt = Object.entries(byCategory).map(([cat, items]) =>
    `## ${cat}\n` + items.map(i => `  ${i.confirmed_full_type}`).sort().join('\n')
  ).join('\n\n');
  writeFileSync(`${outputBase}.txt`, `Status: ${partial ? 'partial' : 'complete'}\nDay: ${targetDay}\n\n` + txt + '\n');
  if (partial) process.exitCode = 2;

  console.log(`\n${leaves.length} hojas · ${visitedBranches} ramas · ${unknowns.length} sin clasificar`);
  console.log(`  ${outputBase}.json`);
  console.log(`  ${outputBase}.txt`);
  if (unknowns.length > 0) {
    console.log('\n[!] Entradas sin clasificar (revisar a mano en el JSON, clave "unknown"):');
    for (const u of unknowns.slice(0, 10)) console.log(`    ${u.raw_label}  — ${u.kind}`);
  }
}

main().catch(err => { console.error(`\nERROR: ${err.message}`); process.exit(1); });
