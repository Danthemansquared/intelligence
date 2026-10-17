// Entorno B — API de datos públicos. No importa ni consulta la base privada.

import ExcelJS from 'exceljs';
import { SOURCES, sourceById, PRICE_PRODUCTS } from '../sources/index.js';
import { getSeries, lastObservation, lastRuns, notesBetween, openPublicDb } from '../db/public.js';
import { variations, freshness, indexChanges } from '../core/metrics.js';
import { addDays, addMonths, todayHouston, isIsoDate } from '../core/dates.js';
import { buildNarrative, weeklyChangeDistribution } from '../core/narrative.js';

const PRODUCT_LABEL = { propano: 'Propano', butano: 'Butano', wti: 'WTI', brent: 'Brent' };

/** Fuentes de precio para un producto, en orden de prioridad de visualización. */
export function sourcesFor(product) {
  return SOURCES.filter((s) => s.enabled !== false && s.kind === 'price' && s.products.includes(product))
    .sort((a, b) => (a.displayPriority?.[product] ?? 99) - (b.displayPriority?.[product] ?? 99));
}

function sourceCard(s, product, today) {
  const rows = getSeries(s.id, product, addMonths(today, -14));
  const last = lastObservation(s.id, product);
  const runs = lastRuns(s.id);
  return {
    sourceId: s.id, name: s.name, shortName: s.shortName, url: s.url, label: s.label?.[product] ?? null, reference: s.reference[product] ?? s.reference.default,
    unit: last?.unit ?? null, unitOrig: last?.unit_orig ?? null, conversion: s.conversionNote?.[product] ?? null,
    variations: variations(rows),
    // Mini tendencia de ~3 meses para la tarjeta (estilo widget de Bolsa).
    spark: rows.filter((r) => r.date >= addMonths(today, -3)).map((r) => [r.date, r.value]),
    lastFetchedAt: runs.lastOk?.finished_at ?? null, fetchedAt: last?.fetched_at ?? null,
    freshness: freshness(last?.date, today, s.maxLagBusinessDays),
    lastRunStatus: runs.last?.status ?? null,
  };
}

/** Índices mensuales relacionados con un producto (p. ej. PPI de butano). No son precios. */
export function indexCards(product, today = todayHouston()) {
  return SOURCES.filter((s) => s.enabled !== false && s.kind === 'index' && s.relatesTo?.includes(product)).flatMap((s) => s.products.map((ip) => {
    const rows = getSeries(s.id, ip, addMonths(today, -26));
    const ch = indexChanges(rows);
    return ch && { spark: rows.map((r) => [r.date, r.value]), sourceId: s.id, product: ip, shortName: s.shortName, name: s.name, url: s.url, unit: rows.at(-1).unit, ...ch, freshness: freshness(ch.date, today, s.maxLagBusinessDays) };
  })).filter(Boolean);
}

function overview() {
  const today = todayHouston();
  const products = {};
  for (const product of PRICE_PRODUCTS) {
    products[product] = { label: PRODUCT_LABEL[product], sources: sourcesFor(product).map((s) => sourceCard(s, product, today)), indices: indexCards(product, today) };
  }
  return { today, products, alerts: alerts(today), lastUpdate: lastUpdate() };
}

function lastUpdate() {
  const r = openPublicDb().prepare("SELECT MAX(finished_at) t FROM fetch_runs WHERE status IN ('ok','sin_cambios')").get();
  return r?.t ?? null;
}

/** Incidencias de datos (no estadísticas): fuentes con error, atrasadas o con cambio de estructura. */
function alerts(today) {
  const out = [];
  for (const s of SOURCES.filter((x) => x.enabled !== false)) {
    const runs = lastRuns(s.id);
    if (runs.last?.status === 'error') out.push({ level: 'rojo', type: 'falla', source: s.shortName, text: `${s.shortName}: la última actualización falló (${runs.last.message}).` });
    if (runs.last?.structure_changed) out.push({ level: 'amarillo', type: 'estructura', source: s.shortName, text: `${s.shortName}: cambió el formato de la respuesta; revisar el adaptador.` });
    for (const product of s.products) {
      const last = lastObservation(s.id, product);
      const f = freshness(last?.date, today, s.maxLagBusinessDays);
      if (f.status === 'atrasada' || f.status === 'detenida') {
        out.push({ level: f.status === 'detenida' ? 'rojo' : 'amarillo', type: 'antiguedad', source: s.shortName,
          text: `${s.shortName} · ${PRODUCT_LABEL[product] ?? product}: último dato del ${last.date} (${f.lag} días hábiles; lo normal es ≤ ${s.maxLagBusinessDays}).` });
      } else if (f.status === 'sin_datos' && s.kind === 'price') {
        out.push({ level: 'amarillo', type: 'sin_datos', source: s.shortName, text: `${s.shortName} · ${PRODUCT_LABEL[product] ?? product}: aún no hay datos.` });
      }
    }
  }
  return out;
}

function series(q) {
  const product = q.product;
  const indexSrc = SOURCES.filter((s) => s.enabled !== false && s.kind === 'index' && s.products.includes(product));
  if (!PRICE_PRODUCTS.includes(product) && !indexSrc.length) throw new Error('Producto no válido');
  const from = isIsoDate(q.from) ? q.from : addMonths(todayHouston(), -12);
  const list = indexSrc.length ? indexSrc : sourcesFor(product);
  return {
    product, from,
    sources: list.map((s) => ({ sourceId: s.id, name: s.shortName, unit: s.unit, rows: getSeries(s.id, product, from).map((r) => [r.date, r.value]) })),
  };
}

function quality() {
  const today = todayHouston();
  const d = openPublicDb();
  return SOURCES.map((s) => {
    const runs = lastRuns(s.id);
    const recent = d.prepare('SELECT status, finished_at, rows_new, message FROM fetch_runs WHERE source_id=? ORDER BY id DESC LIMIT 10').all(s.id).map((r) => ({ ...r }));
    const revisions = d.prepare('SELECT COUNT(*) n FROM observation_revisions WHERE source_id=?').get(s.id).n;
    return {
      id: s.id, enabled: s.enabled !== false, name: s.name, shortName: s.shortName, url: s.url, role: s.role, kind: s.kind, products: s.products,
      reference: s.reference, location: s.location, unit: s.unit, frequency: s.frequency, history: s.history, access: s.access,
      terms: s.terms, limitations: s.limitations, maxLagBusinessDays: s.maxLagBusinessDays,
      perProduct: s.products.map((p) => {
        const last = lastObservation(s.id, p);
        const n = d.prepare('SELECT COUNT(*) n, MIN(quote_date) a FROM observations WHERE source_id=? AND product=?').get(s.id, p);
        return { product: p, lastDate: last?.date ?? null, n: n.n, first: n.a, freshness: freshness(last?.date, today, s.maxLagBusinessDays) };
      }),
      lastRun: runs.last, lastOk: runs.lastOk, revisions, recent,
    };
  });
}

/** Indicadores de contexto (inventarios, exportaciones) con su cambio semanal. */
function contextIndicators() {
  return SOURCES.filter((s) => s.kind === 'context' && s.enabled !== false).flatMap((s) => s.products.map((p) => {
    const rows = getSeries(s.id, p, addMonths(todayHouston(), -3));
    if (rows.length < 2) return null;
    const a = rows.at(-2), b = rows.at(-1);
    return { id: `${s.id}:${p}`, key: p, label: s.contextLabel[p], date: b.date, value: b.value, change: b.value - a.value, unit: b.unit, source: s.shortName, url: s.url, products: s.relatesTo };
  })).filter(Boolean);
}

function market() {
  const today = todayHouston();
  const ser = {};
  for (const product of PRICE_PRODUCTS) {
    const src = sourcesFor(product).find((s) => lastObservation(s.id, product));
    if (!src) continue;
    const rows = getSeries(src.id, product, addMonths(today, -26));
    ser[product] = { variations: variations(rows), dist: weeklyChangeDistribution(rows), unit: rows.at(-1)?.unit, source: src.shortName };
  }
  const context = contextIndicators();
  const notes = notesBetween(addDays(today, -45), today);
  const indices = Object.fromEntries(PRICE_PRODUCTS.map((p) => [p, indexCards(p, today)]));
  return { items: buildNarrative({ series: ser, context, notes, today, indices }), context, notes, series: Object.fromEntries(Object.entries(ser).map(([k, v]) => [k, { source: v.source }])) };
}

function exportData(q) {
  const products = PRICE_PRODUCTS.includes(q.product) ? [q.product] : PRICE_PRODUCTS;
  const from = isIsoDate(q.from) ? q.from : '1900-01-01';
  const rows = [];
  for (const p of products) for (const s of sourcesFor(p)) for (const r of getSeries(s.id, p, from)) {
    rows.push({ producto: p, fuente: s.shortName, fecha_cotizacion: r.date, valor_original: r.value_orig, unidad_original: r.unit_orig, valor_normalizado: r.value, unidad_normalizada: r.unit });
  }
  const stamp = todayHouston();
  if (q.format === 'xlsx') return xlsx(rows, stamp);
  const head = Object.keys(rows[0] ?? { producto: '' });
  const csv = [head.join(','), ...rows.map((r) => head.map((h) => r[h]).join(','))].join('\n');
  return { __file: true, body: '﻿' + csv, type: 'text/csv; charset=utf-8', filename: `precios-digitales-${stamp}.csv` };
}

async function xlsx(rows, stamp) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Precios digitales');
  ws.columns = Object.keys(rows[0] ?? { producto: '' }).map((k) => ({ header: k, key: k, width: 18 }));
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  const meta = wb.addWorksheet('Fuentes');
  meta.columns = [{ header: 'Fuente', key: 'n', width: 40 }, { header: 'URL', key: 'u', width: 70 }, { header: 'Términos', key: 't', width: 80 }];
  for (const s of SOURCES) meta.addRow({ n: s.name, u: s.url, t: s.terms });
  return { __file: true, body: Buffer.from(await wb.xlsx.writeBuffer()), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `precios-digitales-${stamp}.xlsx` };
}

export const routes = {
  '/api/overview': overview,
  '/api/series': series,
  '/api/quality': quality,
  '/api/market': market,
  '/api/export': exportData,
  '/api/sources': () => SOURCES.map(({ fetch, requires, ...meta }) => meta),
};

export { sourceById };
