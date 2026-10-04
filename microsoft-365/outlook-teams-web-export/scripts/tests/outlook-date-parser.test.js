// outlook-date-parser.test.js — tests sin red ni navegador: parser de fechas de Outlook (toDate) en inglés y español.
// Uso: npm test (o node --test scripts/tests/*.test.js). Datos 100% ficticios. Efectos: ninguno.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const browserScript = await readFile(
  path.join(projectRoot, "scripts/outlook/02-export-folder-bodies.js"),
  "utf8"
);
const parserSource = browserScript.match(
  /  function toDate\(str\) \{[\s\S]*?\n  \}\n\n  function timestampFragment/
)?.[0].replace(/\n\n  function timestampFragment$/, "");

assert.ok(parserSource, "No se pudo localizar toDate() en el script autocontenido.");

function parserAt(now, dayFirst = false) {
  return Function("now", "dayFirst", `"use strict";\n${parserSource}\nreturn toDate;`)(now, dayFirst);
}

function localParts(date) {
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ];
}

test("interpreta la fecha abreviada observada en Outlook", () => {
  const parse = parserAt(new Date(2026, 6, 30, 17));
  assert.deepEqual(localParts(parse("Wed 7/22")), [2026, 7, 22, 0, 0]);
});

test("interpreta fecha abreviada con hora", () => {
  const parse = parserAt(new Date(2026, 6, 30, 17));
  assert.deepEqual(localParts(parse("Thu 7/30 3:45 PM")), [2026, 7, 30, 15, 45]);
});

test("interpreta Today y Yesterday", () => {
  const parse = parserAt(new Date(2026, 6, 30, 17));
  assert.deepEqual(localParts(parse("Today at 9:15 AM")), [2026, 7, 30, 9, 15]);
  assert.deepEqual(localParts(parse("Yesterday at 11:20 PM")), [2026, 7, 29, 23, 20]);
});

test("interpreta fecha completa e ISO", () => {
  const parse = parserAt(new Date(2026, 6, 30, 17));
  assert.deepEqual(localParts(parse("7/24/2026 8:05 AM")), [2026, 7, 24, 8, 5]);
  assert.equal(parse("2026-07-24T06:05:00.000Z").toISOString(), "2026-07-24T06:05:00.000Z");
});

test("infiere el año anterior al cruzar enero", () => {
  const parse = parserAt(new Date(2027, 0, 2, 12));
  assert.deepEqual(localParts(parse("Thu 12/31")), [2026, 12, 31, 0, 0]);
});

test("interpreta fechas relativas y D/M en interfaz española", () => {
  const parse = parserAt(new Date(2026, 6, 30, 17), true);
  assert.deepEqual(localParts(parse("Hoy a las 9:15")), [2026, 7, 30, 9, 15]);
  assert.deepEqual(localParts(parse("Ayer a las 23:20")), [2026, 7, 29, 23, 20]);
  assert.deepEqual(localParts(parse("30/07/2026 08:05")), [2026, 7, 30, 8, 5]);
});
