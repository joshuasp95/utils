# outlook-teams-web-export

Exporta **correos de Outlook Web** y **chats de Teams Web** a ficheros JSON y TXT locales. Lo hace
**leyendo la interfaz web** (scraping del DOM) con **Playwright**, que es una librería de Node.js
para controlar un navegador Chromium desde código. No usa Microsoft Graph ni registra ninguna
aplicación en Entra ID: solo ve lo mismo que ves tú en el navegador.

> **Aviso de privacidad.** Las exportaciones contienen **datos personales y corporativos**
> (nombres, correos, asuntos, cuerpos de mensajes). Quedan en `data/`, que está en `.gitignore`.
> No las subas a git, no las compartas ni las envíes a servicios externos. Lo mismo vale para
> `.playwright-profile/` (contiene la sesión iniciada de Microsoft 365) y `config.local.json`
> (contiene tus direcciones de correo).

Hay dos formas de usarlo:

1. **Lanzador Playwright** (`npm run extract…`): abre Chromium, verifica la cuenta, inyecta el
   script de exportación y guarda los ficheros en `data/` organizados por tenant y mes.
2. **Consola del navegador**: pegas un script de `scripts/outlook/` o `scripts/teams/` en DevTools
   (F12 → Consola), lo ejecutas y descargas el resultado. Después puedes archivarlo con
   `npm run teams:import` / `npm run outlook:import`.

## Qué exporta

| Origen | Qué se guarda | Efecto colateral |
|---|---|---|
| Outlook, solo metadatos (`01`) | Fecha, remitente (si aparece su email), remitentes+asunto, vista previa | Ninguno: no abre correos |
| Outlook, con cuerpos (`02`, el que usa Playwright) | Lo anterior + asunto y cuerpo completo (texto; HTML con `--include-html`) | **Puede marcar correos como leídos** |
| Teams, chat abierto (`02`, `05`) | Autor, fecha y texto de cada mensaje del intervalo | Ninguno: el chat ya está abierto |
| Teams, todos los chats (`03`, `04`, el que usa Playwright) | Lo anterior para cada conversación de *Favorites* y *Chats* | **Puede marcar chats como leídos** |

Ningún script envía, mueve, borra, responde ni archiva nada. Tampoco leen ni guardan cookies,
tokens ni cabeceras de autenticación.

## Scripts

| Fichero | Qué hace | Efectos |
|---|---|---|
| `scripts/run-playwright.js` | Lanzador: perfiles por tenant, verificación de identidad, descubrimiento de carpetas de Outlook, checkpoints, JSON+TXT | Lectura en M365 (puede marcar leídos) · ESCRIBE `data/` y `.playwright-profile/` |
| `scripts/import-export.js` | Copia descargas manuales a `data/…/<tenant>/<AAAA-MM>/manual/` | ESCRIBE copias en `data/` |
| `scripts/check-syntax.js` | `node --check` de todos los `.js` | Lectura |
| `scripts/outlook/00-debug.js` | Consola: diagnóstico de selectores de Outlook | Lectura |
| `scripts/outlook/01-export-folder-since.js` | Consola: metadatos de la carpeta abierta desde una fecha | Lectura |
| `scripts/outlook/02-export-folder-bodies.js` | Consola o Playwright: carpeta abierta con cuerpos | Puede marcar leídos |
| `scripts/teams/01-list-first-30-chats.js` | Consola: lista las 30 primeras conversaciones | Lectura |
| `scripts/teams/02-export-current-chat-since.js` | Consola: chat abierto en un intervalo fijo | Lectura |
| `scripts/teams/03-export-all-chats-in-range.js` | Consola: todos los chats en un intervalo fijo | Puede marcar leídos |
| `scripts/teams/04-export-all-chats-to-today.js` | Consola o Playwright: todos los chats desde una fecha hasta hoy | Puede marcar leídos |
| `scripts/teams/05-export-current-chat-to-today.js` | Consola: chat abierto desde una fecha hasta hoy | Lectura |
| `scripts/config/microsoft-tenants.js` | Carga los tenants de `config.local.json` (o `M365_WEB_EXPORT_CONFIG`) | Lectura |
| `scripts/lib/*.js` | Lógica compartida (CLI, tenants, flujo y navegación de Outlook) | — |
| `scripts/tests/*.test.js` | Tests sin red ni navegador, con datos ficticios | Ninguno |

### Correspondencia con los nombres originales

Los scripts vienen de un proyecto interno. Solo cambia un nombre, que era engañoso:

| Original | Aquí |
|---|---|
| `teams/03-export-first-30-chats-since.js` | `teams/03-export-all-chats-in-range.js` (con `chatLimit: null` ya recorría todos los chats) |
| `config/microsoft-tenants.js` (tenants escritos en el código) | `config/microsoft-tenants.js` (lee `config.local.json`) + `config.example.json` |
| Resto de ficheros | Mismo nombre y ruta |

## Requisitos

- **Node.js 20 o superior** (`node --version`).
- **Dependencias**, una sola vez, dentro de esta carpeta:

  ```bash
  npm install
  npx playwright install chromium
  ```

  - `npm install` descarga la librería `playwright` declarada en `package.json` a `node_modules/`.
  - `npx playwright install chromium`: `npx` ejecuta el binario `playwright` que acaba de
    instalarse; el subcomando `install chromium` descarga **el navegador Chromium que Playwright
    sabe controlar** (va a una caché de tu usuario, p. ej. `~/Library/Caches/ms-playwright` en
    macOS). Sin este paso el lanzador falla con *Executable doesn't exist*. No toca tu Chrome,
    Edge o Firefox habituales.
- Para el modo consola basta un navegador con DevTools; no hace falta Node.

## Configuración

1. Copia la plantilla y edítala:

   ```bash
   cp config.example.json config.local.json
   ```

2. Rellena un objeto por tenant (organización de Microsoft 365 en la que tienes cuenta):

   | Campo | Qué es | De dónde sale |
   |---|---|---|
   | `id` | Identificador corto: minúsculas, números o guiones, empezando por letra. Se usa en `--tenant`, en la carpeta del perfil y en las rutas de salida | Lo eliges tú (`empresa`, `cliente`…) |
   | `name` | Nombre legible que aparece en los menús | Lo eliges tú |
   | `email` | Tu dirección **exacta** de inicio de sesión en ese tenant. Sirve para elegir la cuenta en *Pick an account* y para comprobar que la sesión abierta es la correcta | La que usas para entrar en Outlook/Teams de ese tenant |
   | `applications` | `["teams"]`, `["outlook"]` o ambas | Las apps que quieres exportar de ese tenant |

`config.local.json` está ignorado por git. No pongas contraseñas, tokens ni cookies.

### Variables de entorno

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `M365_WEB_EXPORT_CONFIG` | No | Ruta a un JSON de tenants distinto de `./config.local.json` (mismo formato). Si la defines y el fichero no existe, el programa se para con error | La ruta donde guardes tu config, p. ej. `export M365_WEB_EXPORT_CONFIG="$HOME/.config/m365-web-export.json"` |

Las variables opcionales están documentadas en esta tabla. Node no carga un fichero `.env` por sí
solo; define las variables en la shell antes de ejecutar el programa.

## Primer login y persistencia de la sesión

- El lanzador usa `chromium.launchPersistentContext`, es decir, un **perfil de navegador guardado
  en disco**. Cada aplicación y tenant tiene el suyo para no mezclar identidades:
  `.playwright-profile/teams/<id>/`, `.playwright-profile/outlook/<id>/` (permisos `0700`).
- **Primera ejecución** de cada perfil: se abre Chromium vacío; inicia sesión a mano con la cuenta
  de `email` y completa SSO/MFA. Si aparece *Pick an account*, el programa solo hace clic en la
  dirección exacta configurada (nunca por posición).
- Después intenta **verificar la identidad** buscando el email exacto en la interfaz (o en el
  panel de cuenta). Si no lo consigue, te pide que escribas el email en la terminal para
  confirmar; tres fallos detienen ese tenant. En `--headless` no hay confirmación manual: falla.
- **Siguientes ejecuciones**: el perfil conserva la sesión, así que normalmente entra directamente
  (y puedes usar `--headless`). Si caduca, vuelve a iniciar sesión en la ventana.
- Para "cerrar sesión" de verdad, borra la carpeta del perfil correspondiente.
- Primer `Ctrl+C`: cierre limpio del navegador; segundo `Ctrl+C`: salida inmediata.

## Uso con Playwright

```bash
npm run extract:all -- --days 7
npm run extract:teams -- --tenants empresa,cliente --days 7 --yes
npm run extract:outlook -- --tenant cliente --discover-folders
npm run extract:outlook -- --tenant cliente --folders Inbox,Archive --tabs focused,other \
  --since 2026-01-01 --until 2026-01-08 --yes
npm run extract:outlook -- --tenant cliente --folder "Projects/Reports, Europe" --tabs focused --days 7
```

- `npm run <script> -- <flags>`: el `--` separa los flags de npm de los que recibe el script.
- `extract:all` / `extract:teams` / `extract:outlook` equivalen a `--target all|teams|outlook`.
- Sin `--tenant`/`--tenants` aparece un menú para elegir uno o varios tenants.
- En Outlook, sin `--folders`/`--tabs`, se descubre el árbol del buzón y se elige por menú. Antes
  de abrir correos se muestra un resumen y se pide confirmación (salvo `--yes`).
- Si un tenant, carpeta o pestaña falla, se registra y se continúa con el resto; el resumen final
  separa correctas, vacías, omitidas y fallidas, y el código de salida es `1`.

### Flags

| Flag | Qué hace |
|---|---|
| `--target all\|teams\|outlook` | Qué aplicación exportar (por defecto `all`) |
| `--days N` | Últimos N días naturales incluyendo hoy (por defecto 7): desde las 00:00 de hace N-1 días hasta mañana 00:00 |
| `--since ISO` | Inicio **inclusivo** (p. ej. `2026-01-01` o `2026-01-01T00:00:00+01:00`); prevalece sobre `--days` |
| `--until ISO` | Fin **exclusivo**; por defecto mañana 00:00 local |
| `--tenant ID` | Tenant a usar (`id` de tu config); repetible |
| `--tenants A,B` | Lista de tenants separada por comas |
| `--account ID` | Alias antiguo de `--tenant` (no se puede combinar con él) |
| `--headless` | Ejecuta Chromium sin ventana; exige `--tenant(s)` y, en Outlook, `--folders` y `--tabs` (salvo `--discover-folders`) |
| `--yes` | Omite solo la confirmación final; nunca elige tenants ni carpetas por posición |
| `--timeout-minutes N` | Tiempo máximo por extracción (por defecto 180) |
| `--profile RUTA` | Raíz alternativa de perfiles (debajo se crean `teams/<id>/` y `outlook/<id>/`) |
| `--folder RUTA` | (Outlook) Ruta de carpeta literal; repetible; admite comas en el nombre |
| `--folders A,B` | (Outlook) Lista de carpetas separada por comas. Un nombre corto vale si es único; si no, usa la ruta completa (`Archive/Reports`) |
| `--tabs focused,other` | (Outlook) Pestañas a recorrer; acepta también `prioritarios`/`otros` |
| `--discover-folders` | (Outlook) Solo inicia sesión y lista las rutas de carpetas; no exporta |
| `--interactive` | Fuerza los menús aunque se pasen argumentos |
| `--include-html` | (Outlook) Guarda también el HTML del cuerpo |
| `--range-only` | (Outlook) Aplica el intervalo también a los correos *Pinned* (por defecto se incluyen todos los Pinned visibles) |
| `--account-label TEXTO` | Etiqueta heredada; se acepta pero el `id` del tenant siempre manda |
| `--help`, `-h` | Muestra la ayuda |

## Uso desde la consola del navegador

1. Abre `https://outlook.office.com/mail/` o `https://teams.microsoft.com/v2/` y deja visible la
   carpeta/pestaña o la lista de chats (y, si aplica, el chat).
2. `F12` → **Consola**. Pega el script completo. Ajusta antes el bloque `SETTINGS` (las líneas
   marcadas `← CAMBIAR`): `since`/`until` en ISO 8601 con zona horaria.
3. Ejecuta y espera el mensaje final. Descarga con la función que indica el log:

   | Script | Funciones de descarga |
   |---|---|
   | Outlook `01` | `downloadOutlookFolderJson()`, `downloadOutlookFolderText()` |
   | Outlook `02` | `downloadOutlookBodiesJson()`, `downloadOutlookBodiesText()` |
   | Teams `01` | `downloadTeamsChatInventory()` |
   | Teams `02`, `05` | `downloadTeamsCurrentChatJson()`, `downloadTeamsCurrentChatText()` |
   | Teams `03`, `04` | `downloadTeamsBatchJson()`, `downloadTeamsBatchText()`, `downloadTeamsChatTexts()` (un TXT por chat) |

   Para cancelar un export de Teams en curso: `window.teamsExportAbort = true`.
4. Archiva la descarga (opcional):

   ```bash
   npm run teams:import -- --tenant empresa ~/Downloads/teams-empresa-all-chats-2026-01-01-to-2026-01-08.json
   npm run outlook:import -- --tenant cliente ~/Downloads/cliente-Inbox-bodies-since-2026-01-01-to-2026-01-08.txt
   ```

   `--tenant ID` agrupa bajo ese tenant; la fecha (mes y día) se deduce del primer `AAAA-MM-DD`
   del nombre; si no hay, va a `sin-fecha/`. Solo copia; no borra el original.

## Estructura de salida

```text
data/
  teams-exports/raw/<tenant>/<AAAA-MM>/
    <DD>-teams-<tenant>[-to-<AAAA-MM-DD>]-run-<marca>.json|.txt
  outlook-exports/raw/<tenant>/<AAAA-MM>/<carpeta-sanitizada>-<hash8>/<focused|other|all>/
    <DD>-outlook-<tenant>--<carpeta>-<hash8>--<pestaña>[-to-<AAAA-MM-DD>]-run-<marca>.json|.txt
  <origen>-exports/raw/<tenant>/<AAAA-MM>/manual/   ← importaciones manuales
```

- `<AAAA-MM>` y `<DD>` salen de la fecha de inicio (`since`); `<hash8>` son 8 caracteres de un
  SHA-256 de la ruta de carpeta, para que dos carpetas con nombres parecidos no colisionen.
- El JSON incluye tenant y email configurados, intervalo pedido, contadores (mensajes/correos,
  Pinned, cuerpos fallidos, sin fecha) y diagnóstico del recorrido. Un correo cuyo panel no cargó
  queda con `bodyLoaded: false` y `bodyError: "reading-pane-timeout"`.
- Mientras corre se escribe `*.checkpoint.json` cada 15 s; se borra al completar y se conserva si
  falla, para diagnosticar.
- Directorios `0700` y ficheros `0600` (solo tu usuario puede leerlos).

## Tests

```bash
npm test
```

Ejecuta `check-syntax.js` y `node --test scripts/tests/*.test.js`. Los tests no abren navegador
ni usan red, y cargan tenants ficticios desde `scripts/tests/fixtures/tenants.test.json` (nunca
tu `config.local.json`). La validación real solo se puede hacer contra la web, porque Microsoft
cambia el DOM periódicamente: si algo deja de detectarse, ejecuta `outlook/00-debug.js` en la
consola y ajusta los selectores.

## Diferencia con `../teams/export-teams-chat.mjs`

| | `outlook-teams-web-export` (esta carpeta) | `teams/export-teams-chat.mjs` |
|---|---|---|
| Mecanismo | Scraping de la interfaz web con Playwright o pegando scripts en la consola | API REST de Microsoft Graph |
| Requisitos | Node + Chromium de Playwright, o solo un navegador | App registration en Entra ID con permiso delegado `Chat.Read` |
| Cubre | Outlook (correos, cuerpos) y Teams (chats) | Solo chats de Teams |
| Robustez | Frágil ante cambios del DOM; lento (scroll) | Estable y paginado |
| Útil cuando… | No puedes registrar apps o el tenant bloquea Graph | Tienes una app autorizada |
