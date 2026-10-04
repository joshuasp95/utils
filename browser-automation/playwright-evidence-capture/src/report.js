/**
 * report.js — genera el borrador (scaffold) del informe en Markdown a partir de un run.
 *
 * Qué hace:     Toma una plantilla Markdown (report.template) o, si no hay, una cabecera
 *               mínima con una matriz entorno × sección vacía; rellena la fecha; añade
 *               las consultas de referencia (referenceQueries) y una sección "Evidencias"
 *               con enlaces relativos a todas las capturas del run.
 *               NO decide el semáforo (OK/Warning/Critical) ni describe anomalías: la
 *               matriz queda en blanco para que la rellene quien revise las capturas.
 * Requisitos:   Node.js >= 18. No necesita playwright ni navegador.
 * Uso:          npm run report
 *               npm run report -- --run=<RUN_ID> --date=<YYYY-MM-DD>
 *               npm run report -- --write
 * Variables:    --config / EVIDENCE_CONFIG, EVIDENCE_REPORT_TEMPLATE, EVIDENCE_RESULTS_DIR,
 *               EVIDENCE_REPORT_PREFIX (ver README).
 * Efectos:      ESCRIBE en local: <prefijo>-<fecha>.md dentro de la carpeta del run.
 *               Con --write, además una copia en report.resultsDir SOLO si no existe
 *               (nunca sobrescribe un informe ya redactado).
 * Salida:       Ruta del Markdown generado por la terminal.
 */

import { readFile, writeFile, readdir, stat, access, mkdir } from 'fs/promises';
import { join, relative, basename } from 'path';
import { CONFIG, SHARED_DIR_NAME } from './config.js';
import { dateStamp, RUN_ID_PATTERN } from './runtime.js';
import { parseArgs } from './args.js';

const EVIDENCE_FILES = /\.(png|txt|json)$/;

async function exists(p) { try { await access(p); return true; } catch { return false; } }
async function isDir(p) { return (await stat(p).catch(() => null))?.isDirectory() ?? false; }

/** Último run de outputDir (solo carpetas con el patrón YYYY-MM-DD_HH-MM-SS). */
async function latestRun() {
  const entries = await readdir(CONFIG.outputDir).catch(() => []);
  const dirs = [];
  for (const e of entries) {
    if (RUN_ID_PATTERN.test(e) && (await isDir(join(CONFIG.outputDir, e)))) dirs.push(e);
  }
  dirs.sort(); // los run-id son ordenables cronológicamente
  return dirs.at(-1) ?? null;
}

/** { ENV: { sección: [ficheros] } } a partir de output/<run>/<ENV>/<sección>/*. */
async function collectEvidence(runDir) {
  const out = {};
  for (const envName of await readdir(runDir).catch(() => [])) {
    const envPath = join(runDir, envName);
    if (!(await isDir(envPath))) continue;
    out[envName] = {};
    for (const section of (await readdir(envPath).catch(() => [])).sort()) {
      const secPath = join(envPath, section);
      if (!(await isDir(secPath))) continue;
      const files = (await readdir(secPath).catch(() => [])).filter((f) => EVIDENCE_FILES.test(f)).sort();
      if (files.length) out[envName][section] = files.map((f) => join(secPath, f));
    }
    if (!Object.keys(out[envName]).length) delete out[envName];
  }
  return out;
}

function evidenceMarkdown(evidence, runDir, mdDir) {
  let md = '\n---\n\n## Evidencias\n\n';
  md += `Capturas generadas automáticamente en \`${runDir}\`.\n`;
  md += 'La matriz de revisión queda en blanco: el estado OK/Warning/Critical lo asigna quien revisa las capturas.\n\n';

  // Orden de la config (DEV → ... → PROD) y SHARED al final.
  const order = Object.values(CONFIG.environments).map((e) => e.name);
  const rank = (n) => (order.indexOf(n) === -1 ? (n === SHARED_DIR_NAME ? 998 : 999) : order.indexOf(n));
  const envKeys = Object.keys(evidence).sort((a, b) => rank(a) - rank(b));

  if (!envKeys.length) { md += '_Sin capturas en este run._\n'; return md; }

  for (const envName of envKeys) {
    md += `### ${envName}\n\n`;
    for (const [section, files] of Object.entries(evidence[envName])) {
      md += `**${section}**\n\n`;
      for (const f of files) md += `- [\`${basename(f)}\`](${relative(mdDir, f)})\n`;
      md += '\n';
    }
  }
  return md;
}

function queriesMarkdown() {
  const q = CONFIG.referenceQueries ?? [];
  if (!q.length) return '';
  return `\n## Consultas de referencia\n\n\`\`\`text\n${q.join('\n\n')}\n\`\`\`\n`;
}

/** Cabecera mínima si no hay plantilla: matriz entornos (+ SHARED) × secciones. */
function defaultTemplate(date) {
  const sections = CONFIG.sections ?? [];
  const rows = Object.values(CONFIG.environments).map((e) => e.name);
  if (sections.some((s) => s.scope === 'shared')) rows.push(SHARED_DIR_NAME);
  const cols = sections.map((s) => s.id);
  return [
    `# ${CONFIG.report.title} - ${date}`,
    '',
    '| Campo | Valor |',
    '| --- | --- |',
    '| Fecha | |',
    '| Responsable | <RESPONSABLE> |',
    '| Resultado general | |',
    '',
    '## Matriz de revisión',
    '',
    `| Entorno | ${cols.join(' | ')} | Estado entorno |`,
    `| --- | ${cols.map(() => '---').join(' | ')} | --- |`,
    ...rows.map((r) => `| ${r} | ${cols.map(() => ' ').join(' | ')} | |`),
    '',
    '## Anomalías y observaciones',
    '',
    '_(completar solo si hay Warning/Critical)_',
    '',
    '## Conclusión',
    '',
  ].join('\n');
}

/** Rellena la fecha: fila "| Fecha | |" o el marcador `YYYY-MM-DD` de la plantilla. */
function fillDate(template, date) {
  return template
    .replace(/\|\s*(Fecha|Date)\s*\|\s*\|/, `| $1 | ${date} |`)
    .replace(/\|\s*(Fecha|Date)\s*\|\s*`YYYY-MM-DD`\s*\|/, `| $1 | \`${date}\` |`)
    .replace(/`YYYY-MM-DD`/, `\`${date}\``);
}

const HELP = `Uso: npm run report -- [opciones]

Genera el borrador del informe a partir de la plantilla (o una cabecera mínima),
rellena la fecha y enlaza las evidencias de una ejecución de captura.
No infiere estados: la matriz queda en blanco para redactarla a mano.

Opciones:
  --config <ruta>        Fichero JSON de configuración (o EVIDENCE_CONFIG).
  --run, --run-id <id>   Run a reportar (por defecto: el último de outputDir).
  --date <YYYY-MM-DD>    Fecha del informe (por defecto: hoy).
  --write                Copia también a report.resultsDir (SOLO si no existe).
  --help                 Muestra esta ayuda.`;

async function main() {
  const { opts } = parseArgs();
  if (opts.help) { console.log(HELP); return; }

  // Acepta --run y --run-id (alias), en forma =valor o con espacio.
  const runOpt = opts.run ?? opts['run-id'];
  const runId = typeof runOpt === 'string' ? runOpt : await latestRun();
  if (!runId) { console.error(`No hay runs en ${CONFIG.outputDir}. Ejecuta primero: npm run capture`); process.exit(1); }
  const runDir = join(CONFIG.outputDir, runId);
  if (!(await exists(runDir))) { console.error(`Run no encontrado: ${runDir}`); process.exit(1); }
  const date = typeof opts.date === 'string' ? opts.date : dateStamp();

  let template = CONFIG.report.template ? await readFile(CONFIG.report.template, 'utf8').catch(() => null) : null;
  if (CONFIG.report.template && !template) console.warn(`! No encontré la plantilla ${CONFIG.report.template} — uso cabecera mínima.`);
  if (!template) template = defaultTemplate(date);

  const evidence = await collectEvidence(runDir);
  const fileName = `${CONFIG.report.filePrefix}-${date}.md`;
  const build = (mdDir) => fillDate(template, date) + queriesMarkdown() + evidenceMarkdown(evidence, runDir, mdDir);

  const scaffoldPath = join(runDir, fileName);
  await writeFile(scaffoldPath, build(runDir), 'utf8');
  console.log(`Borrador generado: ${scaffoldPath}`);

  if (!opts.write) {
    console.log('Sugerencia: revisa las capturas, rellena la matriz y usa --write para copiarlo a report.resultsDir.');
    return;
  }
  if (!CONFIG.report.resultsDir) { console.error('! --write necesita report.resultsDir (o EVIDENCE_RESULTS_DIR).'); process.exit(1); }

  const destDir = CONFIG.report.perDateSubdir ? join(CONFIG.report.resultsDir, date) : CONFIG.report.resultsDir;
  const dest = join(destDir, fileName);
  if (await exists(dest)) {
    console.log(`! Ya existe ${dest} — no se sobrescribe. Revísalo a mano.`);
    return;
  }
  await mkdir(destDir, { recursive: true });
  // Mismo contenido, con enlaces a evidencias relativos a la carpeta de destino.
  await writeFile(dest, build(destDir), 'utf8');
  console.log(`Informe copiado a: ${dest}`);
  if (CONFIG.report.perDateSubdir) {
    await mkdir(join(destDir, 'images'), { recursive: true }); // para capturas manuales extra
    console.log(`Carpeta para capturas manuales: ${join(destDir, 'images')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
