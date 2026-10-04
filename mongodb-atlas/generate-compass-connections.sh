#!/usr/bin/env bash
# generate-compass-connections.sh — genera un JSON importable en MongoDB Compass con todos
#                                   los clusters accesibles desde tu sesión de Atlas CLI.
#
# Qué hace:     Recorre todos los proyectos que ve el usuario logado en Atlas CLI, obtiene la
#               connection string de cada cluster, le inserta usuario + placeholder de password
#               y escribe un fichero con el formato "Compass Connections" (favoritos).
# Requisitos:   atlas CLI autenticado (`atlas auth login`), jq, sed, uuidgen.
# Uso:          COMPASS_DB_USER=<DB_USER> ./generate-compass-connections.sh
#               COMPASS_DB_USER=<DB_USER> ./generate-compass-connections.sh --private-endpoint
#               ./generate-compass-connections.sh --user <DB_USER> --output /ruta/compass.json
# Variables:    COMPASS_DB_USER / --user  (obligatorio) usuario de BD que se mete en cada URI.
#               COMPASS_PASSWORD_PLACEHOLDER (opcional) texto que se pone en lugar de la
#                                password. Por defecto CHANGE_PASSWORD.
#               OUTPUT / --output (opcional) fichero de salida. Por defecto
#                                ./output/compass-connections.json junto al script.
#               --private-endpoint (opcional) prioriza la connection string del PRIVATE ENDPOINT
#                                (Private Link). Úsalo cuando tu red solo llega a Atlas por
#                                Private Link: el hostname público (standardSrv) resuelve a IP
#                                pública y da ETIMEDOUT. Sin el flag se usa la pública
#                                (standardSrv > standard).
# Efectos:      SOLO LECTURA en Atlas (projects list/describe, clusters list, connectionStrings
#               describe). ESCRIBE un fichero local (OUTPUT).
# Salida:       JSON con el formato { type, version, connections: [...] } en OUTPUT.
#               Después: sustituir el placeholder de password e importar en Compass
#               (Connections → ... → Import saved connections).

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OUTPUT="${OUTPUT:-$SCRIPT_DIR/output/compass-connections.json}"
DB_USER="${COMPASS_DB_USER:-}"
PLACEHOLDER="${COMPASS_PASSWORD_PLACEHOLDER:-CHANGE_PASSWORD}"
PRIVATE_ENDPOINT=0

while [ $# -gt 0 ]; do
    case "$1" in
        --user)             DB_USER="${2:?--user requiere un valor}"; shift 2 ;;
        --output)           OUTPUT="${2:?--output requiere un valor}"; shift 2 ;;
        --private-endpoint) PRIVATE_ENDPOINT=1; shift ;;
        -h|--help)          sed -n '2,26p' "$0"; exit 0 ;;
        *) echo "Argumento desconocido: $1 (usa --help)" >&2; exit 1 ;;
    esac
done

: "${DB_USER:?Define COMPASS_DB_USER o pasa --user (usuario de BD de Atlas, ej: app-user)}"

mkdir -p "$(dirname "$OUTPUT")"

echo "Obteniendo proyectos de Atlas..."
projects_json=$(atlas projects list --output json 2>/dev/null)
# jq: según la versión de Atlas CLI la respuesta es un array o un objeto {results:[...]}
project_ids=$(echo "$projects_json" | jq -r 'if type == "array" then .[].id else .results[].id end' 2>/dev/null)

if [ -z "$project_ids" ]; then
    echo "ERROR: no se encontraron proyectos. Comprueba: atlas auth whoami"
    exit 1
fi

entries=()

for projectId in $project_ids; do
    projectName=$(atlas projects describe "$projectId" --output json 2>/dev/null | jq -r '.name // "unknown"')
    echo "  Proyecto: $projectName ($projectId)"

    clusters_json=$(atlas clusters list --projectId "$projectId" --output json 2>/dev/null)
    cluster_names=$(echo "$clusters_json" | jq -r 'if type == "array" then .[].name else .results[].name end' 2>/dev/null)

    if [ -z "$cluster_names" ]; then
        echo "    Sin clusters o sin acceso."
        continue
    fi

    for clusterName in $cluster_names; do
        echo "    Cluster: $clusterName"
        cs_json=$(atlas clusters connectionStrings describe "$clusterName" \
            --projectId "$projectId" --output json 2>/dev/null)

        if [ "$PRIVATE_ENDPOINT" -eq 1 ]; then
            # Con --private-endpoint: los clusters se alcanzan por PRIVATE ENDPOINT (Private
            # Link). Se usa el SRV del private endpoint (hostname tipo <cluster>-pl-0.xxxx.mongodb.net).
            # Prioridad: private endpoint SRV > private endpoint estándar > privateSrv
            #            > standardSrv > standard.
            # NOTA: si un cluster tiene varios private endpoints (varias regiones), se coge
            # el primero [0]; revisar si algún cluster necesita otro.
            connStr=$(echo "$cs_json" | jq -r '
                .privateEndpoint[0].srvConnectionString //
                .privateEndpoint[0].connectionString //
                .privateSrv //
                .standardSrv //
                .standard //
                empty')
        else
            # Sin el flag: connection string pública (SRV si existe).
            connStr=$(echo "$cs_json" | jq -r '.standardSrv // .standard // empty')
        fi

        if [ -z "$connStr" ]; then
            echo "      WARN: sin connection string, saltando."
            continue
        fi

        # Insertar usuario y placeholder de password (soporta srv y no-srv):
        # mongodb+srv://host → mongodb+srv://<user>:<placeholder>@host
        connStrWithCreds=$(echo "$connStr" | sed -E "s|mongodb(\+srv)?://|mongodb\1://$DB_USER:$PLACEHOLDER@|")
        uuid=$(uuidgen | tr '[:upper:]' '[:lower:]')

        entries+=("$(cat <<EOF
    {
      "id": "$uuid",
      "connectionOptions": {
        "connectionString": "$connStrWithCreds"
      },
      "savedConnectionType": "favorite",
      "favorite": {
        "name": "$projectName - $clusterName"
      }
    }
EOF
)")
    done
done

if [ ${#entries[@]} -eq 0 ]; then
    echo "ERROR: no se generó ninguna conexión."
    exit 1
fi

# Escribir JSON con el formato que espera Compass: objeto envoltorio
# { type, version, connections: [...] }, no un array plano.
{
    printf '{\n'
    printf '  "type": "Compass Connections",\n'
    printf '  "version": {\n    "$numberInt": "1"\n  },\n'
    printf '  "connections": [\n'
    for i in "${!entries[@]}"; do
        if [ "$i" -lt $(( ${#entries[@]} - 1 )) ]; then
            printf "%s,\n" "${entries[$i]}"
        else
            printf "%s\n" "${entries[$i]}"
        fi
    done
    printf '  ]\n'
    printf '}\n'
} > "$OUTPUT"

echo ""
echo "Generado: $OUTPUT (${#entries[@]} conexiones)"
echo ""
echo "Para cambiar la password antes de importar (macOS: sed -i ''; Linux: sed -i):"
echo "  sed -i '' 's/$PLACEHOLDER/<TU_PASSWORD>/g' $OUTPUT"
