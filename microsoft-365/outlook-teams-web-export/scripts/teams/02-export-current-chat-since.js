// 02-export-current-chat-since.js — exporta el chat de Teams Web ABIERTO dentro de un intervalo fijo.
//
// Qué hace:     Hace scroll hacia arriba en el panel de mensajes hasta pasar 'since' y guarda
//               autor, fecha y texto de los mensajes con since <= fecha < until.
// Requisitos:   Teams Web con la conversación abierta; DevTools (F12) → Consola.
// Uso:          Ajustar SETTINGS.since y SETTINGS.until, pegar y ejecutar; luego
//               downloadTeamsCurrentChatJson() o downloadTeamsCurrentChatText().
// Variables:    SETTINGS.since (inclusivo), SETTINGS.until (exclusivo), ambos ISO 8601 con zona.
// Efectos:      SOLO LECTURA (el chat ya está abierto).
// Salida:       window.teamsCurrentChatExport y <chat>-since-<desde>.json|.txt
(async () => {
  const SETTINGS = {
    since: "2026-06-01T00:00:00+02:00",
    until: "2026-07-01T00:00:00+02:00",
    waitMs: 700,
    maxScrolls: 500,
    stuckLimit: 10
  };
  const cutoff = new Date(SETTINGS.since);
  const upperBound = new Date(SETTINGS.until);
  if (Number.isNaN(cutoff.getTime()) || Number.isNaN(upperBound.getTime()) || cutoff >= upperBound) {
    throw new Error("Intervalo invalido: revisa SETTINGS.since y SETTINGS.until.");
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const MESSAGE_SELECTOR = [
    '[data-tid="chat-pane-message"]',
    '[data-tid="message-wrapper"]',
    '[data-tid="message-item"]',
    '[id^="chat-message-"]'
  ].join(", ");

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
      const numeric = /^\d{10,13}$/.test(normalized) ? Number(normalized) * (normalized.length === 10 ? 1000 : 1) : NaN;
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
        const raw = [element.getAttribute("datetime"), element.getAttribute("title"), element.getAttribute("aria-label"), element.textContent]
          .filter(Boolean).join(" ");
        dates.push(...datesInText(raw));
      });
    return dates.length ? Math.min(...dates.map((date) => date.getTime())) : null;
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
    const key =
      root.getAttribute("data-message-id") ||
      root.getAttribute("data-client-message-id") ||
      root.id ||
      [author, timestamp.iso || timestamp.raw, body].join("|");
    return { key, timestamp: timestamp.iso, timestampRaw: timestamp.raw, author, body, ariaLabel: aria };
  }

  function findMessagePane() {
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

  function currentChatTitle() {
    const selected = document.querySelector('[role="treeitem"][aria-selected="true"]');
    const selectedTitle = clean(selected?.querySelector('[id^="title-chat-list-item"]')?.textContent);
    if (selectedTitle) return selectedTitle;
    const selectors = [
      '[data-tid="chat-header-title"]',
      '[data-tid="conversation-header-title"]',
      'header h1',
      'header h2'
    ];
    for (const selector of selectors) {
      const value = clean(document.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return clean(document.title.replace(/\| Microsoft Teams.*/i, "")) || "teams-chat";
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  let pane = findMessagePane();
  if (!pane) {
    console.error("No se encontro el panel de mensajes. Abre una conversacion con mensajes visibles.");
    return;
  }

  const messages = new Map();
  let stuck = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!pane.isConnected) pane = findMessagePane();
    if (!pane) throw new Error("Teams reemplazo el panel de mensajes durante la carga.");
    pane.scrollTop = pane.scrollHeight;
    pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(SETTINGS.waitMs);
  }

  for (let iteration = 0; iteration < SETTINGS.maxScrolls; iteration++) {
    if (!pane.isConnected) pane = findMessagePane();
    if (!pane) throw new Error("Teams reemplazo el panel de mensajes durante la exportacion.");
    const sizeBefore = messages.size;
    for (const root of messageRoots()) {
      const message = extractMessage(root);
      if (message) messages.set(message.key, message);
    }

    const earliestMs = oldestVisibleTimestamp(pane);
    const earliest = earliestMs === null ? null : new Date(earliestMs);
    if (earliestMs !== null && earliestMs < cutoff.getTime()) break;

    const beforeTop = pane.scrollTop;
    pane.scrollTop = Math.max(0, pane.scrollTop - Math.max(500, Math.floor(pane.clientHeight * 0.85)));
    pane.dispatchEvent(new WheelEvent("wheel", { deltaY: -700, bubbles: true }));
    await sleep(SETTINGS.waitMs);

    const noNew = messages.size === sizeBefore;
    const noMovement = pane.scrollTop === beforeTop;
    stuck = noNew && noMovement ? stuck + 1 : 0;
    if (stuck >= SETTINGS.stuckLimit) break;
    if (iteration % 10 === 0) console.log(`Iteracion ${iteration}: ${messages.size} mensajes; fecha mas antigua: ${earliest?.toISOString() || "desconocida"}`);
  }

  for (const root of messageRoots()) {
    const message = extractMessage(root);
    if (message) messages.set(message.key, message);
  }

  const all = [...messages.values()];
  const selected = all
    .filter((message) => {
      if (!message.timestamp) return false;
      const timestamp = new Date(message.timestamp);
      return timestamp >= cutoff && timestamp < upperBound;
    })
    .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  const undatedCount = all.filter((message) => !message.timestamp).length;
  const chat = currentChatTitle();

  window.teamsCurrentChatExport = {
    exportedAt: new Date().toISOString(),
    since: SETTINGS.since,
    untilExclusive: SETTINGS.until,
    chat,
    messageCount: selected.length,
    undatedCount,
    undatedSamples: all.filter((message) => !message.timestamp).slice(0, 5).map((message) => ({
      key: message.key,
      timestampRaw: message.timestampRaw,
      ariaLabel: message.ariaLabel
    })),
    messages: selected
  };

  const safeName = chat.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "teams-chat";
  const base = `${safeName}-since-${SETTINGS.since.slice(0, 10)}`;
  window.downloadTeamsCurrentChatJson = () => download(
    JSON.stringify(window.teamsCurrentChatExport, null, 2), `${base}.json`, "application/json"
  );
  window.downloadTeamsCurrentChatText = () => download(
    selected.map((message) => `[${message.timestamp || message.timestampRaw || "fecha desconocida"}] ${message.author}\n${message.body}`).join("\n\n---\n\n"),
    `${base}.txt`, "text/plain"
  );

  console.log(`Exportados ${selected.length} mensajes de ${chat}; descartados sin fecha fiable: ${undatedCount}.`);
  console.log("Descarga: downloadTeamsCurrentChatJson() o downloadTeamsCurrentChatText()");
})().catch((error) => {
  const message = error?.message || (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
  window.teamsCurrentChatExportError = { at: new Date().toISOString(), message: message || "Error interno de Teams sin detalles" };
  console.error(`[Teams current chat export] ${window.teamsCurrentChatExportError.message}`);
});
