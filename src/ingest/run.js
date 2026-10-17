// Orquestador de actualización. Ejecuta cada fuente habilitada con reintentos,
// valida, normaliza, deduplica y registra el resultado.
//
// Uso:  npm run update                → todas las fuentes
//       npm run update -- --source eia_propane
//
// Código de salida ≠ 0 si alguna fuente falla (útil para alertas del programador de tareas).

import { pathToFileURL } from 'node:url';
import { SOURCES } from '../sources/index.js';
import { normalize, isPlausible } from '../core/units.js';
import { isIsoDate, todayHouston } from '../core/dates.js';
import { upsertObservations, startRun, finishRun, lastRuns } from '../db/public.js';
import { settings } from '../config.js';
import { execFile } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Valida y normaliza filas crudas de un adaptador. Devuelve { ok, rejected } */
export function validateRows(source, rawRows, { today = todayHouston(), fetchedAt = new Date().toISOString() } = {}) {
  const ok = [];
  const rejected = [];
  for (const r of rawRows) {
    const why = !source.products.includes(r.product) ? 'producto no declarado'
      : !isIsoDate(r.quoteDate) ? 'fecha inválida'
      : r.quoteDate > today ? 'fecha futura'
      : !Number.isFinite(r.value) ? 'valor no numérico'
      : null;
    if (why) { rejected.push({ ...r, why }); continue; }
    let n;
    try { n = normalize(r.value, r.unit, r.product); } catch (e) { rejected.push({ ...r, why: e.message }); continue; }
    if (!isPlausible(r.product, n.value)) { rejected.push({ ...r, why: 'fuera de rango plausible (¿unidad?)' }); continue; }
    ok.push({
      sourceId: source.id, product: r.product, quoteDate: r.quoteDate,
      valueOrig: r.value, unitOrig: r.unit, valueNorm: n.value, unitNorm: n.unit, conversion: n.method,
      publishedAt: r.publishedAt ?? null, fetchedAt,
    });
  }
  return { ok, rejected };
}

export async function runSource(source, { fetchImpl } = {}) {
  const runId = startRun(source.id);
  const prev = lastRuns(source.id);
  const { retries, backoffMs } = settings.fetch;
  let attempt = 0;
  let lastErr;
  while (attempt < retries) {
    attempt++;
    try {
      const res = await (fetchImpl ? fetchImpl(source) : source.fetch({ settings }));
      const { ok, rejected } = validateRows(source, res.rows);
      if (res.rows.length && !ok.length) throw Object.assign(new Error(`Todas las filas fueron rechazadas (${rejected[0]?.why})`), { retryable: false });
      const { added, revised } = upsertObservations(ok, runId);
      const structureChanged = prev.lastSignature && res.signature && prev.lastSignature !== res.signature ? 1 : 0;
      const status = added + revised > 0 ? 'ok' : 'sin_cambios';
      const lastQuoteDate = ok.map((r) => r.quoteDate).sort().at(-1) ?? null;
      const msg = [
        structureChanged ? 'Cambió la estructura de la respuesta; revisar el adaptador.' : null,
        res.note ?? null,
        rejected.length ? `${rejected.length} filas rechazadas (p. ej. ${rejected[0].why}).` : null,
        status === 'sin_cambios' ? 'La fuente no publicó datos nuevos.' : null,
      ].filter(Boolean).join(' ');
      finishRun(runId, {
        status, attempts: attempt, rows_received: res.rows.length, rows_new: added, rows_revised: revised,
        rows_rejected: rejected.length, last_quote_date: lastQuoteDate, structure_signature: res.signature ?? null,
        structure_changed: structureChanged, message: msg || null,
      });
      return { source: source.id, status, added, revised, rejected: rejected.length, lastQuoteDate, structureChanged, message: msg };
    } catch (e) {
      lastErr = e;
      if (e.retryable === false || attempt >= retries) break;
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
  finishRun(runId, { status: 'error', attempts: attempt, message: lastErr?.message?.slice(0, 500) ?? 'Error desconocido' });
  return { source: source.id, status: 'error', message: lastErr?.message };
}

export async function runAll({ only } = {}) {
  const results = [];
  for (const s of SOURCES.filter((x) => x.enabled !== false && (!only || x.id === only))) {
    if (s.requires && !s.requires(settings)) {
      const id = startRun(s.id);
      finishRun(id, { status: 'omitida', message: s.requiresMessage });
      results.push({ source: s.id, status: 'omitida', message: s.requiresMessage });
      continue;
    }
    results.push(await runSource(s));
  }
  return results;
}

async function main() {
  const i = process.argv.indexOf('--source');
  const results = await runAll({ only: i > 0 ? process.argv[i + 1] : undefined });
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'sin_cambios' ? '·' : r.status === 'omitida' ? '–' : '✗';
    console.log(`${icon} ${r.source.padEnd(22)} ${r.status.padEnd(12)} ${r.added != null ? `nuevas ${r.added}, revisadas ${r.revised}, último dato ${r.lastQuoteDate ?? '—'}` : ''} ${r.message ?? ''}`);
  }
  const failed = results.filter((r) => r.status === 'error' || r.structureChanged);
  if (failed.length) {
    process.exitCode = 2;
    // Alerta local en macOS (sin servicios externos). Desactivar con NOTIFY=0.
    if (process.platform === 'darwin' && process.env.NOTIFY !== '0') {
      const msg = `Fallaron: ${failed.map((r) => r.source).join(', ')}`.replace(/"/g, "'");
      execFile('osascript', ['-e', `display notification "${msg}" with title "Mont Belvieu: actualización"`], () => {});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
