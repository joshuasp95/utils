# Exportar un chat de Microsoft Teams

`export-teams-chat.mjs` descarga mediante Microsoft Graph (la API REST unificada de Microsoft 365) todos los mensajes que la API devuelve para un chat, recorre `@odata.nextLink` (el enlace a la página siguiente de resultados) hasta el final y los ordena del más antiguo al más reciente. Puede generar JSON (máxima fidelidad), CSV, Markdown o HTML.

| Fichero | Qué hace | Efectos |
|---|---|---|
| `export-teams-chat.mjs` | Lista tus chats o exporta uno completo | Solo lectura en Microsoft 365 · ESCRIBE un fichero local `0600` (nunca sobrescribe) |
| `export-teams-chat.test.mjs` | Tests con `node:test`, sin red (simula `fetch`) | Crea y borra un directorio temporal |
| `.env.example` | Plantilla de variables | — |

## Requisitos

- Node.js 18 o posterior (usa `fetch` nativo; no hay dependencias npm).
- Una cuenta corporativa o educativa de Microsoft 365.
- Permiso delegado de Microsoft Graph `Chat.Read` ("delegado" = la app actúa en tu nombre y solo ve lo que tú ves).

La opción más limpia es registrar en Microsoft Entra ID una aplicación para uso local:

1. Crea un **App registration** de un solo tenant.
2. En **Authentication**, habilita **Allow public client flows** (necesario para el flujo device-code sin secreto).
3. En **API permissions**, añade Microsoft Graph → Delegated → `Chat.Read`.
4. Concede el consentimiento requerido por las políticas de tu organización.
5. Copia el **Application (client) ID** (y, si quieres, el **Directory (tenant) ID**) de la pestaña **Overview**. No necesitas crear ningún secreto.

## Variables

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `TEAMS_EXPORT_CLIENT_ID` | Sí, salvo que uses `GRAPH_ACCESS_TOKEN` o `--client-id` | Client ID de la app pública | Entra ID → App registrations → tu app → Overview → *Application (client) ID* |
| `TEAMS_EXPORT_TENANT_ID` | No (por defecto `organizations`) | Tenant donde autenticarse | Overview → *Directory (tenant) ID*, o el dominio `<EMPRESA>.onmicrosoft.com` |
| `GRAPH_ACCESS_TOKEN` | No | Token delegado obtenido por otro medio | Otra herramienta (p. ej. Graph Explorer). Nombre configurable con `--token-env` |

Los argumentos `--client-id` y `--tenant-id` tienen prioridad sobre las variables.

## Opciones

| Opción | Qué hace |
|---|---|
| `--chat-id <valor>` | ID del chat (`19:…@thread.v2`) o enlace de Teams que contenga `chatId=` |
| `--list-chats` | Lista los chats accesibles (id, tipo, tema, fecha del último mensaje) en JSON por stdout |
| `--output <ruta>` | Fichero de salida. Si existe, el script falla para no sobrescribirlo |
| `--format <json\|csv\|md\|html>` | Formato. Si no se indica, se deduce de la extensión de `--output` o se usa JSON |
| `--tenant-id`, `--client-id` | Ver tabla de variables |
| `--token-env <nombre>` | Nombre de la variable que contiene el token (por defecto `GRAPH_ACCESS_TOKEN`) |
| `--max-retries <n>` | Reintentos ante 429 (throttling) o 5xx, 0-20 (por defecto 5) |

## Uso

Primero localiza el chat:

```bash
export TEAMS_EXPORT_CLIENT_ID='<CLIENT_ID>'   # export: deja la variable disponible para los procesos hijos
node export-teams-chat.mjs --list-chats
```

El script imprime un código y una URL (`https://microsoft.com/devicelogin`): ábrela, introduce el código e inicia sesión. Después exporta (también puedes pasar un enlace de Teams si contiene `chatId`):

```bash
node export-teams-chat.mjs \
  --chat-id '19:xxxxxxxx@thread.v2' \
  --format json \
  --output ./mi-chat.json
```

Para reutilizar un token delegado obtenido por otro medio, evita ponerlo como argumento (quedaría en el historial del shell) y usa una variable:

```bash
export GRAPH_ACCESS_TOKEN='<TOKEN>'
node export-teams-chat.mjs --chat-id '19:xxxxxxxx@thread.v2' --format html
```

Tests (no necesitan red ni credenciales):

```bash
node --test export-teams-chat.test.mjs   # --test: ejecuta el fichero con el runner de tests integrado de Node
```

El flujo device-code no guarda el token en disco. Los archivos exportados se crean con modo `0600` (solo tu usuario puede leerlos) en sistemas POSIX.

## Formatos y límites

- **JSON** conserva el objeto de chat y los objetos completos `chatMessage`, incluidos menciones, reacciones y metadatos de adjuntos que devuelva Graph.
- **CSV**, **Markdown** y **HTML** son vistas cómodas; usa JSON como copia principal.
- El script no descarga el contenido binario de archivos o imágenes alojadas.
- Microsoft Graph solo puede devolver mensajes que sigan retenidos y a los que la cuenta tenga acceso. No recupera el cuerpo de mensajes eliminados ni contenido borrado por políticas de retención.
- Exporta chats 1:1, grupales o de reunión. Los mensajes de un canal de un equipo usan otra ruta de Graph y no están cubiertos.

Documentación oficial:

- [List messages in a chat](https://learn.microsoft.com/graph/api/chat-list-messages)
- [List chats](https://learn.microsoft.com/graph/api/chat-list)
