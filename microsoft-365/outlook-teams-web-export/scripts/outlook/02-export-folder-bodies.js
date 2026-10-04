// 02-export-folder-bodies.js — exporta la carpeta abierta de Outlook Web CON el cuerpo de cada correo.
//
// Qué hace:     Como 01, pero hace clic en cada correo del intervalo y lee el panel de lectura.
//               Incluye los correos "Pinned" aunque sean anteriores a 'since' (salvo
//               includePinnedOutsideRange=false). Es el script que inyecta run-playwright.js.
// Requisitos:   Outlook Web con panel de lectura visible y la carpeta/pestaña abierta;
//               DevTools (F12) → Consola, o el lanzador Playwright.
// Uso:          Ajustar SETTINGS.since/until, pegar y ejecutar; luego downloadOutlookBodiesJson()
//               o downloadOutlookBodiesText(). Con Playwright: npm run extract:outlook -- ...
// Variables:    SETTINGS (abajo); Playwright los sobrescribe con window.__dailyWorkContextSettings.outlook.
// Efectos:      Abrir correos PUEDE MARCARLOS COMO LEÍDOS. No mueve, borra ni responde nada.
// Salida:       window.outlookBodiesExport (+ checkpoint en window.outlookBodiesCheckpoint) y
//               <cuenta>-<carpeta>-bodies-since-<desde>-to-<hasta>.json|.txt
(async () => {
  // ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
  // Igual que 01, pero ABRE cada correo para capturar el cuerpo completo.
  // Más lento y frágil (depende del panel de lectura de OWA). Fechas en inglés y español.
  const SETTINGS = {
    since: "2026-06-01T00:00:00+02:00",  // ← CAMBIAR: fecha inicio (ISO 8601)
    until: null,                          // null = hasta hoy fin del día; o ISO 8601 exclusivo
    accountLabel: "",                     // opcional: etiqueta para el fichero (p.ej. "cliente")
    accountId: "",                        // Playwright: identificador seguro de cuenta
    accountEmail: "",                     // Playwright: correo configurado, nunca credenciales
    folderPath: "",                       // Playwright: ruta completa de carpeta
    tab: "all",                           // focused, other o all
    waitMs: 1200,                         // pausa tras cada scroll
    clickWaitMs: 400,                     // sondeo tras clic
    clickTimeoutMs: 9000,                 // espera máx. a que cargue un cuerpo
    includeHtml: false,                   // true = guarda también el HTML del cuerpo
    includePinnedOutsideRange: true,      // incluye Pinned aunque sea anterior a 'since'
    dateOrder: null,                      // null = idioma del documento; "mdy" o "dmy"
    maxScrolls: 800,
    maxEmails: 2000,
    stuckLimit: 12,
    ...(window.__dailyWorkContextSettings?.outlook || {})
  };

  window.outlookBodiesExportRun = { status: "running", startedAt: new Date().toISOString() };

  const now = new Date();
  const documentLanguage = document.documentElement.lang || navigator.language || "en";
  const dayFirst = SETTINGS.dateOrder
    ? SETTINGS.dateOrder === "dmy"
    : /^(es|ca|de|fr|it|pt)\b/i.test(documentLanguage);
  const cutoff = new Date(SETTINGS.since);
  const upperBound = SETTINGS.until
    ? new Date(SETTINGS.until)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (Number.isNaN(cutoff.getTime()) || Number.isNaN(upperBound.getTime()) || cutoff >= upperBound) {
    throw new Error("Intervalo invalido: revisa SETTINGS.since y SETTINGS.until.");
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const sig = (text) => clean(text).slice(0, 120);
  const paneSig = (subject, body) => `${sig(subject)}|${sig(body)}`;

  const ROW_SELECTOR = [
    '[data-testid="message-list-item"]',
    'div[role="option"][data-convid]',
    'div[data-convid]',
    'div[role="option"][aria-label]'
  ].join(", ");
  const SUBJECT_SELECTOR = 'span[id$="_SUBJECT"][role="heading"], [id$="_SUBJECT"], [aria-labelledby$="_SUBJECT"]';
  const BODY_SELECTOR = [
    '[data-test-id="mailMessageBodyContainer"]',
    '[aria-label="Message body"]',
    '[id^="UniqueMessageBody"]',
    '[role="document"]'
  ].join(", ");
  const READING_PANE_SELECTOR = [
    '.ConversationReadingPaneContainer',
    '[data-app-section="ConversationContainer"]',
    '[aria-label="Reading Pane"]'
  ].join(", ");

  function rowRoots() {
    const nodes = [...document.querySelectorAll(ROW_SELECTOR)];
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  }

  async function ensurePinnedExpanded() {
    const headers = [...document.querySelectorAll(
      '#groupHeaderPinned, [aria-label="Pinned"][aria-expanded], ' +
      '[aria-label="Anclados"][aria-expanded], [aria-label="Fijados"][aria-expanded], ' +
      '[data-testid*="pinned" i][aria-expanded]'
    )];
    const header = headers.find((element) => {
      const label = clean(element.getAttribute("aria-label") || element.textContent);
      return /^(pinned|anclados?|fijados?)$/i.test(label) || element.id === "groupHeaderPinned";
    });
    const expandable = header?.closest("[aria-expanded]") || header;
    if (expandable?.getAttribute("aria-expanded") === "false") {
      expandable.click();
      await sleep(SETTINGS.waitMs);
    }
  }

  function dateTitleEl(root) {
    return [...root.querySelectorAll("[title]")].find((el) => {
      const t = el.getAttribute("title") || "";
      return /\d{1,2}\/\d{1,2}/.test(t) || /\b(19|20)\d{2}\b/.test(t);
    });
  }

  // Parser manual determinista. Outlook alterna entre ISO, M/D/YYYY, "Wed 7/22",
  // Today/Yesterday y una hora aislada según la antigüedad y el ancho de la vista.
  function toDate(str) {
    if (!str) return null;
    const iso = str.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})\b/i);
    if (iso) {
      const parsed = new Date(iso[0]);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const clock = (hour, minute, second, meridiem) => {
      let normalizedHour = Number(hour || 0);
      if (meridiem) {
        normalizedHour %= 12;
        if (/pm/i.test(meridiem)) normalizedHour += 12;
      }
      return { hour: normalizedHour, minute: Number(minute || 0), second: Number(second || 0) };
    };

    const calendar = (first, second) => {
      const a = Number(first);
      const b = Number(second);
      const useDayFirst = a > 12 || (b <= 12 && dayFirst);
      return { month: useDayFirst ? b : a, day: useDayFirst ? a : b };
    };

    const full = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (full) {
      let year = Number(full[3]); if (year < 100) year += 2000;
      const time = clock(full[4], full[5], full[6], full[7]);
      const date = calendar(full[1], full[2]);
      return new Date(year, date.month - 1, date.day, time.hour, time.minute, time.second);
    }

    const relative = str.match(/\b(today|yesterday|hoy|ayer)\b(?:[,\s]+(?:at|a\s+las?))?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (relative) {
      const time = clock(relative[2], relative[3], relative[4], relative[5]);
      const dayOffset = /yesterday|ayer/i.test(relative[1]) ? -1 : 0;
      return new Date(
        now.getFullYear(), now.getMonth(), now.getDate() + dayOffset,
        time.hour, time.minute, time.second
      );
    }

    const abbreviated = str.match(/\b(\d{1,2})\/(\d{1,2})(?!\/\d)(?:[,\s]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (abbreviated) {
      const time = clock(abbreviated[3], abbreviated[4], abbreviated[5], abbreviated[6]);
      const date = calendar(abbreviated[1], abbreviated[2]);
      let parsed = new Date(
        now.getFullYear(), date.month - 1, date.day,
        time.hour, time.minute, time.second
      );
      // En enero, "12/31" corresponde normalmente al año anterior.
      if (parsed.getTime() > now.getTime() + 36 * 60 * 60 * 1000) {
        parsed = new Date(
          now.getFullYear() - 1, date.month - 1, date.day,
          time.hour, time.minute, time.second
        );
      }
      return parsed;
    }

    const t = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (t) {
      const time = clock(t[1], t[2], 0, t[3]);
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute);
    }
    return null;
  }

  function timestampFragment(str) {
    if (!str) return "";
    return str.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})\b/i)?.[0]
      || str.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:[,\s]+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i)?.[0]
      || str.match(/\b(?:today|yesterday|hoy|ayer)\b(?:[,\s]+(?:at|a\s+las?))?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/i)?.[0]
      || str.match(/\b\d{1,2}\/\d{1,2}(?!\/\d)(?:[,\s]+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i)?.[0]
      || str.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/i)?.[0]
      || "";
  }

  function parseTimestamp(root, aria) {
    const candidates = [
      root.querySelector("time[datetime]")?.getAttribute("datetime"),
      dateTitleEl(root)?.getAttribute("title"),
      aria
    ].filter(Boolean);
    for (const raw of candidates) {
      const d = toDate(raw);
      if (d && !Number.isNaN(d.getTime())) return { iso: d.toISOString(), raw: timestampFragment(raw) };
    }
    return { iso: null, raw: candidates.map(timestampFragment).find(Boolean) || "" };
  }

  function rowFlags(aria) {
    const prefix = aria.match(
      /^(?:(?:collapsed|expanded|pinned|anclad[oa]s?|fijad[oa]s?|unread|no le[ií]do|flagged|marcado|draft|borrador|has attachments?|tiene archivos adjuntos)\s+)+/i
    )?.[0] || "";
    return {
      pinned: /\b(pinned|anclad[oa]s?|fijad[oa]s?)\b/i.test(prefix),
      content: clean(aria.slice(prefix.length))
    };
  }

  function extractRow(root) {
    const aria = clean(root.getAttribute("aria-label"));
    const flags = rowFlags(aria);
    const pinned = flags.pinned;
    const timestamp = parseTimestamp(root, aria);
    const senderEmail = clean([...root.querySelectorAll("[title]")]
      .find((el) => /@/.test(el.getAttribute("title") || ""))?.getAttribute("title"));
    const rest = flags.content;
    const dv = clean(dateTitleEl(root)?.textContent);
    let headline = rest, preview = "";
    if (dv) {
      const p = rest.indexOf(dv);
      if (p >= 0) { headline = clean(rest.slice(0, p)); preview = clean(rest.slice(p + dv.length)); }
    }
    preview = preview.replace(/\bNo conversations? selected\b/i, "").trim();
    const stableId = root.getAttribute("data-convid")
      || root.getAttribute("data-conversation-id")
      || root.getAttribute("data-item-id")
      || root.getAttribute("id")
      || "";
    const key = stableId
      ? `id:${stableId}`
      : `fallback:${timestamp.iso || timestamp.raw}|${senderEmail}|${headline.slice(0, 80)}`;
    if (!headline && !aria) return null;
    return { key, pinned, timestamp: timestamp.iso, timestampRaw: timestamp.raw, senderEmail, headline, preview, ariaLabel: aria, root };
  }

  function oldestNonPinnedMs() {
    const ms = rowRoots()
      .map((root) => extractRow(root))
      .filter((email) => email && !email.pinned && email.timestamp)
      .map((email) => new Date(email.timestamp).getTime());
    return ms.length ? Math.min(...ms) : null;
  }

  function isEmailInScope(email) {
    if (email.pinned && SETTINGS.includePinnedOutsideRange) return true;
    if (!email.timestamp) return false;
    const ts = new Date(email.timestamp);
    return ts >= cutoff && ts < upperBound;
  }

  function scrollableAncestor(node) {
    for (let el = node?.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 40 && ["auto", "scroll"].includes(style.overflowY)) return el;
    }
    return null;
  }

  function findListScroller() {
    const list = document.querySelector('[data-testid="virtuoso-item-list"]');
    let scroller = scrollableAncestor(list);
    if (scroller) return scroller;
    scroller = scrollableAncestor(rowRoots()[0]);
    if (scroller) return scroller;
    const first = rowRoots()[0];
    if (!first) return null;
    const candidates = [];
    for (let element = first.parentElement; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.scrollHeight > element.clientHeight + 40 && ["auto", "scroll"].includes(style.overflowY)) {
        candidates.push({ element, score: element.querySelectorAll(ROW_SELECTOR).length * 10000 + element.clientHeight });
      }
    }
    return candidates.sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  // ─── PANEL DE LECTURA ──────────────────────────────────────────────────────
  function readingSubject() {
    return clean(document.querySelector(SUBJECT_SELECTOR)?.textContent);
  }
  function readingBodyNode() {
    const pane = document.querySelector(READING_PANE_SELECTOR) || document;
    return pane.querySelector(BODY_SELECTOR) || document.querySelector(BODY_SELECTOR);
  }
  function clickRow(root) {
    const target = root.querySelector('[role="button"], [tabindex]') || root;
    target.scrollIntoView({ block: "center" });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }
  async function waitForBody(previousPaneSig) {
    const deadline = Date.now() + SETTINGS.clickTimeoutMs;
    while (Date.now() < deadline) {
      const node = readingBodyNode();
      const text = clean(node?.innerText);
      const subj = readingSubject();
      if (text && paneSig(subj, text) !== previousPaneSig) return { node, text, subject: subj };
      await sleep(SETTINGS.clickWaitMs);
    }
    return { node: null, text: null, subject: null, timedOut: true };
  }

  function folderLabel() {
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"], [role="tree"] [aria-selected="true"]');
    let name = clean(sel?.getAttribute("aria-label")) || clean(sel?.textContent);
    name = clean(name.replace(/selected/gi, "").replace(/\s*\d+\s*(unread|no le[ií]dos)?\s*$/i, ""));
    name = clean(name.replace(/[\uE000-\uF8FF]/g, ""));
    return name || clean(document.title.split(/\s[-–|]\s/)[0]) || "outlook";
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
  await ensurePinnedExpanded();
  let scroller = findListScroller();
  if (!scroller) {
    throw new Error("No se encontro la lista de correos. Abre una carpeta con correos visibles.");
  }

  const emails = new Map();
  let stuck = 0;
  let lastPaneSig = paneSig(readingSubject(), readingBodyNode()?.innerText || "");
  let reachedCutoff = false;
  const diagnostics = {
    iterations: 0,
    rowsObserved: 0,
    pinnedObserved: 0,
    normalObserved: 0,
    scrollerReacquisitions: 0,
    stopReason: "unknown"
  };

  console.log(`Filas de correo detectadas inicialmente: ${rowRoots().length}`);
  rowRoots().slice(0, 8).forEach((root, index) => {
    const email = extractRow(root);
    console.log(`#${index + 1} ts=${email?.timestamp || "sin fecha"} id=${email?.key?.startsWith("id:") ? "estable" : "fallback"}`);
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(SETTINGS.waitMs);
  }

  for (let i = 0; i < SETTINGS.maxScrolls && !reachedCutoff; i++) {
    diagnostics.iterations += 1;
    const sizeBefore = emails.size;

    // Outlook puede reemplazar todas las filas al abrir un correo. Reconsultar el
    // DOM antes de cada clic evita seguir usando nodos desconectados.
    for (let viewportPass = 0; viewportPass < 1000; viewportPass++) {
      const meta = rowRoots()
        .map((root) => extractRow(root))
        .find((candidate) => {
          if (!candidate || emails.has(candidate.key)) return false;
          if (candidate.pinned && SETTINGS.includePinnedOutsideRange) return true;
          if (!candidate.timestamp) return true;
          const ts = new Date(candidate.timestamp).getTime();
          return ts >= cutoff.getTime() && ts < upperBound.getTime();
        });
      if (!meta) break;
      if (emails.size >= SETTINGS.maxEmails) {
        diagnostics.stopReason = "max-emails";
        reachedCutoff = true;
        break;
      }

      clickRow(meta.root);
      const { node, text, subject, timedOut } = await waitForBody(lastPaneSig);
      if (!timedOut) lastPaneSig = paneSig(subject, text);

      emails.set(meta.key, {
        key: meta.key,
        timestamp: meta.timestamp,
        timestampRaw: meta.timestampRaw,
        pinned: meta.pinned,
        senderEmail: meta.senderEmail,
        headline: meta.headline,
        subject: subject || meta.headline,
        preview: meta.preview,
        body: text || null,
        bodyHtml: SETTINGS.includeHtml ? (node?.innerHTML || null) : undefined,
        bodyLoaded: !timedOut && !!text,
        bodyError: timedOut ? "reading-pane-timeout" : null,
        ariaLabel: meta.ariaLabel
      });
      diagnostics.rowsObserved += 1;
      if (meta.pinned) diagnostics.pinnedObserved += 1;
      else diagnostics.normalObserved += 1;
      window.outlookBodiesCheckpoint = {
        exportedAt: new Date().toISOString(),
        since: SETTINGS.since,
        until: upperBound.toISOString(),
        accountId: SETTINGS.accountId || null,
        accountEmail: SETTINGS.accountEmail || null,
        folderPath: SETTINGS.folderPath || folderLabel(),
        tab: SETTINGS.tab,
        emailCount: emails.size,
        diagnostics: { ...diagnostics },
        emails: [...emails.values()]
      };
    }

    const refreshedScroller = findListScroller();
    if (!refreshedScroller) {
      diagnostics.stopReason = "scroller-lost";
      throw new Error("Outlook reemplazo la lista virtualizada y no se pudo volver a localizar el scroller.");
    }
    if (refreshedScroller !== scroller) diagnostics.scrollerReacquisitions += 1;
    scroller = refreshedScroller;

    // Parada: la fila NO anclada más antigua ya es anterior a 'since'.
    const earliestMs = oldestNonPinnedMs();
    if (earliestMs !== null && earliestMs < cutoff.getTime()) {
      diagnostics.stopReason = "cutoff-reached";
      reachedCutoff = true;
      break;
    }

    const beforeTop = scroller.scrollTop;
    const beforeHeight = scroller.scrollHeight;
    const targetTop = Math.min(
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      scroller.scrollTop + Math.max(400, Math.floor(scroller.clientHeight * 0.7))
    );
    scroller.scrollTop = targetTop;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 700, bubbles: true }));
    await sleep(SETTINGS.waitMs);

    const afterScroller = findListScroller();
    if (afterScroller && afterScroller !== scroller) diagnostics.scrollerReacquisitions += 1;
    if (afterScroller) scroller = afterScroller;
    const noNew = emails.size === sizeBefore;
    const noMovement = scroller.scrollTop === beforeTop && scroller.scrollHeight === beforeHeight;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
    stuck = noNew && noMovement ? stuck + 1 : 0;
    if (noNew && noMovement && atEnd) {
      diagnostics.stopReason = "list-end";
      break;
    }
    if (stuck >= SETTINGS.stuckLimit) {
      diagnostics.stopReason = "stuck-limit";
      break;
    }
    const earliest = earliestMs !== null ? new Date(earliestMs).toISOString().slice(0, 10) : "desconocida";
    console.log(`Iteracion ${i}: ${emails.size} correos con cuerpo; mas antiguo (no anclado): ${earliest}`);
  }

  const all = [...emails.values()];
  if (diagnostics.stopReason === "unknown") {
    diagnostics.stopReason = reachedCutoff ? "cutoff-reached" : "max-scrolls";
  }
  const selected = all
    .filter(isEmailInScope)
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  const undatedCount = all.filter((email) => !email.timestamp).length;
  if (all.length > 0 && selected.length === 0 && undatedCount === all.length) {
    throw new Error(
      `Outlook detecto ${all.length} correos, pero no pudo interpretar ninguna fecha. ` +
      "Conservando el checkpoint para diagnostico."
    );
  }
  const failedBodies = selected.filter((email) => !email.bodyLoaded).length;
  const pinnedCount = selected.filter((email) => email.pinned).length;
  const pinnedOutsideRangeCount = selected.filter((email) => {
    if (!email.pinned) return false;
    if (!email.timestamp) return true;
    const ts = new Date(email.timestamp);
    return ts < cutoff || ts >= upperBound;
  }).length;
  const folder = folderLabel();
  const sinceStr = SETTINGS.since.slice(0, 10);
  const untilStr = SETTINGS.until
    ? SETTINGS.until.slice(0, 10)
    : `${upperBound.getFullYear()}-${String(upperBound.getMonth() + 1).padStart(2, "0")}-${String(upperBound.getDate()).padStart(2, "0")}`;
  const tag = SETTINGS.accountLabel ? `${SETTINGS.accountLabel}-` : "";
  const safeName = (tag + folder).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "outlook";
  const base = `${safeName}-bodies-since-${sinceStr}-to-${untilStr}`;

  window.outlookBodiesExport = {
    exportedAt: new Date().toISOString(),
    since: SETTINGS.since,
    until: upperBound.toISOString(),
    accountId: SETTINGS.accountId || null,
    accountEmail: SETTINGS.accountEmail || null,
    folder,
    folderPath: SETTINGS.folderPath || folder,
    tab: SETTINGS.tab,
    emailCount: selected.length,
    failedBodies,
    undatedCount,
    pinnedCount,
    pinnedOutsideRangeCount,
    includePinnedOutsideRange: SETTINGS.includePinnedOutsideRange,
    diagnostics,
    emails: selected
  };

  window.downloadOutlookBodiesJson = () =>
    download(JSON.stringify(window.outlookBodiesExport, null, 2), `${base}.json`, "application/json");
  window.downloadOutlookBodiesText = () =>
    download(
      selected.map((email) =>
        `[${email.timestamp || email.timestampRaw || "fecha desconocida"}]${email.pinned ? " [PINNED]" : ""}${email.senderEmail ? " <" + email.senderEmail + ">" : ""}\n` +
        `Asunto: ${email.subject}\n\n${email.body || "(cuerpo no capturado)"}`
      ).join("\n\n========================================\n\n"),
      `${base}.txt`, "text/plain"
    );

  console.log(`Carpeta: ${folder}`);
  console.log(
    `Exportados ${selected.length} correos con cuerpo desde ${sinceStr} hasta ${untilStr}; ` +
    `pinned: ${pinnedCount} (${pinnedOutsideRangeCount} fuera del intervalo); ` +
    `sin cuerpo: ${failedBodies}; sin fecha: ${undatedCount}.`
  );
  console.log("downloadOutlookBodiesJson()  → JSON con cuerpos");
  console.log("downloadOutlookBodiesText()  → texto plano");
  window.outlookBodiesExportRun = {
    ...window.outlookBodiesExportRun,
    status: "completed",
    finishedAt: new Date().toISOString()
  };
})().catch((error) => {
  const message = error?.message || String(error || "Error interno de Outlook sin detalles");
  window.outlookBodiesExportRun = {
    ...(window.outlookBodiesExportRun || {}),
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: message
  };
  console.error(`[Outlook bodies export] ${message}`);
});
