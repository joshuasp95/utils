/**
 * login.js — login MANUAL por perfil: abre las consolas y guarda la sesión en disco.
 *
 * Qué hace:     Abre Chromium con el perfil persistente indicado y una pestaña por cada
 *               URL de login de las secciones que usan ese perfil (en cada entorno).
 *               Tú completas el SSO (usuario + contraseña + MFA) en la ventana; al pulsar
 *               ENTER en la terminal se cierra el navegador y la sesión queda guardada en
 *               <profileDir>/<perfil>-profile/ para que capture.js la reutilice.
 *               El script NO lee, pide ni imprime credenciales.
 * Requisitos:   npm install + npm run install:browsers; red/VPN con acceso a las consolas.
 * Uso:          npm run login -- <perfil>              (perfiles = sections[].profile)
 *               npm run login -- sso --env=prod --config=./config.json
 * Variables:    --config / EVIDENCE_CONFIG, EVIDENCE_PROFILE_DIR (ver README).
 * Efectos:      ESCRIBE en local: cookies/tokens de sesión en el perfil del navegador.
 *               No modifica nada remoto (solo inicia sesión).
 * Salida:       Perfil del navegador actualizado; mensajes en la terminal.
 *
 * Por qué una pestaña por URL y no solo una: tras el primer login el IdP suele
 * autenticar solo el resto de dominios, pero abrir todas permite comprobar que la
 * sesión está activa en cada consola/entorno antes de capturar.
 */

import { createInterface } from 'readline';
import { launch, profileDir } from './browser.js';
import { parseArgs } from './args.js';
import { interpolate } from './utils.js';
import { selectEnvs, selectSections, sectionAppliesTo } from './selection.js';

function promptEnter(msg) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); resolve(); });
  });
}

/** [{ name, url, hint }] de todas las secciones del perfil, sin URLs repetidas. */
function loginTargets(profile, sections, envs) {
  const targets = [];
  const seen = new Set();
  const add = (name, url, hint) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    targets.push({ name, url, hint });
  };
  for (const s of sections.filter((x) => x.profile === profile && x.needsBrowser)) {
    const fn = s.mod.loginUrls;
    if (!fn) continue;
    if (s.scope === 'shared') {
      for (const u of fn(interpolate(s.options, {}), null)) add(`${s.id}`, u, s.loginHint);
    } else {
      for (const env of envs.filter((e) => sectionAppliesTo(s, e))) {
        for (const u of fn(interpolate(s.options, env), env)) add(`${env.name}/${s.id}`, u, s.loginHint);
      }
    }
  }
  return targets;
}

async function main() {
  const { opts, positional } = parseArgs();
  const sections = selectSections(opts, () => {});
  const profiles = [...new Set(sections.filter((s) => s.needsBrowser).map((s) => s.profile))];
  const profile = positional[0];

  if (opts.help || !profile || !profiles.includes(profile)) {
    console.error(
      'Uso: npm run login -- <perfil> [--env=<lista>] [--config=<ruta>]\n' +
      `Perfiles definidos en la configuración: ${profiles.join(', ') || '(ninguno)'}`,
    );
    process.exit(opts.help ? 0 : 1);
  }

  const targets = loginTargets(profile, sections, selectEnvs(opts));
  if (!targets.length) {
    console.error(`No hay URLs de login para el perfil "${profile}" (¿variables de entorno vacías?).`);
    process.exit(1);
  }

  const context = await launch(profile, { headless: false });

  console.log(`\n[login:${profile}] Abriendo ${targets.length} pestaña(s)...`);
  let first = true;
  for (const { name, url } of targets) {
    const page = first ? (context.pages()[0] ?? (await context.newPage())) : await context.newPage();
    first = false;
    page.setDefaultNavigationTimeout(120_000);
    console.log(`   • ${name}: ${url}`);
    // Sin await: si el redirect SSO tarda, no bloquea la apertura del resto de pestañas.
    page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  const hints = [...new Set(targets.map((t) => t.hint).filter(Boolean))];
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Completa el login SSO (usuario + contraseña + MFA) en CADA pestaña');
  console.log(' hasta ver la aplicación cargada (no la pantalla del proveedor de identidad).');
  for (const h of hints) console.log(` ${h}`);
  console.log(' Cuando TODAS estén autenticadas, vuelve aquí y pulsa ENTER.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await promptEnter('ENTER para guardar la sesión y cerrar el navegador... ');

  await context.close();
  console.log(`[login:${profile}] Sesión guardada en ${profileDir(profile)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
