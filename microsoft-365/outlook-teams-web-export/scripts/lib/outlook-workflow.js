// outlook-workflow.js — lógica pura (sin navegador) del flujo de Outlook.
// Qué hace: valida cuentas, normaliza rutas de carpeta y pestañas (focused/other, también en
// español), construye rutas desde el árbol descubierto, resuelve carpetas pedidas y calcula
// rutas de perfil y de salida (<tenant>/<AAAA-MM>/<carpeta>-<hash8>/<pestaña>). Efectos: ninguno.
import { createHash } from "node:crypto";
import path from "node:path";

import { OUTLOOK_ACCOUNTS } from "../config/outlook-accounts.js";

const TAB_ALIASES = new Map([
  ["focused", "focused"],
  ["prioritarios", "focused"],
  ["prioritario", "focused"],
  ["other", "other"],
  ["otros", "other"],
  ["otro", "other"]
]);

export function validateOutlookAccounts(accounts = OUTLOOK_ACCOUNTS) {
  const ids = new Set();
  const emails = new Set();
  for (const account of accounts) {
    if (!/^[a-z][a-z0-9-]*$/.test(account.id)) {
      throw new Error(`Identificador de cuenta no válido: ${account.id}`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) {
      throw new Error(`Correo configurado no válido para ${account.id}.`);
    }
    const email = account.email.toLowerCase();
    if (ids.has(account.id) || emails.has(email)) {
      throw new Error(`Cuenta de Outlook duplicada: ${account.id}.`);
    }
    ids.add(account.id);
    emails.add(email);
  }
  return accounts;
}

export function accountById(id, accounts = OUTLOOK_ACCOUNTS) {
  const normalized = String(id || "").trim().toLowerCase();
  const account = accounts.find((candidate) => candidate.id === normalized);
  if (!account) {
    throw new Error(`Cuenta desconocida: ${id}. Usa: ${accounts.map((candidate) => candidate.id).join(", ")}.`);
  }
  return account;
}

export function exactVisibleEmail(value, expectedEmail) {
  return String(value || "").trim().toLowerCase() === String(expectedEmail || "").trim().toLowerCase();
}

export function splitList(value) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
}

export function normalizeFolderPath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || /[\u0000-\u001f]/.test(raw)) throw new Error("Ruta de carpeta vacía o no válida.");
  const segments = raw.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Ruta de carpeta no válida: ${value}.`);
  }
  return segments.join("/");
}

export function normalizeFolderRequests(values) {
  const unique = new Map();
  for (const value of values.flatMap(splitList)) {
    const normalized = normalizeFolderPath(value);
    unique.set(normalized.toLocaleLowerCase(), normalized);
  }
  return [...unique.values()];
}

export function normalizeTabs(values) {
  const requested = values.flatMap(splitList);
  const normalized = [];
  for (const value of requested) {
    const tab = TAB_ALIASES.get(value.toLocaleLowerCase());
    if (!tab) throw new Error(`Pestaña de Outlook no válida: ${value}. Usa focused u other.`);
    if (!normalized.includes(tab)) normalized.push(tab);
  }
  return normalized;
}

export function tabFromVisibleLabel(label) {
  return TAB_ALIASES.get(String(label || "").trim().toLocaleLowerCase()) || null;
}

export function buildFolderPaths(items) {
  const stack = [];
  const folders = [];
  let excludedLevel = null;
  for (const item of items) {
    const level = Math.max(1, Number(item.level) || 1);
    if (excludedLevel !== null && level <= excludedLevel) excludedLevel = null;
    if (item.excluded) {
      excludedLevel = level;
      continue;
    }
    if (excludedLevel !== null && level > excludedLevel) continue;
    if (!item.folder) continue;
    stack.length = level - 1;
    stack[level - 1] = String(item.name || "").trim();
    const segments = stack.filter(Boolean);
    if (!segments.length) continue;
    folders.push({ ...item, name: segments.at(-1), path: segments.join("/") });
  }
  return folders;
}

export function resolveFolderRequests(discoveredFolders, requestedPaths) {
  return requestedPaths.map((requestedPath) => {
    const requested = normalizeFolderPath(requestedPath);
    const lower = requested.toLocaleLowerCase();
    const exact = discoveredFolders.filter((folder) => folder.path.toLocaleLowerCase() === lower);
    if (exact.length === 1) return exact[0];
    const leaf = discoveredFolders.filter((folder) => folder.name.toLocaleLowerCase() === lower);
    if (leaf.length === 1) return leaf[0];
    if (exact.length > 1 || leaf.length > 1) {
      const matches = [...exact, ...leaf].map((folder) => folder.path).join(", ");
      throw new Error(`Carpeta ambigua "${requested}". Usa una ruta completa: ${matches}.`);
    }
    throw new Error(`Carpeta no encontrada: ${requested}. Ejecuta --discover-folders para listar rutas.`);
  });
}

export function safeOutputSegment(value, maxLength = 90) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, maxLength) || "unknown";
}

export function outlookProfilePath(projectRoot, accountId, explicitProfileRoot = null) {
  const root = explicitProfileRoot || path.join(projectRoot, ".playwright-profile");
  return path.join(root, "outlook", accountById(accountId).id);
}

export function outlookFolderOutputSegment(folderPath) {
  const normalizedPath = normalizeFolderPath(folderPath);
  const pathHash = createHash("sha256").update(normalizedPath.toLocaleLowerCase()).digest("hex").slice(0, 8);
  return `${safeOutputSegment(normalizedPath, 64)}-${pathHash}`;
}

export function outlookOutputIdentity(account, folderPath, tab) {
  return [
    safeOutputSegment(account.id),
    outlookFolderOutputSegment(folderPath),
    safeOutputSegment(tab)
  ].join("--");
}

export function outlookViewOutputDirectory(baseDirectory, account, since, folderPath, tab) {
  const month = String(since || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Fecha de salida de Outlook no válida.");
  return path.join(
    baseDirectory,
    safeOutputSegment(accountById(account.id).id),
    month,
    outlookFolderOutputSegment(folderPath),
    safeOutputSegment(tab)
  );
}

export async function executeViewPlan(views, worker) {
  const results = [];
  for (const view of views) {
    try {
      const result = await worker(view);
      results.push({ view, status: result?.status || "completed", result });
    } catch (error) {
      results.push({ view, status: "failed", error: String(error?.message || error) });
    }
  }
  return results;
}

validateOutlookAccounts();
