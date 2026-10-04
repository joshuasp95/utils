// import-export.js — archiva en data/ un JSON/TXT descargado manualmente desde la consola del navegador.
//
// Qué hace:     Copia (no mueve) cada fichero a data/<teams|outlook>-exports/raw/..., deduciendo
//               el mes y el día de la primera fecha AAAA-MM-DD que aparezca en el nombre.
// Requisitos:   Node.js 20+. Con --tenant, config.local.json con ese tenant.
// Uso:          npm run teams:import -- --tenant empresa ~/Downloads/teams-empresa-all-chats-2026-01-01-to-2026-01-08.json
//               npm run outlook:import -- ~/Downloads/Inbox-since-2026-01-01-to-2026-01-08.txt
// Variables:    <teams|outlook> origen (primer argumento); --tenant ID (opcional) agrupa por tenant;
//               resto de argumentos: ficheros .json o .txt.
// Efectos:      ESCRIBE copias 0600 en data/ (directorios 0700). No borra los originales.
// Salida:       data/<origen>-exports/raw/<tenant>/<AAAA-MM>/manual/<DD>-<nombre>  (con --tenant)
//               data/<origen>-exports/raw/<AAAA-MM>/<DD>-<nombre>                 (sin --tenant)
//               "sin-fecha" como mes si el nombre no contiene fecha.
import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { tenantById } from "./lib/tenant-workflow.js";

const supportedSources = new Set(["teams", "outlook"]);
const [, , source, ...sourceArguments] = process.argv;
let tenantId = null;
const inputArguments = [];
for (let index = 0; index < sourceArguments.length; index += 1) {
  const argument = sourceArguments[index];
  if (argument === "--tenant") {
    const value = sourceArguments[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Falta un valor para --tenant.");
    tenantId = tenantById(value).id;
    index += 1;
  } else if (argument.startsWith("--")) {
    throw new Error(`Opción de importación desconocida: ${argument}.`);
  } else {
    inputArguments.push(argument);
  }
}

// Los scripts de navegador incrustan la fecha de inicio del rango en el nombre
// (p. ej. "...-since-2026-07-31..." o "...-2026-07-31-to-2026-08-01..."); se
// reutiliza para agrupar igual que las exportaciones de Playwright.
function monthAndDayFromFilename(filename) {
  const match = filename.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) return null;
  return { month: match[0].slice(0, 7), day: match[0].slice(8, 10) };
}

if (!supportedSources.has(source) || inputArguments.length === 0) {
  console.error("Uso: node scripts/import-export.js <teams|outlook> [--tenant ID] <archivo.txt|archivo.json> [...]");
  process.exitCode = 1;
} else {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const base = path.join(projectRoot, "data", `${source}-exports`, "raw");

  for (const sourceArgument of inputArguments) {
    const input = path.resolve(sourceArgument);
    const extension = path.extname(input).toLowerCase();
    if (![".txt", ".json"].includes(extension)) {
      console.error(`Omitido (solo .txt o .json): ${input}`);
      process.exitCode = 1;
      continue;
    }

    try {
      const info = await stat(input);
      if (!info.isFile()) throw new Error("no es un archivo");
      const inputName = path.basename(input);
      const parsed = monthAndDayFromFilename(inputName);
      const dateDirectory = parsed?.month || "sin-fecha";
      const destination = tenantId
        ? path.join(base, tenantId, dateDirectory, "manual")
        : path.join(base, dateDirectory);
      await mkdir(destination, { recursive: true, mode: 0o700 });
      await chmod(destination, 0o700);
      const outputName = parsed ? `${parsed.day}-${inputName}` : inputName;
      const target = path.join(destination, outputName);
      await copyFile(input, target);
      await chmod(target, 0o600);
      console.log(`Copiado: ${target}`);
    } catch (error) {
      console.error(`No se pudo importar ${input}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
