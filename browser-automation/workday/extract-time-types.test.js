// extract-time-types.test.js — Tests (vitest) de la validación de argumentos del CLI y de time-type-record.js.
// Uso: npm test   (no abren navegador ni acceden a Workday)
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const script = fileURLToPath(new URL('./extract-time-types.js', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], {
  cwd: tmpdir(), encoding: 'utf8', timeout: 5000,
});

describe('extract-time-types CLI: valida antes de acceder a configuración o navegador', () => {
  it('ofrece ayuda sin configuración', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--day=YYYY-MM-DD');
  });
  it.each([
    ['--day=2026-02-30', '--day debe ser una fecha válida'],
    ['--day=ayer', '--day debe ser una fecha válida'],
    ['--max-depth=0', '--max-depth debe ser un entero'],
    ['--max-depth=NaN', '--max-depth debe ser un entero'],
    ['--only', 'Argumento no válido'],
    ['--roots-only=false', 'Argumento no válido'],
    ['--unknown=yes', 'Argumento no válido'],
  ])('rechaza %s', (arg, message) => {
    const result = run(arg);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain('ENOENT');
  });
});

import { record } from './time-type-record.js';

describe('rutas observadas en Workday', () => {
  it('no duplica la jerarquía de las hojas con etiqueta completa', () => {
    const result = record(['Project Plan Tasks', 'ClientA', 'Support', 'ClientA > Support > SLA tasks (Starts: 01/05/2026)'], 'leaf');
    expect(result.confirmed_full_type).toBe('ClientA > Support > SLA tasks');
    expect(result.full_type_with_dates).toBe('ClientA > Support > SLA tasks (Starts: 01/05/2026)');
  });
  it('conserva la jerarquía si la etiqueta es solo el nombre de la hoja', () => {
    expect(record(['Project Plan Tasks', 'Project (2024-2027)', 'Execution', 'Support'], 'leaf').confirmed_full_type)
      .toBe('Project (2024-2027) > Execution > Support');
  });
  it('conserva códigos simples y nunca confirma ramas pendientes', () => {
    expect(record(['Time Entry Codes', 'Break'], 'leaf').confirmed_full_type).toBe('Break');
    expect(record(['Project Plan Tasks', 'Pending'], 'max-depth-reached').confirmed_full_type).toBeNull();
  });
});
