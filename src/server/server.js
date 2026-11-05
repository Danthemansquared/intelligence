// Servidor HTTP del dashboard (sin dependencias externas).
//   /api/*          → indicadores digitales (rol lector o superior)
//   /api/private/*  → comparación vs. AMEXGAS (rol validador + privateMode)
//   /               → interfaz estática (web/)
//
// Seguridad: escucha en 127.0.0.1 por defecto; cabeceras estrictas (CSP sin
// orígenes externos); respuestas privadas con Cache-Control: no-store; los
// registros sólo incluyen método, ruta y estado (nunca cuerpos ni valores).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, settings } from '../config.js';
import { identify, canSeePrivate, canRefresh } from './auth.js';
import { runAll } from '../ingest/run.js';
import * as pub from './public-api.js';

const WEB = path.join(ROOT, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

let privateApi = null;
async function loadPrivate() {
  // Se carga sólo cuando el entorno tiene privateMode: un despliegue sin datos
  // oficiales nunca abre ni importa el módulo privado.
  if (!settings.privateMode) return null;
  privateApi ??= await import('./private-api.js');
  return privateApi;
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  const start = Date.now();
  res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${p} ${res.statusCode} ${Date.now() - start}ms`));

  // Sólo lectura, salvo la actualización de datos públicos y la carga de archivos AMEXGAS.
  const isRefresh = p === '/api/refresh';
  const isImport = p === '/api/private/import';
  const writes = isRefresh || isImport;
  if (writes ? req.method !== 'POST' : req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método no permitido' });

  const id = identify(req);
  if (id.error) return send(res, id.error, { error: id.reason });

  try {
    if (p === '/api/me') return send(res, 200, { user: id.user, role: id.role, canSeePrivate: canSeePrivate(id), canRefresh: canRefresh(id), authMode: settings.authMode });
    if (isRefresh) return await refresh(req, res, id);
    if (isImport) return await importOfficial(req, res, id);
    if (p.startsWith('/api/private/')) {
      if (!canSeePrivate(id)) return send(res, 403, { error: 'No autorizado para consultar la comparación contra AMEXGAS.' });
      const api = await loadPrivate();
      const fn = api?.routes[p];
      if (!fn) return send(res, 404, { error: 'No encontrado' });
      return send(res, 200, await fn(q), { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    }
    if (p.startsWith('/api/')) {
      const fn = pub.routes[p];
      if (!fn) return send(res, 404, { error: 'No encontrado' });
      const out = await fn(q);
      if (out && out.__file) return send(res, 200, out.body, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'no-store' });
      return send(res, 200, out, { 'Cache-Control': 'no-cache' });
    }
    // Archivos estáticos
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'No encontrado');
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch (e) {
    // El mensaje genérico evita filtrar datos; el detalle técnico sólo se registra si no viene del módulo privado.
    const isPrivate = p.startsWith('/api/private/');
    console.error(`Error en ${p}: ${isPrivate ? '(detalle omitido por confidencialidad)' : e.stack}`);
    return send(res, 500, { error: 'Error interno al procesar la solicitud.' });
  }
}

let refreshing = null;
let refreshImpl = runAll;
/** Sólo para pruebas: reemplaza la descarga real por una simulada. */
export function setRefreshImpl(fn) { refreshImpl = fn ?? runAll; }

/**
 * Botón «Actualizar»: descarga de nuevo todas las fuentes públicas (EIA, FRED/BLS…).
 * Nunca toca los precios oficiales, que se cargan manualmente.
 * Protección CSRF: exige un encabezado propio, que otro sitio no puede enviar sin
 * autorización CORS, y un Origin igual al del servidor cuando el navegador lo manda.
 */
async function refresh(req, res, id) {
  if (!canRefresh(id)) return send(res, 403, { error: 'No autorizado para actualizar los datos.' });
  const origin = req.headers.origin;
  if (req.headers['x-requested-with'] !== 'dashboard' || (origin && new URL(origin).host !== req.headers.host)) {
    return send(res, 403, { error: 'Solicitud no permitida.' });
  }
  // Una sola actualización a la vez: si ya hay una en curso, se espera su resultado.
  refreshing ??= refreshImpl().finally(() => { refreshing = null; });
  const results = await refreshing;
  if (privateApi?.invalidate) privateApi.invalidate();
  let official = null;
  if (canSeePrivate(id)) {
    // Carga diferida: un despliegue sin modo privado nunca importa la base oficial.
    const { lastImport } = await import('../db/private.js');
    const li = lastImport();
    official = li ? { lastDate: li.last_date, importedAt: li.imported_at } : null;
  }
  return send(res, 200, { finishedAt: new Date().toISOString(), results, official }, { 'Cache-Control': 'no-store' });
}

const MAX_UPLOAD = 25 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('El archivo excede 25 MB.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * «Cargar AMEXGAS»: importa un Excel subido desde la app a la base privada.
 * Sólo agrega fechas nuevas (no modifica valores ya cargados) y responde con
 * conteos y fechas, nunca con precios. El archivo no se guarda en disco.
 */
async function importOfficial(req, res, id) {
  if (!canSeePrivate(id)) return send(res, 403, { error: 'No autorizado para cargar precios oficiales.' });
  const origin = req.headers.origin;
  if (req.headers['x-requested-with'] !== 'dashboard' || (origin && new URL(origin).host !== req.headers.host)) {
    return send(res, 403, { error: 'Solicitud no permitida.' });
  }
  let body;
  try { body = await readBody(req, MAX_UPLOAD); } catch (e) { return send(res, e.status ?? 400, { error: e.message }); }
  const name = decodeURIComponent(String(req.headers['x-file-name'] || 'archivo.xlsx')).replace(/[^\w .()-]/g, '_').slice(0, 120);
  const { importBuffer } = await import('../private/import-official.js');
  const { officialCoverage } = await import('../db/private.js');
  let results;
  try {
    results = await importBuffer(body, name, { onlyNew: true });
  } catch (e) {
    // Mensajes propios del importador (formato no reconocido, Excel inválido); sin valores de celdas.
    return send(res, 422, { error: e.message });
  }
  if (privateApi?.invalidate) privateApi.invalidate();
  const cov = officialCoverage();
  const summary = {
    sheets: results.map((r) => r.sheet),
    added: results.reduce((a, r) => a + r.rowsNew, 0),
    addedDays: Math.max(...results.map((r) => Math.ceil(r.rowsNew / 2)), 0),
    differing: results.reduce((a, r) => a + (r.keptDifferent ?? 0), 0),
    rejected: results.reduce((a, r) => a + r.rowsRejected, 0),
    lastDate: cov.map((c) => c.last_date).sort().at(-1) ?? null,
  };
  return send(res, 200, { summary }, { 'Cache-Control': 'no-store' });
}

export function createServer() {
  return http.createServer((req, res) => { handle(req, res); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (settings.authMode === 'local' && !['127.0.0.1', '::1', 'localhost'].includes(settings.host)) {
    console.error('Por seguridad, el modo local sólo puede escuchar en 127.0.0.1. Use AUTH_MODE=proxy detrás de un proxy autenticado.');
    process.exit(1);
  }
  createServer().listen(settings.port, settings.host, () => {
    console.log(`Dashboard en http://${settings.host}:${settings.port}  (auth: ${settings.authMode}, modo privado: ${settings.privateMode ? 'sí' : 'no'})`);
  });
}
