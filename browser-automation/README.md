# browser-automation

Scripts **Node.js + [Playwright](https://playwright.dev/)** que controlan un navegador real para leer datos de aplicaciones web sin API pública. Playwright es una librería que abre Chromium/Firefox/WebKit y permite hacer clic, escribir y leer el DOM desde código.

| Carpeta / fichero | Qué hace | Efectos |
|---|---|---|
| `workday/extract-time-types.js` | Recorre el selector jerárquico "Time Type" de Workday y exporta el catálogo completo de tipos de tiempo imputables | **Solo lectura** en Workday (abre "Enter Time" y cierra con Cancel, nunca guarda) · ESCRIBE en local: `out/*.json`, `out/*.txt`, perfil del navegador, `tmp/debug/*.png` con `--debug` |
| `workday/navigation.js` | Módulo: navega de la home de Workday a Time → vista mensual | Solo lectura |
| `workday/time-type-record.js` | Módulo: normaliza una ruta del árbol en un registro (categoría, ruta, tipo sin fechas) | Función pura |
| `workday/extract-time-types.test.js` | Tests [vitest](https://vitest.dev/) de la validación de argumentos y de `time-type-record.js` | Ninguno (no abre navegador) |
| `playwright-evidence-capture/` | Esqueleto genérico para healthchecks mensuales: login SSO manual en varias consolas, capturas de evidencia por entorno/sección y borrador del informe en Markdown. Secciones enchufables por configuración | **Solo lectura** en las consolas · ESCRIBE en local: `output/<run-id>/`, perfil del navegador, informe `.md`. Ver [su README](playwright-evidence-capture/README.md) |

## Requisitos

- Node.js 18 o superior (20.6+ si quieres usar `--env-file`).
- Dependencias de la carpeta: `npm install` (instala `playwright` y `vitest`, definidos en `package.json`).
- Navegador para Playwright: `npx playwright install chromium` (descarga un Chromium propio en la caché de Playwright). No hace falta si defines `CHROMIUM_PATH`.
- Cuenta de Workday con login SSO (SAML → Microsoft Entra ID). El MFA lo completas tú en la ventana.

## Variables

Copia `.env.example` a `.env` y rellénalo. El script **no** carga `.env` solo: usa `node --env-file=.env …` o expórtalo en el shell (ver ejemplos).

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `WORKDAY_URL` | Sí* | URL de login de tu tenant Workday | La barra de direcciones al entrar en Workday (formato `https://<HOST>.myworkday.com/wday/authgwy/<TENANT>/login.htmld`) |
| `WORKDAY_EMAIL` | Sí* | Email corporativo para el SSO | Tu cuenta de trabajo |
| `WORKDAY_PASSWORD` | No | Si existe, se autorrellena en el login de Microsoft | Mejor no definirla y teclearla en la ventana |
| `WORKDAY_USER_DATA_DIR` | No | Carpeta del perfil persistente del navegador (cookies) para reutilizar sesión | Por defecto `workday/.browser-session/` (ignorada por git) |
| `CHROMIUM_PATH` | No | Ejecutable de Chrome/Chromium a usar | Vacío = el de Playwright |

\* Alternativa: `--config=<ruta.json>` con `{ "workdayUrl": "...", "email": "..." }`. Las variables de entorno tienen prioridad sobre el JSON.

## Argumentos de `extract-time-types.js`

| Argumento | Qué hace |
|---|---|
| `--day=YYYY-MM-DD` | Día del calendario donde se abre "Enter Time" (por defecto hoy; debe ser del año actual). Workday no deja abrirlo en periodos futuros no abiertos ni en semanas ya aprobadas. |
| `--only=<TEXTO>` | Solo recorre ramas de segundo nivel cuyo nombre contenga ese texto (sin distinguir mayúsculas). |
| `--roots-only` | Solo lista el primer nivel bajo cada categoría (rápido). El resultado se marca como parcial. |
| `--max-depth=N` | Profundidad máxima del árbol (1-20, por defecto 5). |
| `--out=<ruta-base>` | Ruta base de salida sin extensión (por defecto `out/time-types-<hoy>`). |
| `--config=<ruta>` | JSON con `workdayUrl` y `email` (alternativa a las variables). |
| `--debug` | Guarda capturas en `tmp/debug/` y lista cada fila leída. |
| `--help` | Muestra la ayuda. |

## Ejemplos de uso

```bash
cd browser-automation/workday
npm install                         # instala playwright + vitest según package.json
npx playwright install chromium     # descarga el navegador de Playwright (una vez)
cp .env.example .env                # y edita WORKDAY_URL / WORKDAY_EMAIL

# --env-file=.env: Node lee las variables del fichero .env (Node 20.6+)
node --env-file=.env extract-time-types.js --roots-only

# Alternativa sin --env-file: set -a exporta todas las variables que se definan; source lee el .env; set +a lo desactiva
set -a; source .env; set +a
node extract-time-types.js --only=<TEXTO> --max-depth=4 --debug

npm test                            # vitest run: ejecuta los tests una vez (sin modo watch)
```

## Salida

- `out/time-types-<fecha>.json`: `status` (`complete`/`partial`), recuento por categoría, `leaves` (cada hoja con `category`, `path`, `confirmed_full_type`…) y `unknown` (ramas no expandidas o filas sin clasificar).
- `out/time-types-<fecha>.txt`: lista legible agrupada por categoría.
- Si el resultado es parcial, el nombre lleva `.partial` y el proceso termina con código `2`.

## Avisos

- Depende de `data-automation-id` y textos en inglés de la interfaz de Workday ("Time", "Week", "Month", "Cancel"…). Si Workday cambia el DOM, usa `--debug` para ver capturas y diagnóstico.
- `.browser-session/` contiene cookies de tu sesión: no la subas a git (ya está en `.gitignore`).

---

# playwright-evidence-capture

Esqueleto reutilizable para el healthcheck mensual de "entrar en varias consolas web, hacer capturas de evidencia y redactar el informe". Documentación completa (arquitectura, variables, cómo añadir secciones) en [`playwright-evidence-capture/README.md`](playwright-evidence-capture/README.md).

| Fichero | Qué hace | Efectos |
|---|---|---|
| `src/login.js` | Abre una pestaña por consola de un perfil; haces el SSO a mano y pulsas ENTER | ESCRIBE la sesión en `.browser-session/` |
| `src/capture.js` | Recorre secciones × entornos y guarda capturas | **Solo lectura** remota · ESCRIBE `output/<run-id>/` |
| `src/report.js` | Genera el borrador del informe con la matriz vacía y enlaces a las capturas | ESCRIBE un `.md` (con `--write`, copia que nunca sobrescribe) |
| `src/sections/*.js` | Tipos de sección de ejemplo: `portal-page`, `dashboard-time-range` (Kibana/Grafana con rango temporal) y `cloud-resource-blade` (portal tipo Azure) | ESCRIBE capturas |

Requisitos: Node.js 18+, `npm install` y `npm run install:browsers` dentro de la carpeta. Se configura con variables de entorno o con un JSON (`config.example.json` → `config.json`).

```bash
cd browser-automation/playwright-evidence-capture
npm install && npm run install:browsers
cp config.example.json config.json          # edita entornos y secciones
npm run login -- sso --config=./config.json  # "sso" = valor de sections[].profile
npm run capture -- --config=./config.json --env=prod   # --env: solo esos entornos
npm run report -- --config=./config.json               # borrador en output/<run-id>/
```
