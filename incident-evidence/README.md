# incident-evidence

Plantilla reutilizable para recoger evidencias de un incidente en **solo lectura**, dejando cada salida
en un fichero numerado con una cabecera de trazabilidad (ticket, fecha UTC, quién, comando exacto), lista
para adjuntar al ticket.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `collect-evidence.sh` | Ejecuta los comandos definidos en su función `collect()` y guarda cada salida en `<EVIDENCE_ROOT>/<TICKET>/evidencias/NN-<nombre>.txt` | SOLO LECTURA en los sistemas consultados (los comandos de ejemplo son get/list/show/query/logs) · escribe ficheros locales con permisos solo para tu usuario (`umask 077`) |

## Cómo funciona

1. Cada paso se declara con un helper dentro de `collect()`:
   - `step <nombre> "<título>" <comando> [args...]`: ejecuta el comando tal cual (sin shell intermedio).
   - `step_sh <nombre> "<título>" '<cmd> | grep ... | tail -50'`: para tuberías.
   - `kql <nombre> "<título>" '<consulta KQL>'`: consulta a Log Analytics (Azure) contra `AZ_WORKSPACE_ID`.
2. Los pasos se numeran solos (`01`, `02`, ...) en el orden en que aparecen.
3. Cada fichero lleva: ticket y título, fecha UTC, `RUN_BY`, ventana del incidente, comando exacto
   (copiable), la salida y `EXIT=<código>` al final.
4. Si un paso falla, se registra y se sigue con el resto (el script no usa `set -e` a propósito).
5. Con `REDACT=1` (por defecto) la salida pasa por un filtro que enmascara emails, `password=...`,
   cabeceras `Authorization`, tokens `Bearer` y JWT. Es conservador: **revisa antes de publicar**.
6. Los bloques de ejemplo (Kubernetes, Azure, AWS) solo se ejecutan si defines sus variables. Para un
   incidente concreto, copia el script junto al ticket y edita `collect()`.

Regla de interpretación: incluye siempre un paso de **control** (¿llega telemetría?). Si el control sale
vacío, los resultados vacíos de los demás pasos no demuestran ausencia del fallo.

## Requisitos

- `bash` (vale el 3.2 de macOS) y `perl` (para `REDACT=1`).
- Según los bloques que uses: `kubectl` con contexto válido, `az` con `az login`, `aws` con sesión válida.
- El script **no inicia sesión ni cambia el contexto activo**: si la sesión ha caducado, el paso falla y
  queda registrado.

## Variables

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `$1` | Sí | Id del ticket o nombre del caso (letras, números, `.`, `_`, `-`) | Tu gestor de tickets (p. ej. `<TICKET_ID>`) |
| `EVIDENCE_ROOT` | No (def. directorio actual) | Raíz donde se crea `<TICKET>/evidencias/` | — |
| `RUN_BY` | No (def. usuario del sistema) | Quién ejecuta, para la cabecera | — |
| `REDACT` | No (def. `1`) | `1` enmascara datos sensibles; `0` guarda la salida en bruto | — |
| `WINDOW_START` / `WINDOW_END` | No | Ventana del incidente en UTC, `YYYY-MM-DDTHH:MM:SSZ` | Hora de la alerta / del ticket |
| `K8S_NAMESPACE` | Para bloque K8s | Namespace | `kubectl get ns` |
| `K8S_CONTEXT` | No | Contexto de kubeconfig (def. el actual) | `kubectl config get-contexts` |
| `K8S_WORKLOAD` | No | `deploy/<NOMBRE>`, `sts/<NOMBRE>` o `pod/<NOMBRE>` para describe y logs | `kubectl get deploy,sts -n <NAMESPACE>` |
| `AZ_SUBSCRIPTION` | No | Suscripción para `--subscription` | `az account list -o table` |
| `AZ_RESOURCE_GROUP` | Para bloque Azure | Resource group | `az group list -o table` |
| `AZ_WORKSPACE_ID` | Para consultas KQL | GUID "Workspace ID" del Log Analytics | `az monitor log-analytics workspace show -g <RG> -n <WORKSPACE> --query customerId -o tsv` |
| `AWS_PROFILE` | Para bloque AWS | Perfil de la AWS CLI (la CLI lo lee directamente) | `aws configure list-profiles` |
| `AWS_REGION` | No | Región (la CLI lo lee directamente) | — |
| `AWS_LOG_GROUP` | No | Log group de CloudWatch Logs | `aws logs describe-log-groups --query 'logGroups[].logGroupName'` |

## Ejemplos

```bash
# Kubernetes: pods, eventos, describe y logs de un deployment
K8S_NAMESPACE=<NAMESPACE> K8S_WORKLOAD=deploy/<NOMBRE> ./collect-evidence.sh <TICKET_ID>

# Azure con ventana del incidente
AZ_SUBSCRIPTION=<SUBSCRIPTION> AZ_RESOURCE_GROUP=<RG> AZ_WORKSPACE_ID=<WORKSPACE_GUID> \
WINDOW_START=2026-01-31T13:00:00Z WINDOW_END=2026-01-31T14:30:00Z \
  ./collect-evidence.sh <TICKET_ID>

# AWS: identidad, alarmas activas y errores de la última hora en un log group
AWS_PROFILE=<PERFIL> AWS_LOG_GROUP=<LOG_GROUP> ./collect-evidence.sh <TICKET_ID>
```

- `VAR=valor ./script`: define la variable solo para esa ejecución.
- Flags de los comandos de ejemplo:
  - `kubectl get pods -o wide`: columnas extra (nodo, IP); `get events --sort-by=.lastTimestamp`: eventos
    por fecha; `logs --tail=500 --all-containers --timestamps`: últimas 500 líneas de todos los
    contenedores, con marca de tiempo.
  - `az monitor activity-log list --start-time/--end-time` (o `--offset 24h`): operaciones de Azure en la
    ventana; `--query`: filtro JMESPath; `-o table`: salida en tabla.
  - `az monitor log-analytics query --workspace <GUID> --analytics-query '<KQL>'`: consulta de logs.
  - `aws cloudwatch describe-alarms --state-value ALARM`: solo alarmas disparadas;
    `aws logs tail <grupo> --since 1h --filter-pattern ERROR --format short`: lee (sin `--follow`, así
    termina) los eventos de la última hora que contienen `ERROR`.
