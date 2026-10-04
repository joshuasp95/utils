// 01-export-folder-since.js — exporta metadatos de la carpeta abierta de Outlook Web desde una fecha.
//
// Qué hace:     Hace scroll en la lista (lo más nuevo arriba) hasta pasar 'since' y guarda, por
//               correo: fecha, remitente, asunto+remitentes (headline) y vista previa. NO abre los
//               correos, así que no los marca como leídos.
// Requisitos:   Outlook Web con la carpeta/pestaña deseada abierta; DevTools (F12) → Consola.
// Uso:          Ajustar SETTINGS.since (y opcionalmente until/accountLabel), pegar y ejecutar;
//               luego downloadOutlookFolderJson() o downloadOutlookFolderText().
// Variables:    SETTINGS.since (ISO 8601, inclusivo), SETTINGS.until (ISO 8601 exclusivo o null =
//               mañana 00:00), SETTINGS.accountLabel (prefijo del nombre de fichero).
// Efectos:      SOLO LECTURA. Descarga ficheros al directorio de descargas del navegador.
// Salida:       window.outlookFolderExport y <cuenta>-<carpeta>-since-<desde>-to-<hasta>.json|.txt
(async () => {
  // ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
  // Abre la carpeta/cuenta deseada en outlook.office.com y pega esto en la consola.
  // La lista de OWA muestra lo MÁS NUEVO arriba: el script scrollea hacia ABAJO
  // hasta encontrar correos NO anclados anteriores a 'since'.
  const SETTINGS = {
    since: "2026-06-01T00:00:00+02:00",  // ← CAMBIAR: fecha inicio (ISO 8601)
    until: null,                          // null = hasta hoy fin del día; o ISO 8601 exclusivo
    accountLabel: "",                     // opcional: etiqueta para el fichero (p.ej. "cliente")
    waitMs: 700,
    maxScrolls: 800,
    stuckLimit: 12
  };

  const now = new Date();
  const cutoff = new Date(SETTINGS.since);
  const upperBound = SETTINGS.until
    ? new Date(SETTINGS.until)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (Number.isNaN(cutoff.getTime()) || Number.isNaN(upperBound.getTime()) || cutoff >= upperBound) {
    throw new Error("Intervalo invalido: revisa SETTINGS.since y SETTINGS.until.");
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();

  const ROW_SELECTOR = [
    '[data-testid="message-list-item"]',
    'div[role="option"][data-convid]',
    'div[data-convid]',
    'div[role="option"][aria-label]'
  ].join(", ");

  function rowRoots() {
    const nodes = [...document.querySelectorAll(ROW_SELECTOR)];
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  }

  // ─── FECHA ────────────────────────────────────────────────────────────────────
  // Fuente fiable: span[title] con fecha COMPLETA (ej. "Tue 7/21/2026 1:36 PM"),
  // presente aunque el texto visible sea relativo ("1:36 PM", "Fri 7/17").
  function dateTitleEl(root) {
    return [...root.querySelectorAll("[title]")].find((el) => {
      const t = el.getAttribute("title") || "";
      return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t) || /\b(19|20)\d{2}\b/.test(t);
    });
  }

  // Parser manual determinista (new Date() no es fiable en Firefox con M/D/YYYY h:mm AM/PM).
  // Asume UI en inglés (formato M/D/YYYY). Correos de hoy con solo hora → fecha de hoy.
  function toDate(str) {
    if (!str) return null;
    const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (m) {
      let year = Number(m[3]); if (year < 100) year += 2000;
      let h = m[4] != null ? Number(m[4]) : 0;
      if (m[7]) { h %= 12; if (/pm/i.test(m[7])) h += 12; }
      return new Date(year, Number(m[1]) - 1, Number(m[2]), h, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
    }
    const t = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (t) {
      let h = Number(t[1]); if (t[3]) { h %= 12; if (/pm/i.test(t[3])) h += 12; }
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, Number(t[2]));
    }
    return null;
  }

  function parseTimestamp(root, aria) {
    const el = dateTitleEl(root);
    const candidates = [
      el?.getAttribute("title"),
      root.querySelector("time[datetime]")?.getAttribute("datetime"),
      aria
    ].filter(Boolean);
    for (const raw of candidates) {
      const d = toDate(raw);
      if (d && !Number.isNaN(d.getTime())) return { iso: d.toISOString(), raw };
    }
    return { iso: null, raw: candidates[0] || "" };
  }

  function extractRow(root) {
    const aria = clean(root.getAttribute("aria-label"));
    const pinned = /^(collapsed\s+)?pinned\b/i.test(aria);

    const timestamp = parseTimestamp(root, aria);
    const senderEmail = clean([...root.querySelectorAll("[title]")]
      .find((el) => /@/.test(el.getAttribute("title") || ""))?.getAttribute("title"));

    // aria-label = "[flags] Remitente(s) Asunto FechaVisible Preview".
    // headline = remitente(s) + asunto; preview = lo que va tras la fecha visible.
    const rest = aria.replace(/^(collapsed |expanded |pinned |unread |flagged |draft )+/i, "");
    const dv = clean(dateTitleEl(root)?.textContent);
    let headline = rest, preview = "";
    if (dv) {
      const p = rest.indexOf(dv);
      if (p >= 0) { headline = clean(rest.slice(0, p)); preview = clean(rest.slice(p + dv.length)); }
    }
    preview = preview.replace(/\bNo conversations? selected\b/i, "").trim();

    // Clave por-mensaje: distingue mensajes del mismo hilo (vista "individual messages")
    // y a la vez deduplica la misma fila re-observada al scrollear.
    const key = [
      root.getAttribute("data-convid") || root.getAttribute("id") || "",
      timestamp.iso || timestamp.raw || "",
      headline.slice(0, 40)
    ].join("|");
    if (!headline && !aria) return null;
    return { key, pinned, timestamp: timestamp.iso, timestampRaw: timestamp.raw, senderEmail, headline, preview, ariaLabel: aria };
  }

  // Fecha más antigua entre filas NO ancladas (las pinned se saltan la cronología).
  function oldestNonPinnedMs() {
    const ms = rowRoots()
      .map((root) => extractRow(root))
      .filter((email) => email && !email.pinned && email.timestamp)
      .map((email) => new Date(email.timestamp).getTime());
    return ms.length ? Math.min(...ms) : null;
  }

  function scrollableAncestor(node) {
    for (let el = node?.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 40 && ["auto", "scroll"].includes(style.overflowY)) return el;
    }
    return null;
  }

  function findListScroller() {
    // Outlook nuevo: la lista es Virtuoso; el scroller es su ancestro scrollable.
    const list = document.querySelector('[data-testid="virtuoso-item-list"]');
    let scroller = scrollableAncestor(list);
    if (scroller) return scroller;
    scroller = scrollableAncestor(rowRoots()[0]);
    if (scroller) return scroller;
    // Fallback: puntuar ancestros scrollables por nº de filas.
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

  function folderLabel() {
    const sel = document.querySelector('[role="treeitem"][aria-selected="true"], [role="tree"] [aria-selected="true"]');
    let name = clean(sel?.getAttribute("aria-label")) || clean(sel?.textContent);
    name = clean(name.replace(/selected/gi, "").replace(/\s*\d+\s*(unread|no le[ií]dos)?\s*$/i, ""));
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
  const scroller = findListScroller();
  if (!scroller) {
    console.error("No se encontro la lista de correos. Abre una carpeta con correos visibles.");
    return;
  }

  // Diagnóstico: cómo interpreta las primeras filas visibles.
  console.log("== Diagnóstico (primeras 5 filas) ==");
  rowRoots().slice(0, 5).forEach((root, i) => {
    const e = extractRow(root);
    console.log(`#${i} pinned=${e?.pinned} ts=${e?.timestamp || "—"} raw="${e?.timestampRaw || ""}" | ${(e?.headline || "").slice(0, 60)}`);
  });
  console.log(`cutoff=${cutoff.toISOString()}  upperBound=${upperBound.toISOString()}`);
  console.log(`scroller: <${scroller.tagName.toLowerCase()} class="${(scroller.className || "").toString().slice(0, 40)}"> scrollH=${scroller.scrollHeight} clientH=${scroller.clientHeight}`);
  {
    const before = scroller.scrollTop;
    scroller.scrollTop = before + 400;
    await sleep(300);
    console.log(`test-scroll: ${before} -> ${scroller.scrollTop} (${scroller.scrollTop !== before ? "SE MUEVE" : "NO SE MUEVE - scroller incorrecto"})`);
    scroller.scrollTop = 0;
  }

  const emails = new Map();
  let stuck = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(SETTINGS.waitMs);
  }

  for (let i = 0; i < SETTINGS.maxScrolls; i++) {
    const sizeBefore = emails.size;
    for (const root of rowRoots()) {
      const email = extractRow(root);
      if (email) emails.set(email.key, email);
    }

    const earliestMs = oldestNonPinnedMs();
    if (earliestMs !== null && earliestMs < cutoff.getTime()) break;

    const beforeTop = scroller.scrollTop;
    scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + Math.max(500, Math.floor(scroller.clientHeight * 0.85)));
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 700, bubbles: true }));
    await sleep(SETTINGS.waitMs);

    const noNew = emails.size === sizeBefore;
    const noMovement = scroller.scrollTop === beforeTop;
    stuck = noNew && noMovement ? stuck + 1 : 0;
    if (stuck >= SETTINGS.stuckLimit) break;
    if (i % 5 === 0 && i > 0) {
      const earliest = earliestMs !== null ? new Date(earliestMs).toISOString().slice(0, 10) : "desconocida";
      console.log(`Iteracion ${i}: ${emails.size} correos; mas antiguo (no anclado): ${earliest}`);
    }
  }

  for (const root of rowRoots()) {
    const email = extractRow(root);
    if (email) emails.set(email.key, email);
  }

  const all = [...emails.values()];
  const selected = all
    .filter((email) => {
      if (!email.timestamp) return false;
      const ts = new Date(email.timestamp);
      return ts >= cutoff && ts < upperBound;
    })
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  const undatedCount = all.filter((email) => !email.timestamp).length;
  const folder = folderLabel();
  const sinceStr = SETTINGS.since.slice(0, 10);
  const untilStr = SETTINGS.until
    ? SETTINGS.until.slice(0, 10)
    : `${upperBound.getFullYear()}-${String(upperBound.getMonth() + 1).padStart(2, "0")}-${String(upperBound.getDate()).padStart(2, "0")}`;
  const tag = SETTINGS.accountLabel ? `${SETTINGS.accountLabel}-` : "";
  const safeName = (tag + folder).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "outlook";
  const base = `${safeName}-since-${sinceStr}-to-${untilStr}`;

  window.outlookFolderExport = {
    exportedAt: new Date().toISOString(),
    since: SETTINGS.since,
    until: upperBound.toISOString(),
    folder,
    emailCount: selected.length,
    undatedCount,
    emails: selected
  };

  window.downloadOutlookFolderJson = () =>
    download(JSON.stringify(window.outlookFolderExport, null, 2), `${base}.json`, "application/json");
  window.downloadOutlookFolderText = () =>
    download(
      selected.map((email) =>
        `[${email.timestamp || email.timestampRaw || "fecha desconocida"}]${email.senderEmail ? " <" + email.senderEmail + ">" : ""}\n${email.headline}\n${email.preview}`
      ).join("\n\n---\n\n"),
      `${base}.txt`, "text/plain"
    );

  console.log(`Carpeta: ${folder}`);
  console.log(`Exportados ${selected.length} correos desde ${sinceStr} hasta ${untilStr}; sin fecha fiable: ${undatedCount}.`);
  console.log("downloadOutlookFolderJson()  → JSON con metadatos");
  console.log("downloadOutlookFolderText()  → texto plano");
})();
