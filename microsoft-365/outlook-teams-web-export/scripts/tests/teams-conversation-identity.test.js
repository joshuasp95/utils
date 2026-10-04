// teams-conversation-identity.test.js — tests sin red ni navegador: deduplicación Favorites/Chats en Teams (conversationIdentity).
// Uso: npm test (o node --test scripts/tests/*.test.js). Datos 100% ficticios. Efectos: ninguno.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const browserScript = await readFile(
  path.join(projectRoot, "scripts/teams/04-export-all-chats-to-today.js"),
  "utf8"
);
const functionSource = browserScript.match(
  /  function conversationIdentity\(rawKey, title\) \{[\s\S]*?\n  \}\n\n  function isFavoriteChat/
)?.[0].replace(/\n\n  function isFavoriteChat$/, "");

assert.ok(functionSource, "No se pudo localizar conversationIdentity() en el script autocontenido.");

const conversationIdentity = Function(
  `"use strict";\n${functionSource}\nreturn conversationIdentity;`
)();

test("deduplica la misma conversación entre Favorites y Chats", () => {
  const favorite = "ConversationFolder|tenant~Favorites/OneGQL_SelfChatConversation|48:notes";
  const regular = "ConversationFolder|tenant~Chats/OneGQL_SelfChatConversation|48:notes";
  assert.equal(conversationIdentity(favorite, "Notes"), conversationIdentity(regular, "Notes"));
});
