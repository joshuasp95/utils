# admin-api — MongoDB Atlas Admin API v2 (Service Account OAuth2)

Scripts (Bash y Python) y una colección Postman para operar sobre un proyecto de MongoDB Atlas a través de la [Atlas Admin API v2](https://www.mongodb.com/docs/atlas/reference/api-resources-spec/v2/), autenticando con un **Service Account** (OAuth2, flujo `client_credentials`).

> **Atención: la mayoría de comandos ESCRIBEN.** Crean/borran usuarios de BD, modifican la IP Access List, pausan/reanudan/borran clusters y crean/restauran snapshots. Revisa la columna *Efectos* antes de ejecutar nada contra un proyecto real.

## Conceptos base

- **Admin API v2**: API REST de Atlas para gestionar recursos (clusters, usuarios, red, backups). URL base `https://cloud.mongodb.com/api/atlas/v2`. Se versiona por fecha con la cabecera `Accept: application/vnd.atlas.<YYYY-MM-DD>+json` (aquí `ATLAS_API_VERSION=2023-02-01`).
- **Service Account**: identidad "de máquina" de Atlas con un `client_id` y un `client_secret`. Se intercambian por un **token Bearer** (válido ~1 h) en el endpoint OAuth2. Los scripts lo piden y renuevan solos.
- **Project ID / groupId**: identificador del proyecto Atlas. En las URLs de la API aparece como `/groups/<ATLAS_PROJECT_ID>/...`.
- **IP Access List**: lista de IPs/CIDR desde las que Atlas acepta conexiones al proyecto.
- **Snapshot / restore job**: copia de seguridad de un cluster (Cloud Backup, tiers M10+) y la tarea que la vuelca sobre un cluster destino.

## Estructura

```
admin-api/
├── .env.example           # Plantilla de variables (copiar a .env)
├── bash/
│   ├── auth.sh            # Obtiene el token OAuth2
│   ├── common.sh          # Funciones compartidas (se carga con source)
│   ├── clusters.sh
│   ├── db-users.sh
│   ├── ip-access-list.sh
│   └── snapshots.sh
├── python/
│   ├── requirements.txt
│   ├── atlas_client.py    # Cliente base (auth + HTTP), lo importan los demás
│   ├── clusters.py
│   ├── db_users.py
│   ├── ip_access_list.py
│   └── snapshots.py
└── postman/
    ├── atlas-admin-api.postman_collection.json
    └── atlas-admin-api.postman_environment.json   # solo placeholders
```

## Scripts y efectos por comando

Bash (`bash/*.sh`) y Python (`python/*.py`) ofrecen los mismos comandos.

| Fichero | Comando | Qué hace | Efectos |
|---|---|---|---|
| `auth.sh` | — | Obtiene un token Bearer | SOLO LECTURA |
| `clusters.sh` / `clusters.py` | `list`, `get <CLUSTER>` | Lista / detalla clusters | SOLO LECTURA |
| | `pause <CLUSTER>` | `PATCH {"paused": true}` | **ESCRIBE**: detiene el cluster (las apps pierden conexión) |
| | `resume <CLUSTER>` | `PATCH {"paused": false}` | **ESCRIBE**: arranca el cluster |
| | `delete <CLUSTER>` | `DELETE` del cluster | **ESCRIBE, DESTRUCTIVO**: borra cluster y datos (pide confirmación) |
| `db-users.sh` / `db_users.py` | `list`, `get <USER> [authDb]` | Lista / detalla usuarios de BD | SOLO LECTURA |
| | `create <USER> <PASSWORD> <ROLE>` | Crea usuario de BD | **ESCRIBE** |
| | `rotate <USER> <NEW_PASSWORD> [authDb]` | Cambia la contraseña | **ESCRIBE**: las apps con la contraseña antigua dejan de conectar |
| | `delete <USER> [authDb]` | Borra usuario | **ESCRIBE, DESTRUCTIVO** (pide confirmación) |
| `ip-access-list.sh` / `ip_access_list.py` | `list` | Lista entradas | SOLO LECTURA |
| | `add <CIDR> [comentario]` | Añade IP/CIDR | **ESCRIBE**: abre acceso de red |
| | `delete <CIDR>` | Quita IP/CIDR | **ESCRIBE**: corta acceso desde esa IP (pide confirmación) |
| `snapshots.sh` / `snapshots.py` | `list <CLUSTER>` | Lista snapshots | SOLO LECTURA |
| | `create <CLUSTER> [desc] [días]` | Snapshot on-demand | **ESCRIBE**: consume almacenamiento de backup |
| | `restore <CLUSTER> <SNAPSHOT_ID> <TARGET>` | Restore job `automated` | **ESCRIBE, DESTRUCTIVO para `<TARGET>`**: sobrescribe sus datos. **No pide confirmación** |

Notas:
- `db-users.sh create` siempre usa `admin` como authDb; `db_users.py create` acepta un 4.º argumento `authDb`.
- Pasar contraseñas como argumento las deja en el historial del shell (`history`). Para evitarlo en zsh/bash, deja un espacio delante del comando si `HISTCONTROL=ignorespace` / `setopt HIST_IGNORE_SPACE` está activo.

## Requisitos

- **Bash**: `bash`, `curl`, `jq`, `column`, `base64`.
- **Python**: Python 3.10+ (usa la sintaxis `str | None`), `requests`, `python-dotenv` (`pip install -r python/requirements.txt`).
- **Postman**: cualquier versión reciente (formato Collection v2.1).
- Un Service Account de Atlas con rol suficiente en el proyecto (p.ej. *Project Owner* para escrituras, *Project Read Only* si solo vas a listar).

## Variables

Se leen de `admin-api/.env` (si existe) o del entorno.

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `ATLAS_CLIENT_ID` | Sí | Client ID del Service Account | Atlas UI → Organization (o Project) → Access Manager → Service Accounts |
| `ATLAS_CLIENT_SECRET` | Sí | Client Secret del Service Account | Se muestra solo al crearlo; si se pierde, generar otro |
| `ATLAS_PROJECT_ID` | Sí | ID del proyecto (groupId) | Atlas UI → Project Settings, o `atlas projects list` |
| `ATLAS_TOKEN_URL` | No | Endpoint OAuth2 | Valor por defecto en los scripts (`.env.example` trae `https://cloud.mongodb.com/api/oauth/token`) |
| `ATLAS_API_BASE` | No | URL base de la API | Por defecto `https://cloud.mongodb.com/api/atlas/v2` |
| `ATLAS_API_VERSION` | No | Versión (fecha) de la API | Por defecto `2023-02-01` |

Aviso: si no defines `ATLAS_TOKEN_URL`, `auth.sh` y `atlas_client.py` usan `https://services.cloud.mongodb.com/api/oauth/token` (heredado del original). Con el `.env` copiado de `.env.example` se usa `https://cloud.mongodb.com/api/oauth/token`. Si el token falla, prueba la otra.

## Uso

### Configuración

```bash
cd admin-api
cp .env.example .env      # copia la plantilla
chmod 600 .env            # solo tu usuario puede leerlo (contiene un secreto)
# edita .env con los valores reales
```

### Bash

```bash
bash bash/clusters.sh list
bash bash/clusters.sh pause  <CLUSTER_NAME>
bash bash/clusters.sh resume <CLUSTER_NAME>

bash bash/db-users.sh list
bash bash/db-users.sh create app-user '<PASSWORD>' readWrite
bash bash/db-users.sh rotate app-user '<NEW_PASSWORD>'

bash bash/ip-access-list.sh list
bash bash/ip-access-list.sh add 203.0.113.5/32 "Office IP"
bash bash/ip-access-list.sh delete 203.0.113.5/32

bash bash/snapshots.sh list    <CLUSTER_NAME>
bash bash/snapshots.sh create  <CLUSTER_NAME> "Pre-deploy backup" 7
bash bash/snapshots.sh restore <CLUSTER_NAME> <SNAPSHOT_ID> <TARGET_CLUSTER_NAME>

source bash/auth.sh       # deja ATLAS_TOKEN en tu shell para hacer curl a mano
```

`/32` en un CIDR significa "exactamente esa IP"; `/24` serían 256 direcciones. `203.0.113.0/24` es un rango reservado para documentación.

### Python

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate   # entorno virtual aislado (opcional)
pip install -r requirements.txt

python clusters.py list
python db_users.py create app-user '<PASSWORD>' readWrite mydb
python ip_access_list.py add 10.0.0.0/8 "Red interna"
python snapshots.py create <CLUSTER_NAME> "Backup pre-deploy" 7
```

### Postman

1. Importa `postman/atlas-admin-api.postman_collection.json` y `postman/atlas-admin-api.postman_environment.json`.
2. Selecciona el environment **Atlas Admin API - Service Account**.
3. Sustituye los placeholders `<...>` (`ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET`, `ATLAS_PROJECT_ID`, `ATLAS_CLUSTER_NAME`, ...) en *Current value* (no en *Initial value*, para no sincronizarlos).
4. Ejecuta **Auth → Get OAuth2 Token** (o deja que el pre-request script de la colección lo pida solo).
5. Los requests `Pause/Resume/Create/Delete Cluster`, `Create/Rotate/Delete DB User`, `Add IP / Delete Access Entry`, `Create On-Demand Snapshot` y `Restore Snapshot to Cluster` **escriben**. Ojo con `Delete Cluster`: usa `retainBackups=false` (borra también los backups).

## Seguridad

- `.env` no debe subirse nunca al repositorio (añádelo a `.gitignore`).
- `bash auth.sh` ejecutado directamente imprime el token: trátalo como una credencial.
- En Postman, las variables de tipo `secret` no se muestran en la consola.
