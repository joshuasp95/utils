# http

Scripts para consultar APIs HTTP/REST desde la terminal.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `paginated-api-loop.sh` | Pide el listado de un recurso (una página grande), extrae los ids y luego pide el detalle de cada id, guardando el resultado filtrado con `jq` | SOLO LECTURA en la API (GET). ESCRIBE: añade a `OUTPUT_FILE` en local |

## Requisitos

- `bash`, `curl`, `jq`.
- Un token Bearer válido para la API (por ejemplo, el JWT que devuelve su endpoint de login).

## Variables

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `API_TOKEN` | Sí | Token que se envía como `Authorization: Bearer <API_TOKEN>` | Login de la API o tu gestor de secretos. Nunca lo escribas en el script |
| `BASE_URL` | Sí | Esquema + host, sin barra final | Documentación de la API |
| `ENDPOINT` | Sí | Ruta del recurso, empezando por `/` | Documentación de la API (Swagger/OpenAPI) |
| `PAGE_SIZE_PARAM` | No (`pageSize`) | Nombre del parámetro de tamaño de página | Documentación (otros típicos: `size`, `limit`, `per_page`) |
| `PAGE_SIZE` | No (`1000`) | Elementos a pedir en el listado; ponlo mayor que el total | — |
| `LIST_JQ` | No (`.items[].id`) | Filtro `jq` que saca los ids del listado | Mira una respuesta real del listado |
| `DETAIL_JQ` | No (`.`) | Filtro `jq` aplicado a cada detalle | Tú lo defines |
| `OUTPUT_FILE` | No (`response.log`) | Fichero donde se acumulan los resultados | — (`*.log` está en `.gitignore`) |

## Uso

```bash
export API_TOKEN='<TOKEN>'    # mejor export en la shell que en la misma línea (no queda en el historial del comando)
BASE_URL=https://api.example.com ENDPOINT=/rest/products/v1 LIST_JQ='.products[].id' \
DETAIL_JQ='select(.active == true and .price.amount > 0) | {id, category, price}' \
  ./paginated-api-loop.sh
```

Qué hace cada pieza:

- Listado: `GET <BASE_URL><ENDPOINT>/?<PAGE_SIZE_PARAM>=<PAGE_SIZE>`. No recorre páginas: pide una
  sola página lo bastante grande. Si la API limita el tamaño, sube `PAGE_SIZE` hasta su máximo.
- `LIST_JQ` con `jq -r`: `-r` (raw) devuelve los ids sin comillas, uno por línea.
- Detalle: `GET <BASE_URL><ENDPOINT>/<id>` por cada id.
- `DETAIL_JQ`: `select(cond)` deja pasar solo los objetos que cumplen la condición; `{id, price}`
  construye un objeto nuevo solo con esos campos.
- `curl -sS`: `-s` oculta la barra de progreso, `-S` sigue mostrando errores.
- Al final añade `----------end----------------` y la fecha a `OUTPUT_FILE`. El fichero se
  **acumula** entre ejecuciones (`>>`); bórralo si quieres empezar de cero.
