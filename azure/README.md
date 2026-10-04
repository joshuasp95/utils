# azure

Barrido mensual de salud de una suscripción Azure en **solo lectura**: Container Apps, Log Analytics,
Application Insights, PostgreSQL Flexible Server, Front Door/CDN, Data Factory y Databricks. Cada
consulta deja su resultado en un fichero de texto para revisarlo o adjuntarlo a un informe.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `azure-readonly-sweep.sh` | Barrido principal por entorno: inventario del resource group, salud y métricas de Container Apps, operaciones fallidas (Activity Log 30 d), enrutado de logs y patrones de error, telemetría y top de excepciones de App Insights, salud y métricas de PostgreSQL, Front Door/CDN; más inventario de Data Factory/Databricks | SOLO LECTURA en Azure · escribe ficheros en el directorio de salida |
| `azure-readonly-supplemental.sh` | Consultas KQL complementarias: cobertura por tabla de logs, errores uniendo esquema nuevo y antiguo de logs, telemetría con `AppRequests`, tasas de fallo de requests/dependencias, top 15 de excepciones y su distribución diaria por rol | SOLO LECTURA en Azure · escribe ficheros en el directorio de salida |

## Requisitos

- `az` CLI con las extensiones `containerapp`, `datafactory` y `databricks` (la CLI ofrece instalarlas
  la primera vez que se usan; o `az extension add --name <EXTENSION>`).
- `jq` y `awk`.
- Sesión iniciada: `az login`, con permisos de lectura (p. ej. rol *Reader* + *Log Analytics Reader*).
- macOS o Linux: la ventana de 30 días usa `date -v-30d` (BSD/macOS) y, si falla, `date -d '30 days ago'`
  (GNU/Linux).

## Variables

Los nombres de recursos se definen como **plantillas** donde `{env}` se sustituye por cada entorno
de `ENVIRONMENTS`. Ejemplo: con `RG_TEMPLATE="rg-shop-{env}"` y `ENVIRONMENTS="qa prod"` se recorren
`rg-shop-qa` y `rg-shop-prod`.

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `$1` (argumento) | Sí | Directorio de salida | Lo eliges tú (p. ej. `out/2026-10`) |
| `AZ_SUBSCRIPTION` | Sí | Nombre o id de la suscripción; se pasa con `--subscription` a cada llamada | `az account list --query '[].{name:name,id:id}' -o table` |
| `ENVIRONMENTS` | No (def. `dev qa prod`) | Entornos a recorrer, separados por espacios | Convención de nombres de tus recursos |
| `RG_TEMPLATE` | No (def. `rg-app-{env}`) | Resource group de cada entorno | `az group list -o table` |
| `CONTAINER_APPS` | No (def. `ca-api-{env} ca-worker-{env}`) | Container Apps a revisar, separadas por espacios | `az containerapp list -g <RG> -o table` |
| `LAW_TEMPLATE` | No (def. `law-app-{env}`) | Workspace de Log Analytics | `az monitor log-analytics workspace list -g <RG> -o table` |
| `CAE_TEMPLATE` | No (def. `cae-app-{env}`) | Container Apps Environment (para saber a qué workspace manda los logs) | `az containerapp env list -g <RG> -o table` |
| `APPI_TEMPLATE` | No (def. `appi-{env}`) | Componente de Application Insights (se filtra por el final de `_ResourceId`) | `az resource list -g <RG> --resource-type microsoft.insights/components -o table` |
| `POSTGRES_SERVERS` | No (def. `psql-app-{env}`) | PostgreSQL Flexible Servers, separados por espacios (solo el barrido principal) | `az postgres flexible-server list -g <RG> -o table` |
| `AZ_BIN` | No (def. `az`) | Binario de la CLI (solo el barrido principal) | — |
| `RUN_DATE` | No (def. hoy) | Fecha que se escribe en la cabecera | — |

## Ejemplos

```bash
export AZ_SUBSCRIPTION="<SUBSCRIPTION_NAME_O_ID>"
export ENVIRONMENTS="qa prod"
export RG_TEMPLATE="rg-<PROYECTO>-{env}"
export CONTAINER_APPS="ca-api-{env} ca-worker-{env}"
export POSTGRES_SERVERS="psql-<PROYECTO>-{env}"

./azure-readonly-sweep.sh out/<FECHA>
./azure-readonly-supplemental.sh out/<FECHA>   # mismo directorio: ficheros 10-15, no pisa nada
```

- `export VAR=...`: deja la variable disponible para los scripts que lances después en esa terminal.
- Las comillas en `"ca-api-{env} ca-worker-{env}"` son necesarias para que la lista sea un solo valor.

Flags de `az` que aparecen en los scripts:

- `--subscription`: suscripción sobre la que actúa cada comando (no cambia tu suscripción por defecto).
- `--query`: filtro JMESPath sobre la respuesta JSON (p. ej. `[?properties.active]` = solo activas).
- `-o table|tsv|json|none`: formato de salida; `tsv` sirve para capturar un valor en una variable,
  `none` para solo comprobar si el comando funciona.
- `--analytics-query`: consulta KQL (lenguaje de Log Analytics); `--timespan P30D` = últimos 30 días
  en formato ISO 8601.
- `--interval PT1H`: granularidad de 1 hora en las métricas; `--aggregation`: Average/Maximum/...

## Notas de interpretación

- `04-loganalytics-routing.txt`: si dice `mismatch`, el Container Apps Environment manda los logs a otro
  workspace distinto de `LAW_TEMPLATE`; los resultados vacíos en el workspace esperado **no** significan
  ausencia de errores.
- Las palabras clave de error de las consultas KQL (`KafkaException`, `Connection refused`, ...) son
  ejemplos: adáptalas a tu aplicación.
