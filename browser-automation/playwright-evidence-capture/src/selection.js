/**
 * selection.js — resuelve qué entornos y secciones se procesan según los argumentos.
 *
 * Qué hace:     selectEnvs(): aplica --env y los overrides por entorno
 *               (--<env>.<campo>=valor, p.ej. --prod.namespace=<NAMESPACE>).
 *               selectSections(): aplica --section, valida que el "type" esté registrado
 *               y resuelve scope/perfil de cada sección. Lo usan capture.js y login.js.
 * Requisitos:   Ninguno.
 * Uso:          const envs = selectEnvs(opts); const sections = selectSections(opts, log);
 * Variables:    CONFIG.environments, CONFIG.sections.
 * Efectos:      Ninguno.
 * Salida:       Arrays de entornos y secciones resueltas.
 */

import { CONFIG } from './config.js';
import { csv } from './args.js';
import { SECTION_TYPES } from './sections/index.js';

export function selectEnvs(opts) {
  const keys = csv(opts.env, Object.keys(CONFIG.environments));
  return keys.map((k) => {
    const e = CONFIG.environments[k];
    if (!e) throw new Error(`Entorno desconocido: ${k}. Válidos: ${Object.keys(CONFIG.environments).join(', ')}`);
    // Overrides por CLI: --<env>.<campo>=valor (sobrescribe un campo de ese entorno).
    const overrides = {};
    for (const [opt, value] of Object.entries(opts)) {
      const m = opt.match(/^([\w-]+)\.([\w-]+)$/);
      if (m && m[1] === k && typeof value === 'string') overrides[m[2]] = value;
    }
    return { ...e, ...overrides };
  });
}

export function selectSections(opts, log = console.log) {
  const all = CONFIG.sections ?? [];
  const ids = csv(opts.section, all.map((s) => s.id));
  const out = [];
  for (const id of ids) {
    const s = all.find((x) => x.id === id);
    if (!s) { log(`Sección desconocida: ${id} — skip (definidas: ${all.map((x) => x.id).join(', ')})`); continue; }
    const mod = SECTION_TYPES[s.type];
    if (!mod) { log(`Tipo de sección no registrado: ${s.type} (sección ${id}) — skip. Regístralo en src/sections/index.js`); continue; }
    out.push({
      ...s,
      mod,
      scope: s.scope ?? mod.defaultScope ?? 'per-env',
      profile: s.profile ?? 'default',
      needsBrowser: mod.needsBrowser !== false,
      options: s.options ?? {},
    });
  }
  return out;
}

/** ¿Debe ejecutarse la sección en este entorno? (filtro opcional sections[].envs) */
export function sectionAppliesTo(section, env) {
  return !section.envs || section.envs.includes(env.key);
}
