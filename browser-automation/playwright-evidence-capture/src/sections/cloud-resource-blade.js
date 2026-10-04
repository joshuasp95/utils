/**
 * cloud-resource-blade.js — sección de ejemplo: "blades" (páginas) de recursos en un
 * portal cloud con rutas tipo Azure Resource Manager.
 *
 * Qué hace:     (Opcional) captura el overview del grupo de recursos para confirmar el
 *               acceso; después, para cada recurso de la lista, captura cada blade
 *               configurado (overview, /monitoring, /backup, /revisions...).
 *               Con subscriptionId se usan URLs directas; sin él, solo se puede capturar
 *               la página de búsqueda del portal por nombre de recurso.
 * Requisitos:   Sesión iniciada en el perfil de la sección (npm run login -- <perfil>).
 * Uso:          { "id": "03-cloud-resources", "type": "cloud-resource-blade", "profile": "sso",
 *                 "options": { "subscriptionId": "{{$AZURE_SUBSCRIPTION_ID}}",
 *                              "resourceGroup": "{{env.resourceGroup}}",
 *                              "provider": "Microsoft.App", "resourceType": "containerApps",
 *                              "resources": "{{env.containerApps}}",
 *                              "blades": [ { "suffix": "", "name": "overview" } ] } }
 * Variables:    portalUrl (defecto https://portal.azure.com), tenantId, subscriptionId,
 *               resourceGroup, provider (p.ej. Microsoft.DBforPostgreSQL), resourceType
 *               (p.ej. flexibleServers), resources (array o "a,b"), blades, captureResourceGroup.
 * Efectos:      SOLO LECTURA en el portal. ESCRIBE en local: <dir>/NN*.png.
 * Salida:       PNG en output/<run>/<ENV>/<id-sección>/ con nombres
 *               <NN><letra>-<recurso>-<blade>.png (01a-x-overview, 01b-x-monitoring...).
 *
 * Nota: los gráficos de métricas del portal suelen abrir con "últimas 24 h". Si el
 * check necesita 30 días, ejecuta sin --headless y ajusta el rango en la ventana
 * antes de que se tome la captura (o sube settleMs del blade para tener tiempo).
 */

import { gotoSettle, shot, withPage, azureResourceUrl, toList } from '../utils.js';

export const type = 'cloud-resource-blade';

const DEFAULT_PORTAL = 'https://portal.azure.com';

export function loginUrls(options) {
  return [options.loginUrl || options.portalUrl || DEFAULT_PORTAL];
}

export async function capture({ context, env, dir, options, log, sectionId }) {
  const label = `${env?.name ?? 'SHARED'}/${sectionId}`;
  const portalUrl = (options.portalUrl || DEFAULT_PORTAL).replace(/\/$/, '');
  const { tenantId, subscriptionId, resourceGroup, provider, resourceType } = options;
  const resources = toList(options.resources);
  const blades = options.blades?.length ? options.blades : [{ suffix: '', name: 'overview' }];

  if (!resources.length && !(options.captureResourceGroup && resourceGroup)) {
    log(`[${label}] sin recursos configurados — skip`);
    return;
  }
  if (resources.length && (!provider || !resourceType) && subscriptionId) {
    log(`[${label}] faltan provider/resourceType — skip`);
    return;
  }
  if (!subscriptionId) log(`  [${label}] sin subscriptionId: solo páginas de búsqueda por nombre`);

  await withPage(context, async (page) => {
    // Grupo de recursos: confirma que el acceso al portal y a la suscripción funciona.
    if (options.captureResourceGroup && resourceGroup) {
      const rgUrl = subscriptionId
        ? azureResourceUrl({ portalUrl, tenantId, subscriptionId, resourceGroup })
        : `${portalUrl}/#browse/resourcegroups`;
      await gotoSettle(page, rgUrl, { log, settle: 6_000 });
      await shot(page, dir, '00-resource-group', log);
      log(`  [${label}] 00-resource-group`);
    }

    for (let i = 0; i < resources.length; i++) {
      const resourceName = resources[i];
      const prefix = String(i + 1).padStart(2, '0');
      const url = azureResourceUrl({ portalUrl, tenantId, subscriptionId, resourceGroup, provider, resourceType, resourceName });

      if (!subscriptionId) {
        // La URL de búsqueda no admite sub-rutas de blade: una sola captura.
        await gotoSettle(page, url, { log, settle: 6_000 });
        await shot(page, dir, `${prefix}-${resourceName}-search`, log);
        log(`  [${label}] ${prefix}-${resourceName}-search`);
        continue;
      }

      for (let j = 0; j < blades.length; j++) {
        const { suffix = '', name, settleMs = 6_000 } = blades[j];
        const letter = String.fromCharCode(97 + j); // a, b, c...
        const file = `${prefix}${letter}-${resourceName}-${name}`;
        await gotoSettle(page, `${url}${suffix}`, { log, settle: settleMs });
        await shot(page, dir, file, log);
        log(`  [${label}] ${file}`);
      }
    }
  });
}
