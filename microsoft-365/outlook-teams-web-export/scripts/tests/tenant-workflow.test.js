// tenant-workflow.test.js — tests sin red ni navegador: selección de tenants, perfiles, salidas y matriz tenant × aplicación.
// Uso: npm test (o node --test scripts/tests/*.test.js). Datos 100% ficticios. Efectos: ninguno.
import "./use-test-config.js";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  executeTenantPlan,
  normalizeTenantIds,
  tenantById,
  tenantOutputDirectory,
  tenantProfilePath,
  tenantSupports,
  tenantsForSources
} from "../lib/tenant-workflow.js";

test("configura Teams y Outlook por tenant sin asumir Teams en gamma", () => {
  assert.equal(tenantSupports(tenantById("alpha"), "teams"), true);
  assert.equal(tenantSupports(tenantById("beta"), "teams"), true);
  assert.equal(tenantSupports(tenantById("gamma"), "teams"), false);
  assert.deepEqual(
    tenantsForSources(["teams"]).map((tenant) => tenant.id),
    ["alpha", "beta"]
  );
});

test("normaliza y deduplica selecciones múltiples", () => {
  assert.deepEqual(
    normalizeTenantIds(["alpha,beta", "alpha"]),
    ["alpha", "beta"]
  );
});

test("separa perfiles de Teams y Outlook por tenant", () => {
  const root = "/tmp/m365-web-export-profiles";
  assert.equal(
    tenantProfilePath(root, "teams", "beta"),
    path.join(root, "teams", "beta")
  );
  assert.equal(
    tenantProfilePath(root, "outlook", "beta"),
    path.join(root, "outlook", "beta")
  );
});

test("organiza las salidas genéricas por tenant y mes", () => {
  const base = "/tmp/teams-exports/raw";
  assert.equal(
    tenantOutputDirectory(base, "alpha", "2026-08-03T00:00:00+02:00"),
    path.join(base, "alpha", "2026-08")
  );
});

test("continúa con otros tenants cuando una combinación falla", async () => {
  const tenants = [tenantById("alpha"), tenantById("beta"), tenantById("gamma")];
  const results = await executeTenantPlan(tenants, ["teams", "outlook"], async ({ tenant, source }) => {
    if (tenant.id === "alpha" && source === "outlook") throw new Error("fallo simulado");
    return `${tenant.id}/${source}`;
  });
  assert.deepEqual(
    results.map((result) => `${result.tenant}/${result.source}:${result.status}`),
    [
      "alpha/teams:completed",
      "alpha/outlook:failed",
      "beta/teams:completed",
      "beta/outlook:completed",
      "gamma/teams:skipped",
      "gamma/outlook:completed"
    ]
  );
});
