// workday-time-entries-export.js — Exporta las entradas de tiempo de Workday desde una fecha hasta hoy.
//
// Qué hace:     Desde la vista SEMANAL de Time de Workday, retrocede semana a semana hasta la que
//               contiene SETTINGS.since y luego avanza leyendo cada tarjeta del calendario (tipo de
//               tiempo, horas, estado y comentario). Asigna cada tarjeta a su día por posición en pantalla.
// Requisitos:   Navegador de escritorio con sesión iniciada en el tenant Workday de tu empresa,
//               abierto en Time → vista Week (calendario semanal de la semana actual).
// Uso:          Ajusta SETTINGS.since, pega el script en DevTools → Console y pulsa Enter. Al terminar:
//                 downloadWorkdayJson()   // descarga .json
//                 downloadWorkdayText()   // descarga .txt agrupado por día
//                 workdayExport.entries   // ver los datos en consola
//               Para cancelar a mitad: window.workdayExportAbort = true
// Variables:    SETTINGS.since (YYYY-MM-DD, primer día), waitMs (espera entre semanas), maxWeeks (límite).
// Efectos:      SOLO LECTURA: solo pulsa los botones de semana anterior/siguiente; no abre ni guarda entradas.
//               ESCRIBE: descargas en la carpeta del navegador SOLO cuando llamas a download*().
// Salida:       workday-time-<since>-to-<hoy>.json / .txt
(async () => {
  // ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
  const SETTINGS = {
    since: "2026-06-01",  // ← CAMBIAR: primer día del periodo a extraer (YYYY-MM-DD)
    waitMs: 1500,         // ms entre navegaciones — aumentar si Workday va lento
    maxWeeks: 52          // límite de seguridad
  };

  // ─── UTILS ────────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (v) => (v || "").replace(/\s+/g, " ").trim();

  const sinceDate = new Date(SETTINGS.since + "T00:00:00");
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Get the Monday of the week that contains a given date
  function getMondayOf(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ─── NAVEGACIÓN ──────────────────────────────────────────────────────────────
  function findNavBtn(dir) {
    const prevSel = [
      '[data-automation-id="navigateBackwardButton"]',
      '[data-automation-id="prevButton"]',
      '[data-automation-id="chevronLeftButton"]',
      'button[aria-label*="Previous" i]',
      'button[aria-label*="Anterior" i]',
      'button[aria-label*="atrás" i]',
      'button[aria-label*="Back" i]'
    ].join(",");
    const nextSel = [
      '[data-automation-id="navigateForwardButton"]',
      '[data-automation-id="nextButton"]',
      '[data-automation-id="chevronRightButton"]',
      'button[aria-label*="Next" i]',
      'button[aria-label*="Siguiente" i]',
      'button[aria-label*="adelante" i]',
      'button[aria-label*="Forward" i]'
    ].join(",");
    return document.querySelector(dir === "prev" ? prevSel : nextSel);
  }

  async function clickNav(dir) {
    const btn = findNavBtn(dir);
    if (!btn) {
      const labels = [...document.querySelectorAll("button")]
        .map((b) => b.getAttribute("aria-label") || b.textContent.trim())
        .filter(Boolean)
        .slice(0, 30)
        .join(" | ");
      throw new Error(
        `Botón de navegación '${dir}' no encontrado.\n` +
        `¿Estás en la vista semanal de Time? Botones visibles: ${labels}`
      );
    }
    btn.click();
    await sleep(SETTINGS.waitMs);
  }

  // ─── DETECCIÓN DE DÍAS EN PANTALLA ───────────────────────────────────────────
  // Returns all visible calendarDateCell elements with their month (0-based) and day
  function getVisibleDayCells() {
    const cells = [];
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const el = document.querySelector(
          `[data-automation-id="calendarDateCell-${m}-${d}"]`
        );
        if (el) cells.push({ month: m, day: d, el });
      }
    }
    return cells;
  }

  // When a week spans two months the month index alone is ambiguous — use the
  // known week-Monday date to resolve the year correctly.
  function resolveYear(weekMondayDate, month) {
    const wm = weekMondayDate.getMonth();
    const wy = weekMondayDate.getFullYear();
    const diff = month - wm;
    if (diff > 6) return wy - 1; // e.g. month=11 while weekMonday is in Jan
    if (diff < -6) return wy + 1; // e.g. month=0 while weekMonday is in Dec
    return wy;
  }

  // ─── EXTRACCIÓN DE SEMANA ─────────────────────────────────────────────────────
  function extractWeek(weekMondayDate) {
    const cells = getVisibleDayCells();
    if (cells.length === 0) return [];

    // Build a list of { dateStr, left, right } for each visible day
    const dayColumns = cells
      .map((cell) => {
        const rect = cell.el.getBoundingClientRect();
        const year = resolveYear(weekMondayDate, cell.month);
        const date = new Date(year, cell.month, cell.day);
        return {
          dateStr: date.toISOString().slice(0, 10),
          left: rect.left,
          right: rect.right
        };
      })
      .sort((a, b) => a.left - b.left);

    // Extend each column rightward to the next column's left edge (fills any gap)
    for (let i = 0; i < dayColumns.length - 1; i++) {
      dayColumns[i].right = dayColumns[i + 1].left;
    }
    if (dayColumns.length > 0) {
      dayColumns[dayColumns.length - 1].right = window.innerWidth;
    }

    // Collect all appointment cards — try multiple selectors for Workday variants
    const apptEls = [
      ...(document.querySelectorAll('[data-automation-appointment-style]') || []),
      ...(document.querySelectorAll('[data-automation-id*="calendarAppointment"]:not([data-automation-id*="Title"]):not([data-automation-id*="Subtitle"])') || [])
    ].filter((el, i, arr) => arr.indexOf(el) === i); // deduplicate

    const entries = [];

    for (const appt of apptEls) {
      const rect = appt.getBoundingClientRect();
      // Skip elements not on-screen (e.g. hidden overflow)
      if (rect.width === 0 && rect.height === 0) continue;

      const midX = rect.left + rect.width / 2;
      const col = dayColumns.find((c) => midX >= c.left && midX < c.right);

      // Extract structured fields from inner elements
      const timeType = clean(
        appt.querySelector('[data-automation-id="calendarAppointmentTitle"]')?.innerText || ""
      );
      const hoursText = clean(
        appt.querySelector('[data-automation-id="calendarAppointmentSubtitle"]')?.innerText || ""
      );
      const category = clean(
        appt.querySelector('[data-automation-id="calendarAppointmentSubtitle2"]')?.innerText || ""
      );

      // The title attribute often contains the full entry info:
      // "Project > Phase > Leaf | 4 Hours | Status | Comment"
      const fullTitle = clean(
        appt.getAttribute("title") || appt.getAttribute("aria-label") || ""
      );

      const parts = fullTitle ? fullTitle.split(/\s*\|\s*/) : [];

      // Parse comment: everything after the 3rd pipe segment (index 3+)
      const comment = parts.length > 3 ? parts.slice(3).join(" | ") : "";

      const entry = {
        date: col?.dateStr || "unknown",
        timeType: timeType || (parts[0] || ""),
        hours: hoursText || (parts[1] || ""),
        category: category || (parts[2] || ""),
        comment,
        raw: fullTitle
      };

      if (!entry.timeType && !entry.raw) continue;
      entries.push(entry);
    }

    return entries;
  }

  // ─── FORMATEO DE TEXTO ────────────────────────────────────────────────────────
  function toText(entries) {
    const byDate = {};
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    }

    const lines = [];
    for (const date of Object.keys(byDate).sort()) {
      lines.push(date);
      for (const e of byDate[date]) {
        const parts = [e.timeType];
        if (e.hours) parts.push(e.hours);
        if (e.category) parts.push(e.category);
        if (e.comment) parts.push(e.comment);
        lines.push("  " + parts.join(" | "));
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  // ─── DESCARGA ─────────────────────────────────────────────────────────────────
  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  // ─── MAIN ─────────────────────────────────────────────────────────────────────
  window.workdayExportAbort = false;

  const sinceMondayDate = getMondayOf(sinceDate);
  const todayMondayDate = getMondayOf(today);
  const totalWeeks =
    Math.round(
      (todayMondayDate.getTime() - sinceMondayDate.getTime()) /
      (7 * 24 * 3600 * 1000)
    ) + 1;

  if (totalWeeks - 1 > SETTINGS.maxWeeks) {
    console.error(
      `El rango de ${totalWeeks - 1} semanas supera el límite de ${SETTINGS.maxWeeks}. ` +
      `Ajusta SETTINGS.maxWeeks o acorta el rango since/until.`
    );
    return;
  }

  console.log(
    `%c[Workday Export] Iniciando extracción de ${totalWeeks} semana(s)` +
    ` desde ${SETTINGS.since} hasta hoy (${today.toISOString().slice(0, 10)})`,
    "color:#0066cc;font-weight:bold"
  );
  console.log("Para cancelar: window.workdayExportAbort = true");

  await sleep(SETTINGS.waitMs);

  // Navigate backward to the week containing since date
  const weeksBack = totalWeeks - 1;
  if (weeksBack > 0) {
    console.log(`  Navegando ${weeksBack} semana(s) hacia atrás…`);
    for (let i = 0; i < weeksBack; i++) {
      if (window.workdayExportAbort) { console.warn("Cancelado."); return; }
      await clickNav("prev");
      if ((i + 1) % 5 === 0) console.log(`    ${i + 1}/${weeksBack}…`);
    }
  }

  // Collect entries week by week going forward
  const allEntries = [];
  let currentMondayDate = new Date(sinceMondayDate);

  for (let week = 0; week < totalWeeks; week++) {
    if (window.workdayExportAbort) { console.warn("Cancelado."); break; }

    const label = currentMondayDate.toISOString().slice(0, 10);
    console.log(`  Semana ${week + 1}/${totalWeeks}: ${label}`);

    const weekEntries = extractWeek(currentMondayDate);

    // Keep only entries within the configured date range
    const inRange = weekEntries.filter((e) => {
      if (e.date === "unknown") return false;
      const d = new Date(e.date + "T00:00:00");
      return d >= sinceDate && d <= today;
    });

    console.log(`    → ${inRange.length} entrada(s) encontrada(s)`);
    allEntries.push(...inRange);

    if (week < totalWeeks - 1) {
      await clickNav("next");
      currentMondayDate.setDate(currentMondayDate.getDate() + 7);
    }
  }

  // Sort by date then by time type
  const sorted = allEntries
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeType.localeCompare(b.timeType));

  const todayStr = today.toISOString().slice(0, 10);
  const baseName = `workday-time-${SETTINGS.since}-to-${todayStr}`;

  // Expose data and download helpers on window so they can be called any time
  window.workdayExport = {
    entries: sorted,
    count: sorted.length,
    extractedAt: new Date().toISOString(),
    settings: { ...SETTINGS, extractedUpTo: todayStr }
  };

  window.downloadWorkdayJson = () =>
    download(JSON.stringify(window.workdayExport, null, 2), `${baseName}.json`, "application/json");

  window.downloadWorkdayText = () =>
    download(toText(sorted), `${baseName}.txt`, "text/plain");

  // Summary
  const byDate = {};
  for (const e of sorted) byDate[e.date] = (byDate[e.date] || 0) + 1;
  const days = Object.keys(byDate).length;

  console.log(
    `%c[Workday Export] Finalizado: ${sorted.length} entrada(s) en ${days} día(s)`,
    "color:#009900;font-weight:bold"
  );
  console.log("  Descargar JSON : downloadWorkdayJson()");
  console.log("  Descargar texto: downloadWorkdayText()");
  console.log("  Ver en consola : workdayExport.entries");
  console.table(
    sorted.slice(0, 20).map((e) => ({
      fecha: e.date,
      tipo: e.timeType.slice(0, 50),
      horas: e.hours,
      estado: e.category
    }))
  );
  if (sorted.length > 20)
    console.log(`  … y ${sorted.length - 20} más. Ver workdayExport.entries para la lista completa.`);
})();
