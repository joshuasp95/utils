// check-syntax.js — ejecuta `node --check` sobre todos los .js de scripts/.
//
// Qué hace:     Recorre scripts/ recursivamente y valida la sintaxis de cada fichero .js.
// Requisitos:   Node.js 20+.
// Uso:          npm run check   (también lo lanza `npm test`)
// Variables:    —
// Efectos:      SOLO LECTURA.
// Salida:       "OK <fichero>" por cada script y el total; código de salida != 0 si alguno falla.
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptRoot = path.join(projectRoot, "scripts");

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
  return files;
}

const files = (await javascriptFiles(scriptRoot)).sort();
for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  console.log(`OK ${path.relative(projectRoot, file)}`);
}
console.log(`${files.length} scripts validados.`);
