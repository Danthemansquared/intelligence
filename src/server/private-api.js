// Entorno A — rutas privadas. Sólo accesibles para rol validador con privateMode.
import { comparisonFor, lastComparable, diffHistory, fullStats, lpgSources, LPG, estimateStats, seriesFor, VIRTUAL, clearMemo } from '../private/validation.js';
import { variations } from '../core/metrics.js';
import { officialCoverage, lastImport, officialMap, fxMap } from '../db/private.js';
import { getSeries } from '../db/public.js';
import { MIXES, dailyMix, weeklyAverages, weeklyForecast, forecastMessage } from '../core/mix.js';
import { isIsoDate, addMonths, todayHouston } from '../core/dates.js';

let statsCache = { at: 0, data: null };

/** Tras una actualización de datos, se recalcula todo en la siguiente consulta. */
export function invalidate() {
  statsCache = { at: 0, data: null };
  clearMemo();
}

function stats() {
  // Cálculo costoso (≈26 años diarios): se reutiliza 10 minutos.
  if (Date.now() - statsCache.at > 600_000) statsCache = { at: Date.now(), data: fullStats() };
  return statsCache.data;
}

function summary(q) {
  const date = isIsoDate(q.date) ? q.date : undefined;
  const out = { coverage: officialCoverage(), lastImport: lastImport(), products: {} };
  for (const product of LPG) {
    out.products[product] = lpgSources(product).map((s) => ({
      current: comparisonFor(s.id, product, date),
      lastComparable: lastComparable(s.id, product),
    }));
  }
  out.recommendation = stats().recommendation;
  // Estimaciones (p. ej. butano) con variaciones y mini tendencia para la tarjeta.
  out.estimates = {};
  for (const product of LPG) {
    const e = estimateStats(product);
    if (!e) continue;
    const rows = seriesFor(e.sourceId, product).filter((r) => r.date >= addMonths(todayHouston(), -14));
    out.estimates[product] = { ...e, variations: variations(rows), spark: rows.filter((r) => r.date >= addMonths(todayHouston(), -3)).map((r) => [r.date, r.value]) };
  }
  out.sourceNames = Object.fromEntries(VIRTUAL.map((v) => [v.id, v.shortName]));
  return out;
}

function history(q) {
  if (!LPG.includes(q.product)) throw new Error('Producto no válido');
  const from = isIsoDate(q.from) ? q.from : addMonths(todayHouston(), -12);
  return { product: q.product, sourceId: q.source, rows: diffHistory(q.source, q.product, from) };
}

/** Serie diaria de una estimación privada (p. ej. butano) para la gráfica de GLP. */
function series(q) {
  if (!LPG.includes(q.product)) throw new Error('Producto no válido');
  const from = isIsoDate(q.from) ? q.from : addMonths(todayHouston(), -12);
  const v = VIRTUAL.find((x) => x.products.includes(q.product));
  return { product: q.product, sources: v ? [{ sourceId: v.id, name: v.shortName, rows: seriesFor(v.id, q.product).filter((r) => r.date >= from).map((r) => [r.date, r.value]) }] : [] };
}

/**
 * Mezcla en $/kg y referencia semanal (viernes a jueves) con precios AMEXGAS.
 * Para semanas posteriores al último dato oficial se agrega una estimación con
 * precios públicos (propano EIA + butano estimado) y tipo de cambio FRED.
 */
function mix(q) {
  const label = MIXES[q.ratio] ? q.ratio : '90-10';
  const w = MIXES[label];
  const today = todayHouston();
  const publicFx = new Map(getSeries('fred_fx', 'mxn_usd').map((r) => [r.date, r.value]));
  const official = dailyMix(officialMap('propano'), officialMap('butano'), w, fxMap(), publicFx);
  const weeks = weeklyAverages(official);
  const lastOfficial = official.at(-1)?.date ?? null;
  const forecast = weeklyForecast(weeks, today, lastOfficial);
  // Estimación pública para las fechas sin dato oficial.
  const prop = new Map(getSeries('eia_propano', 'propano').filter((r) => !lastOfficial || r.date > lastOfficial).map((r) => [r.date, r.value]));
  const but = new Map(seriesFor('estimado_butano', 'butano').filter((r) => !lastOfficial || r.date > lastOfficial).map((r) => [r.date, r.value]));
  const estDaily = dailyMix(prop, but, w, new Map(), publicFx);
  const label2 = label.replace('-', '/');
  return {
    ratio: label, label: label2, lastOfficial,
    fxSources: [...new Set(official.slice(-90).map((r) => r.fxSource))],
    weeks: weeks.slice(-26),
    daily: official.filter((r) => r.date >= addMonths(today, -12)).map((r) => [r.date, r.value]),
    forecast,
    message: forecastMessage(forecast, label2),
    estimated: { daily: estDaily.map((r) => [r.date, r.value]), weeks: weeklyAverages(estDaily) },
  };
}

export const routes = {
  '/api/private/mix': mix,
  '/api/private/series': series,
  '/api/private/summary': summary,
  '/api/private/history': history,
  '/api/private/stats': stats,
};
