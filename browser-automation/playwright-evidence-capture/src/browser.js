/**
 * browser.js — lanza Chromium con un perfil persistente por "profile" (sesión SSO).
 *
 * Qué hace:     Abre Chromium con launchPersistentContext sobre
 *               <profileDir>/<profile>-profile/ para que login.js (manual) y
 *               capture.js (automático) compartan cookies/sesión en momentos distintos.
 * Requisitos:   paquete `playwright` (npm install) y su Chromium
 *               (npm run install:browsers).
 * Uso:          const context = await launch('sso', { headless: false });
 * Variables:    CONFIG.profileDir (EVIDENCE_PROFILE_DIR), CONFIG.ssoDomains
 *               (EVIDENCE_SSO_DOMAINS), CONFIG.ignoreHttpsErrors
 *               (EVIDENCE_IGNORE_HTTPS_ERRORS), CONFIG.viewport, CONFIG.timeouts.
 * Efectos:      ESCRIBE en local: el perfil del navegador (cookies, tokens de sesión).
 *               No modifica nada remoto.
 * Salida:       Un BrowserContext de Playwright.
 *
 * POR QUÉ launchPersistentContext y no newContext() + storageState:
 *   Los logins corporativos (Entra ID, ADFS, SAML) encadenan varios redirects entre
 *   dominios distintos. Un perfil persistente en disco conserva TODAS las cookies
 *   entre saltos y entre ejecuciones (igual que un Chrome con el usuario ya
 *   autenticado), evitando bucles de SSO. storageState se queda corto en esos saltos.
 *
 * SEGURIDAD: el perfil contiene la sesión. Está en .gitignore; trátalo como una contraseña.
 */

import { mkdir } from 'fs/promises';
import { join } from 'path';
import { CONFIG } from './config.js';

export function profileDir(profile) {
  return join(CONFIG.profileDir, `${profile}-profile`);
}

export async function launch(profile, { headless = false } = {}) {
  // Import dinámico: así `--help`, `report` y los tests no requieren tener
  // playwright instalado; solo se exige al lanzar el navegador de verdad.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error("Falta 'playwright'. Ejecuta: npm install && npm run install:browsers");
  }

  const dir = profileDir(profile);
  await mkdir(dir, { recursive: true });

  const args = [
    // Quita la marca de "navegador automatizado" que algunos portales detectan.
    '--disable-blink-features=AutomationControlled',
    '--no-default-browser-check',
    '--no-first-run',
    '--disable-infobars',
  ];
  if (CONFIG.ssoDomains?.length) {
    // Dominios en los que Chromium puede usar autenticación integrada
    // (Kerberos/NTLM/Negotiate) y delegar credenciales en redirects SSO.
    const whitelist = CONFIG.ssoDomains.join(',');
    args.push(`--auth-server-whitelist=${whitelist}`, `--auth-negotiate-delegate-whitelist=${whitelist}`);
  }

  const context = await chromium.launchPersistentContext(dir, {
    headless,
    viewport: CONFIG.viewport,
    ignoreHTTPSErrors: CONFIG.ignoreHttpsErrors, // certs internos/autofirmados
    acceptDownloads: false, // solo se hacen capturas; nunca se descarga nada
    args,
  });

  // Oculta navigator.webdriver, que algunos portales usan para desviar a flujos
  // anti-bot o bloquear el SSO.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  context.setDefaultNavigationTimeout(CONFIG.timeouts.navigation);
  context.setDefaultTimeout(CONFIG.timeouts.element);

  return context;
}
