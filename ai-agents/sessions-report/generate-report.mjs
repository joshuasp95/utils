#!/usr/bin/env node
// generate-report.mjs — genera un informe HTML navegable con tus sesiones locales de Codex CLI y Claude Code
//
// Qué hace:     Lee las sesiones guardadas en disco por Codex (SQLite + ficheros .jsonl)
//               y por Claude Code (~/.claude/projects/**/*.jsonl) dentro de un intervalo
//               de fechas, las resume (tema principal, puntos tratados, conclusión),
//               redacta patrones de secretos y genera un único HTML con buscador y filtros.
// Requisitos:   Node.js >= 18 (usa ESM, Array.at, String.replaceAll). CLI `sqlite3` en el
//               PATH (para leer la base de datos de Codex). macOS/Linux.
// Uso:          node generate-report.mjs
//               node generate-report.mjs --start 2026-05-01 --end 2026-07-24 --output ./informe.html
//               REPORT_START=2026-05-01 REPORT_OUTPUT=/tmp/informe.html node generate-report.mjs
// Variables:    --start / REPORT_START    inicio del intervalo (YYYY-MM-DD). Defecto: hace 90 días.
//               --end   / REPORT_END      fin del intervalo (YYYY-MM-DD, incluido). Defecto: hoy.
//               --output / REPORT_OUTPUT  ruta del HTML. Defecto: ./informe-sesiones-ia.html
//               CODEX_HOME                carpeta de Codex. Defecto: $HOME/.codex
//               CLAUDE_HOME               carpeta de Claude Code. Defecto: $HOME/.claude
//               CODEX_DB                  base SQLite de Codex. Defecto: $CODEX_HOME/state_5.sqlite
//               REPORT_TZ                 zona horaria para fechas. Defecto: la del sistema.
// Efectos:      SOLO LECTURA sobre las sesiones. ESCRIBE: el fichero HTML de salida.
// Salida:       HTML autocontenido + resumen JSON (totales) por stdout.
//
// AVISO: aunque se redactan patrones típicos de secretos, el informe contiene resúmenes
// de tus conversaciones. Revísalo antes de compartirlo.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

// ── Argumentos y rutas ──────────────────────────────────────────────────────
// Lee "--nombre valor" de la línea de comandos; si no está, usa la variable de entorno.
function arg(name, envName, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return process.env[envName] || fallback;
}

const isoDay = (date) => date.toISOString().slice(0, 10);
const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(HOME, ".claude");
const CODEX_DB = process.env.CODEX_DB || path.join(CODEX_HOME, "state_5.sqlite");
const CODEX_INDEX = path.join(CODEX_HOME, "session_index.jsonl");
const CLAUDE_PROJECTS = path.join(CLAUDE_HOME, "projects");
const OUTPUT = path.resolve(arg("output", "REPORT_OUTPUT", "informe-sesiones-ia.html"));
const START = new Date(`${arg("start", "REPORT_START", isoDay(new Date(Date.now() - 90 * 864e5)))}T00:00:00.000Z`);
const END = new Date(`${arg("end", "REPORT_END", isoDay(new Date()))}T23:59:59.999Z`);
const TIME_ZONE = process.env.REPORT_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
if (Number.isNaN(START.getTime()) || Number.isNaN(END.getTime())) {
  console.error("ERROR: --start/--end deben tener formato YYYY-MM-DD");
  process.exit(1);
}

// ── CONFIG: reglas personalizables ──────────────────────────────────────────
// Todo lo que depende de TU forma de trabajar está aquí. Ajusta o vacía las listas.
const CONFIG = {
  // Nombres de carpeta tras los que va el "proyecto" en el cwd de la sesión.
  // Ej.: cwd=/home/user/dev/projects/tienda/api → marker "projects" → proyecto "tienda".
  projectMarkers: ["projects", "dev"],                    // ← CAMBIAR
  // Títulos de sesiones de Codex que no se incluyen (regex, sin distinguir mayúsculas).
  excludeCodexTitles: [/analizar las carpetas de codex y claude/i], // ← CAMBIAR
  // Objetivo fijo para sesiones cuyo título coincide y no tienen texto recuperable.
  titleObjectives: [
    [/^rds minor upgrade$/i, "Revisión y preparación de una actualización menor de la base de datos RDS."],
  ],
  // Reglas de "tema" sobre el texto bruto del mensaje: si test(raw) es true, se usa text.
  // text vacío ("") = descartar ese mensaje como tema. Se evalúan en orden.
  topicRules: [
    { test: (raw) => /metadata\.creationtimestamp|managedfields\[\]/i.test(raw), text: "" },
    { test: (raw) => /\b(hazme|haz|crea|genera)\b.{0,35}\bresumen\b.{0,35}\b(conversaci[oó]n|puntos tratados)\b/i.test(raw), text: "" },
    { test: (raw) => /err_ossl_evp_unsupported|digital envelope routines|webpack\s*4|node\.js v?2[0-9]/i.test(raw),
      text: "Análisis de un fallo de compilación provocado por la incompatibilidad entre una versión reciente de Node.js y un proyecto antiguo." },
    { test: (raw) => /\b(revisa|revisar)\b.{0,25}\bmejora\b.{0,80}\bdocumentaci[oó]n\b/.test(raw),
      text: "Revisión y mejora de la documentación propia en los proyectos indicados." },
    { test: (raw) => /\bno modifiques\b.{0,80}\bdocumentaci[oó]n ajena\b/.test(raw)
        || /\b(autor[ií]a|alcance)\b.{0,70}\bno (?:lo|la) modifiques\b/.test(raw),
      text: "Restricción del alcance a documentación propia y claramente atribuible al usuario." },
    { test: (raw) => /\bno modifiques\b.{0,160}\b(c[oó]digo|configuraciones?|infraestructura|dependencias)\b/.test(raw),
      text: "Exclusión expresa de código, configuración, infraestructura y otros archivos no documentales." },
    { test: (raw) => /\binspecciona?r?\b.{0,100}\brepositorios?\b/.test(raw) && /\bsegur[ao]s?\b/.test(raw),
      text: "Inspección segura de los repositorios para comprender el contexto antes de mejorar la documentación." },
    { test: (raw) => /\bmcp\b/.test(raw) && /\batlassian\b/.test(raw) && /\bjira\b/.test(raw) && /\bconfluence\b/.test(raw),
      text: "Verificación de la conexión y de los permisos de lectura de Atlassian para Jira y Confluence." },
    { test: (raw) => /\bteams\b/.test(raw) && /\bscript\b/.test(raw) && /\b(error(?:es)?|fall(?:a|o|os)?)\b/.test(raw),
      text: "Revisión y mejora del script de exportación de Teams debido a fallos intermitentes." },
    { test: (raw) => /\bteams\b/.test(raw) && /\b(mensajes?|chats?)\b/.test(raw) && /\b(intervalo|fechas?|d[ií]as)\b/.test(raw),
      text: "Búsqueda o creación de una herramienta para exportar conversaciones de Teams por intervalo de fechas." },
    { test: (raw) => /\boutlook\b/.test(raw) && /\b(fechas?|d[ií]as|intervalo|periodo)\b/.test(raw),
      text: "Uso del exportador de Outlook para obtener correos de un periodo concreto." },
    { test: (raw) => /\boutlook\b/.test(raw) && /\b(cuenta|carpeta|abiert[ao]s?|coge|recoge)\b/.test(raw),
      text: "Aclaración del alcance de la exportación de Outlook: cuenta completa frente a carpeta visible." },
    { test: (raw) => /\b(correos?|mensajes?)\b/.test(raw) && /\b(m[aá]s de|solo|solamente)\s+\d+\b/.test(raw),
      text: "Diagnóstico de una exportación incompleta que recuperó menos elementos de los esperados." },
    { test: (raw) => /\bventana operativa\b/.test(raw) || (/\bmanualmente\b/.test(raw) && /\b(indisponibilidad|downtime|tiempo)\b/.test(raw)),
      text: "Planificación de la ejecución manual dentro de la ventana operativa, incluida la indisponibilidad prevista y las precauciones necesarias." },
    { test: (raw) => /\bqu[eé] es go\b/.test(raw) || /\bgo\/no[- ]go\b/.test(raw),
      text: "Aclaración del significado de la autorización de ejecución y confirmación de la aprobación recibida." },
    { test: (raw) => /\bopenssl\b/.test(raw) && /\b(subject|certificate|certificado|cn=)\b/.test(raw),
      text: "Análisis de una discrepancia entre el dominio consultado y el certificado presentado." },
    { test: (raw) => /\bsmoke tests?\b/.test(raw) && /\bliferay\b/.test(raw) && /\brunbook\b/.test(raw),
      text: "Ampliación del runbook con pruebas funcionales de Liferay y una explicación de cómo ejecutarlas e interpretar sus resultados." },
    { test: (raw) => /\batlas projects list\b/.test(raw) && /\batlas clusters list\b/.test(raw),
      text: "Inventario de los proyectos y clústeres disponibles en MongoDB Atlas." },
    { test: (raw) => /\bargocd\b/.test(raw) && /\bversi[oó]n\b/.test(raw) && /\bv?2\.[0-9]+\b/.test(raw)
        && /\b(kubectl|get deploy|desplegad)\b/.test(raw),
      text: "Comprobación de la versión realmente desplegada de Argo CD frente a la versión prevista." },
    { test: (raw) => /\bbrew\b/.test(raw) && /\b(paquetes|apps|aplicaciones|instalad)\b/.test(raw),
      text: "Revisión del estado y la coherencia de las herramientas instaladas mediante Homebrew." },
    { test: (raw) => /\bcurl\b/.test(raw) && /\bsolo\b/.test(raw) && /\bip\b/.test(raw),
      text: "Obtención únicamente de la dirección IP de una consulta y documentación de ese uso." },
    { test: (raw) => /\barchivos? de documentaci[oó]n\b/.test(raw) && /\bcreados? por m[ií]\b/.test(raw),
      text: "Análisis exclusivo de los archivos de documentación y texto creados por el usuario." },
    { test: (raw) => /\b(nuevo md|documentaci[oó]n|documento)\b/.test(raw)
        && /\b(explica|reproduc|detall|comandos?|procedimiento)\b/.test(raw),
      text: "Creación de documentación reproducible con el contexto, las comprobaciones y la forma de interpretar los resultados." },
    { test: (raw) => /\bpodcast\b/.test(raw) && /\b(md|documento|texto plano|escuch)\b/.test(raw),
      text: "Creación de una explicación en formato podcast y texto plano, adaptada a un perfil junior." },
    { test: (raw) => /\bcorreo\b/.test(raw) && /\bingl[eé]s\b/.test(raw)
        && /\b(resumid|breve|poco texto|minor upgrade)\b/.test(raw),
      text: "Redacción de un correo breve en inglés para coordinar la actualización y comunicar su situación." },
    { test: (raw) => /\bjira\b/.test(raw) && /\b(ticket|estado|comentario)\b/.test(raw)
        && /\b(resuelt|gestionad|actualiz|avanza)\b/.test(raw),
      text: "Actualización del ticket de Jira para reflejar la resolución, el estado correcto y el trabajo realizado." },
  ],
  // Reglas de respaldo sobre la petición ya resumida (en minúsculas). Mismo formato.
  fallbackTopicRules: [
    { test: (lower) => /\b(hist[oó]ric[oa]s?|versiones anteriores)\b/.test(lower),
      text: "Revisión del historial y de las versiones anteriores relacionadas con la consulta." },
    { test: (lower) => /\b(pass|password|contraseñ|credencial)\b/.test(lower) && /\bkeeper\b/.test(lower),
      text: "Búsqueda en Keeper de credenciales actuales y anteriores para el servicio indicado." },
    { test: (lower) => /\b(auth|autentic|login|sesi[oó]n|shell|cli)\b/.test(lower)
        && /\b(no puedo|persist|cada iteraci[oó]n|repetir|ejecut)\b/.test(lower),
      text: "Dificultades para mantener el acceso y completar la revisión sin repetir la autenticación." },
    { test: (lower) => /\bteams\b/.test(lower) && /\bscript\b/.test(lower) && /\b(error(?:es)?|fall|problema)\b/.test(lower),
      text: "Revisión y mejora del script de exportación de Teams debido a fallos intermitentes." },
    { test: (lower) => /\bssl certificate problem|certificado ssl|issuer certificate\b/.test(lower),
      text: "Análisis de un problema de validación del certificado SSL." },
  ],
};

const SECRET_PATTERNS = [
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[AWS_ACCESS_KEY_REDACTED]"],
  [/\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/g, "[API_KEY_REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[GITHUB_TOKEN_REDACTED]"],
  [/\bglpat-[A-Za-z0-9_-]{16,}\b/g, "[GITLAB_TOKEN_REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [TOKEN_REDACTED]"],
  [/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]{6,}/gi, "$1[REDACTED]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[PRIVATE_KEY_REDACTED]"],
];

function redact(value = "") {
  let text = String(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

function normalize(value = "") {
  return redact(value)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/gi, " ")
    .replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi, " ")
    .replace(/<apps_instructions>[\s\S]*?<\/apps_instructions>/gi, " ")
    .replace(/<plugins_instructions>[\s\S]*?<\/plugins_instructions>/gi, " ")
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<bash-input>[\s\S]*?<\/bash-input>/gi, " ")
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, " ")
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, " ")
    .replace(/<[^>\n]{1,100}>/g, " ")
    .replace(/\[Image\s+#\d+\]/gi, " ")
    .replace(/`[^`\n]{1,300}`/g, " ")
    .replace(/\bhttps?:\/\/\S+/gi, "el servicio indicado")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "la cuenta indicada")
    .replace(/\*\*|__/g, "")
    .replace(/^[ \t]*[-*]\s+/gm, "• ")
    .replace(/^[ \t]*#{1,6}\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripNoiseLines(value = "") {
  const clean = normalize(value);
  const lines = clean.split("\n");
  const kept = [];
  let noisyRun = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (kept.at(-1) !== "") kept.push("");
      continue;
    }
    const symbolCount = (line.match(/[{}[\]<>|=$`\\]/g) || []).length;
    const wordCount = (line.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/g) || []).length;
    const pathCount = (line.match(/(?:\/[\w.@~-]+){3,}|[\w.-]+\.(?:py|js|ts|java|sh|json|ya?ml|tf|xml|gradle)(?::\d+)?/gi) || []).length;
    const noisy = /^(?:at\s+\S+\s*\(|file\s+".*",\s+line\s+\d+|traceback|caused by:|npm err!?|error(?:\s+\w+)?:|warning:|failed\b|failure:|build failed|process exited|chunk id|wall time|node\.js v\d+|[\d-]{10}[T ][\d:.]+Z?\s+(?:error|warn|info)|➜|[$%]\s|>{1,3}\s)/i.test(line)
      || /(?:exception|stacktrace|opensslerrorstack|non-zero exit value|deprecated gradle features)/i.test(line)
      || symbolCount > Math.max(8, line.length * 0.12)
      || pathCount >= 2
      || (wordCount < 4 && /[/:=_-]/.test(line))
      || line.length > 700;
    if (noisy) {
      noisyRun += 1;
      continue;
    }
    noisyRun = 0;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isScaffolding(text) {
  const start = text.trim().slice(0, 160).toLowerCase();
  return start.startsWith("# agents.md instructions")
    || start.startsWith("you are codex")
    || start.startsWith("<instructions>")
    || start.startsWith("# global codex cli rules")
    || start.startsWith("asset above in container")
    || /if you decide to avoid rtk or request more output/i.test(text)
    || /when in doubt, ask before scanning everything/i.test(text)
    || /recommended baseline commands in this environment/i.test(text)
    || /global codex cli rules/i.test(text)
    || /^set model to .+saved as your default for new sessions/i.test(text.trim());
}

function clip(text, max = 360) {
  const clean = normalize(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "));
  return `${cut.slice(0, boundary > max * 0.55 ? boundary + 1 : max).trim()}…`;
}

function splitIdeas(text) {
  return stripNoiseLines(text)
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ0-9•])/)
    .map((part) => part.replace(/^•\s*/, "").trim())
    .filter((part) => part.length >= 22 && part.length <= 900)
    .filter((part) => !/^(script running|chunk id|process exited|wall time)/i.test(part))
    .filter((part) => !/actionable tasks|up-to-date|build failed|non-zero exit|deprecated gradle|stack trace/i.test(part))
    .filter((part) => !/(?:\/[\w.@~-]+){3,}|(?:--[a-z-]+\s+){2,}|[{}[\]<>|=$`\\]{3,}/i.test(part));
}

function scoreIdea(sentence) {
  let score = Math.min(sentence.length, 260) / 100;
  if (/^(objetivo|resultado|solución|problema|conclusión|cambio|tarea|riesgo|pendiente|verificación)/i.test(sentence)) score += 3;
  if (/\b(analiz|crea|corrig|implement|configur|verific|document|migr|despleg|error|fall|decid|recomend|pendiente|soluci)/i.test(sentence)) score += 2;
  if (/[/:._-]/.test(sentence)) score += 0.5;
  return score;
}

function uniqueIdeas(texts, max = 8) {
  const candidates = texts.flatMap(splitIdeas)
    .map((text, order) => ({ text: clip(text, 300), score: scoreIdea(text), order }));
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  const selected = [];
  for (const item of candidates) {
    const fingerprint = item.text.toLowerCase().replace(/[^a-záéíóúüñ0-9 ]/g, "").slice(0, 90);
    if (selected.some((entry) => entry.fingerprint.includes(fingerprint.slice(0, 55))
      || fingerprint.includes(entry.fingerprint.slice(0, 55)))) continue;
    selected.push({ ...item, fingerprint });
    if (selected.length >= max) break;
  }
  return selected.sort((a, b) => a.order - b.order).map((item) => item.text);
}

function conciseSummary(text, max = 380) {
  const ideas = uniqueIdeas([text], 3);
  return clip(ideas.join(" "), max) || "Sin contenido textual suficiente para resumir.";
}

function asSentence(value) {
  const clean = value.replace(/\s+/g, " ").replace(/\s*:\s*$/, "").trim();
  if (!clean) return "";
  const sentence = clean.charAt(0).toLocaleUpperCase("es") + clean.slice(1);
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

function summarizeRequest(text, max = 420) {
  const candidates = splitIdeas(text).map((idea, order) => {
    let score = scoreIdea(idea);
    if (/\b(quiero|necesito|podrías|podrias|puedes|ayuda|objetivo|analiza|revisa|explica|crea|organiza|dime|cómo|como|por qué|porque)\b/i.test(idea)) score += 6;
    if (/\b(error|exception|stack|failed|line \d+|exit value)\b/i.test(idea)) score -= 5;
    return { idea, order, score };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  const chosen = candidates.slice(0, 2).sort((a, b) => a.order - b.order).map((item) => item.idea);
  return asSentence(clip(chosen.join(" "), max)) || "Se planteó una consulta cuyo detalle textual no pudo recuperarse sin incluir información técnica irrelevante.";
}

function summarizeResponse(text, max = 520) {
  const candidates = splitIdeas(text).map((idea, order) => {
    let score = scoreIdea(idea);
    if (/\b(conclusión|resultado|solución|se comprobó|se confirmó|se identificó|se recomendó|quedó|pendiente|causa|alternativa|siguiente paso|resumen)\b/i.test(idea)) score += 6;
    if (/^(?:ejecuta|usa|copia|pega|comando|archivo|ruta)\b/i.test(idea)) score -= 3;
    if (/\b(shell|terminal|comando|argumentos?|multil[ií]nea|clipboard|uid|stack|trace|exception|flags?|script|json|yaml|ruta|archivo \S+\.\w+)\b/i.test(idea)) score -= 9;
    if (/[A-Za-z0-9_-]{20,}/.test(idea)) score -= 12;
    return { idea, order, score };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  const chosen = candidates.filter((item) => item.score > 0).slice(0, 2)
    .sort((a, b) => a.order - b.order).map((item) => item.idea);
  return asSentence(clip(chosen.join(" "), max))
    || "Se revisó el asunto y se definieron los siguientes pasos, sin conservar aquí los detalles de consola.";
}

function isMeaningfulUserTurn(text) {
  const clean = stripNoiseLines(text);
  if (clean.length < 12) return false;
  if (/^(?:login|logout|history|yes|no|ok|vale|hecho|s[ií]|contin[uú]a|procede)\b/i.test(clean) && clean.split(/\s+/).length <= 4) return false;
  if (/persistent login is not working|traceback|exception|build failed|non-zero exit|error stack|unrecognized arguments|record-history|this-device/i.test(clean)) return false;
  if (/^(?:-l\s+['"]|\.?metadata\.|[\[(].*managedFields)|\bwhile IFS=|\bjsonpath=/.test(clean)) return false;
  if (/[A-Za-z0-9_-]{20,}/.test(clean)) return false;
  if ((clean.match(/\bclassic\b/gi) || []).length >= 2) return false;
  const words = clean.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/g) || [];
  const conversational = /\b(quiero|necesito|puedes|podrías|podrias|ayuda|analiza|revisa|explica|crea|organiza|dime|mira|hazlo|entiendo|cómo|como|por qué|porque|también|tambien|ahora|después|despues|falta|pendiente|problema|tema)\b/i.test(clean);
  const sentenceLike = words.length >= 7 && /\b(el|la|los|las|un|una|que|para|con|sin|pero|y|o|de)\b/i.test(clean);
  const codeish = (clean.match(/[{}[\]<>|=$`\\/_]/g) || []).length > Math.max(5, clean.length * 0.06);
  return (conversational || sentenceLike) && !codeish;
}

function topicCategory(text) {
  const clean = stripNoiseLines(text).toLowerCase();
  if (/\b(hist[oó]ric[oa]s?|versiones anteriores)\b/.test(clean)) return "history";
  if (/\b(pass|password|contraseñ|credencial|keeper)\b/.test(clean)) return "credentials";
  if (/\b(auth|autentic|login|sesi[oó]n|shell|cli|acceso)\b/.test(clean)) return "access";
  if (/\b(document|manual|gu[ií]a|runbook|markdown|pdf)\b/.test(clean)) return "documentation";
  if (/\b(error|fallo|problema|failed|exception)\b/.test(clean)) return "problem";
  if (/\b(crea|genera|construye|implementa)\b/.test(clean)) return "creation";
  if (/\b(revisa|analiza|audita|comprueba|verifica)\b/.test(clean)) return "analysis";
  if (/\b(explica|por qu[eé]|dime|c[oó]mo)\b/.test(clean)) return "explanation";
  return "";
}

function plainTopic(text) {
  const raw = normalize(text).toLowerCase();
  // 1) Reglas de CONFIG.topicRules sobre el texto bruto (la primera que coincide gana).
  const rule = CONFIG.topicRules.find((item) => item.test(raw));
  if (rule) return rule.text;
  const source = summarizeRequest(text, 360).replace(/[?!.]+$/, "");
  const lower = source.toLowerCase();
  // 2) Reglas de respaldo sobre la petición resumida.
  const fallback = CONFIG.fallbackTopicRules.find((item) => item.test(lower));
  if (fallback) return fallback.text;
  // 3) Sin regla: se convierte la petición en un título nominal ("analiza X" → "Análisis de X").
  let clean = source
    .replace(/\b(?:en este caso|esta vez)\b.*$/i, "")
    .replace(/\b(?:me ha salido|aparece el siguiente error|el error es)\b.*$/i, "")
    .replace(/^(?:hola[, ]+)?(?:por favor[, ]+)?(?:me |te )?(?:puedes|podrías|podrias|quiero que|necesito que|me gustaría que|me gustaria que)\s+/i, "")
    .replace(/^(analiza|revisa|mira|comprueba|verifica)\s+/i, "Análisis de ")
    .replace(/^(crea|genera|construye|implementa|haz)\s+/i, "Creación de ")
    .replace(/^(mejora|mejorar|corrige|corregir)\s+/i, "Mejora de ")
    .replace(/^(busca|buscar|localiza|localizar)\s+/i, "Búsqueda de ")
    .replace(/^(confirma|confirmar|valida|validar)\s+/i, "Comprobación de ")
    .replace(/^(decir|dime)\s+si\s+/i, "Comprobación de si ")
    .replace(/^(explica|dime por qué|dime porque)\s+/i, "Explicación de ")
    .replace(/^c[oó]mo\s+(?:podr[ií]a|podemos|puedo|hacer|se hace)\s+/i, "Procedimiento para ")
    .replace(/^por\s*qu[eé]\s+/i, "Análisis de la causa por la que ")
    .replace(/^qu[eé]\s+es\s+/i, "Aclaración del significado de ")
    .replace(/^(?:podr[ií]a|puedo)\s+/i, "Evaluación de la posibilidad de ")
    .replace(/^hay alguna forma de\s+/i, "Comprobación de cómo ")
    .replace(/^no hab[ií]a que\s+/i, "Aclaración sobre si era necesario ")
    .replace(/^el tema es que\s+/i, "Diagnóstico de ")
    .replace(/^vale[, ]+(?:ya est[aá]|hecho)[, ]*(?:ahora)?\s*/i, "")
    .replace(/^no entiendo\s+/i, "Aclaración sobre ")
    .replace(/^no puedo\s+/i, "Dificultades para ");
  clean = clean.replace(/[?]+/g, ".").replace(/\s+/g, " ").trim();
  return asSentence(clip(clean, 230));
}

function topicFingerprint(text) {
  const stop = new Set(["para", "como", "quiero", "puedes", "podrias", "podrías", "tambien", "también",
    "esto", "esta", "este", "estos", "estas", "hacer", "hazlo", "dime", "mira", "analiza", "revisa",
    "tengo", "ahora", "despues", "después", "desde", "sobre", "entre", "pero", "porque", "solo"]);
  return new Set((stripNoiseLines(text).toLowerCase().match(/[a-záéíóúüñ]{4,}/g) || [])
    .filter((word) => !stop.has(word)));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.min(a.size, b.size);
}

function extractRequestUnits(text) {
  const clean = stripNoiseLines(text);
  if (clean.length < 650) return [text];
  const ideas = splitIdeas(text);
  const actionable = ideas.filter((idea) =>
    /\b(objetivo|quiero|necesito|puedes|podrías|podrias|analiza|revisa|crea|genera|busca|localiza|explica|compara|ordena|organiza|mejora|corrige|elimina|actualiza|verifica|comprueba|incluye|agrupa|clasifica|resume|documenta|no modifiques|no cambies|al finalizar|para cada)\b/i.test(idea));
  if (actionable.length < 2) return [text];
  const selected = [];
  for (const idea of actionable) {
    const fingerprint = topicFingerprint(idea);
    if (selected.some((item) => overlap(item.fingerprint, fingerprint) >= 0.82)) continue;
    selected.push({ text: idea, fingerprint });
    if (selected.length >= 6) break;
  }
  return selected.map((item) => item.text);
}

function humanizeTitle(value) {
  const clean = normalize(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function titleFromText(text) {
  let first = splitIdeas(text)[0] || normalize(text);
  first = first
    .replace(/^(hola[, ]+)?(me |te )?(podrías|podrias|puedes|quiero que|necesito que|por favor)\s+/i, "")
    .replace(/^(analiza|revisa|dime|explica|crea|haz|ayúdame a|ayudame a)\s+/i, "");
  return clip(first, 108) || "Conversación sin título";
}

function timestampMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

async function readJsonLines(file, onItem) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      await onItem(JSON.parse(line));
    } catch {
      // Una línea dañada no invalida el resto de la sesión.
    }
  }
}

function codexMetadata() {
  // Sin base de datos de Codex (no lo usas) → no hay sesiones de Codex.
  if (!fs.existsSync(CODEX_DB)) return [];
  // Consulta a la tabla threads de Codex: sesiones cuyo intervalo de actividad se solapa con [START, END].
  // created_at/updated_at son segundos Unix; sqlite3 -json devuelve las filas como JSON.
  const sql = `
    SELECT id, rollout_path AS rolloutPath, created_at AS created,
           updated_at AS updated, cwd, title AS dbTitle, tokens_used AS tokens,
           COALESCE(name,'') AS name, COALESCE(preview,'') AS preview,
           COALESCE(model,'') AS model
    FROM threads
    WHERE created_at <= ${Math.floor(END.getTime() / 1000)}
      AND updated_at >= ${Math.floor(START.getTime() / 1000)}
    ORDER BY created_at DESC;
  `;
  const raw = execFileSync("sqlite3", ["-json", CODEX_DB, sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(raw || "[]").map((row) => ({
    ...row,
    created: Number(row.created) * 1000,
    updated: Number(row.updated) * 1000,
    tokens: Number(row.tokens),
  }));
}

async function codexIndex() {
  const names = new Map();
  if (!fs.existsSync(CODEX_INDEX)) return names;
  await readJsonLines(CODEX_INDEX, (item) => {
    if (item.id && item.thread_name) names.set(item.id, item.thread_name);
  });
  return names;
}

function codexBlockText(payload) {
  if (!Array.isArray(payload?.content)) return [];
  return payload.content
    .filter((block) => block && (block.type === "input_text" || block.type === "output_text"))
    .map((block) => block.text || "")
    .filter(Boolean);
}

async function parseCodex(meta, indexNames) {
  const events = [];
  let metaTimestamp = meta.created;
  if (fs.existsSync(meta.rolloutPath)) {
    await readJsonLines(meta.rolloutPath, (item) => {
      const ts = timestampMs(item.timestamp) ?? meta.created;
      if (item.type === "session_meta") metaTimestamp = ts;
      if (item.type !== "response_item" || item.payload?.type !== "message") return;
      const role = item.payload.role;
      if (role !== "user" && role !== "assistant") return;
      for (const raw of codexBlockText(item.payload)) {
        const text = normalize(raw);
        if (!text || isScaffolding(text)) continue;
        events.push({ role, text: text.slice(0, 24000), ts });
      }
    });
  }
  if (!events.length && meta.preview) events.push({ role: "user", text: normalize(meta.preview), ts: meta.created });
  const userEvents = events.filter((event) => event.role === "user");
  const titleCandidate = indexNames.get(meta.id) || meta.name || meta.dbTitle;
  const looksLikeRawPrompt = titleCandidate?.length > 140;
  const title = looksLikeRawPrompt
    ? titleFromText(userEvents[0]?.text || titleCandidate)
    : humanizeTitle(titleCandidate) || titleFromText(userEvents[0]?.text || "");
  return makeConversation({
    id: meta.id,
    agent: "Codex",
    title,
    created: metaTimestamp || meta.created,
    updated: meta.updated,
    cwd: meta.cwd,
    model: meta.model,
    source: meta.rolloutPath,
    events,
  });
}

function walkJsonl(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "subagents" && entry.name !== "memory") stack.push(full);
      } else if (entry.name.endsWith(".jsonl")) {
        found.push(full);
      }
    }
  }
  return found;
}

function claudeContent(message) {
  if (typeof message?.content === "string") return [message.content];
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter((block) => block?.type === "text")
    .map((block) => block.text || "")
    .filter(Boolean);
}

async function parseClaude(file) {
  const events = [];
  let customTitle = "";
  let cwd = "";
  let model = "";
  let sessionId = path.basename(file, ".jsonl");
  let minTs = Infinity;
  let maxTs = -Infinity;
  await readJsonLines(file, (item) => {
    if (item.type === "custom-title" && item.customTitle) customTitle = item.customTitle;
    if (item.cwd) cwd = item.cwd;
    if (item.sessionId) sessionId = item.sessionId;
    if (item.message?.model) model = item.message.model;
    const ts = timestampMs(item.timestamp);
    if (ts !== null) {
      minTs = Math.min(minTs, ts);
      maxTs = Math.max(maxTs, ts);
    }
    if (item.isMeta || item.isSidechain || item.isCompactSummary) return;
    if (item.type !== "user" && item.type !== "assistant") return;
    const role = item.type;
    for (const raw of claudeContent(item.message)) {
      const text = normalize(raw);
      if (!text || isScaffolding(text)) continue;
      events.push({ role, text: text.slice(0, 24000), ts: ts ?? minTs });
    }
  });
  if (!Number.isFinite(maxTs) || maxTs < START.getTime() || minTs > END.getTime()) return null;
  const firstUser = events.find((event) => event.role === "user")?.text || "";
  return makeConversation({
    id: sessionId,
    agent: "Claude",
    title: humanizeTitle(customTitle) || titleFromText(firstUser),
    created: Number.isFinite(minTs) ? minTs : maxTs,
    updated: Number.isFinite(maxTs) ? maxTs : minTs,
    cwd,
    model,
    source: file,
    events,
  });
}

function inferProject(cwd, source) {
  const raw = cwd || path.dirname(source);
  const parts = raw.split(path.sep).filter(Boolean);
  for (const marker of CONFIG.projectMarkers) {
    const index = parts.lastIndexOf(marker);
    if (index >= 0 && parts[index + 1]) return parts[index + 1];
  }
  const encoded = source.match(/\.claude\/projects\/-(?:Users|home)-[^/]+-(?:dev-)?(?:projects-)?([^/]+)/);
  if (encoded) return encoded[1].split("-")[0];
  return "General";
}

function buildPhases(events) {
  const userIndexes = events.map((event, index) => event.role === "user" ? index : -1).filter((index) => index >= 0);
  const phases = [];
  userIndexes.forEach((eventIndex, phaseIndex) => {
    if (phaseIndex > 0 && !isMeaningfulUserTurn(events[eventIndex].text)) return;
    const nextUser = userIndexes[phaseIndex + 1] ?? events.length;
    const replies = events.slice(eventIndex + 1, nextUser).filter((event) => event.role === "assistant");
    for (const unit of extractRequestUnits(events[eventIndex].text)) {
      if (!isMeaningfulUserTurn(unit)) continue;
      const request = plainTopic(unit);
      if (!request) continue;
      if (phaseIndex > 0 && /^Se planteó una consulta cuyo detalle/i.test(request)) continue;
      const category = topicCategory(unit);
      const fingerprint = topicFingerprint(request);
      const duplicate = phases.find((phase) => overlap(phase.fingerprint, fingerprint) >= 0.8);
      if (duplicate) {
        if (!duplicate.response && replies.length) duplicate.response = summarizeResponse(replies.map((reply) => reply.text).join("\n"), 360);
        continue;
      }
      phases.push({
        turn: phaseIndex + 1,
        request,
        response: replies.length ? summarizeResponse(replies.map((reply) => reply.text).join("\n"), 360) : "",
        fingerprint,
        category,
      });
    }
  });
  if (phases.length <= 8) return phases;
  const indexes = [0, 1, 2, Math.floor(phases.length / 2) - 1, Math.floor(phases.length / 2),
    phases.length - 3, phases.length - 2, phases.length - 1];
  return [...new Set(indexes)].map((index) => phases[index]).filter(Boolean);
}

function makeConversation({ id, agent, title, created, updated, cwd, model, source, events }) {
  const users = events.filter((event) => event.role === "user");
  const assistants = events.filter((event) => event.role === "assistant");
  const firstUser = users[0]?.text || "";
  const lastAssistant = assistants.at(-1)?.text || "";
  const phases = buildPhases(events);
  let objective = plainTopic(firstUser);
  if (stripNoiseLines(firstUser).length >= 650 && phases[0]?.request) objective = phases[0].request;
  if (!isMeaningfulUserTurn(firstUser) || !objective || /^Se planteó una consulta cuyo detalle/i.test(objective)) {
    const fixed = CONFIG.titleObjectives.find(([pattern]) => pattern.test(title));
    objective = fixed ? fixed[1] : `Revisión del asunto «${title}».`;
    if (phases[0] && /^Se planteó una consulta cuyo detalle/i.test(phases[0].request)) {
      phases[0].request = objective;
    }
  }
  if (!phases.length && events.length) {
    phases.push({ turn: 1, request: objective, response: "", fingerprint: topicFingerprint(objective), category: "fallback" });
  }
  let result = lastAssistant ? summarizeResponse(lastAssistant, 620)
    : "No consta una respuesta final recuperable en el archivo de sesión.";
  const resultSource = stripNoiseLines(lastAssistant).toLowerCase();
  if (/otros hosts|otros destinos/.test(resultSource) && /\bregistros?\b/.test(resultSource)) {
    result = "Los registros encontrados correspondían a otros destinos y no al servicio buscado. La comprobación exacta quedó pendiente de continuar desde una sesión autenticada.";
  }
  if (/no response requested/i.test(lastAssistant)) {
    result = "La sesión terminó sin una conclusión final explícita registrada.";
  }
  return {
    id, agent, title: title || "Conversación sin título", created, updated, cwd, model, source,
    project: inferProject(cwd, source),
    turns: phases.length,
    objective,
    phases,
    result,
    recoverable: events.length > 0,
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(ms, withTime = false) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short", timeZone: TIME_ZONE } : {}),
  }).format(new Date(ms));
}

// Los límites del intervalo se guardan en UTC; se formatean en UTC para que el día no se desplace.
function formatRangeDay(date) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function slug(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderList(items, empty = "Sin datos adicionales.") {
  if (!items.length) return `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderCard(conversation, index) {
  const search = [
    conversation.title, conversation.project, conversation.agent, conversation.objective,
    conversation.result,
    conversation.phases.map((phase) => `${phase.request} ${phase.response}`).join(" "),
  ].join(" ").toLowerCase();
  const phaseRows = conversation.phases.map((phase, pointIndex) => `
    <li class="phase">
      <span class="phase-number">${pointIndex + 1}</span>
      <div>
        <p>${escapeHtml(phase.request)}</p>
      </div>
    </li>`).join("");
  return `
  <article class="conversation" data-agent="${conversation.agent.toLowerCase()}"
    data-project="${escapeHtml(conversation.project)}" data-date="${conversation.created}"
    data-search="${escapeHtml(search)}">
    <details ${index < 3 ? "open" : ""}>
      <summary>
        <span class="agent-dot ${conversation.agent.toLowerCase()}"></span>
        <span class="summary-copy">
          <span class="conversation-title">${escapeHtml(conversation.title)}</span>
          <span class="meta">${escapeHtml(conversation.agent)} · ${escapeHtml(conversation.project)} · ${formatDate(conversation.created)} · ${conversation.turns} ${conversation.turns === 1 ? "tema" : "temas"}</span>
        </span>
        <span class="chevron" aria-hidden="true"></span>
      </summary>
      <div class="conversation-body">
        <section class="objective">
          <h3>Tema principal</h3>
          <p>${escapeHtml(conversation.objective)}</p>
        </section>
        <section>
          <h3>Puntos tratados, en orden</h3>
          ${phaseRows ? `<ol class="phases">${phaseRows}</ol>` : `<p class="muted">No se recuperaron mensajes conversacionales; solo metadatos de la sesión.</p>`}
        </section>
        <section class="result">
          <h3>Conclusión o estado al terminar</h3>
          <p>${escapeHtml(conversation.result)}</p>
        </section>
        <footer>
          <span>Inicio: ${formatDate(conversation.created, true)}</span>
          <span>Última actividad: ${formatDate(conversation.updated, true)}</span>
          ${conversation.model ? `<span>Modelo: ${escapeHtml(conversation.model)}</span>` : ""}
          <span>ID: ${escapeHtml(conversation.id.slice(0, 12))}…</span>
        </footer>
      </div>
    </details>
  </article>`;
}

function buildHtml(conversations) {
  const codexCount = conversations.filter((item) => item.agent === "Codex").length;
  const claudeCount = conversations.filter((item) => item.agent === "Claude").length;
  const projects = [...new Set(conversations.map((item) => item.project))].sort((a, b) => a.localeCompare(b));
  const turns = conversations.reduce((total, item) => total + item.turns, 0);
  const unavailable = conversations.filter((item) => !item.recoverable).length;
  const generated = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long", timeStyle: "short", timeZone: TIME_ZONE,
  }).format(new Date());
  const cards = conversations.map(renderCard).join("\n");
  const projectOptions = projects.map((project) => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`).join("");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Atlas de conversaciones IA · ${formatRangeDay(START)} – ${formatRangeDay(END)}</title>
  <style>
    :root {
      --ink: #17211b; --muted: #647168; --paper: #f7f5ef; --card: #fffefa;
      --line: #dfe3d8; --accent: #245f46; --accent-soft: #dcebe1;
      --codex: #167454; --claude: #b85e35; --shadow: 0 15px 35px rgba(33, 46, 38, .08);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; color: var(--ink); background: var(--paper);
      font: 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body::before { content: ""; position: fixed; inset: 0 0 auto; height: 8px;
      background: linear-gradient(90deg, var(--codex) 0 58%, var(--claude) 58%); z-index: 10; }
    .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    header.hero { padding: 72px 0 34px; }
    .eyebrow { color: var(--accent); font-weight: 800; letter-spacing: .13em; text-transform: uppercase; font-size: 12px; }
    h1 { max-width: 780px; margin: 12px 0 14px; font: 700 clamp(36px, 6vw, 70px)/.98 Georgia, serif; letter-spacing: -.04em; }
    .lede { max-width: 760px; color: var(--muted); font-size: 17px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 30px 0 0; }
    .stat { padding: 18px; border: 1px solid var(--line); background: rgba(255,255,255,.54); border-radius: 16px; }
    .stat strong { display: block; font: 700 30px/1 Georgia, serif; }
    .stat span { color: var(--muted); font-size: 13px; }
    .controls { position: sticky; top: 8px; z-index: 9; display: grid; grid-template-columns: 1fr auto auto;
      gap: 10px; padding: 14px; margin: 0 0 22px; border: 1px solid var(--line); border-radius: 18px;
      background: rgba(247,245,239,.93); backdrop-filter: blur(14px); box-shadow: var(--shadow); }
    input, select, button { min-height: 44px; border: 1px solid var(--line); border-radius: 11px;
      background: var(--card); color: var(--ink); padding: 0 13px; font: inherit; }
    input:focus, select:focus, button:focus-visible { outline: 3px solid rgba(36,95,70,.2); border-color: var(--accent); }
    .agent-filters { display: flex; gap: 6px; }
    button { cursor: pointer; font-weight: 700; }
    button.active { color: white; background: var(--accent); border-color: var(--accent); }
    .result-line { display: flex; justify-content: space-between; gap: 20px; margin: 0 2px 12px; color: var(--muted); font-size: 13px; }
    .conversation { margin-bottom: 12px; }
    .conversation[hidden] { display: none; }
    details { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--card); box-shadow: 0 4px 14px rgba(33,46,38,.04); }
    details[open] { box-shadow: var(--shadow); border-color: #cbd6ca; }
    summary { display: flex; align-items: center; gap: 14px; min-height: 86px; padding: 18px 20px; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .agent-dot { flex: 0 0 auto; width: 13px; height: 13px; border-radius: 50%; box-shadow: 0 0 0 5px rgba(22,116,84,.1); }
    .agent-dot.codex { background: var(--codex); }
    .agent-dot.claude { background: var(--claude); box-shadow: 0 0 0 5px rgba(184,94,53,.1); }
    .summary-copy { min-width: 0; display: grid; gap: 4px; }
    .conversation-title { font: 700 19px/1.25 Georgia, serif; }
    .meta { color: var(--muted); font-size: 12px; }
    .chevron { margin-left: auto; width: 10px; height: 10px; border-right: 2px solid var(--muted);
      border-bottom: 2px solid var(--muted); transform: rotate(45deg); transition: transform .2s; }
    details[open] .chevron { transform: rotate(225deg); }
    .conversation-body { padding: 0 24px 22px 47px; border-top: 1px solid var(--line); }
    section { margin-top: 24px; }
    h3 { margin: 0 0 9px; color: var(--accent); font-size: 13px; letter-spacing: .05em; text-transform: uppercase; }
    p { margin: 0 0 10px; }
    ul { margin: 0; padding-left: 19px; }
    li { margin: 0 0 7px; }
    .objective { padding: 18px 20px; background: var(--accent-soft); border-radius: 14px; }
    .objective p { font-size: 16px; }
    .result { padding: 18px 20px; border: 1px solid var(--line); border-radius: 14px; background: #fbfaf6; }
    .phases { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .phase { display: grid; grid-template-columns: 30px 1fr; gap: 11px; margin: 0; padding: 13px 14px;
      border-left: 3px solid var(--accent-soft); background: #fbfaf6; border-radius: 0 12px 12px 0; }
    .phase-number { display: grid; place-items: center; width: 27px; height: 27px; color: white; background: var(--accent); border-radius: 50%; font-weight: 800; font-size: 12px; }
    .phase p:last-child { margin-bottom: 0; }
    footer { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 24px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
    .method { margin: 38px 0 60px; padding: 22px; border: 1px dashed #b8c4b7; border-radius: 16px; color: var(--muted); }
    .method h2 { margin: 0 0 8px; color: var(--ink); font: 700 22px Georgia, serif; }
    .muted { color: var(--muted); }
    .empty-state { display: none; padding: 50px 20px; text-align: center; border: 1px dashed var(--line); border-radius: 18px; }
    .empty-state.visible { display: block; }
    @media (max-width: 760px) {
      .shell { width: min(100% - 24px, 1180px); }
      header.hero { padding-top: 52px; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .controls { position: static; grid-template-columns: 1fr; }
      .agent-filters { display: grid; grid-template-columns: repeat(3, 1fr); }
      .conversation-body { padding-left: 20px; }
      summary { padding: 16px; }
    }
    @media print {
      body::before, .controls { display: none; }
      .shell { width: 100%; }
      details { break-inside: avoid; box-shadow: none; }
      details:not([open]) > *:not(summary) { display: block; }
    }
  </style>
</head>
<body>
  <header class="hero shell">
    <div class="eyebrow">Archivo personal · ${formatRangeDay(START)} — ${formatRangeDay(END)}</div>
    <h1>Atlas de conversaciones con IA</h1>
    <p class="lede">Un índice navegable de las sesiones locales de Codex y Claude, condensadas en objetivos, puntos tratados, evolución y resultado final.</p>
    <div class="stats" aria-label="Resumen">
      <div class="stat"><strong>${conversations.length}</strong><span>conversaciones</span></div>
      <div class="stat"><strong>${codexCount} / ${claudeCount}</strong><span>Codex / Claude</span></div>
      <div class="stat"><strong>${projects.length}</strong><span>ámbitos o proyectos</span></div>
      <div class="stat"><strong>${turns}</strong><span>temas resumidos</span></div>
    </div>
  </header>
  <main class="shell">
    <div class="controls" aria-label="Filtros del informe">
      <input id="search" type="search" placeholder="Buscar tema, tecnología, proyecto…" aria-label="Buscar conversaciones">
      <select id="project" aria-label="Filtrar por proyecto"><option value="">Todos los proyectos</option>${projectOptions}</select>
      <div class="agent-filters" role="group" aria-label="Filtrar por agente">
        <button type="button" class="active" data-agent="">Todos</button>
        <button type="button" data-agent="codex">Codex</button>
        <button type="button" data-agent="claude">Claude</button>
      </div>
    </div>
    <div class="result-line"><span id="count">${conversations.length} conversaciones visibles</span><span>Orden: más recientes primero</span></div>
    <div id="conversations">${cards}</div>
    <div id="empty" class="empty-state"><strong>No hay coincidencias.</strong><p class="muted">Prueba con otro término o elimina algún filtro.</p></div>
    <aside class="method">
      <h2>Cómo se ha elaborado</h2>
      <p>Generado el ${escapeHtml(generated)} a partir de sesiones locales con actividad dentro del intervalo. Se han omitido mensajes de sistema, instrucciones internas, subagentes, llamadas y resultados de herramientas, comandos, rutas, listados de archivos, trazas y bloques de error. Cada ficha se centra en el tema tratado, su evolución y la conclusión alcanzada.</p>
      <p>Se aplicó redacción automática de patrones habituales de credenciales. ${unavailable ? `${unavailable} sesiones solo conservaban metadatos y se señalan como tales.` : "Todas las fichas incluidas contenían texto conversacional recuperable."}</p>
    </aside>
  </main>
  <script>
    const cards = [...document.querySelectorAll(".conversation")];
    const search = document.querySelector("#search");
    const project = document.querySelector("#project");
    const count = document.querySelector("#count");
    const empty = document.querySelector("#empty");
    const buttons = [...document.querySelectorAll("[data-agent]")];
    let agent = "";
    function applyFilters() {
      const query = search.value.trim().toLocaleLowerCase("es");
      let visible = 0;
      for (const card of cards) {
        const show = (!agent || card.dataset.agent === agent)
          && (!project.value || card.dataset.project === project.value)
          && (!query || card.dataset.search.includes(query));
        card.hidden = !show;
        if (show) visible++;
      }
      count.textContent = visible + (visible === 1 ? " conversación visible" : " conversaciones visibles");
      empty.classList.toggle("visible", visible === 0);
    }
    search.addEventListener("input", applyFilters);
    project.addEventListener("change", applyFilters);
    buttons.forEach((button) => button.addEventListener("click", () => {
      agent = button.dataset.agent;
      buttons.forEach((item) => item.classList.toggle("active", item === button));
      applyFilters();
    }));
  </script>
</body>
</html>`;
}

async function main() {
  const indexNames = await codexIndex();
  const codexRows = codexMetadata().filter((meta) =>
    !CONFIG.excludeCodexTitles.some((pattern) => pattern.test(meta.dbTitle || "")));
  const conversations = [];
  for (const meta of codexRows) conversations.push(await parseCodex(meta, indexNames));
  for (const file of walkJsonl(CLAUDE_PROJECTS)) {
    const conversation = await parseClaude(file);
    if (conversation) conversations.push(conversation);
  }
  conversations.sort((a, b) => b.created - a.created || a.agent.localeCompare(b.agent));
  fs.writeFileSync(OUTPUT, buildHtml(conversations), "utf8");
  const summary = {
    output: OUTPUT,
    total: conversations.length,
    codex: conversations.filter((item) => item.agent === "Codex").length,
    claude: conversations.filter((item) => item.agent === "Claude").length,
    projects: new Set(conversations.map((item) => item.project)).size,
    turns: conversations.reduce((total, item) => total + item.turns, 0),
    withoutMessages: conversations.filter((item) => !item.recoverable).length,
    bytes: fs.statSync(OUTPUT).size,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
