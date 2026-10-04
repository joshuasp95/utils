// 04-export-all-chats-to-today.js — exporta todos los chats de Teams Web desde una fecha hasta hoy.
//
// Qué hace:     Expande las secciones Favorites y Chats, inventaría las conversaciones
//               (deduplicando las que aparecen en ambas), abre cada una y guarda los mensajes con
//               since <= fecha < until (until por defecto = mañana 00:00). Es el script que
//               inyecta run-playwright.js.
// Requisitos:   Teams Web en Chat con lista y una conversación visibles; DevTools (F12) → Consola,
//               o el lanzador Playwright.
// Uso:          Ajustar SETTINGS.since, pegar, ejecutar y confirmar; luego downloadTeamsBatchText(),
//               downloadTeamsChatTexts() o downloadTeamsBatchJson(). Cancelar: window.teamsExportAbort = true
// Variables:    SETTINGS (abajo); Playwright los sobrescribe con window.__dailyWorkContextSettings.teams.
// Efectos:      Abre cada chat: PUEDE MARCARLOS COMO LEÍDOS. No envía nada.
// Salida:       window.teamsBatchExport y teams-<tenant>-all-chats-<desde>-to-<hasta>.json|.txt
(async () => {
  // ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
  // En ejecución manual solo necesitas cambiar 'since'. Playwright puede
  // sobreescribir estos valores mediante window.__dailyWorkContextSettings.
  const SETTINGS = {
    since: "2026-07-01T00:00:00+02:00",  // ← CAMBIAR: fecha inicio (ISO 8601)
    until: null,                          // null = mañana 00:00 local (exclusivo)
    tenantId: "",                        // Playwright: identificador seguro del tenant
    tenantEmail: "",                     // Playwright: correo configurado, nunca credenciales
    skipConfirmation: false,
    waitMs: 700,
    openWaitMs: 2200,
    maxChatRetries: 3,
    retryBackoffMs: 1500,
    maxSidebarScrolls: 500,
    maxMessageScrolls: 500,
    stuckLimit: 10,
    ...(window.__dailyWorkContextSettings?.teams || {})
  };

  window.teamsBatchExportRun = { status: "running", startedAt: new Date().toISOString() };

  // Por defecto, 'until' es mañana a las 00:00 local y siempre es exclusivo.
  const now = new Date();
  const untilDate = SETTINGS.until
    ? new Date(SETTINGS.until)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const untilStr = untilDate.toISOString().slice(0, 10);

  const cutoff = new Date(SETTINGS.since);
  const upperBound = untilDate;
  if (Number.isNaN(cutoff.getTime()) || Number.isNaN(upperBound.getTime()) || cutoff >= upperBound) {
    throw new Error("Intervalo invalido: revisa SETTINGS.since y SETTINGS.until.");
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();

  function errorDetails(error) {
    if (error instanceof Error) {
      return {
        name: error.name || "Error",
        message: error.message || "Error sin mensaje",
        stack: error.stack || ""
      };
    }
    if (typeof error === "string") return { name: "Error", message: error, stack: "" };
    try {
      const ownProperties = error && typeof error === "object"
        ? Object.fromEntries(Object.getOwnPropertyNames(error).map((key) => [key, error[key]]))
        : error;
      const serialized = JSON.stringify(ownProperties);
      return {
        name: "Error de Teams",
        message: serialized && serialized !== "{}" ? serialized : "Teams lanzo un error interno sin detalles",
        stack: ""
      };
    } catch {
      return { name: "Error de Teams", message: String(error || "Error sin detalles"), stack: "" };
    }
  }

  const MESSAGE_SELECTOR = [
    '[data-tid="chat-pane-message"]',
    '[data-tid="message-wrapper"]',
    '[data-tid="message-item"]',
    '[id^="chat-message-"]'
  ].join(", ");

  window.teamsExportAbort = false;

  // ─── SIDEBAR / CHATS ─────────────────────────────────────────────────────────
  function chatTitle(item) {
    const title = item.querySelector(
      '[id^="title-chat-list-item"], [data-tid="chat-list-item-title"], span[role="text"][title]'
    );
    return clean(title?.getAttribute("title") || title?.textContent);
  }

  function rawChatKey(item, title) {
    return item.getAttribute("data-fui-tree-item-value")
      || item.getAttribute("data-conversation-id")
      || item.id
      || title;
  }

  function conversationIdentity(rawKey, title) {
    if (!rawKey) return title;
    const separator = rawKey.lastIndexOf("/");
    return separator >= 0 ? rawKey.slice(separator + 1) : rawKey;
  }

  function isFavoriteChat(item, title) {
    return /(?:^|[~\/])Favorites\//i.test(rawChatKey(item, title));
  }

  function visibleChats() {
    const titleNodes = [...document.querySelectorAll(
      '[id^="title-chat-list-item"], [data-tid="chat-list-item-title"]'
    )];
    const byTitleNode = titleNodes.map((titleNode) => {
      const item = titleNode.closest('[role="treeitem"]') || titleNode.parentElement;
      return { item, title: clean(titleNode.getAttribute("title") || titleNode.textContent) };
    });
    const fallback = titleNodes.length === 0
      ? [...document.querySelectorAll('[role="treeitem"]')].map((item) => ({ item, title: chatTitle(item) }))
      : [];
    return [...byTitleNode, ...fallback]
      .filter(({ item, title }) => item && title)
      .filter(({ item, title }) => /Conversation\|/.test(chatKey(item, title)))
      .filter(({ item }, index, all) => all.findIndex((candidate) => candidate.item === item) === index);
  }

  function chatKey(item, title) {
    return conversationIdentity(rawChatKey(item, title), title);
  }

  async function expandConversationSections() {
    let changed = false;
    const headers = [...document.querySelectorAll(
      '[data-testid="conversation-folder-header"], [data-id^="conversation-folder-header-"]'
    )];
    for (const header of headers) {
      const label = clean(
        header.getAttribute("aria-label")
        || header.getAttribute("data-id")
        || header.textContent
      );
      if (!/(Favorites|Chats)/i.test(label)) continue;
      const expandable = header.closest("[aria-expanded]") || header;
      if (expandable.getAttribute("aria-expanded") === "false") {
        expandable.click();
        changed = true;
      }
    }
    if (changed) await sleep(SETTINGS.waitMs);
  }

  function findScrollableAncestor(start, { narrow = false } = {}) {
    if (!start) return null;
    const elements = new Set();
    for (let element = start.parentElement; element && element !== document.body; element = element.parentElement) {
      elements.add(element);
    }
    if (narrow) {
      document.querySelectorAll(
        '[data-scrollable-element="true"], [data-is-scrollable="true"], [data-tid*="chat-list"], [role="tree"]'
      ).forEach((element) => elements.add(element));
    }
    const candidates = [...elements].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const itemCount = narrow ? element.querySelectorAll('[id^="title-chat-list-item"]').length : 1;
      const scrollRange = element.scrollHeight - element.clientHeight;
      const fitsWidth = !narrow || (rect.width > 120 && rect.width < Math.min(window.innerWidth * 0.65, 760));
      const visibleEnough = rect.height > 120 && (!narrow || rect.left < window.innerWidth * 0.5);
      const overflowBonus = ["auto", "scroll"].includes(style.overflowY) ? 5000 : 0;
      const score = itemCount * 10000 + Math.max(0, scrollRange) + overflowBonus + rect.height;
      return { element, itemCount, scrollRange, fitsWidth, visibleEnough, score };
    }).filter((c) => c.itemCount > 0 && c.fitsWidth && c.visibleEnough)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.element || null;
  }

  function currentSidebar() {
    return findScrollableAncestor(visibleChats()[0]?.item, { narrow: true });
  }

  function selectedChatMatches(target) {
    const selected = document.querySelector('[role="treeitem"][aria-selected="true"], [role="treeitem"][aria-current="true"]');
    if (!selected) return null;
    const title = chatTitle(selected);
    return chatKey(selected, title) === target.key || title === target.title;
  }

  async function inventoryChats() {
    await expandConversationSections();
    const sidebar = currentSidebar();
    if (!sidebar) throw new Error("No se encontro el scroll lateral de chats. Asegurate de tener la lista de chats visible.");

    const originalTop = sidebar.scrollTop;
    const records = new Map();
    sidebar.scrollTop = 0;
    sidebar.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(SETTINGS.waitMs);

    let stuck = 0;
    for (let i = 0; i < SETTINGS.maxSidebarScrolls; i++) {
      const sizeBefore = records.size;
      for (const { item, title } of visibleChats()) {
        const key = chatKey(item, title);
        const favorite = isFavoriteChat(item, title);
        const existing = records.get(key);
        if (!existing) {
          records.set(key, {
            position: records.size + 1,
            key,
            title,
            favorite,
            ariaLabel: item.getAttribute("aria-label") || ""
          });
        } else if (favorite) {
          existing.favorite = true;
        }
      }
      const before = sidebar.scrollTop;
      sidebar.scrollTop += Math.max(220, Math.floor(sidebar.clientHeight * 0.75));
      sidebar.dispatchEvent(new WheelEvent("wheel", { deltaY: 600, bubbles: true }));
      await sleep(SETTINGS.waitMs);
      stuck = sidebar.scrollTop === before && records.size === sizeBefore ? stuck + 1 : 0;
      if (stuck >= 5) break;
    }

    sidebar.scrollTop = originalTop;
    return { chats: [...records.values()] };
  }

  async function findAndOpenChat(target) {
    await expandConversationSections();
    // Teams reemplaza nodos del DOM al virtualizar la lista. No reutilizar el
    // sidebar de la fase de inventario porque puede haber quedado desconectado.
    const sidebar = currentSidebar();
    if (!sidebar || !sidebar.isConnected) {
      throw new Error("Teams reemplazo el panel lateral; no se pudo volver a localizar.");
    }
    sidebar.scrollTop = 0;
    sidebar.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(SETTINGS.waitMs);

    let stuck = 0;
    for (let i = 0; i < SETTINGS.maxSidebarScrolls; i++) {
      const match = visibleChats().find(({ item, title }) => chatKey(item, title) === target.key || title === target.title);
      if (match) {
        if (!match.item.isConnected) continue;
        match.item.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(100);
        match.item.click();
        await sleep(SETTINGS.openWaitMs);
        const selectedMatches = selectedChatMatches(target);
        if (selectedMatches === false) throw new Error(`Teams no activo el chat solicitado: ${target.title}`);
        return;
      }
      const before = sidebar.scrollTop;
      sidebar.scrollTop += Math.max(220, Math.floor(sidebar.clientHeight * 0.75));
      sidebar.dispatchEvent(new WheelEvent("wheel", { deltaY: 600, bubbles: true }));
      await sleep(SETTINGS.waitMs);
      stuck = sidebar.scrollTop === before ? stuck + 1 : 0;
      if (stuck >= 5) break;
    }
    throw new Error(`No se pudo volver a localizar el chat: ${target.title}`);
  }

  // ─── MENSAJES ─────────────────────────────────────────────────────────────────
  function messageRoots() {
    const nodes = [...document.querySelectorAll(MESSAGE_SELECTOR)];
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  }

  function datesInText(raw) {
    if (!raw) return [];
    const fragments = [
      ...(raw.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/gi) || []),
      ...(raw.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+(?:at\s+)?\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?/gi) || []),
      ...(raw.match(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:,?\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?/gi) || []),
      ...(raw.match(/\b1\d{9}(?:\d{3})?\b/g) || [])
    ];
    if (/^\d{10,13}$/.test(raw)) fragments.push(raw);
    return fragments.map((fragment) => {
      let normalized = fragment.replace(/\sat\s/i, " ");
      if (/^[A-Za-z]+\s+\d{1,2}(?:\s|$)/.test(normalized) && !/\b\d{4}\b/.test(normalized)) {
        normalized = normalized.replace(/^(\w+\s+\d{1,2})/, `$1, ${cutoff.getFullYear()}`);
      }
      const numeric = /^\d{10,13}$/.test(normalized)
        ? Number(normalized) * (normalized.length === 10 ? 1000 : 1)
        : NaN;
      const date = Number.isNaN(numeric) ? new Date(normalized) : new Date(numeric);
      return Number.isNaN(date.getTime()) ? null : date;
    }).filter(Boolean);
  }

  function parseTimestamp(root) {
    const candidates = [
      root.querySelector("time[datetime]")?.getAttribute("datetime"),
      root.querySelector("[data-timestamp]")?.getAttribute("data-timestamp"),
      root.getAttribute("data-timestamp"),
      root.querySelector('[data-tid="message-timestamp"]')?.getAttribute("title"),
      root.querySelector('[data-tid="message-timestamp"]')?.textContent,
      root.getAttribute("data-message-id"),
      root.getAttribute("data-client-message-id"),
      root.id,
      root.querySelector('[id^="content-"]')?.id,
      root.getAttribute("aria-label"),
      root.querySelector("[aria-label]")?.getAttribute("aria-label")
    ].filter(Boolean);

    for (const raw of candidates) {
      const date = datesInText(raw)[0];
      if (date) return { iso: date.toISOString(), raw };
    }
    return { iso: null, raw: candidates[0] || "" };
  }

  function oldestVisibleTimestamp(pane) {
    const dates = messageRoots()
      .map((root) => parseTimestamp(root).iso)
      .filter(Boolean)
      .map((iso) => new Date(iso));
    pane.querySelectorAll('time, [data-tid*="timestamp"], [data-tid*="date"], [class*="timestamp"], [class*="dateDivider"]')
      .forEach((element) => {
        const raw = [
          element.getAttribute("datetime"),
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
          element.textContent
        ].filter(Boolean).join(" ");
        dates.push(...datesInText(raw));
      });
    return dates.length ? Math.min(...dates.map((d) => d.getTime())) : null;
  }

  function extractMessage(root) {
    const aria = root.getAttribute("aria-label") || "";
    const author = clean(
      root.querySelector('[data-tid="message-author-name"], [data-tid="message-author"]')?.textContent ||
      aria.split(/ sent | enviado | ha enviado /i)[0]
    );
    const contentNodes = [...root.querySelectorAll(
      '[id^="content-"], [data-tid="messageBodyContent"], [data-tid="message-body"], [data-tid="message-content"]'
    )];
    const body = clean(contentNodes.map((node) => node.innerText || node.textContent).join("\n")) || clean(root.innerText);
    if (!body || body === "Type a message") return null;

    const timestamp = parseTimestamp(root);
    const key = root.getAttribute("data-message-id")
      || root.getAttribute("data-client-message-id")
      || root.id
      || [author, timestamp.iso || timestamp.raw, body].join("|");
    return { key, timestamp: timestamp.iso, timestampRaw: timestamp.raw, author, body, ariaLabel: aria };
  }

  function messagePane() {
    const first = messageRoots()[0];
    if (!first) return null;
    const candidates = [];
    for (let element = first.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.scrollHeight > element.clientHeight + 100 && ["auto", "scroll"].includes(style.overflowY)) {
        candidates.push({ element, score: element.querySelectorAll(MESSAGE_SELECTOR).length * 10000 + element.clientHeight });
      }
    }
    return candidates.sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  async function exportOpenChat(target) {
    let roots = messageRoots();
    for (let retries = 0; retries < 8 && roots.length === 0; retries++) {
      await sleep(SETTINGS.waitMs);
      roots = messageRoots();
    }
    const pane = messagePane();
    if (!pane) throw new Error("No se encontro el panel de mensajes tras abrir el chat.");

    const messages = new Map();
    let stuck = 0;

    for (let attempt = 0; attempt < 3; attempt++) {
      pane.scrollTop = pane.scrollHeight;
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(SETTINGS.waitMs);
    }

    for (let i = 0; i < SETTINGS.maxMessageScrolls && !window.teamsExportAbort; i++) {
      const beforeSize = messages.size;
      for (const root of messageRoots()) {
        const message = extractMessage(root);
        if (message) messages.set(message.key, message);
      }

      const earliestMs = oldestVisibleTimestamp(pane);
      if (earliestMs !== null && earliestMs < cutoff.getTime()) break;

      const beforeTop = pane.scrollTop;
      pane.scrollTop = Math.max(0, pane.scrollTop - Math.max(500, Math.floor(pane.clientHeight * 0.85)));
      pane.dispatchEvent(new WheelEvent("wheel", { deltaY: -700, bubbles: true }));
      await sleep(SETTINGS.waitMs);

      stuck = messages.size === beforeSize && pane.scrollTop === beforeTop ? stuck + 1 : 0;
      if (stuck >= SETTINGS.stuckLimit) break;
    }

    for (const root of messageRoots()) {
      const message = extractMessage(root);
      if (message) messages.set(message.key, message);
    }

    const all = [...messages.values()];
    const selected = all
      .filter((message) => {
        if (!message.timestamp) return false;
        const ts = new Date(message.timestamp);
        return ts >= cutoff && ts < upperBound;
      })
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));

    return {
      ...target,
      messageCount: selected.length,
      undatedCount: all.filter((m) => !m.timestamp).length,
      undatedSamples: all.filter((m) => !m.timestamp).slice(0, 5).map((m) => ({
        key: m.key, timestampRaw: m.timestampRaw, ariaLabel: m.ariaLabel
      })),
      messages: selected
    };
  }

  async function exportChatWithRetry(target) {
    const failures = [];
    for (let attempt = 1; attempt <= SETTINGS.maxChatRetries; attempt++) {
      try {
        await findAndOpenChat(target);
        return { exported: await exportOpenChat(target), attempts: attempt, failures };
      } catch (error) {
        const details = errorDetails(error);
        failures.push({ attempt, ...details });
        console.warn(
          `[${target.position}] Intento ${attempt}/${SETTINGS.maxChatRetries} fallido para ${target.title}: ${details.message}`
        );
        if (attempt < SETTINGS.maxChatRetries) {
          await sleep(SETTINGS.retryBackoffMs * attempt);
        }
      }
    }
    const last = failures[failures.length - 1];
    const finalError = new Error(last?.message || "No se pudo exportar el chat");
    finalError.failures = failures;
    throw finalError;
  }

  // ─── FORMATO TEXTO ────────────────────────────────────────────────────────────
  function toText(batch) {
    return batch.chats.map((chat) => {
      const msgs = chat.messages.map((m) =>
        `[${m.timestamp || m.timestampRaw || "fecha desconocida"}] ${m.author}\n${m.body}`
      ).join("\n\n---\n\n");
      return `# ${chat.position}. ${chat.title}${chat.favorite ? " [FAVORITE]" : ""}\nMensajes: ${chat.messageCount}; sin fecha: ${chat.undatedCount}\n\n${msgs}`;
    }).join("\n\n============================================================\n\n");
  }

  function chatToText(chat) {
    return chat.messages.map((m) => `[${m.timestamp}] ${m.author}\n${m.body}`).join("\n\n---\n\n");
  }

  function safeFilename(value) {
    return value.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 90) || "teams-chat";
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ─── MAIN ─────────────────────────────────────────────────────────────────────
  const { chats } = await inventoryChats();
  const sinceStr = SETTINGS.since.slice(0, 10);

  if (!SETTINGS.skipConfirmation && !confirm(
    `Se han descubierto ${chats.length} conversaciones.\n` +
    `Se abriran todas y pueden quedar marcadas como leidas.\n\n` +
    `Periodo: desde ${sinceStr} hasta ${untilStr} (exclusivo)\n\n` +
    `Continuar?`
  )) {
    window.teamsBatchExportRun = {
      ...window.teamsBatchExportRun,
      status: "cancelled",
      finishedAt: new Date().toISOString()
    };
    return;
  }

  const batch = {
    exportedAt: new Date().toISOString(),
    tenantId: SETTINGS.tenantId || null,
    tenantEmail: SETTINGS.tenantEmail || null,
    settings: { since: SETTINGS.since, until: untilDate.toISOString() },
    discoveredChats: chats.length,
    attemptedChats: 0,
    scannedChats: 0,
    chats: [],
    chatsWithoutMessagesInRange: [],
    errors: []
  };
  window.teamsBatchExport = batch;

  for (const target of chats) {
    if (window.teamsExportAbort) break;
    console.log(`[${target.position}/${chats.length}] ${target.title}`);
    batch.attemptedChats += 1;
    try {
      const result = await exportChatWithRetry(target);
      const exported = result.exported;
      batch.scannedChats += 1;
      if (exported.messageCount > 0) batch.chats.push(exported);
      else batch.chatsWithoutMessagesInRange.push({
        position: exported.position, title: exported.title,
        undatedCount: exported.undatedCount, undatedSamples: exported.undatedSamples
      });
    } catch (error) {
      const details = errorDetails(error);
      batch.errors.push({
        position: target.position,
        title: target.title,
        error: details.message,
        stack: details.stack,
        attempts: error?.failures || []
      });
      console.error(`[${target.position}] No se pudo exportar ${target.title}: ${details.message}`);
    }
    window.teamsBatchExport = batch;
    await sleep(SETTINGS.waitMs);
  }

  const tenantTag = SETTINGS.tenantId ? `${safeFilename(SETTINGS.tenantId)}-` : "";
  const base = `teams-${tenantTag}all-chats-${sinceStr}-to-${untilStr}`;
  window.downloadTeamsBatchJson = () =>
    download(JSON.stringify(batch, null, 2), `${base}.json`, "application/json");
  window.downloadTeamsBatchText = () =>
    download(toText(batch), `${base}.txt`, "text/plain");
  window.downloadTeamsChatTexts = async () => {
    for (const chat of batch.chats) {
      const name = `${String(chat.position).padStart(3, "0")}-${safeFilename(chat.title)}-${sinceStr}-to-${untilStr}.txt`;
      download(chatToText(chat), name, "text/plain");
      await sleep(250);
    }
  };

  console.log(
    `Finalizado: ${batch.scannedChats}/${batch.attemptedChats} exportados; ` +
    `${batch.chats.length} con mensajes desde ${sinceStr}; ` +
    `${batch.errors.length} errores.`
  );
  console.log("downloadTeamsBatchText()      → un TXT con todos los chats");
  console.log("downloadTeamsChatTexts()      → un TXT por chat");
  console.log("downloadTeamsBatchJson()      → JSON completo");
  console.log("window.teamsExportAbort=true  → cancelar si sigue corriendo");
  window.teamsBatchExportRun = {
    ...window.teamsBatchExportRun,
    status: window.teamsExportAbort ? "cancelled" : "completed",
    finishedAt: new Date().toISOString()
  };
})().catch((error) => {
  const message = error?.message || (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
  window.teamsBatchExportFatalError = { at: new Date().toISOString(), message: message || "Error interno de Teams sin detalles" };
  window.teamsBatchExportRun = {
    ...(window.teamsBatchExportRun || {}),
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: window.teamsBatchExportFatalError.message
  };
  console.error(`[Teams batch export] ${window.teamsBatchExportFatalError.message}`);
});
