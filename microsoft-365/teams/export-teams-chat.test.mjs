// export-teams-chat.test.mjs — Tests (node:test) de export-teams-chat.mjs. Sin red: fetch se simula.
// Uso: node --test export-teams-chat.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  bodyText,
  chatIdFromInput,
  fetchAllPages,
  renderCsv,
  writePrivateFile,
} from "./export-teams-chat.mjs";

test("extrae chatId de un enlace de Teams", () => {
  assert.equal(
    chatIdFromInput("https://teams.microsoft.com/l/message/x?chatId=19%3Aabc%40thread.v2"),
    "19:abc@thread.v2",
  );
});

test("convierte el cuerpo HTML a texto", () => {
  assert.equal(
    bodyText({ body: { contentType: "html", content: "<p>Hola &amp; adiós</p><div>Línea 2<br>fin</div>" } }),
    "Hola & adiós\nLínea 2\nfin",
  );
});

test("escapa correctamente CSV", () => {
  const csv = renderCsv([{
    id: "1",
    createdDateTime: "2026-01-01T00:00:00Z",
    body: { contentType: "text", content: "uno, \"dos\"\ntres" },
    from: { user: { id: "u1", displayName: "Persona" } },
  }]);
  assert.match(csv, /"uno, ""dos""\ntres"/);
});

test("recorre @odata.nextLink", async () => {
  const originalFetch = globalThis.fetch;
  const pages = new Map([
    ["https://example.test/1", { value: [{ id: "2" }], "@odata.nextLink": "https://example.test/2" }],
    ["https://example.test/2", { value: [{ id: "1" }] }],
  ]);
  globalThis.fetch = async (url) => new Response(JSON.stringify(pages.get(url)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const values = await fetchAllPages("https://example.test/1", "token-falso", 0, "Prueba");
    assert.deepEqual(values.map(({ id }) => id), ["2", "1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("escribe con modo privado y no sobrescribe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "teams-export-test-"));
  const path = join(directory, "chat.json");
  try {
    await writePrivateFile(path, "primero\n");
    await assert.rejects(() => writePrivateFile(path, "segundo\n"), { code: "EEXIST" });
    assert.equal(await readFile(path, "utf8"), "primero\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
