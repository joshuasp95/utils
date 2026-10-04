// outlook-row-flags.test.js — tests sin red ni navegador: detección de Pinned en filas de Outlook e isEmailInScope().
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
const functionSource = browserScript.match(
  /  function rowFlags\(aria\) \{[\s\S]*?\n  \}\n\n  function extractRow/
)?.[0].replace(/\n\n  function extractRow$/, "");

assert.ok(functionSource, "No se pudo localizar rowFlags() en el script autocontenido.");

const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
const rowFlags = Function("clean", `"use strict";\n${functionSource}\nreturn rowFlags;`)(clean);
const scopeSource = browserScript.match(
  /  function isEmailInScope\(email\) \{[\s\S]*?\n  \}\n\n  function scrollableAncestor/
)?.[0].replace(/\n\n  function scrollableAncestor$/, "");

assert.ok(scopeSource, "No se pudo localizar isEmailInScope() en el script autocontenido.");

function scopeWith(includePinnedOutsideRange) {
  const settings = { includePinnedOutsideRange };
  const cutoff = new Date("2026-07-25T00:00:00+02:00");
  const upperBound = new Date("2026-08-01T00:00:00+02:00");
  return Function(
    "SETTINGS",
    "cutoff",
    "upperBound",
    `"use strict";\n${scopeSource}\nreturn isEmailInScope;`
  )(settings, cutoff, upperBound);
}

test("reconoce Pinned después de Has attachments", () => {
  const result = rowFlags("Has attachments Pinned Example Sender Subject Wed 7/22 Preview");
  assert.equal(result.pinned, true);
  assert.equal(result.content, "Example Sender Subject Wed 7/22 Preview");
});

test("no confunde una fila normal con Pinned", () => {
  const result = rowFlags("Unread Example Sender Subject Today at 9:15 AM Preview");
  assert.equal(result.pinned, false);
  assert.equal(result.content, "Example Sender Subject Today at 9:15 AM Preview");
});

test("reconoce Pinned en una fila de Outlook en español", () => {
  const result = rowFlags("Tiene archivos adjuntos Anclado Remitente Asunto Hoy a las 9:15");
  assert.equal(result.pinned, true);
  assert.equal(result.content, "Remitente Asunto Hoy a las 9:15");
});

test("incluye Pinned fuera del intervalo por defecto", () => {
  const isEmailInScope = scopeWith(true);
  assert.equal(
    isEmailInScope({ pinned: true, timestamp: "2026-07-22T10:00:00.000Z" }),
    true
  );
  assert.equal(
    isEmailInScope({ pinned: false, timestamp: "2026-07-22T10:00:00.000Z" }),
    false
  );
});

test("range-only aplica el intervalo también a Pinned", () => {
  const isEmailInScope = scopeWith(false);
  assert.equal(
    isEmailInScope({ pinned: true, timestamp: "2026-07-22T10:00:00.000Z" }),
    false
  );
});
