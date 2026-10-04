/**
 * config.js — carga y resuelve la configuración (defaults + JSON opcional + variables de entorno).
 *
 * Qué hace:     Construye el objeto CONFIG que usan el resto de módulos:
 *                 1. Parte de DEFAULTS (un único entorno y las 3 secciones de ejemplo,
 *                    alimentadas por variables de entorno).
 *                 2. Si hay fichero JSON (--config=<ruta> o EVIDENCE_CONFIG), lo mezcla
 *                    encima: `environments` y `sections` se REEMPLAZAN enteros;
 *                    `timeouts`, `viewport` y `report` se mezclan clave a clave.
 *                 3. Las variables EVIDENCE_* (ajustes globales) tienen prioridad sobre el JSON.
 * Requisitos:   Node.js >= 18.
 * Uso:          import { CONFIG } from './config.js';
 * Variables:    EVIDENCE_CONFIG, EVIDENCE_OUTPUT_DIR, EVIDENCE_PROFILE_DIR, EVIDENCE_HEADLESS,
 *               EVIDENCE_SSO_DOMAINS, EVIDENCE_IGNORE_HTTPS_ERRORS, EVIDENCE_REPORT_TEMPLATE,
 *               EVIDENCE_RESULTS_DIR, EVIDENCE_REPORT_PREFIX, EVIDENCE_ENV_NAME
 *               (+ las de las secciones de ejemplo: PORTAL_URL, DASHBOARD_URL, AZURE_*...).
 *               Todas explicadas en el README.
 * Efectos:      SOLO LECTURA (lee el JSON de configuración si se indica).
 * Salida:       Exporta CONFIG, PROJECT_ROOT y SHARED_DIR_NAME.
 *
 * Las rutas relativas (outputDir, profileDir, report.template, report.resultsDir) se
 * resuelven respecto a la carpeta del proyecto (no al directorio desde el que se lanza).
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, csv } from './args.js';

/** Carpeta raíz del proyecto (la que contiene package.json). */
export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Carpeta donde van las evidencias de secciones "shared" (una vez, no por entorno). */
export const SHARED_DIR_NAME = 'SHARED';

const env = process.env;

/** "true"/"1"/"yes"/"si" => true; vacío => fallback. */
function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|y|si|sí)$/i.test(String(value).trim());
}

/**
 * Configuración por defecto (sin fichero JSON). Un único entorno y las 3 secciones
 * de ejemplo. Los valores `{{$VAR}}` / `{{$VAR:-defecto}}` se sustituyen por la
 * variable de entorno en el momento de capturar (ver interpolate() en utils.js);
 * si la URL queda vacía, la sección se salta con un aviso.
 */
const DEFAULTS = {
  outputDir: 'output',
  profileDir: '.browser-session',
  viewport: { width: 1600, height: 1000 },
  // Certificados internos/autofirmados en consolas corporativas: no abortar por TLS.
  ignoreHttpsErrors: true,
  // Dominios para --auth-server-whitelist (Kerberos/NTLM/Negotiate) en Chromium.
  ssoDomains: ['login.microsoftonline.com'],
  // Tiempos (ms) para dejar asentar SPAs pesadas (consolas cloud, Kibana, Grafana...).
  timeouts: {
    navigation: 90_000, // máximo para page.goto
    networkIdle: 8_000, // espera best-effort a que no haya tráfico de red
    settle: 3_500, // pausa fija final (las SPAs nunca quedan "idle" del todo)
    element: 15_000, // espera máxima a un selector / click
  },
  environments: {
    default: { name: env.EVIDENCE_ENV_NAME || 'DEFAULT' },
  },
  sections: [
    {
      id: '01-portal',
      type: 'portal-page',
      profile: 'sso',
      options: {
        steps: [
          { type: 'page', name: '01-landing', url: '{{$PORTAL_URL}}', settleMs: 5_000 },
        ],
      },
    },
    {
      id: '02-dashboard',
      type: 'dashboard-time-range',
      profile: 'dashboards',
      options: {
        baseUrl: '{{$DASHBOARD_URL}}',
        space: '{{$DASHBOARD_SPACE}}',
        timeRangeStyle: '{{$DASHBOARD_TIME_STYLE:-kibana}}',
        timeRange: { from: '{{$DASHBOARD_TIME_FROM:-now-30d}}', to: 'now' },
        views: [
          { name: '01-home', path: '/app/home' },
          { name: '02-discover', path: '/app/discover' },
        ],
      },
    },
    {
      id: '03-cloud-resources',
      type: 'cloud-resource-blade',
      profile: 'sso',
      options: {
        tenantId: '{{$AZURE_TENANT_ID}}',
        subscriptionId: '{{$AZURE_SUBSCRIPTION_ID}}',
        resourceGroup: '{{$AZURE_RESOURCE_GROUP}}',
        provider: '{{$AZURE_RESOURCE_PROVIDER}}',
        resourceType: '{{$AZURE_RESOURCE_TYPE}}',
        resources: '{{$AZURE_RESOURCES}}',
        captureResourceGroup: true,
        blades: [
          { suffix: '', name: 'overview', settleMs: 6_000 },
          { suffix: '/monitoring', name: 'monitoring', settleMs: 8_000 },
        ],
      },
    },
  ],
  // Consultas/notas de referencia que se copian al informe (no se ejecutan).
  referenceQueries: [],
  report: {
    title: 'Resultado healthcheck mensual',
    template: null, // ruta a una plantilla Markdown propia (opcional)
    resultsDir: null, // destino de --write (opcional)
    perDateSubdir: false, // --write crea <resultsDir>/<fecha>/ + images/
    filePrefix: 'resultado-healthcheck',
  },
};

/** Ruta del JSON de configuración: --config=<ruta> gana a EVIDENCE_CONFIG. */
function configPath() {
  const { opts } = parseArgs();
  const p = typeof opts.config === 'string' ? opts.config : env.EVIDENCE_CONFIG;
  // Relativa al directorio actual: es lo que espera quien teclea --config=./x.json
  return p ? resolve(process.cwd(), p) : null;
}

function loadJson(path) {
  if (!path) return {};
  if (!existsSync(path)) throw new Error(`No existe el fichero de configuración: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`JSON inválido en ${path}: ${e.message}`);
  }
}

function buildConfig() {
  const file = configPath();
  const json = loadJson(file);

  const cfg = {
    ...DEFAULTS,
    ...json,
    viewport: { ...DEFAULTS.viewport, ...(json.viewport ?? {}) },
    timeouts: { ...DEFAULTS.timeouts, ...(json.timeouts ?? {}) },
    report: { ...DEFAULTS.report, ...(json.report ?? {}) },
  };

  // Variables de entorno globales: prioridad sobre el JSON.
  if (env.EVIDENCE_OUTPUT_DIR) cfg.outputDir = env.EVIDENCE_OUTPUT_DIR;
  if (env.EVIDENCE_PROFILE_DIR) cfg.profileDir = env.EVIDENCE_PROFILE_DIR;
  if (env.EVIDENCE_SSO_DOMAINS) cfg.ssoDomains = csv(env.EVIDENCE_SSO_DOMAINS, []);
  cfg.ignoreHttpsErrors = bool(env.EVIDENCE_IGNORE_HTTPS_ERRORS, cfg.ignoreHttpsErrors);
  cfg.headless = bool(env.EVIDENCE_HEADLESS, cfg.headless ?? false);
  if (env.EVIDENCE_REPORT_TEMPLATE) cfg.report.template = env.EVIDENCE_REPORT_TEMPLATE;
  if (env.EVIDENCE_RESULTS_DIR) cfg.report.resultsDir = env.EVIDENCE_RESULTS_DIR;
  if (env.EVIDENCE_REPORT_PREFIX) cfg.report.filePrefix = env.EVIDENCE_REPORT_PREFIX;

  // Rutas absolutas (relativas a la raíz del proyecto si no lo son ya).
  cfg.outputDir = resolve(PROJECT_ROOT, cfg.outputDir);
  cfg.profileDir = resolve(PROJECT_ROOT, cfg.profileDir);
  if (cfg.report.template) cfg.report.template = resolve(PROJECT_ROOT, cfg.report.template);
  if (cfg.report.resultsDir) cfg.report.resultsDir = resolve(PROJECT_ROOT, cfg.report.resultsDir);

  // Normaliza entornos: cada uno lleva su `key` y un `name` (carpeta de evidencias).
  const envs = {};
  for (const [key, e] of Object.entries(cfg.environments ?? {})) {
    envs[key] = { ...e, key, name: e.name || key.toUpperCase() };
  }
  cfg.environments = envs;

  // Validación mínima de secciones: id y type obligatorios, ids únicos.
  const seen = new Set();
  for (const s of cfg.sections ?? []) {
    if (!s.id || !s.type) throw new Error(`Sección sin "id" o "type" en la configuración: ${JSON.stringify(s)}`);
    if (seen.has(s.id)) throw new Error(`Id de sección duplicado: ${s.id}`);
    seen.add(s.id);
  }

  cfg.configFile = file;
  return cfg;
}

export const CONFIG = buildConfig();
