// run-playwright.js — lanzador Playwright que exporta Teams Web y/o Outlook Web por tenant.
//
// Qué hace:     Abre Chromium con un perfil persistente por aplicación y tenant
//               (.playwright-profile/<teams|outlook>/<tenant>/), verifica que la cuenta visible es
//               el email configurado, inyecta en la página el script de navegador
//               (teams/04-export-all-chats-to-today.js u outlook/02-export-folder-bodies.js),
//               espera a que termine guardando checkpoints y escribe JSON + TXT en data/.
//               En Outlook descubre el árbol de carpetas y permite elegir carpetas y pestañas.
// Requisitos:   Node.js 20+, `npm install` y `npx playwright install chromium`;
//               config.local.json con tus tenants (ver config.example.json). La primera vez
//               completas SSO/MFA a mano en la ventana de Chromium.
// Uso:          npm run extract:all -- --days 7
//               npm run extract:teams -- --tenant empresa --since 2026-01-01 --until 2026-01-08
//               npm run extract:outlook -- --tenant cliente --folders Inbox --tabs focused --yes
//               npm run extract -- --help        (lista completa de flags)
// Variables:    M365_WEB_EXPORT_CONFIG (opcional) ruta alternativa al JSON de tenants.
//               Flags: ver usageText() en lib/cli-options.js y el README.
// Efectos:      SOLO LECTURA en Microsoft 365, pero abrir chats/correos puede MARCARLOS COMO
//               LEÍDOS. ESCRIBE: perfiles de navegador en .playwright-profile/ (o --profile) y
//               exportaciones en data/ (directorios 0700, ficheros 0600).
// Salida:       data/teams-exports/raw/<tenant>/<AAAA-MM>/*.json|*.txt
//               data/outlook-exports/raw/<tenant>/<AAAA-MM>/<carpeta-hash>/<pestaña>/*.json|*.txt
//               *.checkpoint.json mientras corre (se borra al completar; se conserva si falla).
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { CONFIG_PATH, MICROSOFT_TENANTS } from "./config/microsoft-tenants.js";
import { CliUsageError, extractionRange, parseArguments, usageText } from "./lib/cli-options.js";
import {
  clickOutlookFolder,
  clickOutlookTab,
  discoverOutlookFolders,
  discoverOutlookTabs,
  openAccountIdentityPanel,
  outlookListSignature,
  selectConfiguredMicrosoftAccount,
  visibleConfiguredIdentity
} from "./lib/outlook-browser.js";
import {
  buildFolderPaths,
  executeViewPlan,
  outlookOutputIdentity,
  outlookViewOutputDirectory,
  resolveFolderRequests,
  tabFromVisibleLabel
} from "./lib/outlook-workflow.js";
import {
  executeTenantPlan,
  tenantById,
  tenantOutputDirectory,
  tenantProfilePath,
  tenantSupports,
  tenantsForSources
} from "./lib/tenant-workflow.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function logEvent(event, details = {}) {
  const fields = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  console.log(`[${new Date().toISOString()}] ${event}${fields ? ` ${fields}` : ""}`);
}

function elapsedSeconds(startedAt) {
  return Number(((Date.now() - startedAt) / 1000).toFixed(1));
}

function safeErrorMessage(error) {
  return String(error?.message || error || "Error desconocido")
    .replace(/https?:\/\/\S+/g, "[url]");
}

function usage(error) {
  if (error) console.error(error);
  console.error(usageText());
  process.exit(error ? 1 : 0);
}

function safeName(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 200) || "export";
}

async function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

function teamsText(batch) {
  return batch.chats.map((chat) => {
    const messages = chat.messages
      .map((message) => `[${message.timestamp}] ${message.author}\n${message.body}`)
      .join("\n\n---\n\n");
    return `# ${chat.title}${chat.favorite ? " [FAVORITE]" : ""}\n\n${messages}`;
  }).join("\n\n========================================\n\n");
}

function outlookText(result) {
  return result.emails.map((email) =>
    `[${email.timestamp || email.timestampRaw || "fecha desconocida"}]` +
    `${email.pinned ? " [PINNED]" : ""}` +
    `${email.senderEmail ? ` <${email.senderEmail}>` : ""}\n` +
    `Asunto: ${email.subject}\n\n${email.body || "(cuerpo no capturado)"}`
  ).join("\n\n========================================\n\n");
}

async function askLine(question) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

async function chooseMany(question, choices) {
  console.log(`\n${question}`);
  choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice.label}`));
  console.log("Escribe números separados por comas, o 'all' para seleccionar todo.");
  while (true) {
    const answer = (await askLine("> ")).toLowerCase();
    const indexes = answer === "all"
      ? choices.map((_, index) => index)
      : answer.split(",").map((value) => Number(value.trim()) - 1);
    if (indexes.length && indexes.every((index) => Number.isInteger(index) && choices[index])) {
      return [...new Set(indexes)].map((index) => choices[index].value);
    }
    console.log("Selección no válida; usa, por ejemplo, 1,3.");
  }
}

async function confirmExecution(summary, automatic) {
  console.log("\nResumen de extracción de Outlook");
  console.log(`  Cuenta: ${summary.account.name} (${summary.account.email})`);
  console.log(`  Carpetas: ${summary.folders.join(", ")}`);
  console.log(`  Pestañas: ${summary.tabs.join(", ")}`);
  console.log(`  Intervalo: [${summary.range.since}, ${summary.range.until})`);
  console.log("  Aviso: abrir correos para extraer cuerpos puede marcarlos como leídos.");
  if (automatic) return true;
  const answer = (await askLine("¿Continuar? [y/N] ")).toLowerCase();
  return answer === "y" || answer === "yes" || answer === "s" || answer === "sí" || answer === "si";
}

async function chooseTenants(options, selectedSources) {
  if (options.tenants.length && !options.interactive) {
    return options.tenants.map((tenantId) => tenantById(tenantId));
  }
  const available = tenantsForSources(selectedSources, MICROSOFT_TENANTS);
  const selected = await chooseMany(
    "Elige uno o varios tenants de Microsoft 365:",
    available.map((tenant) => ({
      label: `${tenant.name} — ${tenant.email} [${tenant.applications.join(", ")}]`,
      value: tenant.id
    }))
  );
  return selected.map((tenantId) => tenantById(tenantId));
}

async function verifyRequestedMicrosoftAccount(page, account, options, source) {
  const applicationName = source === "teams" ? "Teams" : "Outlook";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await selectConfiguredMicrosoftAccount(page, account)) {
      logEvent(`${source}.account-picker.selected`, { tenant: account.id, method: "exact-email" });
      await page.waitForTimeout(2_000);
    }
    const identityOptions = { includeTreeItems: source === "outlook" };
    if (await visibleConfiguredIdentity(page, account, identityOptions)) {
      logEvent(`${source}.identity.verified`, { tenant: account.id, method: "visible-exact-email" });
      return "dom";
    }
    if (await openAccountIdentityPanel(page)) {
      await page.waitForTimeout(700);
      const verified = await visibleConfiguredIdentity(page, account, identityOptions);
      await page.keyboard.press("Escape").catch(() => undefined);
      if (verified) {
        logEvent(`${source}.identity.verified`, { tenant: account.id, method: "account-panel" });
        return "panel";
      }
    }
    if (options.headless) {
      throw new Error(`No se pudo verificar la identidad de ${applicationName} para ${account.id} en modo headless.`);
    }
    console.log(`\nNo se pudo verificar automáticamente ${applicationName} para ${account.name}.`);
    console.log("Completa el login/SSO/MFA en Chromium. Cuando veas el tenant correcto,");
    const confirmation = await askLine(`escribe exactamente ${account.email} para confirmarlo: `);
    if (confirmation.toLowerCase() === account.email.toLowerCase()) {
      logEvent(`${source}.identity.verified`, { tenant: account.id, method: "manual-exact-email" });
      return "manual";
    }
    console.log(`La confirmación no coincide con la cuenta configurada (intento ${attempt}/3).`);
  }
  throw new Error(`No se confirmó la identidad solicitada de ${applicationName} para ${account.id}; extracción detenida.`);
}

async function waitForFolderView(page, folder, before, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await outlookListSignature(page);
    const correctFolder = state.folderIdentity === folder.stableId;
    const listReady = state.hasList || state.empty || state.rows > 0;
    const changed = state.folderIdentity !== before.folderIdentity
      || JSON.stringify(state.ids) !== JSON.stringify(before.ids);
    if (correctFolder && listReady && (changed || before.folderIdentity === folder.stableId)) return state;
    await page.waitForTimeout(400);
  }
  throw new Error(`Outlook no confirmó la apertura de la carpeta ${folder.path}.`);
}

async function navigateOutlookFolder(page, folder) {
  const before = await outlookListSignature(page);
  await clickOutlookFolder(page, folder);
  const state = await waitForFolderView(page, folder, before);
  logEvent("outlook.folder.opened", { folder: folder.path, rows: state.rows, empty: state.empty });
  return state;
}

async function navigateOutlookTab(page, tab) {
  if (tab === "all") return outlookListSignature(page);
  const before = await outlookListSignature(page);
  if (!await clickOutlookTab(page, tab)) throw new Error(`La pestaña ${tab} no existe en la carpeta abierta.`);
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const state = await outlookListSignature(page);
    const selected = tabFromVisibleLabel(state.tab) === tab;
    const changed = JSON.stringify(state.ids) !== JSON.stringify(before.ids) || state.empty;
    if (selected && (changed || before.tab === state.tab)) {
      logEvent("outlook.tab.opened", { tab, rows: state.rows, empty: state.empty });
      return state;
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Outlook no confirmó la pestaña ${tab}.`);
}

async function pageIsReady(page, source) {
  const selector = source === "teams"
    ? [
        '[id^="title-chat-list-item"]',
        '[data-tid="chat-list-item-title"]',
        '[data-tid="chat-list-item"]'
      ].join(", ")
    : [
        '[data-testid="message-list-item"]',
        '[data-testid="virtuoso-item-list"]',
        '[data-app-section="MessageList"]'
      ].join(", ");
  try {
    return await page.locator(selector).count() > 0;
  } catch {
    // Los redirects del login destruyen temporalmente el contexto de la página.
    return false;
  }
}

async function waitUntilReady(page, source, prompt, automaticOnly) {
  const startedAt = Date.now();
  console.log(`\n${source.toUpperCase()}: ${prompt}`);
  console.log("Aviso: abrir conversaciones o correos puede marcarlos como leídos.");
  console.log(
    automaticOnly
      ? "Esperando a que la vista esté lista..."
      : "Se iniciará automáticamente al detectar la vista. También puedes pulsar Enter para forzar el inicio."
  );

  let finished = false;
  const automatic = (async () => {
    while (!finished) {
      if (await pageIsReady(page, source)) return "automatic";
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return "stopped";
  })();

  let terminal;
  let manual;
  if (!automaticOnly) {
    terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    manual = terminal.question("> ").then(() => "manual").catch((error) => {
      if (error?.code === "ABORT_ERR") return "cancelled";
      throw error;
    });
  }

  const result = await (manual ? Promise.race([automatic, manual]) : automatic);
  finished = true;
  terminal?.close();
  if (result === "cancelled") {
    const error = new Error("Ejecución cancelada por el usuario.");
    error.code = "USER_CANCELLED";
    throw error;
  }
  console.log(
    result === "automatic"
      ? `${source}: vista detectada; iniciando extracción.`
      : `${source}: inicio manual solicitado.`
  );
  logEvent(`${source}.ready`, { mode: result, waitSeconds: elapsedSeconds(startedAt) });
}

async function waitForExport(page, source, timeoutMs, checkpointFile) {
  const started = Date.now();
  let lastCheckpoint = 0;
  let lastProgress = "";
  while (Date.now() - started < timeoutMs) {
    const snapshot = await page.evaluate((kind) => {
      if (kind === "teams") {
        const data = window.teamsBatchExport || null;
        return {
          run: window.teamsBatchExportRun,
          data,
          metrics: data ? {
            phase: "chats",
            discovered: data.discoveredChats,
            attempted: data.attemptedChats,
            scanned: data.scannedChats,
            withMessages: data.chats.length,
            withoutMessages: data.chatsWithoutMessagesInRange.length,
            errors: data.errors.length
          } : { phase: "inventory" }
        };
      }
      const data = window.outlookBodiesExport || window.outlookBodiesCheckpoint || null;
      const emails = data?.emails || [];
      return {
        run: window.outlookBodiesExportRun,
        data,
        metrics: {
          phase: window.outlookBodiesExport ? "completed" : "emails",
          scanned: data?.emailCount || 0,
          pinned: emails.filter((email) => email.pinned).length,
          bodiesLoaded: emails.filter((email) => email.bodyLoaded).length,
          undated: emails.filter((email) => !email.timestamp).length
        }
      };
    }, source);

    const progress = JSON.stringify(snapshot.metrics);
    if (progress !== lastProgress) {
      logEvent(`${source}.progress`, snapshot.metrics);
      lastProgress = progress;
    }
    if (snapshot.data && Date.now() - lastCheckpoint >= 15_000) {
      await atomicJson(checkpointFile, snapshot.data);
      lastCheckpoint = Date.now();
      logEvent(`${source}.checkpoint`, {
        file: path.basename(checkpointFile),
        records: snapshot.metrics.scanned,
        elapsedSeconds: elapsedSeconds(started)
      });
    }
    if (snapshot.run?.status === "completed") {
      logEvent(`${source}.extract.completed`, { elapsedSeconds: elapsedSeconds(started) });
      return snapshot.data;
    }
    if (snapshot.run?.status === "cancelled") throw new Error(`${source}: extracción cancelada.`);
    if (snapshot.run?.status === "failed") throw new Error(`${source}: ${snapshot.run.error}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${source}: tiempo máximo agotado.`);
}

const sources = {
  teams: {
    url: "https://teams.microsoft.com/v2/",
    script: path.join(projectRoot, "scripts/teams/04-export-all-chats-to-today.js"),
    outputDirectory: path.join(projectRoot, "data/teams-exports/raw"),
    ready: "Inicia sesión si hace falta y abre Chat, dejando visibles la lista y una conversación."
  },
  outlook: {
    url: "https://outlook.office.com/mail/",
    script: path.join(projectRoot, "scripts/outlook/02-export-folder-bodies.js"),
    outputDirectory: path.join(projectRoot, "data/outlook-exports/raw"),
    ready: "Inicia sesión si hace falta y abre la carpeta/pestaña que quieras extraer."
  }
};

async function outputFiles(definition, source, range, runTag, identity, explicitDirectory = null) {
  const monthFolder = range.since.slice(0, 7);
  const dayPrefix = range.since.slice(8, 10);
  const outputDirectory = explicitDirectory || path.join(definition.outputDirectory, monthFolder);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  const spansMultipleDays = new Date(range.until) - new Date(range.since) > 24 * 60 * 60 * 1000;
  const rangeSuffix = spansMultipleDays ? `-to-${range.until.slice(0, 10)}` : "";
  const base = safeName(`${dayPrefix}-${source}-${identity}${rangeSuffix}-run-${runTag}`);
  return {
    checkpoint: path.join(outputDirectory, `${base}.checkpoint.json`),
    json: path.join(outputDirectory, `${base}.json`),
    text: path.join(outputDirectory, `${base}.txt`)
  };
}

async function runSource(context, source, options, range, tenant) {
  const definition = sources[source];
  const runTag = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const startedAt = Date.now();
  const page = await context.newPage();
  let expectedPageClose = false;
  page.on("crash", () => logEvent(`${source}.page.crash`, { unexpected: true, tenant: tenant.id }));
  page.on("close", () => logEvent(`${source}.page.closed`, { expected: expectedPageClose }));
  logEvent(`${source}.navigation.start`, { destination: new URL(definition.url).origin });
  await page.goto(definition.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  logEvent(`${source}.navigation.loaded`, { destination: new URL(definition.url).origin });
  await verifyRequestedMicrosoftAccount(page, tenant, options, source);
  await waitUntilReady(page, source, definition.ready, options.yes);

  await page.evaluate(({
    sourceName,
    rangeValue,
    accountLabel,
    tenantId,
    tenantEmail,
    includeHtml,
    includePinnedOutsideRange
  }) => {
    window.__dailyWorkContextSettings = {
      [sourceName]: {
        since: rangeValue.since,
        until: rangeValue.until,
        skipConfirmation: true,
        accountLabel,
        tenantId,
        tenantEmail,
        includeHtml,
        includePinnedOutsideRange
      }
    };
  }, {
    sourceName: source,
    rangeValue: range,
    accountLabel: tenant.id,
    tenantId: tenant.id,
    tenantEmail: tenant.email,
    includeHtml: options.includeHtml,
    includePinnedOutsideRange: options.includePinnedOutsideRange
  });

  const sourceCode = await readFile(definition.script, "utf8");
  // Ejecutar mediante el canal de Playwright evita depender de que la CSP de
  // Microsoft permita una etiqueta <script> inline. El `undefined` final hace
  // que evaluate vuelva enseguida mientras el IIFE asíncrono continúa.
  await page.evaluate(`${sourceCode}\n;undefined;`);
  logEvent(`${source}.extract.started`, {
    tenant: tenant.id,
    since: range.since,
    until: range.until,
    includePinnedOutsideRange: source === "outlook" ? options.includePinnedOutsideRange : undefined
  });
  const outputDirectory = tenantOutputDirectory(definition.outputDirectory, tenant.id, range.since);
  const files = await outputFiles(
    definition,
    source,
    range,
    runTag,
    tenant.id,
    outputDirectory
  );
  const browserResult = await waitForExport(
    page,
    source,
    options.timeoutMinutes * 60_000,
    files.checkpoint
  );
  const result = {
    ...browserResult,
    tenantId: tenant.id,
    tenantEmail: tenant.email,
    requestedRange: { since: range.since, until: range.until }
  };
  await atomicJson(files.json, result);
  await writeFile(files.text, source === "teams" ? teamsText(result) : outlookText(result), { mode: 0o600 });
  await rm(files.checkpoint, { force: true });
  const summary = {
    chats: result.scannedChats,
    withMessages: result.chats.length,
    favorites: result.chats.filter((chat) => chat.favorite).length,
    messages: result.chats.reduce((total, chat) => total + chat.messageCount, 0),
    errors: result.errors.length
  };
  logEvent(`${source}.files.saved`, {
    tenant: tenant.id,
    directory: path.relative(projectRoot, path.dirname(files.json)),
    json: path.basename(files.json),
    text: path.basename(files.text),
    ...summary,
    elapsedSeconds: elapsedSeconds(startedAt)
  });
  expectedPageClose = true;
  await page.close();
  return summary;
}

async function runOutlookView(page, options, range, account, folder, tab) {
  const definition = sources.outlook;
  const runTag = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const identity = outlookOutputIdentity(account, folder.path, tab);
  const viewDirectory = outlookViewOutputDirectory(
    definition.outputDirectory,
    account,
    range.since,
    folder.path,
    tab
  );
  const files = await outputFiles(definition, "outlook", range, runTag, identity, viewDirectory);
  const startedAt = Date.now();
  let state = await outlookListSignature(page);
  if (!state.rows && !state.empty) {
    await page.waitForTimeout(2_000);
    state = await outlookListSignature(page);
  }

  if (!state.rows && state.empty) {
    const emptyResult = {
      exportedAt: new Date().toISOString(),
      since: range.since,
      until: range.until,
      accountId: account.id,
      accountEmail: account.email,
      legacyAccountLabel: options.accountLabel || null,
      folder: folder.name,
      folderPath: folder.path,
      tab,
      emailCount: 0,
      failedBodies: 0,
      undatedCount: 0,
      pinnedCount: 0,
      pinnedOutsideRangeCount: 0,
      includePinnedOutsideRange: options.includePinnedOutsideRange,
      diagnostics: { stopReason: "empty-view", iterations: 0 },
      emails: []
    };
    await atomicJson(files.json, emptyResult);
    await writeFile(files.text, "", { mode: 0o600 });
    logEvent("outlook.view.empty", { account: account.id, folder: folder.path, tab });
    return { status: "empty", ...emptyResult };
  }

  await page.evaluate(() => {
    delete window.outlookBodiesExport;
    delete window.outlookBodiesCheckpoint;
    delete window.outlookBodiesExportRun;
  });
  await page.evaluate((settings) => {
    window.__dailyWorkContextSettings = { outlook: settings };
  }, {
    since: range.since,
    until: range.until,
    accountLabel: account.id,
    accountId: account.id,
    accountEmail: account.email,
    legacyAccountLabel: options.accountLabel || null,
    folderPath: folder.path,
    tab,
    includeHtml: options.includeHtml,
    includePinnedOutsideRange: options.includePinnedOutsideRange
  });
  const sourceCode = await readFile(definition.script, "utf8");
  await page.evaluate(`${sourceCode}\n;undefined;`);
  logEvent("outlook.extract.started", {
    account: account.id,
    folder: folder.path,
    tab,
    since: range.since,
    until: range.until
  });
  const result = await waitForExport(
    page,
    "outlook",
    options.timeoutMinutes * 60_000,
    files.checkpoint
  );
  const enriched = {
    ...result,
    accountId: account.id,
    accountEmail: account.email,
    legacyAccountLabel: options.accountLabel || null,
    folder: folder.name,
    folderPath: folder.path,
    tab,
    requestedRange: { since: range.since, until: range.until }
  };
  await atomicJson(files.json, enriched);
  await writeFile(files.text, outlookText(enriched), { mode: 0o600 });
  await rm(files.checkpoint, { force: true });
  logEvent("outlook.view.saved", {
    account: account.id,
    folder: folder.path,
    tab,
    emails: enriched.emailCount,
    pinned: enriched.pinnedCount,
    failedBodies: enriched.failedBodies,
    undated: enriched.undatedCount,
    stopReason: enriched.diagnostics?.stopReason,
    directory: path.relative(projectRoot, path.dirname(files.json)),
    json: path.basename(files.json),
    elapsedSeconds: elapsedSeconds(startedAt)
  });
  return { status: "completed", ...enriched };
}

async function runOutlookWorkflow(context, options, range, account) {
  const page = await context.newPage();
  page.on("crash", () => logEvent("outlook.page.crash", { unexpected: true, account: account.id }));
  logEvent("outlook.navigation.start", { account: account.id, destination: "https://outlook.office.com" });
  await page.goto(sources.outlook.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await verifyRequestedMicrosoftAccount(page, account, options, "outlook");
  await waitUntilReady(
    page,
    "outlook",
    `Cuenta solicitada: ${account.name}. Completa SSO/MFA y abre Mail si fuera necesario.`,
    true
  );

  const folderItems = await discoverOutlookFolders(page, account.email);
  const discovered = buildFolderPaths(folderItems);
  const uniqueFolders = [...new Map(discovered.map((folder) => [
    folder.stableId || folder.path.toLocaleLowerCase(),
    folder
  ])).values()];
  if (!uniqueFolders.length) {
    throw new Error("No se descubrieron carpetas del buzón solicitado; Microsoft puede haber cambiado el DOM.");
  }
  logEvent("outlook.folders.discovered", { account: account.id, count: uniqueFolders.length });

  if (options.discoverFolders) {
    console.log(`\nCarpetas disponibles para ${account.name}:`);
    uniqueFolders.forEach((folder) => console.log(`  - ${folder.path}`));
    logEvent("outlook.discovery.completed", { account: account.id, count: uniqueFolders.length });
    return { discovery: true, folders: uniqueFolders.map((folder) => folder.path), results: [] };
  }

  const selectedFolders = options.folders.length && !options.interactive
    ? resolveFolderRequests(uniqueFolders, options.folders)
    : await chooseMany(
        "Elige una o varias carpetas de Outlook:",
        uniqueFolders.map((folder) => ({ label: folder.path, value: folder }))
      );

  const tabsByFolder = new Map();
  const preflightFailures = [];
  for (const folder of selectedFolders) {
    try {
      await navigateOutlookFolder(page, folder);
      const tabs = await discoverOutlookTabs(page);
      tabsByFolder.set(folder.path, tabs);
      logEvent("outlook.tabs.discovered", {
        account: account.id,
        folder: folder.path,
        tabs: tabs.map((tab) => tab.id)
      });
    } catch (error) {
      tabsByFolder.set(folder.path, []);
      preflightFailures.push({
        view: { account: account.id, folder: folder.path, tab: "all" },
        status: "failed",
        error: safeErrorMessage(error)
      });
    }
  }
  const availableTabIds = [...new Set(
    [...tabsByFolder.values()].flat().map((tab) => tab.id)
  )];
  const selectedTabs = options.tabs.length && !options.interactive
    ? options.tabs
    : availableTabIds.length
      ? await chooseMany(
          "Elige las pestañas que se recorrerán cuando estén disponibles:",
          availableTabIds.map((tab) => ({
            label: tab === "focused" ? "Focused / Prioritarios" : "Other / Otros",
            value: tab
          }))
        )
      : ["all"];

  const views = [];
  const skipped = [];
  for (const folder of selectedFolders) {
    if (preflightFailures.some((failure) => failure.view.folder === folder.path)) continue;
    const available = tabsByFolder.get(folder.path) || [];
    if (!available.length) {
      if (selectedTabs.includes("all")) {
        views.push({ account, folder, tab: "all" });
      } else {
        for (const tab of selectedTabs) {
          skipped.push({
            view: { account: account.id, folder: folder.path, tab },
            status: "skipped",
            reason: "tab-not-present"
          });
        }
      }
      continue;
    }
    for (const tab of selectedTabs) {
      if (available.some((candidate) => candidate.id === tab)) {
        views.push({ account, folder, tab });
      } else {
        skipped.push({
          view: { account: account.id, folder: folder.path, tab },
          status: "skipped",
          reason: "tab-not-available"
        });
      }
    }
  }
  if (!views.length && !preflightFailures.length) {
    throw new Error("La selección no contiene ninguna combinación de carpeta y pestaña disponible.");
  }

  if (!await confirmExecution({
    account,
    folders: selectedFolders.map((folder) => folder.path),
    tabs: selectedTabs,
    range
  }, options.yes)) {
    const error = new Error("Extracción cancelada por el usuario.");
    error.code = "USER_CANCELLED";
    throw error;
  }

  const executed = await executeViewPlan(views, async (view) => {
    await navigateOutlookFolder(page, view.folder);
    const available = await discoverOutlookTabs(page);
    if (view.tab !== "all" && !available.some((tab) => tab.id === view.tab)) {
      return { status: "skipped", reason: "tab-not-available-after-navigation" };
    }
    await navigateOutlookTab(page, view.tab);
    return runOutlookView(page, options, range, account, view.folder, view.tab);
  });
  const results = [...preflightFailures, ...skipped, ...executed];
  const summary = {
    completed: results.filter((result) => result.status === "completed").length,
    empty: results.filter((result) => result.status === "empty").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length
  };
  logEvent("outlook.run.summary", { account: account.id, ...summary });
  console.log("\nResumen consolidado de Outlook:");
  console.log(`  Correctas: ${summary.completed}`);
  console.log(`  Vacías: ${summary.empty}`);
  console.log(`  Omitidas: ${summary.skipped}`);
  console.log(`  Fallidas: ${summary.failed}`);
  if (summary.failed) {
    const error = new Error(`${summary.failed} vista(s) de Outlook fallaron; las demás se conservaron.`);
    error.partialResults = results;
    throw error;
  }
  return { discovery: false, results, summary };
}

let activeContext = null;
let closingContext = null;
let expectedContextClose = false;
let interrupted = false;
let interruptCount = 0;

async function closeActiveContext(reason) {
  if (!activeContext) return;
  if (closingContext) return closingContext;
  const context = activeContext;
  expectedContextClose = true;
  logEvent("browser.close.requested", { reason, pages: context.pages().length });
  closingContext = context.close({ reason })
    .then(() => logEvent("browser.close.completed", { reason }))
    .catch((error) => logEvent("browser.close.failed", { reason, error: safeErrorMessage(error) }))
    .finally(() => {
      if (activeContext === context) activeContext = null;
      closingContext = null;
    });
  return closingContext;
}

async function withBrowserProfile(profile, options, label, worker) {
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(profile, 0o700);
  expectedContextClose = false;
  logEvent("browser.launch.start", { engine: "chromium", profileLabel: label });
  activeContext = await chromium.launchPersistentContext(profile, {
    headless: options.headless,
    acceptDownloads: false,
    args: ["--hide-crash-restore-bubble"]
  });
  const context = activeContext;
  context.on("close", () => {
    logEvent("browser.context.closed", { expected: expectedContextClose, profileLabel: label });
  });
  logEvent("browser.launch.completed", {
    engine: "chromium",
    version: context.browser()?.version(),
    pages: context.pages().length,
    profileLabel: label
  });
  try {
    return await worker(context);
  } finally {
    await closeActiveContext(interrupted ? "interrupted" : "completed");
  }
}

process.on("SIGINT", () => {
  interruptCount += 1;
  if (interruptCount > 1) process.exit(130);
  interrupted = true;
  logEvent("run.interrupt", { signal: "SIGINT", action: "graceful-browser-close" });
  void (async () => {
    await Promise.all((activeContext?.pages() || []).map((page) =>
      page.evaluate(() => { window.teamsExportAbort = true; }).catch(() => undefined)
    ));
    await closeActiveContext("SIGINT");
  })();
});

const runStartedAt = Date.now();
try {
  const options = parseArguments(process.argv.slice(2), { projectRoot });
  if (options.help) usage();
  // Sin config.local.json (o M365_WEB_EXPORT_CONFIG) no hay tenants que elegir: parar con instrucciones.
  if (!MICROSOFT_TENANTS.length) {
    throw new CliUsageError(
      `No hay tenants configurados (${CONFIG_PATH}). ` +
      "Copia config.example.json a config.local.json y rellena id, email y applications."
    );
  }
  const range = extractionRange(options);
  const selectedSources = options.target === "all" ? ["teams", "outlook"] : [options.target];
  const selectedTenants = await chooseTenants(options, selectedSources);
  const runnableCount = selectedTenants.reduce((total, tenant) =>
    total + selectedSources.filter((source) => tenantSupports(tenant, source)).length, 0);
  if (!runnableCount) {
    throw new CliUsageError("Ninguno de los tenants seleccionados tiene habilitado el origen solicitado.");
  }
  logEvent("run.start", {
    target: options.target,
    sources: selectedSources,
    tenants: selectedTenants.map((tenant) => tenant.id),
    since: range.since,
    until: range.until,
    headless: options.headless,
    profile: options.profile
  });

  const matrixResults = await executeTenantPlan(
    selectedTenants,
    selectedSources,
    async ({ tenant, source }) => {
      if (interrupted) {
        const error = new Error("Ejecución cancelada por el usuario.");
        error.code = "USER_CANCELLED";
        throw error;
      }
      const profile = tenantProfilePath(options.profile, source, tenant.id);
      if (source === "outlook" && options.accountLabel && options.accountLabel !== tenant.id) {
        logEvent("outlook.account-label.compatibility", {
          supplied: safeName(options.accountLabel),
          effective: tenant.id
        });
      }
      return withBrowserProfile(profile, options, `${source}:${tenant.id}`, (context) =>
        source === "teams"
          ? runSource(context, source, options, range, tenant)
          : runOutlookWorkflow(context, options, range, tenant)
      );
    },
    { abortOnError: (error) => interrupted || error?.code === "USER_CANCELLED" }
  );
  matrixResults.forEach((result) => {
    if (result.status === "skipped") {
      logEvent("tenant.source.skipped", {
        tenant: result.tenant,
        source: result.source,
        reason: result.reason
      });
    } else if (result.status === "failed") {
      logEvent("tenant.source.failed", {
        tenant: result.tenant,
        source: result.source,
        error: safeErrorMessage(result.error)
      });
    }
  });
  const matrixSummary = {
    completed: matrixResults.filter((result) => result.status === "completed").length,
    skipped: matrixResults.filter((result) => result.status === "skipped").length,
    failed: matrixResults.filter((result) => result.status === "failed").length
  };
  logEvent("run.tenant-summary", matrixSummary);
  console.log("\nResumen por tenant y aplicación:");
  matrixResults.forEach((result) => console.log(
    `  ${result.tenant}/${result.source}: ${result.status}` +
    `${result.reason ? ` (${result.reason})` : ""}`
  ));
  if (matrixSummary.failed) {
    throw new Error(`${matrixSummary.failed} ejecución(es) por tenant/aplicación fallaron; las demás se conservaron.`);
  }
} catch (error) {
  if (interrupted || error?.code === "USER_CANCELLED") {
    logEvent("run.cancelled", { elapsedSeconds: elapsedSeconds(runStartedAt) });
    process.exitCode = 130;
  } else if (error instanceof CliUsageError) {
    console.error(error.message);
    console.error(usageText());
    process.exitCode = 1;
  } else {
    logEvent("run.failed", {
      error: safeErrorMessage(error),
      elapsedSeconds: elapsedSeconds(runStartedAt)
    });
    process.exitCode = 1;
  }
} finally {
  logEvent("run.finished", {
    exitCode: process.exitCode || 0,
    elapsedSeconds: elapsedSeconds(runStartedAt)
  });
}
