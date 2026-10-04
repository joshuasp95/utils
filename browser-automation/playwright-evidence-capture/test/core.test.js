/**
 * core.test.js — tests de las funciones puras del core (sin navegador ni red).
 *
 * Qué hace:     Comprueba parseArgs/csv, interpolate, withTimeRange y azureResourceUrl.
 * Requisitos:   Node.js >= 18 (usa el runner integrado node:test; sin dependencias).
 * Uso:          npm test        (equivale a: node --test test/)
 * Variables:    Define temporalmente EVIDENCE_TEST_VAR en process.env.
 * Efectos:      Ninguno.
 * Salida:       Resultado de los tests por la terminal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, csv } from '../src/args.js';
import { interpolate, azureResourceUrl, toList } from '../src/utils.js';
import { withTimeRange } from '../src/sections/dashboard-time-range.js';

test('parseArgs: =valor, espacio, flags y posicionales', () => {
  const { opts, positional } = parseArgs(['sso', '--env=dev,prod', '--run', 'X', '--headless', '--prod.ns=a']);
  assert.deepEqual(positional, ['sso']);
  assert.equal(opts.env, 'dev,prod');
  assert.equal(opts.run, 'X');
  assert.equal(opts.headless, true);
  assert.equal(opts['prod.ns'], 'a');
  assert.deepEqual(csv(opts.env, []), ['dev', 'prod']);
  assert.deepEqual(csv(true, ['x']), ['x']);
});

test('interpolate: env, variables de proceso, defectos y listas', () => {
  process.env.EVIDENCE_TEST_VAR = 'https://example.invalid';
  const env = { portalUrl: 'https://portal.example.invalid', apps: ['a', 'b'] };
  const out = interpolate({
    url: '{{env.portalUrl}}/status',
    list: '{{env.apps}}',
    v: '{{$EVIDENCE_TEST_VAR}}/x',
    d: '{{$EVIDENCE_TEST_MISSING:-now-30d}}',
    missing: '{{env.nope}}',
    nested: [{ u: '{{env.portalUrl}}' }],
  }, env);
  assert.equal(out.url, 'https://portal.example.invalid/status');
  assert.deepEqual(out.list, ['a', 'b']);
  assert.equal(out.v, 'https://example.invalid/x');
  assert.equal(out.d, 'now-30d');
  assert.equal(out.missing, '');
  assert.equal(out.nested[0].u, 'https://portal.example.invalid');
  assert.deepEqual(toList('a, b,,c'), ['a', 'b', 'c']);
});

test('withTimeRange: kibana (query y hash), grafana y none', () => {
  const r = { from: 'now-30d', to: 'now' };
  assert.equal(withTimeRange('https://k/app/discover', 'kibana', r), 'https://k/app/discover?_g=(time:(from:now-30d,to:now))');
  assert.equal(withTimeRange('https://k/app/dashboards#/view/1', 'kibana', r), 'https://k/app/dashboards#/view/1?_g=(time:(from:now-30d,to:now))');
  assert.equal(withTimeRange('https://g/d/abc?orgId=1', 'grafana', r), 'https://g/d/abc?orgId=1&from=now-30d&to=now');
  assert.equal(withTimeRange('https://x/y', 'none', r), 'https://x/y');
});

test('azureResourceUrl: directa con/sin tenant y búsqueda sin suscripción', () => {
  const p = { subscriptionId: 'SUB', resourceGroup: 'RG', provider: 'Microsoft.App', resourceType: 'containerApps', resourceName: 'app1' };
  assert.equal(azureResourceUrl(p), 'https://portal.azure.com/#resource/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.App/containerApps/app1');
  assert.equal(azureResourceUrl({ ...p, tenantId: 'T' }), 'https://portal.azure.com/#@T/resource/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.App/containerApps/app1');
  assert.equal(azureResourceUrl({ subscriptionId: 'SUB', resourceGroup: 'RG' }), 'https://portal.azure.com/#resource/subscriptions/SUB/resourceGroups/RG/overview');
  assert.equal(azureResourceUrl({ resourceName: 'app 1' }), 'https://portal.azure.com/#search=app%201');
});
