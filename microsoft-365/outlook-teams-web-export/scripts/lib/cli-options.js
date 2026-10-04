// cli-options.js — parseo de flags del lanzador y cálculo del intervalo [since, until).
// Qué hace: valida --target/--days/--since/--until/--tenant(s)/--folder(s)/--tabs/... y devuelve
// un objeto de opciones; extractionRange() calcula el rango por defecto (últimos N días naturales,
// fin exclusivo = mañana 00:00 local). Efectos: SOLO LECTURA.
import path from "node:path";

import { MICROSOFT_TENANTS } from "../config/microsoft-tenants.js";
import {
  accountById,
  normalizeFolderPath,
  normalizeFolderRequests,
  normalizeTabs
} from "./outlook-workflow.js";
import { normalizeTenantIds } from "./tenant-workflow.js";

export class CliUsageError extends Error {}

export function usageText() {
  const tenantIds = MICROSOFT_TENANTS.map((tenant) => tenant.id).join(", ");
  return `
Uso:
  npm run extract:all -- --days 7
  npm run extract:teams -- --tenants empresa,cliente --days 7
  npm run extract:outlook -- --days 7
  npm run extract:outlook -- --tenant cliente --folders Inbox,Archive --tabs focused,other --days 7

Opciones generales:
  --target all|teams|outlook   Origen a extraer (por defecto: all)
  --days N                    Días naturales, incluyendo hoy (por defecto: 7)
  --since ISO                 Inicio inclusivo; prevalece sobre --days
  --until ISO                 Fin exclusivo; por defecto, mañana 00:00 local
  --headless                  Ejecuta sin interfaz si la sesión ya existe
  --yes                       Confirma automáticamente; no elige cuenta/carpetas por posición
  --timeout-minutes N         Límite por extractor (por defecto: 180)
  --profile RUTA              Raíz alternativa de perfiles persistentes
  --tenant ID                 Tenant literal; repetible
  --tenants A,B               Uno o varios tenants: ${tenantIds}
  --account ID                Alias compatible de --tenant para Outlook

Opciones de Outlook:
  --folder RUTA               Ruta literal de carpeta; repetible y admite comas
  --folders A,B               Lista simple de carpetas separadas por comas
  --tabs focused,other        Pestañas a recorrer
  --discover-folders          Solo inicia sesión y lista carpetas disponibles
  --interactive               Fuerza el asistente aunque haya argumentos completos
  --account-label TEXTO       Etiqueta heredada; la cuenta conocida siempre prevalece
  --include-html              Incluye HTML de los correos
  --range-only                Excluye Pinned de Outlook fuera del intervalo
`;
}

function requiredValue(argv, index, argument) {
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) throw new CliUsageError(`Falta un valor para ${argument}.`);
  return next;
}

export function parseArguments(argv, { projectRoot }) {
  const options = {
    target: "all",
    days: 7,
    since: null,
    until: null,
    account: null,
    tenants: [],
    folders: [],
    tabs: [],
    discoverFolders: false,
    interactive: false,
    accountLabel: "",
    includeHtml: false,
    includePinnedOutsideRange: true,
    headless: false,
    yes: false,
    timeoutMinutes: 180,
    profile: path.join(projectRoot, ".playwright-profile"),
    help: false
  };
  const literalFolderValues = [];
  const listedFolderValues = [];
  const tabValues = [];
  const tenantValues = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const next = requiredValue(argv, index, argument);
      index += 1;
      return next;
    };
    if (argument === "--target") options.target = take();
    else if (argument === "--days") options.days = Number(take());
    else if (argument === "--since") options.since = take();
    else if (argument === "--until") options.until = take();
    else if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--tenant") tenantValues.push(take());
    else if (argument === "--tenants") tenantValues.push(take());
    else if (argument === "--folder") literalFolderValues.push(take());
    else if (argument === "--folders") listedFolderValues.push(take());
    else if (argument === "--tabs") tabValues.push(...take().split(","));
    else if (argument === "--account-label") options.accountLabel = take();
    else if (argument === "--timeout-minutes") options.timeoutMinutes = Number(take());
    else if (argument === "--profile") {
      options.profile = path.resolve(take());
    } else if (argument === "--include-html") options.includeHtml = true;
    else if (argument === "--range-only") options.includePinnedOutsideRange = false;
    else if (argument === "--discover-folders") options.discoverFolders = true;
    else if (argument === "--interactive") options.interactive = true;
    else if (argument === "--headless") options.headless = true;
    else if (argument === "--yes") options.yes = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new CliUsageError(`Opción desconocida: ${argument}`);
  }
  if (!["all", "teams", "outlook"].includes(options.target)) {
    throw new CliUsageError("--target debe ser all, teams u outlook.");
  }
  if (!Number.isInteger(options.days) || options.days < 1) {
    throw new CliUsageError("--days debe ser un entero positivo.");
  }
  if (!Number.isFinite(options.timeoutMinutes) || options.timeoutMinutes <= 0) {
    throw new CliUsageError("--timeout-minutes debe ser un número positivo.");
  }
  if (options.account && tenantValues.length) {
    throw new CliUsageError("No combines --account con --tenant/--tenants; representan la misma selección.");
  }
  if (options.account) accountById(options.account);
  options.tenants = normalizeTenantIds(options.account ? [options.account] : tenantValues);
  options.folders = [...new Map([
    ...literalFolderValues.map(normalizeFolderPath),
    ...normalizeFolderRequests(listedFolderValues)
  ].map((folder) => [folder.toLocaleLowerCase(), folder])).values()];
  options.tabs = normalizeTabs(tabValues);
  if (options.headless && !options.tenants.length) {
    throw new CliUsageError("--headless requiere --tenant o --tenants para no elegir por posición.");
  }
  if (options.headless && options.target !== "teams" && !options.discoverFolders
    && (!options.folders.length || !options.tabs.length)) {
    throw new CliUsageError("--headless requiere --folders/--folder y --tabs, salvo con --discover-folders.");
  }
  return options;
}

function localIso(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const pad = (number) => String(Math.abs(number)).padStart(2, "0");
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 19);
  return `${local}${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

export function extractionRange(options, now = new Date()) {
  const defaultUntil = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const defaultSince = new Date(now.getFullYear(), now.getMonth(), now.getDate() - options.days + 1);
  const since = new Date(options.since || localIso(defaultSince));
  const until = new Date(options.until || localIso(defaultUntil));
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) {
    throw new CliUsageError("Intervalo inválido: since debe ser anterior a until.");
  }
  return {
    since: options.since || localIso(defaultSince),
    until: options.until || localIso(defaultUntil)
  };
}
