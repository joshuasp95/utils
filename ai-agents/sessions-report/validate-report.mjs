#!/usr/bin/env node
// validate-report.mjs — comprobaciones automáticas sobre el HTML generado por generate-report.mjs
//
// Qué hace:     Abre el informe y verifica que es un HTML completo, que tiene fichas de
//               Codex y Claude, filtros, el intervalo de fechas, que no contiene trazas de
//               error, instrucciones internas ni patrones habituales de secretos, y que el
//               JavaScript embebido compila.
// Requisitos:   Node.js >= 18.
// Uso:          node validate-report.mjs ./informe-sesiones-ia.html
//               node validate-report.mjs ./informe-sesiones-ia.html --expected-cards 131
// Variables:    $1 / REPORT_OUTPUT   ruta del HTML. Defecto: ./informe-sesiones-ia.html
//               --expected-cards N   (opcional) número exacto de fichas esperado; sin él solo
//                                    se exige que haya al menos una.
// Efectos:      SOLO LECTURA
// Salida:       Una línea "OK"/"ERROR" por comprobación. Código de salida 1 si alguna falla.

import fs from "node:fs";
import vm from "node:vm";

const argv = process.argv.slice(2);
const expectedIndex = argv.indexOf("--expected-cards");
const expectedCards = expectedIndex >= 0 ? Number(argv[expectedIndex + 1]) : null;
const positional = argv.filter((value, index) =>
  !value.startsWith("--") && !(expectedIndex >= 0 && index === expectedIndex + 1));
const file = positional[0] || process.env.REPORT_OUTPUT || "informe-sesiones-ia.html";
const html = fs.readFileSync(file, "utf8");
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const cards = html.match(/<article class="conversation"/g) || [];
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

check("Documento HTML5 completo", html.startsWith("<!doctype html>") && html.endsWith("</html>"));
check(expectedCards !== null ? `${expectedCards} fichas renderizadas` : "Al menos una ficha renderizada",
  expectedCards !== null ? cards.length === expectedCards : cards.length > 0);
check("Filtros presentes", html.includes('id="search"') && html.includes('id="project"'));
check("Contenido de Codex", html.includes('data-agent="codex"'));
check("Contenido de Claude", html.includes('data-agent="claude"'));
check("Intervalo de fechas en la cabecera", /<div class="eyebrow">Archivo personal · [^<]+ — [^<]+<\/div>/.test(html));
check("Sin apartado técnico eliminado", !html.includes("Tecnologías y artefactos citados"));
// Restos de consola que el generador debería haber filtrado
check("Sin trazas o bloques de error",
  !/Traceback|actionable tasks|npm ERR|BUILD FAILED|non-zero exit|opensslErrorStack|digital envelope routines/i.test(html));
check("Sin instrucciones internas", !/<environment_context>|<permissions instructions>|# AGENTS\.md instructions/i.test(html));
// AKIA… = clave AWS, sk-proj- = OpenAI, gh?_ = GitHub, glpat- = GitLab, PEM = clave privada
check("Sin patrones habituales de secretos",
  !/AKIA[0-9A-Z]{16}|sk-proj-|gh[pousr]_|glpat-|BEGIN [A-Z ]*PRIVATE KEY/.test(html));
// vm.Script compila el código sin ejecutarlo: detecta errores de sintaxis
check("JavaScript embebido válido", scripts.length === 1 && (() => {
  try { new vm.Script(scripts[0]); return true; } catch { return false; }
})());

const failed = checks.filter((item) => !item.ok);
for (const item of checks) process.stdout.write(`${item.ok ? "OK" : "ERROR"}  ${item.name}\n`);
if (failed.length) process.exitCode = 1;
