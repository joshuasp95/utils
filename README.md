# utils

Colección personal de scripts reutilizables entre proyectos y empresas. Todos están **anonimizados**: no
contienen nombres de clientes, hosts, IDs de cuentas ni secretos. Lo específico de cada entorno se
pasa por **variables de entorno**, **argumentos** o **ficheros `*.example`** que copias y rellenas.

Cada carpeta tiene su propio `README.md` con el detalle: qué hace cada script, requisitos, tabla de
variables (qué son y de dónde sacar el valor) y ejemplos con cada flag explicado.

## Índice

| Carpeta | Contenido | Efectos |
|---|---|---|
| [`aws/`](aws/README.md) | Inventario read-only de una cuenta AWS (RDS, ACM, ECS, EKS, Config, backups) y Lambda para escalar un Auto Scaling Group | Lectura / la Lambda escribe |
| [`azure/`](azure/README.md) | Barrido read-only de una suscripción (Container Apps, Log Analytics, App Insights, PostgreSQL) para healthchecks | Lectura |
| [`mongodb-atlas/`](mongodb-atlas/README.md) | Inventario, métricas de latencia, filtro de audit logs, test de conexión, conexiones de Compass, linter de requests mongosh y cliente de la Atlas Admin API (bash, Python, Postman) | Lectura, salvo `admin-api` |
| [`kubernetes/`](kubernetes/README.md) | Recogida de evidencias en OpenShift/Kubernetes, login por token a varios clusters, `kubectl explain` de CRDs | Lectura |
| [`incident-evidence/`](incident-evidence/README.md) | Plantilla para recoger evidencias de un incidente con trazabilidad (fecha, comando exacto, redacción de secretos) | Lectura |
| [`security/`](security/README.md) | Inspección de certificados `.p7b` con `openssl` | Lectura |
| [`liferay/`](liferay/README.md) | Scripts Groovy para la consola de scripts de Liferay (companies, usuarios, config de mail, reset de password, API headless) | Lectura, salvo el reset |
| [`git/`](git/README.md) | Clonar todos los repos de un grupo de GitLab | Escribe en local |
| [`http/`](http/README.md) | Bucle "listado + detalle por id" contra una API REST | Lectura (API) |
| [`browser-console/`](browser-console/README.md) | Snippets para la consola del navegador: export de LinkedIn (guardados, reacciones), transcripciones de Microsoft Stream, registros de Workday | Lectura |
| [`browser-automation/`](browser-automation/README.md) | Playwright: extracción del catálogo de Time Types de Workday; esqueleto genérico de captura de evidencias (screenshots + informe) para healthchecks mensuales | Lectura / escribe capturas e informe locales |
| [`microsoft-365/`](microsoft-365/README.md) | Export de chats de Teams vía Microsoft Graph; export de correos de Outlook Web y chats de Teams Web con Playwright (scraping de la interfaz) | Lectura / escribe exports locales |
| [`documents/`](documents/README.md) | Conversores y utilidades de documentos: Markdown→DOCX, XLSX/CSV→tablas, NDJSON→HTML, anotaciones de PDF, verificador de docs bash/PowerShell | Escribe en local |
| [`editors/`](editors/README.md) | Configuración de Neovim; extraer notas de las pestañas temporales de Sublime Text y limpiarlas | `clear-*` sobrescribe la sesión |
| [`ai-agents/`](ai-agents/README.md) | Hooks de Claude Code y Codex, validador de guiones de podcast e informe de sesiones de IA | Lectura / bloqueo de comandos |
| [`shell/`](shell/README.md) | Configuración de zsh: `.zshrc` de ejemplo, plugins y tema, historial con backups, funciones, alias, completions y atajos de teclado | Historial y backups en local |
| [`macos/`](macos/README.md) | Actualización de Homebrew y **réplica de este Mac** en otro (`setup/`: Brewfile, bootstrap, ajustes del sistema, inventario y runbook) | Escribe (paquetes, ajustes) solo al ejecutarlo |
| [`misc/`](misc/README.md) | Varios (descifrado César) | — |

## Convenciones

- **Cabecera en cada script**, con *Qué hace*, *Requisitos*, *Uso*, *Variables*, *Efectos* (solo lectura
  o qué escribe) y *Salida*.
- **Variables obligatorias** en bash: `: "${VAR:?mensaje}"`. Esta línea hace que el script se pare con un
  mensaje claro si la variable no está definida, en lugar de seguir con un valor vacío.
- **Secretos**: nunca dentro del repo. Se pasan por variable de entorno o con un `.env` local, que el
  [`.gitignore`](.gitignore) excluye. Solo se versionan los `*.example`.
- **Salidas generadas** (`output/`, `evidencias/`, `*.log`): están ignoradas por git.

## Trabajar en el repo

1. Añade o modifica el script y actualiza el `README.md` de su carpeta si cambia el uso.
2. Prueba manualmente el script en el entorno adecuado. Revisa que no haya credenciales, datos
   personales ni salidas generadas entre los archivos que vas a subir.
3. Revisa los cambios con `git status --short` y `git diff`; añade solo los archivos que correspondan
   con `git add <archivo>`.
4. Comprueba el contenido preparado con `git diff --cached --stat` y `git diff --cached`, haz el
   commit con un mensaje descriptivo y súbelo cuando esté listo.

No hay hooks de Git ni verificaciones automáticas en GitHub. Cada script indica sus requisitos y
efectos en su cabecera y en el README de su carpeta.
