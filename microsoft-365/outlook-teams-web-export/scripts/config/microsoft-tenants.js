// microsoft-tenants.js — carga la lista de tenants/cuentas de Microsoft 365 desde un JSON local.
//
// Qué hace:     Lee el fichero de configuración local (por defecto `config.local.json` en la raíz
//               de la herramienta) y expone MICROSOFT_TENANTS y OUTLOOK_ACCOUNTS. En el repo NO
//               hay tenants ni correos reales: solo `config.example.json` con placeholders.
// Requisitos:   Node.js 20+.
// Uso:          import { MICROSOFT_TENANTS } from "./config/microsoft-tenants.js";
// Variables:    M365_WEB_EXPORT_CONFIG  (opcional) ruta a otro JSON de configuración. Si se
//               define y el fichero no existe, se lanza un error. Sin ella se usa
//               <raíz>/config.local.json; si tampoco existe, la lista queda vacía y el lanzador
//               se detiene con un mensaje que explica cómo crearla.
// Efectos:      SOLO LECTURA (lee el JSON local).
// Salida:       Arrays congelados (Object.freeze) de { id, name, email, applications }.
//
// Formato del JSON (ver config.example.json):
//   { "tenants": [ { "id": "empresa", "name": "Empresa", "email": "usuario@empresa.example",
//                    "applications": ["teams", "outlook"] } ] }
// No guardes contraseñas, tokens ni cookies: la sesión vive en el perfil persistente de Playwright.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_CONFIG_PATH = path.join(toolRoot, "config.local.json");
export const CONFIG_PATH = process.env.M365_WEB_EXPORT_CONFIG
  ? path.resolve(process.env.M365_WEB_EXPORT_CONFIG)
  : DEFAULT_CONFIG_PATH;

function loadTenants(file) {
  if (!existsSync(file)) {
    if (process.env.M365_WEB_EXPORT_CONFIG) {
      throw new Error(`M365_WEB_EXPORT_CONFIG apunta a un fichero inexistente: ${file}`);
    }
    return [];
  }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  // Se acepta { "tenants": [...] } o directamente un array.
  const list = Array.isArray(parsed) ? parsed : parsed?.tenants;
  if (!Array.isArray(list)) {
    throw new Error(`La configuración ${file} debe contener "tenants": [ ... ].`);
  }
  return list.map((tenant) => Object.freeze({
    id: String(tenant?.id || ""),
    name: String(tenant?.name || tenant?.id || ""),
    email: String(tenant?.email || ""),
    applications: Object.freeze(Array.isArray(tenant?.applications) ? [...tenant.applications] : [])
  }));
}

export const MICROSOFT_TENANTS = Object.freeze(loadTenants(CONFIG_PATH));

export const OUTLOOK_ACCOUNTS = Object.freeze(
  MICROSOFT_TENANTS.filter((tenant) => tenant.applications.includes("outlook"))
);
