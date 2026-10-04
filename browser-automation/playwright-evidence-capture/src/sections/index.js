/**
 * sections/index.js — registro de TIPOS de sección disponibles.
 *
 * Qué hace:     Asocia el "type" que se escribe en la config (sections[].type) con el
 *               módulo que sabe capturarlo. Para añadir un tipo nuevo: crea el fichero
 *               en esta carpeta e impórtalo aquí (ver README, "Cómo añadir una sección").
 * Requisitos:   Ninguno.
 * Uso:          import { SECTION_TYPES } from './sections/index.js';
 * Variables:    Ninguna.
 * Efectos:      Ninguno.
 * Salida:       Objeto { <type>: módulo }.
 *
 * Contrato de un módulo de sección (lo que capture.js y login.js esperan):
 *   export const type = '<nombre>';                    // igual que la clave de abajo
 *   export async function capture({ context, env, envs, dir, options, log, sectionId, config })
 *       context    BrowserContext de Playwright (null si needsBrowser = false)
 *       env        entorno actual (scope "per-env") o null (scope "shared")
 *       envs       todos los entornos seleccionados (útil en scope "shared")
 *       dir        carpeta donde guardar las evidencias de esta sección/entorno
 *       options    sections[].options ya interpolado ({{env.x}}, {{$VAR}})
 *       log        función de log (console.log)
 *   export function loginUrls(options, env) => string[]   // opcional: pestañas de login.js
 *   export const defaultScope = 'per-env' | 'shared';     // opcional (defecto per-env)
 *   export const needsBrowser = false;                     // opcional: secciones que no
 *                                                          // usan navegador (p.ej. un CLI)
 */

import * as portalPage from './portal-page.js';
import * as dashboardTimeRange from './dashboard-time-range.js';
import * as cloudResourceBlade from './cloud-resource-blade.js';

export const SECTION_TYPES = {
  [portalPage.type]: portalPage,
  [dashboardTimeRange.type]: dashboardTimeRange,
  [cloudResourceBlade.type]: cloudResourceBlade,
};
