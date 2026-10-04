#!/usr/bin/env node
// extract-sublime-notes.mjs — Extrae las pestañas temporales (sin guardar) de Sublime Text a Markdown redactado.
//
// Qué hace:     Lee el fichero de sesión de Sublime Text (JSON) y, por cada buffer que no está
//               asociado a un fichero en disco (las notas "Untitled" que nunca guardaste), crea un
//               .md con front matter (fechas mencionadas, temas detectados, nº de redacciones).
//               Antes de escribir, REDACTA posibles secretos (JWT, Bearer, password=, tokens en URL,
//               cookies, cadenas largas tipo clave) y genera manifest.json + index.md.
// Requisitos:   Node.js 16+ (solo módulos nativos). Conviene cerrar Sublime antes, para que la sesión
//               en disco esté al día.
// Uso:          node extract-sublime-notes.mjs "<RUTA_SESION>" <CARPETA_SALIDA>
//               node extract-sublime-notes.mjs "<RUTA_SESION>" <CARPETA_SALIDA> 2026-07-15
//               macOS: <RUTA_SESION> = "$HOME/Library/Application Support/Sublime Text/Local/Session.sublime_session"
// Variables:    session        (1er arg, obligatorio) ruta del fichero .sublime_session.
//               output-root    (2º arg, obligatorio) carpeta raíz donde se crea extracted/AAAA/MM/DD/.
//               snapshot-date  (3er arg, opcional) fecha de la instantánea YYYY-MM-DD; por defecto HOY
//                              (fecha local). Sublime no guarda fecha por buffer: esta es la única fecha fiable.
//               SUBLIME_NOTES_TOPICS_FILE (opcional) JSON { "tema": "regex", ... } que sustituye las
//                              reglas de temas por defecto (las regex se evalúan sin distinguir mayúsculas).
// Efectos:      SOLO LECTURA sobre la sesión de Sublime.
//               ESCRIBE (y BORRA antes): <output-root>/extracted/AAAA/MM/DD/notes/ se elimina y se
//               regenera; también escribe manifest.json e index.md en esa fecha. Ficheros con modo 0600.
// Salida:       JSON por stdout: { noteCount, notesDir, manifestPath }.
import fs from 'node:fs';
import path from 'node:path';

// Fecha local de hoy en formato YYYY-MM-DD (toISOString daría la fecha UTC).
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const [source, outputRoot, snapshotDate = today()] = process.argv.slice(2);

if (!source || !outputRoot) {
  throw new Error('Usage: node extract-sublime-notes.mjs <session> <output-root> [snapshot-date YYYY-MM-DD, por defecto hoy]');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
  throw new Error('snapshot-date debe tener formato YYYY-MM-DD');
}

const session = JSON.parse(fs.readFileSync(source, 'utf8'));
// Buffers temporales: sin `file` (nunca guardados), que no sean scratch (paneles internos) y con texto.
const buffers = (session.windows ?? [])
  .flatMap((window) => window.buffers ?? [])
  .filter((buffer) => !buffer.file && !buffer.settings?.scratch && typeof buffer.contents === 'string');

const [year, month, day] = snapshotDate.split('-');
const notesDir = path.join(outputRoot, 'extracted', year, month, day, 'notes');
// OJO: borra la carpeta de notas de esa fecha antes de regenerarla.
fs.rmSync(notesDir, { recursive: true, force: true });
fs.mkdirSync(notesDir, { recursive: true });

// Palabras en título/contenido que marcan la nota como sensible aunque no se haya redactado nada.
const sensitiveHint = /(keeper|password|passwd|contrase(?:n|ñ)a|credential|credencial|authorization|bearer|api[_ -]?key|access[_ -]?token|codigo de verificaci[oó]n|c[oó]digo verificaci[oó]n|jwt)/i;

function redact(text, title = '') {
  let count = 0;
  const replace = (regex, replacement = '[REDACTED]') => {
    text = text.replace(regex, (...args) => {
      count += 1;
      // Con callback, String.replace NO expande "$1": se sustituye aquí a mano por el grupo capturado.
      return typeof replacement === 'function'
        ? replacement(...args)
        : replacement.replace(/\$(\d)/g, (_, group) => args[Number(group)] ?? '');
    });
  };

  // Orden: JWT (empiezan por eyJ), cabeceras Bearer, clave=valor sensibles, parámetros de URL,
  // p_p_auth (token de Liferay), campos SAML, cookies (HAR y cabecera) y, por último, cualquier
  // cadena de 20+ caracteres que mezcle letras y dígitos (posible clave o token).
  replace(/\beyJ[A-Za-z0-9_-]{18,}(?:\.[A-Za-z0-9_-]{8,}){0,2}\b/g);
  replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  replace(/((?:password|passwd|contrase(?:n|ñ)a|secret|token|api[_ -]?key|authorization|credential|credencial)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  replace(/([?&](?:token|access_token|auth|authorization|key|code|password|secret|p_p_auth)=)[^&#\s"']+/gi, '$1[REDACTED]');
  replace(/(p_p_auth(?:=|%3D))[A-Za-z0-9_-]+/gi, '$1[REDACTED]');
  replace(/(<input[^>]+name=["'](?:SAMLRequest|SAMLResponse|RelayState)["'][^>]+value=["'])[^"']+/gi, '$1[REDACTED]');
  replace(/("name"\s*:\s*"Cookie"\s*,\s*"value"\s*:\s*")[^"]*/gi, '$1[REDACTED]');
  replace(/^(Cookie\s*:\s*).+$/gim, '$1[REDACTED]');
  replace(/\b(?=[A-Za-z0-9+/_-]{20,}={0,2}\b)(?=[A-Za-z0-9+/_-]*[A-Za-z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]+={0,2}\b/g);

  const trimmed = text.trim();
  const looksLikeStandaloneSecret = trimmed.length > 7
    && trimmed.length < 100
    && !trimmed.includes('\n')
    && !trimmed.includes(' ')
    && /[A-Za-z]/.test(trimmed)
    && /\d/.test(trimmed)
    && (/[^A-Za-z0-9]/.test(trimmed) || trimmed.length >= 20);

  if (looksLikeStandaloneSecret || (sensitiveHint.test(title) && trimmed.length < 160 && !trimmed.includes('\n'))) {
    text = '[REDACTED: posible credencial o código]\n';
    count += 1;
  }

  return { text, count };
}

function validDate(yearValue, monthValue, dayValue) {
  const candidate = new Date(`${yearValue}-${monthValue}-${dayValue}T00:00:00Z`);
  if (Number.isNaN(candidate.valueOf())) return null;
  const iso = candidate.toISOString().slice(0, 10);
  return iso === `${yearValue}-${monthValue}-${dayValue}` ? iso : null;
}

function extractDates(text) {
  const dates = new Set();
  for (const match of text.matchAll(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/g)) {
    const value = validDate(match[1], match[2], match[3]);
    if (value) dates.add(value);
  }
  for (const match of text.matchAll(/\b(0[1-9]|[12]\d|3[01])[/-](0[1-9]|1[0-2])[/-](20\d{2})\b/g)) {
    const value = validDate(match[3], match[2], match[1]);
    if (value) dates.add(value);
  }
  return [...dates].sort();
}

// Reglas de clasificación por temas: [nombre, regex]. Ejemplos genéricos; ajústalos a tus temas
// o sustitúyelos con SUBLIME_NOTES_TOPICS_FILE (JSON { "tema": "regex" }).
const DEFAULT_TOPIC_RULES = [
  ['bases-de-datos', /mongo(?:db)?|elastic(?:search)?|postgres|mysql|oracle|redis/i],
  ['kubernetes-openshift', /kubectl|kubernetes|\bk8s\b|openshift|\boc\s|helm/i],
  ['cloud-aws-azure', /\baws\b|\bs3\b|\brds\b|\bec2\b|azure|\baz\s/i],
  ['liferay', /liferay|portlet|freemarker|journalarticle/i],
  ['imputaciones-workday', /imputaci[oó]n|workday|timesheet/i],
  ['accesos-seguridad', /keeper|credential|credencial|password|contrase(?:n|ñ)a|token|access denied|allowlist|vpn|vdi/i],
  ['ia-herramientas', /claude|codex|subagente|mcp|anthropic|openai/i]
];

function loadTopicRules() {
  const file = process.env.SUBLIME_NOTES_TOPICS_FILE;
  if (!file) return DEFAULT_TOPIC_RULES;
  const custom = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(custom).map(([name, pattern]) => [name, new RegExp(pattern, 'i')]);
}

const topicRules = loadTopicRules();

function topics(text) {
  const matched = topicRules.filter(([, regex]) => regex.test(text)).map(([name]) => name);
  return matched.length ? matched : ['general'];
}

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' enlace ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 52) || 'sin-titulo';
}

const manifest = [];

buffers.forEach((buffer, index) => {
  const sourceTitle = buffer.settings?.name || buffer.contents.split(/\r?\n/, 1)[0] || 'Sin título';
  const combinedForDetection = `${sourceTitle}\n${buffer.contents}`;
  const titleRedaction = redact(sourceTitle, sourceTitle);
  const contentRedaction = redact(buffer.contents, sourceTitle);
  const redactionCount = titleRedaction.count + contentRedaction.count;
  const isSensitive = redactionCount > 0 || sensitiveHint.test(combinedForDetection);
  const safeTitle = isSensitive && titleRedaction.count > 0 ? `Nota sensible ${index + 1}` : titleRedaction.text.trim().slice(0, 100);
  const slug = isSensitive && titleRedaction.count > 0 ? `sensitive-note-${String(index + 1).padStart(3, '0')}` : slugify(safeTitle);
  const fileName = `note-${String(index + 1).padStart(3, '0')}-${slug}.md`;
  const dateReferences = extractDates(buffer.contents);
  const matchedTopics = topics(combinedForDetection);
  const body = [
    '---',
    `id: ${index + 1}`,
    `snapshot_date: ${snapshotDate}`,
    'original_buffer_date: unavailable',
    `date_references: [${dateReferences.join(', ')}]`,
    `topics: [${matchedTopics.join(', ')}]`,
    `sensitive_content_redacted: ${isSensitive}`,
    `redaction_count: ${redactionCount}`,
    '---',
    '',
    `# ${safeTitle || `Nota ${index + 1}`}`,
    '',
    contentRedaction.text.trimEnd(),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(notesDir, fileName), body, { mode: 0o600 });
  manifest.push({
    id: index + 1,
    file: fileName,
    title: safeTitle,
    sourceSize: buffer.contents.length,
    dateReferences,
    topics: matchedTopics,
    sensitiveContentRedacted: isSensitive,
    redactionCount
  });
});

const manifestPath = path.join(outputRoot, 'extracted', year, month, day, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify({ snapshotDate, source, noteCount: manifest.length, notes: manifest }, null, 2)}\n`, { mode: 0o600 });

const indexLines = [
  '# Índice de notas temporales de Sublime Text',
  '',
  `Fecha verificable de la instantánea: ${snapshotDate}`,
  '',
  'Sublime Text no conserva en esta sesión una fecha de creación o modificación por buffer. Las fechas enumeradas son referencias encontradas dentro del texto y no se usan como fecha de creación.',
  '',
  `Notas temporales extraídas: ${manifest.length}`,
  '',
  '| ID | Nota | Temas | Fechas mencionadas | Redacciones |',
  '|---:|---|---|---|---:|',
  ...manifest.map((item) => `| ${item.id} | [${item.title || 'Sin título'}](notes/${item.file}) | ${item.topics.join(', ')} | ${item.dateReferences.join(', ') || 'Sin fecha explícita'} | ${item.redactionCount} |`),
  ''
];
fs.writeFileSync(path.join(outputRoot, 'extracted', year, month, day, 'index.md'), indexLines.join('\n'), { mode: 0o600 });

process.stdout.write(JSON.stringify({ noteCount: manifest.length, notesDir, manifestPath }));
