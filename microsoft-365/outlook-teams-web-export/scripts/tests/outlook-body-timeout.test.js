// outlook-body-timeout.test.js — tests sin red ni navegador: waitForBody() de 02-export-folder-bodies.js no reutiliza el cuerpo anterior si el panel no cambia.
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
const waitSource = browserScript.match(
  /  async function waitForBody\(previousPaneSig\) \{[\s\S]*?\n  \}\n\n  function folderLabel/
)?.[0].replace(/\n\n  function folderLabel$/, "");

assert.ok(waitSource, "No se pudo localizar waitForBody() en el script autocontenido.");

function createWaitForBody({ timeoutMs, subject, body }) {
  return Function(
    "SETTINGS",
    "readingBodyNode",
    "readingSubject",
    "clean",
    "paneSig",
    "sleep",
    `"use strict";\n${waitSource}\nreturn waitForBody;`
  )(
    { clickTimeoutMs: timeoutMs, clickWaitMs: 0 },
    () => ({ innerText: body }),
    () => subject,
    (value) => String(value || "").replace(/\s+/g, " ").trim(),
    (currentSubject, currentBody) => `${currentSubject}|${currentBody}`,
    async () => undefined
  );
}

test("un timeout del panel no devuelve el cuerpo anterior", async () => {
  const waitForBody = createWaitForBody({ timeoutMs: 0, subject: "Anterior", body: "Cuerpo anterior" });
  assert.deepEqual(await waitForBody("Anterior|Cuerpo anterior"), {
    node: null,
    text: null,
    subject: null,
    timedOut: true
  });
});

test("acepta el panel cuando cambia asunto o cuerpo", async () => {
  const waitForBody = createWaitForBody({ timeoutMs: 50, subject: "Nuevo", body: "Cuerpo" });
  const result = await waitForBody("Anterior|Cuerpo");
  assert.equal(result.timedOut, undefined);
  assert.equal(result.subject, "Nuevo");
  assert.equal(result.text, "Cuerpo");
});
