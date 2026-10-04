# playwright-evidence-capture

Esqueleto reutilizable en **Node.js + [Playwright](https://playwright.dev/)** para el típico healthcheck mensual: **iniciar sesión en varias consolas web** (portales propios, Kibana/Grafana, portal cloud…), **hacer capturas de pantalla de evidencia** de cada entorno y **generar el borrador del informe** en Markdown con todas las capturas enlazadas.

- Playwright es una librería que abre un navegador real (aquí Chromium) y permite navegar, hacer clic, escribir y leer la página desde código.
- El script **no decide** si algo está OK/Warning/Critical: deja la matriz del informe en blanco para que la rellene quien revisa las capturas.
- El login es **siempre manual** (tú tecleas usuario, contraseña y MFA en la ventana). El código no lee, pide ni guarda credenciales.

## Índice

- [Flujo en 3 pasos](#flujo-en-3-pasos)
- [Arquitectura: qué hace cada módulo](#arquitectura-qué-hace-cada-módulo)
- [Requisitos e instalación](#requisitos-e-instalación)
- [Configuración](#configuración)
- [Variables de entorno](#variables-de-entorno)
- [Argumentos de cada comando](#argumentos-de-cada-comando)
- [Secciones de ejemplo incluidas](#secciones-de-ejemplo-incluidas)
- [Cómo añadir una sección](#cómo-añadir-una-sección)
- [Estructura de la salida](#estructura-de-la-salida)
- [Seguridad y avisos](#seguridad-y-avisos)

## Flujo en 3 pasos

| Paso | Comando | Qué hace | Efectos |
|---|---|---|---|
| 1. Login | `npm run login -- <perfil>` | Abre Chromium con una pestaña por consola; haces el SSO a mano y pulsas ENTER | ESCRIBE en local la sesión del navegador (`.browser-session/`). Nada remoto |
| 2. Captura | `npm run capture` (o `npm start`) | Recorre secciones × entornos y guarda capturas | **Solo lectura** remota · ESCRIBE `output/<run-id>/` |
| 3. Informe | `npm run report` | Genera el Markdown con la matriz vacía y enlaces a las capturas | ESCRIBE `output/<run-id>/<prefijo>-<fecha>.md` (y con `--write`, una copia que nunca sobrescribe) |

## Arquitectura: qué hace cada módulo

| Fichero | Qué hace | Efectos |
|---|---|---|
| `src/config.js` | Construye la configuración final: valores por defecto → JSON opcional (`--config`) → variables `EVIDENCE_*` | Lee el JSON |
| `src/args.js` | Parser de argumentos: acepta `--clave=valor`, `--clave valor` y `--flag` | Ninguno |
| `src/browser.js` | Lanza Chromium con un **perfil persistente** por perfil de login (`<profileDir>/<perfil>-profile/`) | ESCRIBE el perfil (cookies) |
| `src/login.js` | Abre una pestaña por cada URL de login de las secciones de un perfil y espera tu ENTER | ESCRIBE el perfil |
| `src/capture.js` | Orquestador: por cada sección lanza el navegador una vez y la ejecuta en cada entorno (o una vez si es `shared`) | ESCRIBE `output/` |
| `src/selection.js` | Aplica `--env`, `--section` y los overrides `--<env>.<campo>`; valida que el tipo de sección exista | Ninguno |
| `src/sections/index.js` | **Registro** de tipos de sección: asocia `type` (en la config) → módulo de código | Ninguno |
| `src/sections/*.js` | Un módulo por tipo de sección (ver [ejemplos](#secciones-de-ejemplo-incluidas)) | ESCRIBE capturas |
| `src/utils.js` | Helpers: `gotoSettle` (navegar y esperar), `shot` (captura), `dumpTable` (texto de tablas a `.txt`), `withPage`, `interpolate` (marcadores `{{…}}`), `azureResourceUrl` | ESCRIBE capturas |
| `src/runtime.js` | Crea el id del run (`YYYY-MM-DD_HH-MM-SS`) y guarda la carpeta del run en curso | Ninguno |
| `src/report.js` | Genera el borrador del informe a partir de un run | ESCRIBE el `.md` |
| `test/core.test.js` | Tests de las funciones puras (sin navegador) con el runner integrado `node:test` | Ninguno |

Ideas de diseño (heredadas de las herramientas originales):

- **Perfil persistente, no `storageState`**: los SSO corporativos (Entra ID, ADFS, SAML) encadenan redirects entre dominios. Un perfil en disco (`launchPersistentContext`) conserva todas las cookies entre saltos y entre ejecuciones; `storageState` (exportar/importar cookies a un JSON) se queda corto en esos saltos.
- **Un perfil por "familia" de login**: si dos consolas usan proveedores de identidad distintos, ponles `profile` distinto; así cada una guarda su sesión sin pisar a la otra.
- **Agrupar por sección, no por entorno**: se abre un navegador por sección y se reutiliza en todos los entornos. El mismo perfil nunca lo abren dos navegadores a la vez (Chromium lo bloquearía).
- **Best-effort**: si una página, selector o clic falla, se registra en la terminal y se sigue. Un run que termina sin error **no** garantiza que todas las capturas sean buenas: revísalas.

## Requisitos e instalación

- Node.js 18 o superior (20.6+ si quieres usar `--env-file`).
- Red/VPN con acceso a las consolas que vayas a capturar.

```bash
cd browser-automation/playwright-evidence-capture
npm install                  # instala la dependencia playwright definida en package.json
npm run install:browsers     # = npx playwright install chromium: descarga el Chromium de Playwright (una vez)
cp config.example.json config.json   # y edita entornos/secciones (config.json está en .gitignore)
```

## Configuración

Hay dos formas de configurar; puedes combinarlas:

1. **Sin fichero** (rápido, un solo entorno): defines variables de entorno (`PORTAL_URL`, `DASHBOARD_URL`, `AZURE_*`…) y se usan las 3 secciones de ejemplo por defecto. Una sección cuya URL queda vacía se salta con un aviso.
2. **Con `config.json`** (varios entornos, secciones a medida): copia `config.example.json`, edítalo y pásalo con `--config=./config.json` o `EVIDENCE_CONFIG=./config.json`.

Prioridad: **variables `EVIDENCE_*` > JSON > valores por defecto**. En el JSON, `environments` y `sections` sustituyen enteros a los de por defecto; `timeouts`, `viewport` y `report` se mezclan clave a clave.

### Claves del JSON

| Clave | Qué es | Defecto |
|---|---|---|
| `outputDir` | Carpeta de evidencias (relativa a la carpeta del proyecto si no es absoluta) | `output` |
| `profileDir` | Carpeta de perfiles del navegador | `.browser-session` |
| `viewport` | Tamaño de la ventana `{ width, height }` en píxeles | `1600×1000` |
| `ignoreHttpsErrors` | `true` = no abortar por certificados TLS internos o autofirmados | `true` |
| `ssoDomains` | Dominios en los que Chromium puede usar autenticación integrada (Kerberos/NTLM/Negotiate). Se pasan a los flags `--auth-server-whitelist` y `--auth-negotiate-delegate-whitelist` | `["login.microsoftonline.com"]` |
| `timeouts.navigation` | Máximo (ms) para cargar una URL | `90000` |
| `timeouts.networkIdle` | Espera (ms) best-effort a que no haya tráfico de red | `8000` |
| `timeouts.settle` | Pausa fija (ms) tras cargar; las SPAs pesadas nunca quedan "quietas" del todo | `3500` |
| `timeouts.element` | Espera máxima (ms) a un selector o clic | `15000` |
| `environments` | Objeto `{ <clave>: { name, ...campos libres } }`. `name` es la carpeta de evidencias (defecto: clave en mayúsculas). Los campos libres (`portalUrl`, `resourceGroup`, `apps`…) se usan desde las secciones con `{{env.<campo>}}` | Un entorno `default` |
| `sections` | Lista ordenada de secciones a ejecutar (ver abajo) | Las 3 de ejemplo |
| `referenceQueries` | Consultas/notas que se copian al informe (no se ejecutan) | `[]` |
| `report.title` | Título del informe cuando no hay plantilla | `Resultado healthcheck mensual` |
| `report.template` | Ruta a tu plantilla Markdown. La fecha se rellena en una fila `\| Fecha \| \|` o en el marcador `` `YYYY-MM-DD` `` | `null` (cabecera mínima con matriz entorno × sección) |
| `report.resultsDir` | Carpeta destino de `--write` | `null` |
| `report.perDateSubdir` | `true` = `--write` crea `<resultsDir>/<fecha>/` y dentro `images/` para capturas manuales | `false` |
| `report.filePrefix` | Prefijo del nombre del informe | `resultado-healthcheck` |

### Claves de cada sección (`sections[]`)

| Clave | Obligatoria | Qué es |
|---|---|---|
| `id` | Sí | Identificador único; nombre de la carpeta de evidencias y valor de `--section` (p.ej. `01-portal`) |
| `type` | Sí | Tipo registrado en `src/sections/index.js` (`portal-page`, `dashboard-time-range`, `cloud-resource-blade`) |
| `profile` | No | Perfil de login (sesión) que usa. Las secciones con el mismo perfil comparten sesión. Defecto `default` |
| `scope` | No | `per-env` (una vez por entorno, carpeta `<ENV>/`) o `shared` (una sola vez, carpeta `SHARED/`, para recursos comunes a todos los entornos). Defecto `per-env` |
| `envs` | No | Lista de claves de entorno donde aplica (p.ej. `["prod"]`); en el resto se salta |
| `loginHint` | No | Texto extra que `login.js` muestra al abrir las pestañas |
| `options` | No | Opciones propias del tipo (ver cada ejemplo). Admite marcadores |

### Marcadores en `options`

| Marcador | Se sustituye por |
|---|---|
| `{{env.<campo>}}` | El campo del entorno actual. Si el string es **solo** el marcador y el campo es una lista, se mantiene como lista (`"resources": "{{env.apps}}"`) |
| `{{$VAR}}` | La variable de entorno `VAR` del proceso (vacío si no existe). Útil para IDs que no quieres en el JSON (`{{$AZURE_SUBSCRIPTION_ID}}`) |
| `{{$VAR:-defecto}}` | `VAR` o, si está vacía, `defecto` (misma idea que `${VAR:-defecto}` en bash) |

## Variables de entorno

Las variables están documentadas en las tablas siguientes. Si prefieres un fichero `.env`, créalo
localmente con las variables que necesites; `.gitignore` impide que se añada al repositorio.

Los scripts **no cargan `.env` solos**: usa `node --env-file=.env src/capture.js` (Node 20.6+) o expórtalo con `set -a; source .env; set +a` (`set -a` marca para exportar toda variable que se defina, `source` lee el fichero, `set +a` lo desactiva).

Ninguna variable es una credencial: el login siempre es manual.

### Ajustes globales (todos opcionales, prioridad sobre el JSON)

| Variable | Qué es | De dónde sacarla / ejemplo |
|---|---|---|
| `EVIDENCE_CONFIG` | Ruta al JSON de configuración (alternativa a `--config`) | `./config.json` |
| `EVIDENCE_OUTPUT_DIR` | Carpeta de evidencias | Defecto `output` |
| `EVIDENCE_PROFILE_DIR` | Carpeta de perfiles del navegador | Defecto `.browser-session` |
| `EVIDENCE_HEADLESS` | `true` = sin ventana (como `--headless`) | Defecto `false` |
| `EVIDENCE_SSO_DOMAINS` | Dominios csv para autenticación integrada | `login.microsoftonline.com,*.<DOMINIO_CORPORATIVO>` |
| `EVIDENCE_IGNORE_HTTPS_ERRORS` | `true`/`false`: tolerar certificados TLS internos | Defecto `true` |
| `EVIDENCE_REPORT_TEMPLATE` | Ruta a una plantilla Markdown propia | Tu plantilla de informe |
| `EVIDENCE_RESULTS_DIR` | Carpeta destino de `report --write` | La carpeta donde guardas los informes |
| `EVIDENCE_REPORT_PREFIX` | Prefijo del nombre del informe | Defecto `resultado-healthcheck` |
| `EVIDENCE_ENV_NAME` | Nombre del entorno único cuando **no** usas JSON | Defecto `DEFAULT` |

### Secciones de ejemplo sin JSON

| Variable | Sección | Qué es | De dónde sacarla |
|---|---|---|---|
| `PORTAL_URL` | `01-portal` | URL de la página principal del portal | Barra de direcciones del navegador |
| `DASHBOARD_URL` | `02-dashboard` | URL base de Kibana/Grafana (sin ruta) | Barra de direcciones, hasta el dominio |
| `DASHBOARD_SPACE` | `02-dashboard` | Space de Kibana (opcional; añade `/s/<space>`) | En la URL de Kibana, lo que va tras `/s/` |
| `DASHBOARD_TIME_STYLE` | `02-dashboard` | `kibana`, `grafana` o `none` | Defecto `kibana` |
| `DASHBOARD_TIME_FROM` | `02-dashboard` | Inicio del rango (sintaxis de la herramienta) | Defecto `now-30d` |
| `AZURE_TENANT_ID` | `03-cloud-resources` | Tenant (directorio) de Entra ID; opcional | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | `03-cloud-resources` | Suscripción; sin ella solo hay páginas de búsqueda | `az account show --query id -o tsv` |
| `AZURE_RESOURCE_GROUP` | `03-cloud-resources` | Grupo de recursos | Portal → Resource groups |
| `AZURE_RESOURCE_PROVIDER` | `03-cloud-resources` | Proveedor ARM, p.ej. `Microsoft.App` | Portal → recurso → JSON View → `id` |
| `AZURE_RESOURCE_TYPE` | `03-cloud-resources` | Tipo ARM, p.ej. `containerApps`, `flexibleServers` | Igual que el anterior |
| `AZURE_RESOURCES` | `03-cloud-resources` | Nombres de recursos separados por comas | Portal → grupo de recursos |

En los comandos `az account show`: `--query` filtra la respuesta con una expresión JMESPath (`tenantId`, `id`) y `-o tsv` la imprime como texto plano. Es solo lectura.

## Argumentos de cada comando

Todos aceptan `--clave=valor` o `--clave valor`. Con `npm run`, los argumentos van después de `--` (así npm se los pasa al script en vez de interpretarlos él).

### `npm run login -- <perfil>`

| Argumento | Qué hace |
|---|---|
| `<perfil>` | Perfil cuyas consolas se abren (los valores de `sections[].profile`). Sin él, imprime los perfiles disponibles |
| `--env=<lista>` | Solo abre pestañas de esos entornos |
| `--config=<ruta>` | JSON de configuración |
| `--help` | Ayuda |

### `npm run capture` / `npm start`

| Argumento | Qué hace |
|---|---|
| `--config=<ruta>` | JSON de configuración |
| `--env=<lista>` | Entornos csv (claves de `environments`); defecto todos |
| `--section=<lista>` | Ids de sección csv; defecto todas, en el orden de la config |
| `--<env>.<campo>=<valor>` | Sobrescribe un campo de un entorno para este run (p.ej. `--prod.resourceGroup=<RESOURCE_GROUP>`) |
| `--headless` | Sin ventana visible (usa la sesión ya guardada). No podrás ajustar nada a mano en la UI |
| `--help` | Ayuda |

### `npm run report`

| Argumento | Qué hace |
|---|---|
| `--run=<RUN_ID>` / `--run-id=<RUN_ID>` | Run a usar (nombre de carpeta en `output/`); defecto el último |
| `--date=<YYYY-MM-DD>` | Fecha del informe; defecto hoy |
| `--write` | Copia el informe a `report.resultsDir` **solo si no existe** (nunca sobrescribe uno redactado) |
| `--config=<ruta>` | JSON de configuración |
| `--help` | Ayuda |

### Otros scripts de `package.json`

| Script | Qué hace |
|---|---|
| `npm run check` | `node --check` de cada `.js`: comprueba la sintaxis sin ejecutar nada |
| `npm test` | `node --test test/`: ejecuta los tests con el runner integrado de Node (sin navegador ni red) |
| `npm run install:browsers` | Descarga el Chromium de Playwright |

### Ejemplos

```bash
# Sin JSON: un entorno, solo la sección de portal
export PORTAL_URL=https://<PORTAL_HOST>
npm run login -- sso
npm run capture -- --section=01-portal

# Con JSON: login de los dos perfiles y captura de PROD sin ventana
npm run login -- sso --config=./config.json
npm run login -- dashboards --config=./config.json
npm run capture -- --config=./config.json --env=prod --headless

# Variables desde un .env propio (Node 20.6+)
node --env-file=.env src/capture.js --config=./config.json

# Informe del último run, y copia al histórico
npm run report -- --config=./config.json
EVIDENCE_RESULTS_DIR=<CARPETA_INFORMES> npm run report -- --config=./config.json --write
```

## Secciones de ejemplo incluidas

### `portal-page` — páginas de un portal (`src/sections/portal-page.js`)

`options.steps` es una lista de pasos que se ejecutan en orden en la misma pestaña:

| `type` del paso | Claves | Qué hace |
|---|---|---|
| `page` (defecto) | `name`, `url`, `dumpTable`, `settleMs` | Navega y captura `<name>.png`; con `dumpTable: true` guarda también el texto de las filas de tabla en `<name>.txt` |
| `search` | `name`, `url`, `inputSelector`, `term`, `resultSelector`, `detailName`, `waitMs` | Escribe `term` en el buscador (selector CSS), pulsa Enter y captura; si hay `resultSelector`, abre el primer resultado y lo captura. Si falla, captura `<name>-state` |
| `menu` | `name`, `url`, `enterSelector`, `enterName`, `links: [{name, label}]`, `dumpTable`, `waitMs` | Captura la vista inicial, entra opcionalmente con un clic y recorre enlaces del menú **por su texto visible** (`label`). Útil cuando la URL lleva un ID que cambia |
| `discover-links` | `name`, `url`, `linkSelector`, `hrefPattern`, `max` | Captura una lista, extrae los enlaces cuyo `href` cumple la expresión regular `hrefPattern` y captura cada uno (hasta `max`, defecto 20). Evita mantener IDs a mano |

Un **selector CSS** identifica elementos de la página: `input[type="search"]` = "un input cuyo atributo type es search". Los ves con clic derecho → Inspeccionar.

### `dashboard-time-range` — Kibana/Grafana con rango temporal (`src/sections/dashboard-time-range.js`)

| Clave | Qué es |
|---|---|
| `baseUrl` | URL base de la herramienta |
| `space` | Space de Kibana (opcional) → `/s/<space>` |
| `timeRangeStyle` | `kibana` añade `_g=(time:(from:…,to:…))` (estado global de Kibana en formato rison); `grafana` añade `from=…&to=…`; `none` no toca la URL |
| `timeRange` | `{ from, to }`, defecto `now-30d` → `now` |
| `views` | Lista `{ name, path \| url, dumpTable, settleMs, timeRange: false }`. `timeRange: false` no añade el rango a esa vista |

Si la URL lleva `#` (rutas tipo `dashboards#/view/<id>`), en Kibana el rango se añade dentro del fragmento, que es donde Kibana lo lee.

### `cloud-resource-blade` — blades de un portal cloud tipo Azure (`src/sections/cloud-resource-blade.js`)

| Clave | Qué es |
|---|---|
| `portalUrl` | Defecto `https://portal.azure.com` |
| `tenantId`, `subscriptionId` | Con suscripción se construyen URLs directas `#@<tenant>/resource/subscriptions/<sub>/resourceGroups/<rg>/providers/<provider>/<type>/<nombre>`; sin ella solo se captura la búsqueda por nombre |
| `resourceGroup`, `provider`, `resourceType` | Componen la ruta ARM (Azure Resource Manager) del recurso |
| `resources` | Lista (o `"a,b"`) de nombres de recurso |
| `blades` | Lista `{ suffix, name, settleMs }`: cada sub-página del recurso (`""` = overview, `/monitoring`, `/backup`, `/revisions`…). Ficheros `01a-<recurso>-overview.png`, `01b-…` |
| `captureResourceGroup` | `true` = captura antes el overview del grupo de recursos (`00-resource-group.png`) |

Los gráficos de métricas suelen abrir con "últimas 24 h". Si necesitas 30 días, ejecuta **sin** `--headless`, cambia el rango en la ventana y sube `settleMs` del blade para tener tiempo antes de la captura.

## Cómo añadir una sección

**Caso A — otra instancia de un tipo existente** (lo más habitual): solo editas `config.json`. Ejemplo: capturar también los servidores de base de datos de cada entorno:

```json
{
  "id": "05-databases",
  "type": "cloud-resource-blade",
  "profile": "sso",
  "options": {
    "subscriptionId": "{{$AZURE_SUBSCRIPTION_ID}}",
    "resourceGroup": "{{env.resourceGroup}}",
    "provider": "Microsoft.DBforPostgreSQL",
    "resourceType": "flexibleServers",
    "resources": "{{env.databases}}",
    "blades": [{ "suffix": "", "name": "overview" }, { "suffix": "/backup", "name": "backup" }]
  }
}
```

y en cada entorno añades `"databases": ["<DB_SERVER>"]`. Ejecuta `npm run capture -- --config=./config.json --section=05-databases`.

**Caso B — un tipo nuevo** (una consola con lógica propia):

1. Crea `src/sections/<mi-tipo>.js` con este contrato:

   ```js
   import { gotoSettle, shot, dumpTable, withPage } from '../utils.js';

   export const type = 'status-page';            // nombre que pondrás en la config

   // Opcional: URLs que login.js abre para este perfil
   export function loginUrls(options, env) { return [options.url].filter(Boolean); }

   export async function capture({ context, env, envs, dir, options, log, sectionId }) {
     const label = `${env?.name ?? 'SHARED'}/${sectionId}`;
     if (!options.url) { log(`[${label}] sin URL — skip`); return; }
     await withPage(context, async (page) => {
       await gotoSettle(page, options.url, { log });   // navega y espera a que se asiente
       await shot(page, dir, '01-status', log);          // guarda <dir>/01-status.png
       await dumpTable(page, dir, '01-status', log);     // y el texto de la tabla, si la hay
       log(`  [${label}] 01-status`);
     });
   }
   ```

   - `context`: el navegador ya autenticado con el perfil de la sección.
   - `env`: el entorno actual (`null` si `scope: "shared"`); `envs`: todos los seleccionados.
   - `dir`: carpeta de evidencias ya calculada (`output/<run>/<ENV|SHARED>/<id>/`).
   - `options`: las `options` de la config con los marcadores ya sustituidos.
   - Exports opcionales: `defaultScope = 'shared'` si el tipo casi siempre es común a todos los entornos; `needsBrowser = false` si la sección no usa navegador (p.ej. llama a un CLI y guarda JSON); entonces `context` llega como `null` y la sección no aparece en `login`.

2. Regístralo en `src/sections/index.js`:

   ```js
   import * as statusPage from './status-page.js';
   export const SECTION_TYPES = { /* ...existentes... */, [statusPage.type]: statusPage };
   ```

3. Añade la instancia en `config.json`:

   ```json
   { "id": "06-status", "type": "status-page", "profile": "sso", "options": { "url": "{{env.portalUrl}}/status" } }
   ```

4. Comprueba: `npm run check && npm test`, luego `npm run capture -- --config=./config.json --section=06-status`.

Pautas: todo best-effort (captura lo que haya aunque un clic falle), nombres de fichero con prefijo numérico (`01-…`) para que el informe salga ordenado, y nunca acciones que cambien algo en la consola (guardar, borrar, reiniciar).

## Estructura de la salida

```
output/
└── 2026-07-03_10-30-22/                 # run-id: fecha y hora de inicio
    ├── DEV/                             # environments.<clave>.name
    │   ├── 01-portal/
    │   │   ├── 01-landing.png
    │   │   ├── 04-status-table.png
    │   │   └── 04-status-table.txt      # texto de la tabla (dumpTable)
    │   └── 03-apps/
    │       ├── 00-resource-group.png
    │       ├── 01a-<APP>-overview.png
    │       └── 01b-<APP>-monitoring-30d.png
    ├── PROD/
    ├── SHARED/                          # secciones con scope "shared"
    │   └── 05-shared-console/
    └── resultado-healthcheck-2026-07-03.md   # npm run report
```

El informe contiene: la plantilla (o cabecera con matriz entorno × sección vacía) con la fecha rellena, las `referenceQueries` y una sección "Evidencias" con un enlace relativo a cada PNG/TXT/JSON, ordenado como `environments` y `SHARED` al final.

## Seguridad y avisos

- `.browser-session/` contiene tu sesión (cookies/tokens): trátala como una contraseña. Está en `.gitignore`, junto con `output/`, `.env` y `config.json`.
- Las capturas son del **contenido** de la página (`fullPage`), no de la barra del navegador, así que no salen URLs con tokens. `dumpTable` solo lee el texto visible de las tablas; nunca cookies, `localStorage` ni tokens.
- Las capturas pueden contener nombres internos, usuarios u otros datos: revísalas antes de compartirlas. No apuntes secciones a páginas que muestren secretos en claro.
- Los selectores CSS y las rutas de las consolas cambian con las versiones: si una captura sale vacía o en la pantalla de login, ejecuta sin `--headless` para ver qué pasa y ajusta la config.
- Una sección ausente o incompleta en el informe es "No revisado", no "OK".
