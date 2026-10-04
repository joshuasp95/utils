// use-test-config.js — fuerza a los tests a usar tenants ficticios (fixtures/tenants.test.json).
// Debe ser el PRIMER import de cada test que cargue scripts/lib: los módulos ES se evalúan en el
// orden de sus imports, así la variable queda definida antes de que microsoft-tenants.js lea la
// configuración. Nunca toca tu config.local.json. Efectos: solo modifica process.env del test.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

process.env.M365_WEB_EXPORT_CONFIG = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "tenants.test.json"
);
