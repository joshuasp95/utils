// 01-list-first-30-chats.js — inventario de las primeras conversaciones de la lista de Chat de Teams Web.
//
// Qué hace:     Hace scroll en la barra lateral de Chat y recoge título, clave interna y tipo de
//               las primeras SETTINGS.limit conversaciones (30 por defecto). No abre ninguna.
// Requisitos:   Teams Web (teams.microsoft.com) en la sección Chat con la lista visible;
//               DevTools (F12) → Consola.
// Uso:          Pegar y ejecutar; luego downloadTeamsChatInventory().
// Variables:    SETTINGS.limit (nº de chats), waitMs (pausa entre scrolls), maxScrolls.
// Efectos:      SOLO LECTURA.
// Salida:       window.teamsChatInventory y teams-chat-inventory-<fecha>.json
(async () => {
  const SETTINGS = { limit: 30, waitMs: 500, maxScrolls: 120 };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();

  function titleFor(item) {
    const title = item.querySelector(
      '[id^="title-chat-list-item"], [data-tid="chat-list-item-title"], span[role="text"][title]'
    );
    return clean(title?.getAttribute("title") || title?.textContent);
  }

  function visibleChatItems() {
    const titleNodes = [...document.querySelectorAll(
      '[id^="title-chat-list-item"], [data-tid="chat-list-item-title"]'
    )];
    const byTitleNode = titleNodes.map((titleNode) => {
      const item = titleNode.closest('[role="treeitem"]') || titleNode.parentElement;
      return { item, title: clean(titleNode.getAttribute("title") || titleNode.textContent) };
    });
    const fallback = titleNodes.length === 0
      ? [...document.querySelectorAll('[role="treeitem"]')].map((item) => ({ item, title: titleFor(item) }))
      : [];
    return [...byTitleNode, ...fallback]
      .filter(({ item, title }) => item && title)
      .filter(({ item, title }) => /Conversation\|/.test(chatRecord(item, title).key))
      .filter(({ item }, index, all) => all.findIndex((candidate) => candidate.item === item) === index);
  }

  function chatRecord(item, title) {
    return {
      position: 0,
      title,
      key:
        item.getAttribute("data-fui-tree-item-value") ||
        item.getAttribute("data-conversation-id") ||
        item.id ||
        title,
      ariaLabel: item.getAttribute("aria-label") || "",
      itemType: item.getAttribute("data-item-type") || "chat"
    };
  }

  function findSidebar() {
    const items = visibleChatItems();
    if (items.length === 0) return null;

    const elements = new Set();
    for (const { item } of items.slice(0, 5)) {
      for (let element = item.parentElement; element && element !== document.body; element = element.parentElement) {
        elements.add(element);
      }
    }
    document.querySelectorAll(
      '[data-scrollable-element="true"], [data-is-scrollable="true"], [data-tid*="chat-list"], [role="tree"]'
    ).forEach((element) => elements.add(element));

    const candidates = [...elements]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const itemCount = element.querySelectorAll('[id^="title-chat-list-item"]').length;
        const scrollRange = element.scrollHeight - element.clientHeight;
        const narrowEnough = rect.width > 120 && rect.width < Math.min(window.innerWidth * 0.65, 760);
        const visibleEnough = rect.height > 120 && rect.left < window.innerWidth * 0.5;
        const overflowBonus = ["auto", "scroll"].includes(style.overflowY) ? 5000 : 0;
        const score = itemCount * 10000 + Math.max(0, scrollRange) + overflowBonus + rect.height;
        return { element, itemCount, scrollRange, narrowEnough, visibleEnough, score };
      })
      .filter((candidate) => candidate.itemCount > 0 && candidate.narrowEnough && candidate.visibleEnough)
      .sort((a, b) => b.score - a.score);

    console.table(candidates.slice(0, 8).map(({ itemCount, scrollRange, score, element }) => ({
      tag: element.tagName,
      id: element.id,
      itemCount,
      scrollRange,
      score
    })));
    return candidates[0]?.element || null;
  }

  function download(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  let sidebar = findSidebar();
  if (!sidebar) {
    console.error("No se encontro el scroll lateral de chats. Abre Chat y deja visible la lista lateral.");
    return;
  }

  const originalTop = sidebar.scrollTop;
  const records = new Map();
  sidebar.scrollTop = 0;
  sidebar.dispatchEvent(new Event("scroll", { bubbles: true }));
  await sleep(SETTINGS.waitMs);

  let stuck = 0;
  for (let iteration = 0; iteration < SETTINGS.maxScrolls && records.size < SETTINGS.limit; iteration++) {
    if (!sidebar.isConnected) {
      sidebar = findSidebar();
      if (!sidebar) throw new Error("Teams reemplazo el panel lateral y no se pudo volver a localizar.");
    }
    for (const { item, title } of visibleChatItems()) {
      const record = chatRecord(item, title);
      if (!records.has(record.key)) records.set(record.key, record);
      if (records.size >= SETTINGS.limit) break;
    }

    const before = sidebar.scrollTop;
    sidebar.scrollTop += Math.max(220, Math.floor(sidebar.clientHeight * 0.75));
    sidebar.dispatchEvent(new WheelEvent("wheel", { deltaY: 600, bubbles: true }));
    await sleep(SETTINGS.waitMs);

    if (sidebar.scrollTop === before) stuck += 1;
    else stuck = 0;
    if (stuck >= 5) break;
  }

  sidebar.scrollTop = originalTop;
  const chats = [...records.values()].slice(0, SETTINGS.limit);
  chats.forEach((chat, index) => { chat.position = index + 1; });

  window.teamsChatInventory = {
    exportedAt: new Date().toISOString(),
    requested: SETTINGS.limit,
    found: chats.length,
    chats
  };

  console.table(chats.map(({ position, title, itemType, key }) => ({ position, title, itemType, key })));
  console.log("Inventario guardado en window.teamsChatInventory");
  console.log("Descarga manual: downloadTeamsChatInventory()");
  window.downloadTeamsChatInventory = () => download(
    window.teamsChatInventory,
    `teams-chat-inventory-${new Date().toISOString().slice(0, 10)}.json`
  );
})().catch((error) => {
  const message = error?.message || (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
  window.teamsChatInventoryError = { at: new Date().toISOString(), message: message || "Error interno de Teams sin detalles" };
  console.error(`[Teams inventory] ${window.teamsChatInventoryError.message}`);
});
