#!/usr/bin/env node
// export-teams-chat.mjs — Exporta todos los mensajes de un chat de Microsoft Teams vía Microsoft Graph.
//
// Qué hace:     Obtiene un token delegado (de una variable o por device-code), descarga el chat y
//               todas las páginas de mensajes (@odata.nextLink), los ordena de antiguo a reciente y
//               los guarda como JSON, CSV, Markdown o HTML. Con --list-chats lista tus chats.
// Requisitos:   Node.js 18+ (usa fetch nativo). Sin dependencias npm. App registration en Entra ID
//               con "Allow public client flows" y permiso delegado Microsoft Graph Chat.Read.
// Uso:          node export-teams-chat.mjs --list-chats
//               node export-teams-chat.mjs --chat-id '19:...@thread.v2' --format html
// Variables:    TEAMS_EXPORT_CLIENT_ID  Client ID de la app (Entra ID → App registrations → Overview).
//                                       Equivale a --client-id (el argumento tiene prioridad).
//               TEAMS_EXPORT_TENANT_ID  Tenant ID o dominio (opcional; por defecto "organizations").
//                                       Equivale a --tenant-id.
//               GRAPH_ACCESS_TOKEN      Token delegado ya obtenido (opcional; si existe no hay device-code).
//                                       El nombre se cambia con --token-env.
// Efectos:      SOLO LECTURA en Microsoft 365 (GET a Graph).
//               ESCRIBE: un fichero local con permisos 0600; falla si ya existe (no sobrescribe).
// Salida:       --output o teams-chat-<chatId>-<timestamp>.<formato> en el directorio actual.

import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
// Chat.Read: leer chats del usuario · offline_access: permite refresh token (no se guarda en disco).
const DEFAULT_SCOPE = "https://graph.microsoft.com/Chat.Read offline_access";
// 429 = throttling de Graph; 5xx = errores transitorios. Se reintentan con backoff.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`Uso:
  export-teams-chat.mjs --chat-id <id-o-enlace> [opciones]
  export-teams-chat.mjs --list-chats [opciones]

Opciones:
  --chat-id <valor>       ID del chat o enlace de Teams que contenga chatId.
  --list-chats            Lista los chats accesibles para localizar su ID.
  --output <ruta>         Fichero de salida (por defecto, generado en el cwd).
  --format <formato>      json, csv, md o html (por defecto: extensión o json).
  --tenant-id <tenant>    Tenant de Entra ID (por defecto: TEAMS_EXPORT_TENANT_ID
                          u "organizations").
  --client-id <id>        Client ID de una app pública con permiso Chat.Read
                          (por defecto: TEAMS_EXPORT_CLIENT_ID).
  --token-env <nombre>    Variable que contiene el token (por defecto:
                          GRAPH_ACCESS_TOKEN).
  --max-retries <n>       Reintentos por throttling/errores transitorios (5).
  --help                  Muestra esta ayuda.

Autenticación:
  1. Si existe GRAPH_ACCESS_TOKEN (o --token-env), se usa ese token.
  2. En caso contrario, --client-id inicia el flujo device-code.

Ejemplos:
  export TEAMS_EXPORT_CLIENT_ID='<CLIENT_ID>'
  node export-teams-chat.mjs --list-chats
  node export-teams-chat.mjs --chat-id '19:...@thread.v2' --format html
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    // Valores por defecto desde el entorno; los argumentos CLI los sobrescriben.
    tenantId: process.env.TEAMS_EXPORT_TENANT_ID || "organizations",
    clientId: process.env.TEAMS_EXPORT_CLIENT_ID || undefined,
    tokenEnv: "GRAPH_ACCESS_TOKEN",
    maxRetries: 5,
    listChats: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith("--")) {
        throw new Error(`Falta el valor de ${arg}`);
      }
      return next;
    };

    switch (arg) {
      case "--chat-id": args.chatId = value(); break;
      case "--output": args.output = value(); break;
      case "--format": args.format = value().toLowerCase(); break;
      case "--tenant-id": args.tenantId = value(); break;
      case "--client-id": args.clientId = value(); break;
      case "--token-env": args.tokenEnv = value(); break;
      case "--max-retries": args.maxRetries = Number(value()); break;
      case "--list-chats": args.listChats = true; break;
      case "--help": usage(0); break;
      default: throw new Error(`Opción desconocida: ${arg}`);
    }
  }

  if (!Number.isInteger(args.maxRetries) || args.maxRetries < 0 || args.maxRetries > 20) {
    throw new Error("--max-retries debe ser un entero entre 0 y 20");
  }
  if (args.listChats && args.chatId) {
    throw new Error("Usa --list-chats o --chat-id, no ambos");
  }
  if (!args.listChats && !args.chatId) {
    throw new Error("Debes indicar --chat-id o --list-chats");
  }
  if (args.format && !["json", "csv", "md", "html"].includes(args.format)) {
    throw new Error("--format debe ser json, csv, md o html");
  }
  return args;
}

function chatIdFromInput(input) {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  const url = new URL(trimmed);
  const candidates = ["chatId", "chatid", "threadId", "threadid"];
  for (const key of candidates) {
    const value = url.searchParams.get(key);
    if (value) return value;
  }
  throw new Error("El enlace no contiene chatId. Copia el ID del chat o un enlace que incluya ?chatId=...");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  if (retryAfter) {
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) return dateDelay;
  }
  return Math.min(30_000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 500);
}

async function graphRequest(url, token, maxRetries) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Prefer: "include-unknown-enum-members",
      },
    });

    if (response.ok) return response.json();
    if (attempt < maxRetries && RETRYABLE_STATUS.has(response.status)) {
      const delay = retryDelay(response, attempt);
      process.stderr.write(`Microsoft Graph respondió ${response.status}; reintento ${attempt + 1}/${maxRetries} en ${Math.ceil(delay / 1000)} s.\n`);
      await sleep(delay);
      continue;
    }

    const detail = (await response.text()).slice(0, 1500).replace(/\s+/g, " ");
    throw new Error(`Microsoft Graph respondió ${response.status} ${response.statusText}: ${detail}`);
  }
}

// Flujo OAuth 2.0 device code: pide un código, el usuario lo introduce en
// https://microsoft.com/devicelogin y aquí se sondea /token hasta que se completa.
async function deviceCodeToken(tenantId, clientId) {
  const authority = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
  const deviceResponse = await fetch(`${authority}/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: DEFAULT_SCOPE }),
  });
  const device = await deviceResponse.json();
  if (!deviceResponse.ok) {
    throw new Error(`No se pudo iniciar device-code: ${device.error_description || device.error}`);
  }

  process.stderr.write(`${device.message}\n`);
  let intervalMs = Math.max(5, Number(device.interval) || 5) * 1000;
  const expiresAt = Date.now() + Number(device.expires_in) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs);
    const tokenResponse = await fetch(`${authority}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: device.device_code,
      }),
    });
    const result = await tokenResponse.json();
    if (tokenResponse.ok) return result.access_token;
    if (result.error === "authorization_pending") continue;
    if (result.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    throw new Error(`Autenticación fallida: ${result.error_description || result.error}`);
  }
  throw new Error("El código de autenticación ha caducado");
}

async function getAccessToken(args) {
  const token = process.env[args.tokenEnv];
  if (token?.trim()) return token.trim();
  if (!args.clientId) {
    throw new Error(`No existe ${args.tokenEnv}. Define TEAMS_EXPORT_CLIENT_ID o indica --client-id para autenticarte por device-code.`);
  }
  return deviceCodeToken(args.tenantId, args.clientId);
}

async function fetchAllPages(initialUrl, token, maxRetries, label) {
  const values = [];
  let url = initialUrl;
  let page = 0;
  while (url) {
    const result = await graphRequest(url, token, maxRetries);
    page += 1;
    values.push(...(result.value || []));
    process.stderr.write(`${label}: página ${page}, ${values.length} elementos acumulados.\n`);
    url = result["@odata.nextLink"] || null;
  }
  return values;
}

function sender(message) {
  const identity = message.from?.user || message.from?.application || message.from?.device;
  return {
    name: identity?.displayName || "",
    id: identity?.id || "",
    type: identity?.userIdentityType || (message.from?.application ? "application" : ""),
  };
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
      const raw = radix === 16 ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(raw, radix);
      try { return String.fromCodePoint(codePoint); } catch { return match; }
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function bodyText(message) {
  const content = message.body?.content || "";
  if ((message.body?.contentType || "").toLowerCase() !== "html") return content;
  return decodeHtmlEntities(content
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, ""))
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(messages) {
  const columns = [
    "id", "createdDateTime", "lastModifiedDateTime", "deletedDateTime",
    "senderName", "senderId", "senderType", "messageType", "importance",
    "subject", "bodyContentType", "bodyText", "bodyHtml", "webUrl",
    "replyToId", "attachmentsJson", "mentionsJson", "reactionsJson",
  ];
  const rows = messages.map((message) => {
    const author = sender(message);
    return [
      message.id, message.createdDateTime, message.lastModifiedDateTime,
      message.deletedDateTime, author.name, author.id, author.type,
      message.messageType, message.importance, message.subject,
      message.body?.contentType, bodyText(message), message.body?.content,
      message.webUrl, message.replyToId,
      JSON.stringify(message.attachments || []), JSON.stringify(message.mentions || []),
      JSON.stringify(message.reactions || []),
    ];
  });
  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function renderMarkdown(exportData) {
  const title = exportData.chat?.topic || exportData.chat?.id || "Chat de Microsoft Teams";
  const lines = [
    `# ${String(title).replace(/\n/g, " ")}`,
    "",
    `- Chat ID: \`${exportData.chatId.replace(/`/g, "\\`")}\``,
    `- Exportado: ${exportData.exportedAt}`,
    `- Mensajes: ${exportData.messageCount}`,
    "",
  ];
  for (const message of exportData.messages) {
    const author = sender(message).name || "Sistema/desconocido";
    lines.push(`## ${message.createdDateTime || "Sin fecha"} — ${author}`, "");
    if (message.deletedDateTime) lines.push(`_Mensaje eliminado: ${message.deletedDateTime}_`, "");
    lines.push(bodyText(message) || "_(sin contenido textual)_", "");
    if (message.attachments?.length) {
      lines.push(`Adjuntos/metadatos: \`${JSON.stringify(message.attachments).replace(/`/g, "\\`")}\``, "");
    }
  }
  return lines.join("\n") + "\n";
}

function renderHtml(exportData) {
  const title = exportData.chat?.topic || "Chat de Microsoft Teams";
  const articles = exportData.messages.map((message) => {
    const author = sender(message).name || "Sistema/desconocido";
    const attachments = message.attachments?.length
      ? `<details><summary>Adjuntos (${message.attachments.length})</summary><pre>${escapeHtml(JSON.stringify(message.attachments, null, 2))}</pre></details>`
      : "";
    return `<article>
      <header><strong>${escapeHtml(author)}</strong><time>${escapeHtml(message.createdDateTime || "Sin fecha")}</time></header>
      ${message.deletedDateTime ? `<p class="deleted">Mensaje eliminado: ${escapeHtml(message.deletedDateTime)}</p>` : ""}
      <div class="body">${escapeHtml(bodyText(message) || "(sin contenido textual)").replace(/\n/g, "<br>")}</div>
      ${attachments}
    </article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#202124;background:#fff}
article{border-top:1px solid #ddd;padding:1rem 0}header{display:flex;gap:1rem;justify-content:space-between}time{color:#666;font-size:.9em}.body{margin-top:.5rem;white-space:normal}.deleted{color:#8b0000}pre{white-space:pre-wrap;word-break:break-word;background:#f5f5f5;padding:.75rem}
</style></head><body><h1>${escapeHtml(title)}</h1>
<p>Exportado: ${escapeHtml(exportData.exportedAt)} · Mensajes: ${exportData.messageCount}</p>
${articles}
</body></html>\n`;
}

function determineFormat(args) {
  if (args.format) {
    return args.format;
  }
  const extension = extname(args.output || "").slice(1).toLowerCase();
  return ["json", "csv", "md", "html"].includes(extension) ? extension : "json";
}

function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "chat";
}

// Escribe en un temporal con modo 0600 y lo enlaza (link) al destino: link falla con
// EEXIST si el destino ya existe, así nunca se sobrescribe una exportación anterior.
async function writePrivateFile(path, content) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.close();
    handle = null;
    await link(temporary, absolute);
    await unlink(temporary);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return absolute;
}

async function listChats(token, args) {
  const params = new URLSearchParams({
    "$top": "50",
    "$expand": "lastMessagePreview",
    "$orderby": "lastMessagePreview/createdDateTime desc",
  });
  const chats = await fetchAllPages(`${GRAPH_ROOT}/me/chats?${params}`, token, args.maxRetries, "Chats");
  const rows = chats.map((chat) => ({
    id: chat.id,
    type: chat.chatType,
    topic: chat.topic || "",
    lastMessage: chat.lastMessagePreview?.createdDateTime || "",
  }));
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}

async function exportChat(token, args) {
  const chatId = chatIdFromInput(args.chatId);
  const encodedId = encodeURIComponent(chatId);
  const chat = await graphRequest(`${GRAPH_ROOT}/chats/${encodedId}`, token, args.maxRetries);
  const params = new URLSearchParams({ "$top": "50", "$orderby": "createdDateTime desc" });
  const messages = await fetchAllPages(
    `${GRAPH_ROOT}/chats/${encodedId}/messages?${params}`,
    token,
    args.maxRetries,
    "Mensajes",
  );
  messages.sort((left, right) => {
    const dateOrder = String(left.createdDateTime || "").localeCompare(String(right.createdDateTime || ""));
    return dateOrder || String(left.id || "").localeCompare(String(right.id || ""));
  });

  const exportData = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    chatId,
    chat,
    messageCount: messages.length,
    messages,
  };
  const format = determineFormat(args);
  const timestamp = exportData.exportedAt.replace(/[:.]/g, "-");
  const output = args.output || `teams-chat-${safeName(chatId)}-${timestamp}.${format}`;
  const content = format === "json" ? `${JSON.stringify(exportData, null, 2)}\n`
    : format === "csv" ? renderCsv(messages)
      : format === "md" ? renderMarkdown(exportData)
        : renderHtml(exportData);
  const absolute = await writePrivateFile(output, content);
  process.stdout.write(`Exportados ${messages.length} mensajes a ${absolute}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = await getAccessToken(args);
  if (args.listChats) await listChats(token, args);
  else await exportChat(token, args);
}

export {
  bodyText,
  chatIdFromInput,
  fetchAllPages,
  parseArgs,
  renderCsv,
  renderHtml,
  renderMarkdown,
  writePrivateFile,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
