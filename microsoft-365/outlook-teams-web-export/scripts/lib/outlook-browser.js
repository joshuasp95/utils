// outlook-browser.js — helpers Playwright para la interfaz de Outlook Web.
// Qué hace: elige la cuenta exacta en "Pick an account", verifica la identidad visible, expande y
// descubre el árbol de carpetas, hace clic en carpetas y pestañas (Focused/Other) y obtiene una
// "firma" de la lista para saber cuándo ha cambiado la vista. Selectores basados en roles ARIA y
// data-* (frágiles: Microsoft cambia el DOM). Efectos: solo navega/hace clic; no modifica correos.
import { exactVisibleEmail, tabFromVisibleLabel } from "./outlook-workflow.js";

const EXCLUDED_FOLDER_LABELS = /^(favorites?|favoritos?|groups?|grupos?|shared with me|compartido conmigo|shared mailboxes?|buzones compartidos?)$/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function selectConfiguredMicrosoftAccount(page, account) {
  const exactMatches = page.getByText(account.email, { exact: true });
  const count = await exactMatches.count().catch(() => 0);
  if (!count) return false;
  for (let index = 0; index < count; index += 1) {
    const email = exactMatches.nth ? exactMatches.nth(index) : exactMatches.first();
    if (email.isVisible && !await email.isVisible().catch(() => false)) continue;
    const target = email.locator('xpath=ancestor-or-self::*[@role="button" or self::button][1]');
    const clickable = await target.count() ? target : email;
    if (await clickable.click().then(() => true).catch(() => false)) return true;
  }
  return false;
}

export async function visibleConfiguredIdentity(page, account, { includeTreeItems = true } = {}) {
  const selectors = [
    '[data-testid*="account" i]',
    '[aria-label*="account" i]',
    '[aria-label*="cuenta" i]',
    '[role="dialog"]'
  ];
  if (includeTreeItems) selectors.push('[role="treeitem"]');
  const values = await page.locator(selectors.join(", ")).evaluateAll((elements) => elements.flatMap((element) => [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title")
  ]).filter(Boolean)).catch(() => []);
  return values.some((value) => (clean(value).match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/g) || [])
    .some((email) => exactVisibleEmail(email.replace(/[),;]+$/, ""), account.email)));
}

export async function openAccountIdentityPanel(page) {
  const selectors = [
    '#O365_MeFlexPane_Button',
    '[data-testid="mectrl_headerPicture"]',
    'button[aria-label*="Account manager" i]',
    'button[aria-label*="Administrador de cuentas" i]'
  ];
  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return true;
    }
  }
  return false;
}

export async function expandDiscoverableFolderTree(page, accountEmail, { maxRounds = 8 } = {}) {
  for (let round = 0; round < maxRounds; round += 1) {
    const expanded = await page.evaluate(({ excludedPattern, expectedEmail }) => {
      const excluded = new RegExp(excludedPattern, "i");
      const exactEmail = (value) => String(value || "").trim().toLowerCase() === expectedEmail.toLowerCase();
      const nodes = [...document.querySelectorAll('[role="treeitem"][aria-expanded="false"]')];
      let changes = 0;
      for (const node of nodes) {
        const label = (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "")
          .replace(/\s+/g, " ").trim();
        const hasFolderIdentity = node.hasAttribute("data-folder-id")
          || node.hasAttribute("data-folder-name")
          || /folder/i.test(node.getAttribute("data-testid") || "");
        const isRequestedMailbox = (label.match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/g) || [])
          .some((email) => exactEmail(email.replace(/[),;]+$/, "")));
        if ((!hasFolderIdentity && !isRequestedMailbox) || excluded.test(label)) continue;
        (node.querySelector([
          'button[aria-label*="expand" i]',
          'button[aria-label*="expandir" i]',
          '[data-testid*="expand" i]',
          '[data-icon-name="ChevronRight"]',
          '[role="button"]'
        ].join(", ")) || node).click();
        changes += 1;
      }
      return changes;
    }, { excludedPattern: EXCLUDED_FOLDER_LABELS.source, expectedEmail: accountEmail });
    if (!expanded) break;
    await page.waitForTimeout(500);
  }
}

export async function discoverOutlookFolders(page, accountEmail) {
  await expandDiscoverableFolderTree(page, accountEmail);
  const items = await page.evaluate((excludedPattern) => {
    const excluded = new RegExp(excludedPattern, "i");
    const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('[role="treeitem"]')].map((element, index) => {
      const aria = cleanText(element.getAttribute("aria-label"));
      const title = cleanText(element.getAttribute("title"));
      const text = cleanText(element.textContent);
      const rawName = element.getAttribute("data-folder-name") || title || aria || text;
      const name = cleanText(rawName
        .replace(/\b(selected|seleccionado)\b/gi, "")
        .replace(/\s+\d+\s*(unread|no le[ií]dos?)?\s*$/i, ""));
      const stableId = element.getAttribute("data-folder-id")
        || element.getAttribute("data-folder-name")
        || element.id
        || `treeitem-${index}`;
      const folder = element.hasAttribute("data-folder-id")
        || element.hasAttribute("data-folder-name")
        || /folder/i.test(element.getAttribute("data-testid") || "")
        || (!element.hasAttribute("aria-expanded") && !!name);
      return {
        name,
        level: Number(element.getAttribute("aria-level") || 1),
        stableId,
        folder,
        excluded: excluded.test(name),
        selected: element.getAttribute("aria-selected") === "true",
        visibleEmails: [aria, title, text].join(" ").match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/g) || []
      };
    }).filter((item) => item.name);
  }, EXCLUDED_FOLDER_LABELS.source);
  const accountRoots = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.visibleEmails.length > 0);
  if (!accountRoots.length) return items;
  const target = accountRoots.find(({ item }) =>
    item.visibleEmails.some((email) => exactVisibleEmail(email.replace(/[),;]+$/, ""), accountEmail))
  );
  if (!target) {
    throw new Error("El árbol de carpetas pertenece a una cuenta distinta de la solicitada.");
  }
  const nextRoot = accountRoots.find(({ index }) => index > target.index);
  return items.slice(target.index + 1, nextRoot?.index ?? items.length);
}

export async function clickOutlookFolder(page, folder) {
  const clicked = await page.evaluate(({ stableId, name }) => {
    const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const nodes = [...document.querySelectorAll('[role="treeitem"]')];
    const syntheticIndex = stableId.match(/^treeitem-(\d+)$/)?.[1];
    const node = (syntheticIndex === undefined ? null : nodes[Number(syntheticIndex)]) || nodes.find((element) => [
      element.getAttribute("data-folder-id"),
      element.getAttribute("data-folder-name"),
      element.id
    ].includes(stableId)) || nodes.find((element) => cleanText(
      element.getAttribute("data-folder-name")
      || element.getAttribute("title")
      || element.getAttribute("aria-label")
      || element.textContent
    ) === name);
    if (!node) return false;
    node.click();
    return true;
  }, folder);
  if (!clicked) throw new Error(`No se pudo localizar la carpeta seleccionada: ${folder.path}.`);
}

export async function discoverOutlookTabs(page) {
  const candidates = await page.locator([
    '[role="tab"]',
    'button[data-testid*="focused" i]',
    'button[data-testid*="other" i]'
  ].join(", ")).evaluateAll((elements) => elements.map((element) => ({
    label: (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim(),
    testId: element.getAttribute("data-testid") || ""
  }))).catch(() => []);
  const tabs = candidates.map((candidate) => ({
    id: tabFromVisibleLabel(candidate.label)
      || (/focused/i.test(candidate.testId) ? "focused" : null)
      || (/other/i.test(candidate.testId) ? "other" : null),
    label: candidate.label,
    testId: candidate.testId
  })).filter((tab) => tab.id);
  return tabs.filter((tab, index) => tabs.findIndex((candidate) => candidate.id === tab.id) === index);
}

export async function clickOutlookTab(page, tabId) {
  const tabs = await discoverOutlookTabs(page);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) return false;
  const roleTab = page.getByRole("tab", { name: tab.label, exact: true });
  if (await roleTab.count() && await roleTab.first().isVisible().catch(() => false)) {
    await roleTab.first().click();
  } else if (tab.testId) {
    const clicked = await page.locator("[data-testid]").evaluateAll((elements, testId) => {
      const element = elements.find((candidate) => candidate.getAttribute("data-testid") === testId);
      element?.click();
      return !!element;
    }, tab.testId);
    if (!clicked) return false;
  }
  else return false;
  return true;
}

export async function outlookListSignature(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll(
      '[data-testid="message-list-item"], div[role="option"][data-convid], div[data-convid], div[role="option"][aria-label]'
    )];
    const ids = rows.slice(0, 4).map((row) => row.getAttribute("data-convid") || row.id || "row");
    const selectedFolder = document.querySelector('[role="treeitem"][aria-selected="true"]');
    const selectedFolderIndex = selectedFolder
      ? [...document.querySelectorAll('[role="treeitem"]')].indexOf(selectedFolder)
      : -1;
    const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
    const empty = !!document.querySelector([
      '[data-app-section="MessageList"] [data-testid*="empty" i]',
      '[data-testid="empty-folder"]',
      '[data-testid*="emptyFolder" i]',
      '[role="main"] [aria-label="Empty folder"]',
      '[role="main"] [aria-label="Carpeta vacía"]'
    ].join(", "));
    return {
      rows: rows.length,
      ids,
      folderIdentity: selectedFolder?.getAttribute("data-folder-id")
        || selectedFolder?.getAttribute("data-folder-name")
        || selectedFolder?.id
        || (selectedFolderIndex >= 0 ? `treeitem-${selectedFolderIndex}` : "")
        || "",
      tab: (selectedTab?.textContent || selectedTab?.getAttribute("aria-label") || "").trim(),
      hasList: !!document.querySelector('[data-testid="virtuoso-item-list"], [data-app-section="MessageList"]'),
      empty
    };
  });
}
