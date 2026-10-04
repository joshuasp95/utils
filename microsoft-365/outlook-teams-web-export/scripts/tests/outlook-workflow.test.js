// outlook-workflow.test.js — tests sin red ni navegador: flags del CLI, identidad exacta, carpetas, pestañas y rutas de salida de Outlook.
// Uso: npm test (o node --test scripts/tests/*.test.js). Datos 100% ficticios. Efectos: ninguno.
import "./use-test-config.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseArguments } from "../lib/cli-options.js";
import { selectConfiguredMicrosoftAccount, visibleConfiguredIdentity } from "../lib/outlook-browser.js";
import {
  accountById,
  buildFolderPaths,
  exactVisibleEmail,
  executeViewPlan,
  normalizeFolderPath,
  normalizeFolderRequests,
  normalizeTabs,
  outlookOutputIdentity,
  outlookProfilePath,
  outlookViewOutputDirectory,
  resolveFolderRequests,
  tabFromVisibleLabel
} from "../lib/outlook-workflow.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = JSON.parse(await readFile(
  path.join(projectRoot, "scripts/tests/fixtures/outlook-folders.json"),
  "utf8"
));

test("parsea cuenta, varias carpetas, pestañas y opciones heredadas", () => {
  const options = parseArguments([
    "--target", "outlook",
    "--account", "beta",
    "--folder", "Projects/Reports",
    "--folders", "Inbox,team-requests",
    "--tabs", "focused,other",
    "--account-label", "legacy",
    "--days", "7",
    "--yes"
  ], { projectRoot });
  assert.equal(options.account, "beta");
  assert.deepEqual(options.tenants, ["beta"]);
  assert.deepEqual(options.folders, ["Projects/Reports", "Inbox", "team-requests"]);
  assert.deepEqual(options.tabs, ["focused", "other"]);
  assert.equal(options.accountLabel, "legacy");
  assert.equal(options.yes, true);
});

test("--folder conserva comas literales y parsea modos interactivo y descubrimiento", () => {
  const options = parseArguments([
    "--account", "gamma",
    "--folder", "Projects/Reports, Europe",
    "--discover-folders",
    "--interactive"
  ], { projectRoot });
  assert.deepEqual(options.folders, ["Projects/Reports, Europe"]);
  assert.equal(options.discoverFolders, true);
  assert.equal(options.interactive, true);
});

test("headless exige una selección no interactiva completa", () => {
  assert.throws(() => parseArguments(["--headless"], { projectRoot }), /requiere --tenant/);
  assert.throws(
    () => parseArguments(["--headless", "--account", "beta"], { projectRoot }),
    /requiere --folders/
  );
  assert.doesNotThrow(() => parseArguments([
    "--headless", "--account", "beta", "--folders", "Inbox", "--tabs", "focused"
  ], { projectRoot }));
  assert.doesNotThrow(() => parseArguments([
    "--headless", "--target", "teams", "--tenants", "alpha,beta"
  ], { projectRoot }));
});

test("parsea uno o varios tenants y rechaza combinar el alias account", () => {
  const options = parseArguments([
    "--target", "teams", "--tenant", "alpha", "--tenants", "beta,alpha"
  ], { projectRoot });
  assert.deepEqual(options.tenants, ["alpha", "beta"]);
  assert.throws(
    () => parseArguments(["--account", "beta", "--tenant", "alpha"], { projectRoot }),
    /No combines --account/
  );
  assert.throws(
    () => parseArguments(["--tenants", "personal"], { projectRoot }),
    /Tenant desconocido/
  );
});

test("rechaza cuentas y pestañas no configuradas", () => {
  assert.throws(
    () => parseArguments(["--account", "personal"], { projectRoot }),
    /Cuenta desconocida/
  );
  assert.throws(
    () => parseArguments(["--tabs", "archive"], { projectRoot }),
    /Pestaña de Outlook no válida/
  );
});

test("selecciona la identidad por correo exacto, no por subcadena", () => {
  const account = accountById("gamma");
  assert.equal(exactVisibleEmail("alice.ext@gamma.example", account.email), true);
  assert.equal(exactVisibleEmail(`Otra ${account.email}`, account.email), false);
  assert.equal(exactVisibleEmail("alice.example@beta.example", account.email), false);
  assert.equal(accountById("alpha").email, "alice@alpha.example");
});

test("el selector de Pick an account solicita coincidencia exacta", async () => {
  const account = accountById("beta");
  let requested;
  let clicked = false;
  const page = {
    getByText(value, options) {
      requested = { value, options };
      return {
        count: async () => 1,
        nth: () => ({
          isVisible: async () => true,
          locator: () => ({ count: async () => 1, click: async () => { clicked = true; } }),
          click: async () => { clicked = true; }
        }),
        first: () => ({
          locator: () => ({ count: async () => 1, click: async () => { clicked = true; } }),
          click: async () => { clicked = true; }
        })
      };
    }
  };
  assert.equal(await selectConfiguredMicrosoftAccount(page, account), true);
  assert.deepEqual(requested, { value: account.email, options: { exact: true } });
  assert.equal(clicked, true);
});

test("rechaza una identidad visible distinta de la solicitada", async () => {
  const page = {
    locator: () => ({
      evaluateAll: async () => ["Cuenta alice.example@beta.example"]
    })
  };
  assert.equal(await visibleConfiguredIdentity(page, accountById("gamma")), false);
  assert.equal(await visibleConfiguredIdentity(page, accountById("beta")), true);
});

test("normaliza rutas y selección múltiple", () => {
  assert.equal(normalizeFolderPath(" Projects \\ Reports "), "Projects/Reports");
  assert.deepEqual(
    normalizeFolderRequests(["Inbox,team-requests", "Inbox"]),
    ["Inbox", "team-requests"]
  );
  assert.throws(() => normalizeFolderPath("Projects/../Inbox"), /no válida/);
});

test("resuelve Inbox, team-requests y rutas anidadas desde fixtures", () => {
  const folders = buildFolderPaths(fixtures.english);
  assert.equal(folders.some((folder) => folder.stableId === "favorite-inbox"), false);
  assert.deepEqual(
    resolveFolderRequests(folders, ["Inbox", "team-requests", "Projects/Reports"])
      .map((folder) => folder.path),
    ["Inbox", "team-requests", "Projects/Reports"]
  );
});

test("exige ruta completa para nombres duplicados", () => {
  const folders = buildFolderPaths(fixtures.english);
  assert.throws(() => resolveFolderRequests(folders, ["Reports"]), /Carpeta ambigua/);
  assert.equal(resolveFolderRequests(folders, ["Archive/Reports"])[0].stableId, "archive-reports");
});

test("admite etiquetas de pestaña inglesas y españolas", () => {
  assert.deepEqual(normalizeTabs(["focused,other"]), ["focused", "other"]);
  assert.equal(tabFromVisibleLabel("Prioritarios"), "focused");
  assert.equal(tabFromVisibleLabel("Otros"), "other");
  assert.equal(buildFolderPaths(fixtures.spanish)[1].path, "Proyectos");
});

test("separa perfiles y nombres de salida por tenant", () => {
  const alpha = accountById("alpha");
  const beta = accountById("beta");
  const gamma = accountById("gamma");
  assert.match(outlookProfilePath(projectRoot, alpha.id), /outlook\/alpha$/);
  assert.match(outlookProfilePath(projectRoot, beta.id), /outlook\/beta$/);
  assert.match(outlookProfilePath(projectRoot, gamma.id), /outlook\/gamma$/);
  assert.match(outlookProfilePath(projectRoot, beta.id, "/tmp/profiles"), /^\/tmp\/profiles\/outlook\/beta$/);
  assert.notEqual(
    outlookOutputIdentity(beta, "Inbox", "focused"),
    outlookOutputIdentity(gamma, "Inbox", "focused")
  );
  assert.notEqual(
    outlookOutputIdentity(alpha, "Inbox", "focused"),
    outlookOutputIdentity(beta, "Inbox", "focused")
  );
  assert.match(
    outlookOutputIdentity(beta, "team-requests", "other"),
    /^beta--team-requests-[a-f0-9]{8}--other$/
  );
  const longPrefix = `Projects/${"repeated-".repeat(15)}`;
  assert.notEqual(
    outlookOutputIdentity(beta, `${longPrefix}Europe`, "focused"),
    outlookOutputIdentity(beta, `${longPrefix}Asia`, "focused")
  );
});

test("organiza salidas por tenant, mes, carpeta y pestaña", () => {
  const base = path.join(projectRoot, "data/outlook-exports/raw");
  const alpha = outlookViewOutputDirectory(
    base,
    accountById("alpha"),
    "2026-08-03T00:00:00+02:00",
    "Projects/Reports",
    "focused"
  );
  assert.match(alpha, /raw\/alpha\/2026-08\/Projects-Reports-[a-f0-9]{8}\/focused$/i);
  assert.notEqual(
    alpha,
    outlookViewOutputDirectory(
      base,
      accountById("beta"),
      "2026-08-03T00:00:00+02:00",
      "Projects/Reports",
      "focused"
    )
  );
});

test("account-label sigue aceptado pero no sustituye la identidad conocida", () => {
  const options = parseArguments([
    "--account", "beta", "--account-label", "legacy-label"
  ], { projectRoot });
  assert.equal(options.accountLabel, "legacy-label");
  assert.match(outlookOutputIdentity(accountById(options.account), "Inbox", "focused"), /^beta-/);
});

test("continúa cuando falla una carpeta y conserva el resto", async () => {
  const views = [
    { folder: "Inbox" },
    { folder: "team-requests" },
    { folder: "Projects/Reports" }
  ];
  const results = await executeViewPlan(views, async (view) => {
    if (view.folder === "team-requests") throw new Error("DOM changed");
    return { status: "completed", count: 2 };
  });
  assert.deepEqual(results.map((result) => result.status), ["completed", "failed", "completed"]);
});
