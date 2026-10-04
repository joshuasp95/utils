// tenant-workflow.js — lógica pura de tenants: validación, selección, perfiles y salidas.
// Qué hace: valida la configuración de tenants, resuelve ids, decide qué tenants soportan Teams u
// Outlook y ejecuta la matriz tenant × aplicación continuando si una combinación falla.
// Efectos: ninguno (las rutas se calculan, no se crean).
import path from "node:path";

import { MICROSOFT_TENANTS } from "../config/microsoft-tenants.js";

export function validateMicrosoftTenants(tenants = MICROSOFT_TENANTS) {
  const ids = new Set();
  const emails = new Set();
  for (const tenant of tenants) {
    if (!/^[a-z][a-z0-9-]*$/.test(tenant.id)) {
      throw new Error(`Identificador de tenant no válido: ${tenant.id}`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tenant.email)) {
      throw new Error(`Correo configurado no válido para ${tenant.id}.`);
    }
    if (!Array.isArray(tenant.applications) || !tenant.applications.length
      || tenant.applications.some((source) => !["teams", "outlook"].includes(source))) {
      throw new Error(`Aplicaciones no válidas para ${tenant.id}.`);
    }
    const normalizedEmail = tenant.email.toLocaleLowerCase();
    if (ids.has(tenant.id) || emails.has(normalizedEmail)) {
      throw new Error(`Tenant de Microsoft 365 duplicado: ${tenant.id}.`);
    }
    ids.add(tenant.id);
    emails.add(normalizedEmail);
  }
  return tenants;
}

export function tenantById(id, tenants = MICROSOFT_TENANTS) {
  const normalized = String(id || "").trim().toLocaleLowerCase();
  const tenant = tenants.find((candidate) => candidate.id === normalized);
  if (!tenant) {
    throw new Error(`Tenant desconocido: ${id}. Usa: ${tenants.map((item) => item.id).join(", ")}.`);
  }
  return tenant;
}

export function tenantSupports(tenant, source) {
  return tenant.applications.includes(source);
}

export function tenantsForSources(sources, tenants = MICROSOFT_TENANTS) {
  return tenants.filter((tenant) => sources.some((source) => tenantSupports(tenant, source)));
}

export function normalizeTenantIds(values, tenants = MICROSOFT_TENANTS) {
  const selected = new Map();
  for (const value of values.flatMap((item) => String(item || "").split(","))) {
    const id = value.trim().toLocaleLowerCase();
    if (!id) continue;
    const tenant = tenantById(id, tenants);
    selected.set(tenant.id, tenant.id);
  }
  return [...selected.values()];
}

export function tenantProfilePath(profileRoot, source, tenantId) {
  if (!["teams", "outlook"].includes(source)) throw new Error(`Origen no válido para perfil: ${source}.`);
  return path.join(profileRoot, source, tenantById(tenantId).id);
}

export function tenantOutputDirectory(baseDirectory, tenantId, since) {
  const month = String(since || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Fecha de salida por tenant no válida.");
  return path.join(baseDirectory, tenantById(tenantId).id, month);
}

export async function executeTenantPlan(tenants, sources, worker, { abortOnError = () => false } = {}) {
  const results = [];
  for (const tenant of tenants) {
    for (const source of sources) {
      if (!tenantSupports(tenant, source)) {
        results.push({ tenant: tenant.id, source, status: "skipped", reason: "source-not-configured" });
        continue;
      }
      try {
        const result = await worker({ tenant, source });
        results.push({ tenant: tenant.id, source, status: "completed", result });
      } catch (error) {
        if (abortOnError(error)) throw error;
        results.push({
          tenant: tenant.id,
          source,
          status: "failed",
          error: String(error?.message || error)
        });
      }
    }
  }
  return results;
}

validateMicrosoftTenants();
