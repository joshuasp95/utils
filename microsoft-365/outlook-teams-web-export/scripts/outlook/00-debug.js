// 00-debug.js — diagnóstico de selectores de Outlook Web (pegar en la consola del navegador).
//
// Qué hace:     Cuenta filas por selector, muestra las 3 primeras filas, la carpeta seleccionada,
//               el árbol de carpetas, las pestañas Focused/Other y si encuentra el panel de lectura.
// Requisitos:   Outlook Web abierto con una carpeta y su lista visibles; DevTools (F12) → Consola.
// Uso:          Pegar el bloque completo y pulsar Enter.
// Variables:    —
// Efectos:      SOLO LECTURA (no abre correos ni descarga nada).
// Salida:       Tablas y logs en la consola. OJO: muestra aria-label/innerText de 3 filas (remitente
//               y asunto); no compartas la salida sin revisarla.
(() => {
  // Diagnóstico: pega esto en la consola con la carpeta de correo abierta.
  // Copia TODA la salida y compártela para ajustar los selectores.
  const clean = (v) => (v || "").replace(/\s+/g, " ").trim();

  const ROW_SELECTOR = [
    'div[role="option"][data-convid]',
    'div[role="option"][aria-label]',
    'div[data-convid]',
    '[role="listitem"]',
    '[data-convid]'
  ];

  const report = {};
  ROW_SELECTOR.forEach((sel) => { report[sel] = document.querySelectorAll(sel).length; });
  console.log("== Conteo por selector de fila ==");
  console.table(report);

  const nodes = [...document.querySelectorAll(ROW_SELECTOR.join(", "))];
  const rows = nodes.filter((n) => !nodes.some((o) => o !== n && o.contains(n)));
  console.log(`Filas hoja detectadas: ${rows.length}`);

  console.log("== Muestra de las primeras 3 filas ==");
  rows.slice(0, 3).forEach((row, index) => {
    const titled = [...row.querySelectorAll("span[title]")].map((el) => ({
      title: el.getAttribute("title"),
      text: clean(el.textContent)
    }));
    const times = [...row.querySelectorAll("time[datetime]")].map((el) => el.getAttribute("datetime"));
    console.log(`--- Fila ${index} ---`);
    console.log("aria-label:", row.getAttribute("aria-label"));
    console.log("data-convid:", row.getAttribute("data-convid"));
    console.log("innerText:", clean(row.innerText).slice(0, 200));
    console.log("span[title]:", JSON.stringify(titled, null, 0));
    console.log("time[datetime]:", JSON.stringify(times));
  });

  console.log("== Carpeta seleccionada (candidatos) ==");
  [
    '[role="tree"] [aria-selected="true"]',
    '[role="treeitem"][aria-selected="true"]',
    '[role="navigation"] [aria-current]'
  ].forEach((sel) => {
    const el = document.querySelector(sel);
    console.log(sel, "→", el ? clean(el.textContent).slice(0, 60) : "(no match)");
  });

  console.log("== Árbol de carpetas y pestañas (sin contenido) ==");
  console.table([...document.querySelectorAll('[role="treeitem"]')].map((el, index) => ({
    index,
    level: el.getAttribute("aria-level"),
    expanded: el.getAttribute("aria-expanded"),
    selected: el.getAttribute("aria-selected"),
    testId: el.getAttribute("data-testid"),
    folderId: el.hasAttribute("data-folder-id") ? "presente" : "ausente",
    folderName: el.hasAttribute("data-folder-name") ? "presente" : "ausente"
  })));
  console.table([...document.querySelectorAll('[role="tab"], button[data-testid]')]
    .filter((el) => /focused|other|prioritarios|otros/i.test(
      `${el.getAttribute("data-testid") || ""} ${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`
    ))
    .map((el) => ({
      role: el.getAttribute("role"),
      selected: el.getAttribute("aria-selected"),
      testId: el.getAttribute("data-testid")
    })));

  console.log("== Panel de lectura ==");
  console.log("subject:", clean(document.querySelector('span[id$="_SUBJECT"], [id$="_SUBJECT"]')?.textContent) || "(no match)");
  console.log("body node:", !!document.querySelector('[data-test-id="mailMessageBodyContainer"], [aria-label="Message body"]'));
})();
