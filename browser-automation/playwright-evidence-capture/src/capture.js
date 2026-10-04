/**
 * capture.js — recorre secciones × entornos y guarda capturas de evidencia.
 *
 * Qué hace:     Para cada sección configurada lanza Chromium con su perfil (sesión ya
 *               iniciada con login.js), la ejecuta en cada entorno (scope "per-env") o
 *               una sola vez (scope "shared") y guarda PNG/TXT en la carpeta del run.
 *               Agrupa por sección (no por entorno): un contexto por sección reutilizado
 *               en todos los entornos; así el perfil en disco nunca lo abren dos
 *               navegadores a la vez. Best-effort: un fallo no aborta el run.
 * Requisitos:   npm install + npm run install:browsers; login previo por perfil
 *               (npm run login -- <perfil>); VPN/red con acceso a las consolas.
 * Uso:          npm run capture
 *               npm run capture -- --env=dev,prod --section=01-portal --headless
 *               npm run capture -- --config=./config.json --prod.resourceGroup=<RG>
 * Variables:    --config / EVIDENCE_CONFIG, EVIDENCE_HEADLESS y el resto de config.js.
 * Efectos:      SOLO LECTURA en los sistemas remotos (navega y hace capturas).
 *               ESCRIBE en local: output/<run-id>/... y el perfil del navegador.
 * Salida:       output/<run-id>/<ENV|SHARED>/<id-sección>/NN-*.png (+ .txt de tablas).
 */

import { join } from 'path';
import { launch } from './browser.js';
import { initRun, getRunDir } from './runtime.js';
import { CONFIG, SHARED_DIR_NAME } from './config.js';
import { parseArgs } from './args.js';
import { interpolate } from './utils.js';
import { selectEnvs, selectSections, sectionAppliesTo } from './selection.js';

const log = (m) => console.log(m);

const HELP = `Uso: npm run capture -- [opciones]

Recorre secciones y entornos y guarda evidencias en
output/<run-id>/<ENV|SHARED>/<id-sección>/NN-*.png (+ .txt de tablas).
Requiere haber hecho login antes en cada perfil (npm run login -- <perfil>).

Opciones:
  --config <ruta>          Fichero JSON de configuración (o variable EVIDENCE_CONFIG).
  --env <lista>            Entornos csv (por defecto: todos los de la config).
  --section <lista>        Ids de sección csv (por defecto: todas).
  --<env>.<campo> <valor>  Sobrescribe un campo de un entorno (p.ej. --prod.resourceGroup=<RG>).
  --headless               Sin ventana (reutiliza la sesión ya guardada).
  --help                   Muestra esta ayuda.`;

async function main() {
  const { opts } = parseArgs();
  if (opts.help) { console.log(HELP); return; }

  const envs = selectEnvs(opts);
  const sections = selectSections(opts, log);
  const headless = opts.headless === true || opts.headless === 'true' || CONFIG.headless;

  const runDir = initRun();
  log('\n=== Captura de evidencias ===');
  log(`Config   : ${CONFIG.configFile ?? '(por defecto + variables de entorno)'}`);
  log(`Run dir  : ${runDir}`);
  log(`Entornos : ${envs.map((e) => e.name).join(', ')}`);
  log(`Secciones: ${sections.map((s) => s.id).join(', ')}`);
  log(`Headless : ${headless}\n`);

  for (const section of sections) {
    log(`\n--- Sección ${section.id} (${section.type}, perfil ${section.profile}, ${section.scope}) ---`);

    let context = null;
    if (section.needsBrowser) {
      try {
        context = await launch(section.profile, { headless });
      } catch (e) {
        log(`! No pude lanzar el navegador para ${section.id}: ${e.message}`);
        continue;
      }
    }

    const base = { context, envs, log, sectionId: section.id, config: CONFIG };
    try {
      if (section.scope === 'shared') {
        // Recurso compartido entre entornos: una sola ejecución, carpeta SHARED/.
        try {
          await section.mod.capture({
            ...base, env: null,
            dir: join(getRunDir(), SHARED_DIR_NAME, section.id),
            options: interpolate(section.options, {}),
          });
        } catch (e) {
          log(`! [${SHARED_DIR_NAME}/${section.id}] error no controlado: ${e.message}`);
        }
      } else {
        for (const env of envs) {
          if (!sectionAppliesTo(section, env)) { log(`[${env.name}/${section.id}] no aplica a este entorno — skip`); continue; }
          try {
            await section.mod.capture({
              ...base, env,
              dir: join(getRunDir(), env.name, section.id),
              options: interpolate(section.options, env),
            });
          } catch (e) {
            log(`! [${env.name}/${section.id}] error no controlado: ${e.message}`);
          }
        }
      }
    } finally {
      await context?.close().catch(() => {});
    }
  }

  log(`\nEvidencias en: ${getRunDir()}`);
  log(`Siguiente paso: npm run report -- --run=${getRunDir().split(/[\\/]/).pop()}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
