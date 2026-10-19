// Pruebas de permisos y confidencialidad con datos sintéticos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-test-'));
process.env.PUBLIC_DB = path.join(tmp, 'public.db');
process.env.PRIVATE_DB = path.join(tmp, 'private', 'official.db');

const { identify, canSeePrivate } = await import('../src/server/auth.js');
const { settings, overrideSettings } = await import('../src/config.js');
const { createServer } = await import('../src/server/server.js');
const { upsertObservations } = await import('../src/db/public.js');
const { upsertOfficial } = await import('../src/db/private.js');
const { SOURCES } = await import('../src/sources/index.js');

const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });
const SECRET = 87.654321; // valor oficial sintético que no debe aparecer en respuestas públicas
let server, base;

before(async () => {
  const src = SOURCES.find((s) => s.kind === 'price' && s.products.includes('propano'));
  const now = new Date().toISOString();
  upsertObservations([
    { sourceId: src.id, product: 'propano', quoteDate: '2026-08-03', valueOrig: 0.85, unitOrig: 'USD/gal', valueNorm: 85, unitNorm: 'cUSD/gal', conversion: 'USD/gal × 100', fetchedAt: now },
    { sourceId: src.id, product: 'propano', quoteDate: '2026-08-04', valueOrig: 0.86, unitOrig: 'USD/gal', valueNorm: 86, unitNorm: 'cUSD/gal', conversion: 'USD/gal × 100', fetchedAt: now },
  ]);
  upsertOfficial([{ product: 'propano', quoteDate: '2026-08-04', value: SECRET }, { product: 'propano', quoteDate: '2026-08-03', value: 84 }], 'sintetico.xlsx');
  overrideSettings({ authMode: 'proxy', trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'], identityHeader: 'x-user' });
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('Modo local rechaza conexiones que no son de esta computadora', () => {
  const cfg = { ...settings, authMode: 'local' };
  assert.equal(identify(req('10.0.0.5'), cfg).error, 403);
  assert.equal(identify(req('127.0.0.1'), cfg).role, cfg.localRole);
});

test('Modo proxy: sólo confía en el proxy y exige rol asignado', () => {
  const cfg = { ...settings, authMode: 'proxy', trustedProxies: ['10.0.0.1'], identityHeader: 'x-user' };
  const roles = { 'ana@empresa.com': 'validador', 'luis@empresa.com': 'lector' };
  assert.equal(identify(req('10.9.9.9', { 'x-user': 'ana@empresa.com' }), cfg, roles).error, 403); // encabezado falsificado
  assert.equal(identify(req('10.0.0.1'), cfg, roles).error, 401);
  assert.equal(identify(req('10.0.0.1', { 'x-user': 'otro@empresa.com' }), cfg, roles).error, 403);
  assert.equal(identify(req('10.0.0.1', { 'x-user': 'Luis@Empresa.com' }), cfg, roles).role, 'lector');
  assert.equal(identify(req('10.0.0.1', { 'x-user': 'x@empresa.com' }), cfg, { '*': 'lector' }).role, 'lector');
});

test('Sólo validador con modo privado ve la comparación', () => {
  assert.equal(canSeePrivate({ role: 'lector' }, { ...settings, privateMode: true }), false);
  assert.equal(canSeePrivate({ role: 'validador' }, { ...settings, privateMode: true }), true);
  assert.equal(canSeePrivate({ role: 'validador' }, { ...settings, privateMode: false }), false);
});

async function get(p, user) {
  const r = await fetch(base + p, { headers: user ? { 'x-user': user } : {} });
  return { status: r.status, text: await r.text(), headers: r.headers };
}

test('API: lector recibe 403 en rutas privadas; validador 200 sin caché', async () => {
  overrideSettings({ authMode: 'local', localRole: 'lector' });
  let r = await get('/api/private/summary');
  assert.equal(r.status, 403);
  overrideSettings({ localRole: 'validador' });
  r = await get('/api/private/summary');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /no-store/);
  overrideSettings({ privateMode: false });
  r = await get('/api/private/summary');
  assert.equal(r.status, 403);
  overrideSettings({ privateMode: true });
});

test('Las rutas públicas nunca contienen precios oficiales', async () => {
  overrideSettings({ authMode: 'local', localRole: 'validador' });
  for (const p of ['/api/overview', '/api/series?product=propano&from=2000-01-01', '/api/quality', '/api/market', '/api/export?format=csv', '/api/sources']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.ok(!r.text.includes('87.654321') && !r.text.includes('87.65'), `${p} filtró un valor oficial`);
  }
});

test('Diferencia privada: signo y valores correctos, y "sin referencia" cuando falta el oficial', async () => {
  const r = JSON.parse((await get('/api/private/summary?date=2026-08-04')).text);
  const c = r.products.propano[0].current;
  assert.equal(c.status, 'ok');
  assert.ok(Math.abs(c.signed - (86 - SECRET)) < 1e-9);
  assert.equal(c.direction, 'abajo'); // 86 < 87.65 → digital por debajo
  const r2 = JSON.parse((await get('/api/private/summary?date=2026-08-05')).text);
  assert.equal(r2.products.propano[0].current.status, 'sin_dato_digital');
});

test('Servidor rechaza métodos de escritura y rutas fuera de web/', async () => {
  const r = await fetch(`${base}/api/overview`, { method: 'POST' });
  assert.equal(r.status, 405);
  const t = await get('/..%2Fprivate%2Fofficial.db');
  assert.equal(t.status, 404);
});

test('Actualizar: sólo POST, con encabezado propio y mismo origen; lector en proxy no puede', async () => {
  const { setRefreshImpl } = await import('../src/server/server.js');
  let calls = 0;
  setRefreshImpl(async () => { calls++; return [{ source: 'x', status: 'sin_cambios' }]; });
  overrideSettings({ authMode: 'local', localRole: 'validador', privateMode: true });
  const post = (headers = {}) => fetch(`${base}/api/refresh`, { method: 'POST', headers });
  assert.equal((await fetch(`${base}/api/refresh`)).status, 405); // GET no permitido
  assert.equal((await post()).status, 403); // sin encabezado (posible CSRF)
  assert.equal((await post({ 'X-Requested-With': 'dashboard', Origin: 'https://sitio-malicioso.example' })).status, 403);
  const ok = await post({ 'X-Requested-With': 'dashboard' });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.results[0].status, 'sin_cambios');
  assert.ok('official' in body);
  assert.equal(calls, 1);
  setRefreshImpl(null);
  overrideSettings({ authMode: 'local' });
});

test('canRefresh: local sí; proxy sólo validador', async () => {
  const { canRefresh } = await import('../src/server/auth.js');
  assert.equal(canRefresh({ role: 'lector' }, { ...settings, authMode: 'local' }), true);
  assert.equal(canRefresh({ role: 'lector' }, { ...settings, authMode: 'proxy' }), false);
  assert.equal(canRefresh({ role: 'validador' }, { ...settings, authMode: 'proxy' }), true);
  assert.equal(canRefresh(null, settings), false);
});
