# microsoft-365

Herramientas para leer/exportar datos de Microsoft 365 (Teams, Outlook, SharePoint…). Hay dos enfoques:

- **Microsoft Graph** (`teams/`): la API REST de Microsoft 365, con permisos *delegados* (actúan en tu nombre y solo ven lo que tu cuenta puede ver).
- **Interfaz web** (`outlook-teams-web-export/`): Playwright o scripts de consola que leen la web de Outlook y Teams como lo harías tú, sin registrar ninguna app.

| Carpeta / fichero | Qué hace | Efectos |
|---|---|---|
| `teams/export-teams-chat.mjs` | Lista tus chats de Teams o exporta uno completo a JSON/CSV/Markdown/HTML | Solo lectura en M365 · ESCRIBE un fichero local `0600`, sin sobrescribir |
| `teams/export-teams-chat.test.mjs` | Tests sin red (`node --test`) | Ninguno fuera de un directorio temporal |
| `outlook-teams-web-export/` | Exporta correos de Outlook Web (carpetas, pestañas Focused/Other, cuerpos) y chats de Teams Web a JSON/TXT, por tenant y desde una fecha | Lectura en M365 (puede marcar como leídos) · ESCRIBE `data/` y perfiles de navegador locales |

## Requisitos

- Node.js 18+.
- Una App registration en Entra ID con *public client flows* y el permiso delegado necesario (para Teams: `Chat.Read`). Pasos detallados en [teams/README.md](teams/README.md).

## Variables

| Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `TEAMS_EXPORT_CLIENT_ID` | Sí (salvo token o `--client-id`) | Client ID de la app | Entra ID → App registrations → Overview |
| `TEAMS_EXPORT_TENANT_ID` | No | Tenant ID o dominio (por defecto `organizations`) | Entra ID → Overview → Directory (tenant) ID |
| `GRAPH_ACCESS_TOKEN` | No | Token delegado ya obtenido | Otra herramienta; evita pasarlo como argumento |

Plantilla: [`teams/.env.example`](teams/.env.example).

## Ejemplo

```bash
export TEAMS_EXPORT_CLIENT_ID='<CLIENT_ID>'
node teams/export-teams-chat.mjs --list-chats                          # lista chats (device-code login)
node teams/export-teams-chat.mjs --chat-id '<CHAT_ID>' --format md     # --format md: salida Markdown
```

## `outlook-teams-web-export/` vs `teams/export-teams-chat.mjs`

Las dos exportan chats de Teams, pero de forma muy distinta:

| | `teams/export-teams-chat.mjs` | `outlook-teams-web-export/` |
|---|---|---|
| Cómo obtiene los datos | Llama a la **API Microsoft Graph** (`/me/chats`, `/chats/{id}/messages`) con un token delegado | **Scraping de la interfaz web**: Playwright (librería que controla Chromium) abre Outlook/Teams, hace scroll y lee el DOM; o pegas el script en la consola del navegador |
| Qué necesitas | App registration en Entra ID con `Chat.Read` (y que el tenant lo permita) | Solo poder iniciar sesión en la web; nada que registrar |
| Qué cubre | Chats de Teams | Chats de Teams **y** correos de Outlook (con cuerpo) |
| Robustez | Estable: API documentada y paginada | Frágil: depende de selectores del DOM que Microsoft cambia; más lento |
| Efecto colateral | Ninguno | Abrir chats/correos puede marcarlos como leídos |

Usa Graph cuando puedas; usa la exportación web cuando no puedas registrar una app o el tenant
bloquee Graph. Detalle completo en [outlook-teams-web-export/README.md](outlook-teams-web-export/README.md).
