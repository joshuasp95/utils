# kubernetes

Utilidades para OpenShift/Kubernetes: login por token en varios clusters, recogida de evidencias de un
namespace en solo lectura y volcado del esquema de CRDs con `kubectl explain`.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `openshift-token-login-all.sh` | Login por token (bash) en los clusters de `clusters.conf`; renombra cada contexto a `<CONTEXT_PREFIX><env>` y fija su namespace | ESCRIBE: kubeconfig local. Nada en el cluster |
| `openshift-token-login.zsh` | Lo mismo en zsh, comprobando además lectura de pods (`oc auth can-i`) y saliendo con código 1 si algo falla | ESCRIBE: kubeconfig local. Nada en el cluster |
| `clusters.conf.example` | Plantilla del fichero de clusters (`entorno\|api_server\|namespace`) | — |
| `.gitignore` | Evita versionar `clusters.conf` (tu copia con URLs reales) | — |
| `openshift-collect-evidence.sh` | `get` de pods, statefulsets, deployments, services, routes, events y pods no Running de un namespace; opcionalmente filtra logs de un pod | SOLO LECTURA en el cluster · escribe `.txt` locales |
| `kubectl-explain-crds.sh` | Guarda `kubectl explain <recurso>.spec --recursive` de cada recurso en un fichero | SOLO LECTURA · escribe ficheros locales |

## Requisitos

- `oc` (OpenShift CLI; macOS: `brew install openshift-cli`) para los logins. La recogida usa `oc` si
  existe y, si no, `kubectl`.
- `zsh` para la variante `.zsh`.
- Sesión SSO en el navegador para obtener el token (los scripts abren la página con `open` en macOS).
- Permiso de lectura en los namespaces.

### Por qué login por token y no `oc login --web`

El flujo `--web` pasa por la ruta `oauth-openshift.apps.<host>`, que puede servir un certificado de una
CA corporativa no confiada; `--insecure-skip-tls-verify` solo afecta al API server, no a esa ruta. El
login por token habla únicamente con el API server (`https://api.<host>:6443`), cuyo certificado
autofirmado sí se puede aceptar con ese flag.

### Seguridad del token

- Se pide con `read -s` (no se ve al pegarlo), no se imprime y se hace `unset` tras usarlo.
- El script no lo escribe en ningún fichero; **`oc login` sí lo guarda en tu `~/.kube/config`**, como
  cualquier login normal. Caduca según la política del cluster.

## Variables

| Variable / argumento | Script | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|---|
| `CLUSTERS_FILE` | logins | No (def. `clusters.conf` junto al script) | Fichero de clusters | Copia de `clusters.conf.example` |
| `CONTEXT_PREFIX` | logins | No (def. `ocp-`) | Prefijo del nombre de contexto | Lo eliges tú |
| entornos (`$@`) | logins | No (def. todos) | Entornos a loguear (1ª columna del fichero) | `clusters.conf` |
| `--ns` | collect | Sí | Namespace a revisar | `oc get projects` |
| `--env` | collect | No (def. = namespace) | Etiqueta para la carpeta de salida | Lo eliges tú |
| `--context` | collect | No (def. actual) | Contexto de kubeconfig | `oc config get-contexts` |
| `--out` | collect | No (def. `output-cli`) | Directorio raíz de salida | — |
| `--log-pod` / `LOG_POD` | collect | No | Pod cuyos logs se filtran | `oc get pods -n <NAMESPACE>` |
| `--log-pattern` / `LOG_PATTERN` | collect | No (def. `error\|exception\|fatal`) | Regex para `grep -iE` | — |
| `--log-tail` / `LOG_TAIL` | collect | No (def. `800`) | Líneas de log a leer | — |
| recursos (`$@`) | explain | Sí | Nombres de recurso | `kubectl api-resources`, `kubectl get crd` |
| `OUT_DIR` | explain | No (def. `specs`) | Directorio de salida | — |
| `FIELD` | explain | No (def. `spec`) | Campo raíz a documentar | — |

## Ejemplos

```bash
# 1) Configurar clusters (una vez)
cp clusters.conf.example clusters.conf && $EDITOR clusters.conf

# 2) Login en todos, o solo en algunos
./openshift-token-login-all.sh
./openshift-token-login.zsh int pro

# 3) Evidencias de un namespace
./openshift-collect-evidence.sh --env PRE --ns <NAMESPACE> --context ocp-pre --out output-cli

# 3b) Además, buscar errores de licencia en los logs de un pod concreto
./openshift-collect-evidence.sh --ns <NAMESPACE> --context ocp-pre \
  --log-pod <POD> --log-pattern 'license|expired|402' --log-tail 2000

# 4) Esquema de CRDs (p. ej. las de un operador de Kafka)
./kubectl-explain-crds.sh kafka schemaregistry connect
OUT_DIR=specs-status FIELD=status ./kubectl-explain-crds.sh kafka
```

Flags usados dentro de los scripts:

- `oc login --token=<T> --server=<URL>`: inicia sesión con un token; `--insecure-skip-tls-verify=true`
  acepta el certificado autofirmado del API server.
- `oc config rename-context` / `set-context <CTX> --namespace <NS>`: renombra el contexto creado por el
  login y fija su namespace por defecto.
- `-n <NS>`: namespace; `-o wide`: columnas extra (nodo, IP...); `--sort-by=.lastTimestamp`: ordena
  eventos por fecha; `--field-selector=status.phase!=Running`: filtra en el servidor.
- `logs <POD> --tail=N`: solo las últimas N líneas del log.
- `kubectl explain <recurso>.spec --recursive`: árbol completo de campos del recurso.
