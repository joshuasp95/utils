# mongodb-atlas

Utilidades para trabajar con **MongoDB Atlas** (el MongoDB gestionado de MongoDB Inc.): inventario y métricas en solo lectura con Atlas CLI, diagnóstico de conexión, filtrado de audit logs, generación de conexiones para Compass, atajos de mongosh en PowerShell, un linter de scripts mongosh y scripts para la Admin API.

## Conceptos base

- **Atlas CLI (`atlas`)**: CLI oficial de Atlas. Se autentica con `atlas auth login` (navegador) o con un perfil de API key (`atlas config init`). Comprueba la sesión con `atlas auth whoami`.
- **Proyecto / Project ID**: agrupación de clusters en Atlas; su ID (24 caracteres hex) se ve en *Project Settings* o con `atlas projects list`.
- **Proceso**: cada `mongod` de un cluster (`host:puerto`). Un replica set de 3 nodos son 3 procesos.
- **Private endpoint / Private Link**: conexión privada entre tu red (AWS/Azure/GCP) y Atlas, sin pasar por Internet. Los clusters tienen entonces hostnames distintos (suelen llevar `-pl-0`) y puertos propios por nodo.
- **SRV (`mongodb+srv://`)**: formato de URI en el que el driver descubre los nodos por DNS; el formato estándar (`mongodb://h1:p1,h2:p2`) los lista explícitamente.
- **mongosh**: shell interactiva de MongoDB (ejecuta JavaScript).

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `atlas-readonly-inventory.sh` | JSON compacto con identidad, clusters, procesos, alertas y (opcional) índices sugeridos de un proyecto. Allowlist cerrada de comandos de lectura | SOLO LECTURA |
| `atlas-latency-metrics.sh` | Configuración, puertos de Private Link, nodos y métricas (min/media/p95/max) de un cluster para valorar impacto de latencia de red | SOLO LECTURA en Atlas; escribe ficheros en `OUTDIR` |
| `generate-compass-connections.sh` | Genera `compass-connections.json` importable en Compass con todos los clusters que ves | SOLO LECTURA en Atlas; escribe un fichero local |
| `connection-test.py` | Diagnóstico paso a paso de una URI: DNS, TCP, TLS, ping, find_one | SOLO LECTURA |
| `filter-audit-events.py` | Filtra audit logs (texto, `.gz` o carpetas) por colección y comando; salida CSV/JSONL/resumen | SOLO LECTURA (ficheros locales) |
| `lint-mongo-requests.py` | Linter estático de peticiones de cambio con scripts mongosh `.js`: sintaxis y patrones de riesgo | SOLO LECTURA (ficheros locales) |
| `powershell/Connect-MongoAtlasProfile.ps1` | Catálogo de clusters por alias y funciones `mat`/`muri`/`mgo`/`mshow` para abrir mongosh | SOLO LECTURA por sí mismo |
| `admin-api/` | Bash, Python y Postman para la Atlas Admin API v2 con Service Account. Ver [admin-api/README.md](admin-api/README.md) | **ESCRIBE** (según comando) |

## Requisitos

- `atlas` CLI autenticado y `jq` para los `.sh` de la raíz (además `uuidgen` para el generador de Compass).
- Python 3.9+ para los `.py`; `connection-test.py` necesita `pymongo` (`pip install pymongo`).
- `node` en el PATH para que `lint-mongo-requests.py` valide sintaxis.
- PowerShell 5.1+/7+ y `mongosh` para el perfil de PowerShell.

## Variables y argumentos

| Variable / argumento | Script | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|---|
| `--project-id` | `atlas-readonly-inventory.sh` | Sí (salvo `--section whoami`) | ID del proyecto | `atlas projects list` |
| `--section` | `atlas-readonly-inventory.sh` | No | Secciones: `whoami,clusters,processes,alerts,advisor` | — |
| `$1` `$2` | `atlas-latency-metrics.sh` | Sí | `<PROJECT_ID>` y `<CLUSTER_NAME>` | `atlas clusters list --projectId <PROJECT_ID>` |
| `$3` `$4` | `atlas-latency-metrics.sh` | No | Periodo (`P7D`) y granularidad (`PT1H`) en formato ISO 8601 | — |
| `OUTDIR` | `atlas-latency-metrics.sh` | No | Carpeta de salida (por defecto `./output/...` junto al script) | — |
| `COMPASS_DB_USER` / `--user` | `generate-compass-connections.sh` | Sí | Usuario de BD que se inserta en cada URI | Atlas UI → Database Access |
| `COMPASS_PASSWORD_PLACEHOLDER` | `generate-compass-connections.sh` | No | Texto en lugar de la password (`CHANGE_PASSWORD`) | — |
| `OUTPUT` / `--output` | `generate-compass-connections.sh` | No | Fichero de salida | — |
| `--private-endpoint` | `generate-compass-connections.sh` | No | Usar la URI del private endpoint en vez de la pública | Úsalo si tu red solo llega a Atlas por Private Link |
| `MONGODB_URI` | `connection-test.py` | Sí | URI completa | Atlas UI → Connect → Drivers |
| `MONGODB_DB`, `MONGODB_COLLECTION` | `connection-test.py` | No | BD y colección para el `find_one` de prueba (si faltan, se omite) | — |
| `MONGODB_APPNAME` | `connection-test.py` | No | `appname` que verá el servidor | — |
| `inputs`, `--collections`, `--commands`, `--format` | `filter-audit-events.py` | `inputs` sí | Ficheros/carpetas, colecciones (sin filtro si se omite), comandos, formato | Logs descargados con `atlas logs download` |
| `--root` / `MONGO_REQUESTS_ROOT` | `lint-mongo-requests.py` | Sí (o `--request`) | Raíz `<root>/<tipo>/<YYYY-MM-DD>/<request>/` | Tu carpeta de peticiones |
| `--analysis-file` / `MONGO_ANALYSIS_FILE` | `lint-mongo-requests.py` | No | Nombre del fichero de análisis por request (`ANALYSIS.md`) | — |
| `$env:MONGO_ATLAS_USER`, `$env:MONGO_ATLAS_APPNAME` | `Connect-MongoAtlasProfile.ps1` | No | Usuario por defecto y appName | — |
| `$script:MongoAtlasTargets` | `Connect-MongoAtlasProfile.ps1` | Sí (editar) | Catálogo de alias → hostnames | `atlas clusters connectionStrings describe <CLUSTER> --projectId <PROJECT_ID>` |

## Ejemplos

### Inventario read-only

```bash
./atlas-readonly-inventory.sh --project-id <PROJECT_ID>
./atlas-readonly-inventory.sh --project-id <PROJECT_ID> --section clusters,alerts | jq .
./atlas-readonly-inventory.sh --project-id <PROJECT_ID> --dry-run
```

- `--section clusters,alerts`: solo esas secciones. `advisor` hace una llamada por proceso (lento).
- `--dry-run`: imprime por stderr los comandos que ejecutaría, sin llamar a Atlas.
- `| jq .`: formatea el JSON compacto para leerlo.
- Código de salida `3` = alguna sección falló pero el JSON se emitió igualmente.

### Métricas de latencia

```bash
./atlas-latency-metrics.sh <PROJECT_ID> my-cluster P7D PT1H
```

`P7D` = últimos 7 días; `PT1H` = un punto por hora. La métrica clave es `OP_EXECUTION_TIME_*` (tiempo dentro del servidor): si el servidor tarda 40 ms, +7 ms de red es ruido; si tarda 1 ms, no lo es. El resumen queda en `05-resumen-metricas.txt`.

### Conexiones para Compass

```bash
COMPASS_DB_USER=app-user ./generate-compass-connections.sh --private-endpoint
sed -i '' 's/CHANGE_PASSWORD/<TU_PASSWORD>/g' output/compass-connections.json   # macOS
```

- `--private-endpoint`: prioridad private endpoint SRV > private endpoint estándar > `privateSrv` > `standardSrv` > `standard`. Sin el flag: `standardSrv` > `standard`.
- `sed -i ''`: edita el fichero en sitio (en Linux es `sed -i` sin las comillas vacías).
- Importar en Compass: *Connections → ... → Import saved connections*. Tras importar, borra el JSON (contiene la password).

### Test de conexión

```bash
export MONGODB_URI='mongodb+srv://<USER>:<PASSWORD>@<CLUSTER_HOST>/?authSource=admin'
MONGODB_DB=mydb MONGODB_COLLECTION=orders python3 connection-test.py
```

### Audit logs

```bash
atlas logs download <HOSTNAME> mongodb-audit-log.gz --projectId <PROJECT_ID> --out audit.gz
./filter-audit-events.py audit.gz --collections orders customers --format summary
./filter-audit-events.py ./audit-logs/ --commands drop dropCollection dropIndexes --format jsonl
```

- `atlas logs download <HOSTNAME> mongodb-audit-log.gz`: descarga el audit log de un nodo (requiere auditoría activada en el proyecto); `--out` es el fichero destino.
- `--format summary`: conteos por colección, comando, usuario, IP remota y resultado. `csv` (por defecto) es para Excel; `jsonl` para seguir filtrando con `jq`.
- Sale con código 1 si no hay coincidencias.

### Linter de peticiones mongosh

```bash
./lint-mongo-requests.py --root ./requests --pending --summary
./lint-mongo-requests.py --request ./requests/collections/2026-06-04/my-change | jq .
```

- `--pending`: solo requests con `.js` y sin fichero de análisis (`--analysis-file`, por defecto `ANALYSIS.md`).
- Severidades: `FALLA` (no ejecutaría: sintaxis, falta `use()`/`getSiblingDB()`, colección con guion en `db.nombre-x`), `REVISAR` (`dropIndex` sin `try`, índice `unique`, TTL), `INFO` (operaciones destructivas). `verdictFloor` es orientativo: el veredicto final lo decide una persona.
- Sale con código 2 si hay algún hallazgo `FALLA`.

### PowerShell

```powershell
. .\powershell\Connect-MongoAtlasProfile.ps1   # dot-sourcing: carga las funciones en la sesión
mat                         # lista alias
mgo app1-dev mydb           # mongosh por hostname privado; pide password
mgo app1-dev mydb -Standard # por hostname público
```

Antes, edita `$script:MongoAtlasTargets` con tus clusters (los ejemplos son ficticios).
