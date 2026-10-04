// navigation.js — Módulo de navegación Playwright hasta el calendario de Time de Workday.
//
// Qué hace:     Espera a que cargue la home de Workday y navega a Time → vista mensual, soportando
//               la interfaz clásica (menú global) y la barra lateral persistente (Personal → Time).
// Requisitos:   playwright (lo importa extract-time-types.js; este módulo solo recibe `page`).
// Uso:          import { navigateToTime, waitForWorkdayHome } from './navigation.js';
// Variables:    ninguna.
// Efectos:      SOLO LECTURA: solo hace clic en menús de navegación.
// Salida:       ninguna (deja la página en el calendario mensual de Time).
function personalMenu(page) {
  return page.locator('button[data-automation-id="sidebarL1"]').filter({ has: page.getByText('Personal', { exact: true }) })
    .filter({ visible: true }).first();
}

export function homeNavigation(page) {
  return page.locator('[data-automation-id="globalNavButton"], [data-automation-id="sidebarL2"]')
    .or(personalMenu(page)).filter({ visible: true }).first();
}

export async function waitForWorkdayHome(page, timeout = 120_000) {
  await homeNavigation(page).waitFor({ state: 'visible', timeout });
}

function timeLink(page) {
  return page.locator('a[data-automation-id="sidebarL2"]')
    .filter({ hasText: /^Time$/ }).filter({ visible: true }).first();
}

// La barra lateral abre el panel al pasar el cursor, pero el boton puede quedar
// fuera del viewport y entonces hover() falla con "element is outside of the
// viewport" por mucho que Playwright intente hacer scroll (el contenedor no
// scrollea). Se prueban varias formas de abrirlo, de menos a mas invasiva, y se
// para en cuanto aparece el enlace de Time (confirmado 2026-09-21).
async function openPersonalMenu(page, personal) {
  await personal.scrollIntoViewIfNeeded().catch(() => {});
  const time = timeLink(page);
  const intentos = [
    ['hover', () => personal.hover({ timeout: 5_000 })],
    ['hover forzado', () => personal.hover({ force: true, timeout: 5_000 })],
    ['eventos de raton', async () => {
      await personal.dispatchEvent('mouseover');
      await personal.dispatchEvent('mouseenter');
    }],
    ['clic', () => personal.click({ force: true, timeout: 5_000 })],
  ];
  for (const [nombre, intento] of intentos) {
    try {
      await intento();
    } catch {
      continue;
    }
    try {
      await time.waitFor({ state: 'visible', timeout: 5_000 });
      console.log(`  Panel abierto con: ${nombre}.`);
      return time;
    } catch {
      // El panel no se abrio con esta via; probar la siguiente.
    }
  }
  throw new Error(
    'No se pudo abrir el panel "Personal" de la barra lateral de Workday. ' +
    'Se probaron hover, hover forzado, eventos de raton y clic. ' +
    'Comprobar si la interfaz ha vuelto a cambiar.'
  );
}

export async function navigateToTime(page) {
  await page.waitForLoadState('domcontentloaded');
  await waitForWorkdayHome(page, 60_000);
  const personal = personalMenu(page);
  if (await personal.count()) {
    console.log('Abriendo Personal → Time...');
    const time = await openPersonalMenu(page, personal);
    await time.click();
  } else {
    console.log('Abriendo Time desde el menú clásico...');
    await page.locator('[data-automation-id="globalNavButton"]').first().click();
    await page.locator('[data-automation-id="globalNavAppItemLink"][aria-label="Time"]')
      .filter({ visible: true }).first().click();
  }

  // Time puede abrir el calendario directamente o mostrar primero This Week.
  const week = page.locator('button[title="Week"]').or(page.getByRole('button', { name: 'Week', exact: true }))
    .filter({ visible: true }).first();
  const month = page.locator('button[title="Month"]')
    .or(page.getByRole('button', { name: 'Month', exact: true }))
    .filter({ visible: true }).first();
  const thisWeek = page.locator('[data-automation-id="label"][aria-label*="This Week"]')
    .or(page.getByText('This Week', { exact: true })).filter({ visible: true }).first();
  await week.or(month).or(thisWeek).first().waitFor({ state: 'visible', timeout: 30_000 });
  if (!(await week.count()) && !(await month.count())) {
    await thisWeek.click();
    await week.or(month).first().waitFor({ state: 'visible', timeout: 30_000 });
  }
  if (!(await month.count())) {
    await week.click();
    await page.locator('[data-automation-id="dropdown-option"][data-automation-label="Month"]')
      .filter({ visible: true }).first().click();
  }
  await month.waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-automation-id^="calendarDateCell-"]').first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  console.log('Calendario mensual cargado.');
}
