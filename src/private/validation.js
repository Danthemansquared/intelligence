// Entorno A — comparación contra AMEXGAS y validación estadística.
// Sólo se invoca desde rutas protegidas (/api/private/*) o scripts locales.
// Reutiliza exclusivamente las funciones de src/core/metrics.js.

import { officialMap, officialCoverage } from '../db/private.js';
import { getSeries } from '../db/public.js';
import { SOURCES, sourceById } from '../sources/index.js';
import {
  compareObservations, errorStats, pairSeries, proposeTolerance, classify, percentile, indexVsOfficial, ratioEstimates,
} from '../core/metrics.js';
import { addMonths, businessDaysBetween } from '../core/dates.js';
import { settings } from '../config.js';

export const LPG = ['propano', 'butano'];

/**
 * Fuentes VIRTUALES del Entorno A: estimaciones que usan datos oficiales para
 * calibrarse. Nunca se exponen en la API pública.
 */
export const VIRTUAL = [{
  id: 'estimado_butano', kind: 'price', products: ['butano'], virtual: true, comparable: true,
  shortName: 'Estimación', name: 'Estimación diaria: propano (EIA) × relación butano/propano de AMEXGAS de los últimos 20 días',
  base: { sourceId: 'eia_propano', product: 'propano' }, window: 20,
}];

const memo = new Map();
export function clearMemo() { memo.clear(); }
/** Serie diaria de una fuente real (base pública) o virtual (estimación calculada). */
export function seriesFor(sourceId, product, { gap = 1 } = {}) {
  const v = VIRTUAL.find((x) => x.id === sourceId);
  if (!v) return getSeries(sourceId, product);
  const key = `${sourceId}|${product}|${gap}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const rows = ratioEstimates(getSeries(v.base.sourceId, v.base.product), officialMap(product), { window: v.window, gap })
    .map((r) => ({ date: r.date, value: r.value, unit: 'cUSD/gal', ratio: r.ratio, ratioTo: r.ratioTo }));
  memo.set(key, { at: Date.now(), rows });
  return rows;
}

function digitalMap(sourceId, product) {
  return new Map(seriesFor(sourceId, product).map((r) => [r.date, r.value]));
}

export function lpgSources(product) {
  return [...SOURCES.filter((s) => s.enabled !== false && s.kind === 'price' && s.products.includes(product)),
    ...VIRTUAL.filter((s) => s.products.includes(product))];
}

export function sourceMeta(id) {
  return VIRTUAL.find((x) => x.id === id) ?? sourceById(id);
}

/** Pares comparables (misma fecha de cotización), opcionalmente desde una fecha. */
export function pairsFor(sourceId, product, { from, lag = 0, official } = {}) {
  const off = official ?? officialMap(product);
  let pairs = pairSeries(digitalMap(sourceId, product), off, { lagBusinessDays: lag });
  if (from) pairs = pairs.filter((p) => p.date >= from);
  return pairs;
}

/** Tolerancia vigente: percentiles del error absoluto en la ventana móvil configurada. */
export function toleranceFor(sourceId, product, official) {
  const all = pairsFor(sourceId, product, { official });
  if (!all.length) return { status: 'insuficiente', n: 0 };
  const from = addMonths(all.at(-1).date, -settings.tolerance.windowMonths);
  return {
    ...proposeTolerance(all.filter((p) => p.date >= from), settings.tolerance),
    windowMonths: settings.tolerance.windowMonths,
  };
}

/** Comparación para una fecha (o la última observación digital). */
export function comparisonFor(sourceId, product, date) {
  const src = sourceMeta(sourceId);
  const series = seriesFor(sourceId, product);
  const dig = date ? series.find((r) => r.date === date) : series.at(-1);
  const off = officialMap(product);
  const offVal = dig ? off.get(dig.date) : undefined;
  const cmp = compareObservations(
    dig && { product, quoteDate: dig.date, value: dig.value, unit: dig.unit },
    offVal !== undefined ? { product, quoteDate: dig.date, value: offVal, unit: 'cUSD/gal' } : null,
    src,
  );
  const tol = toleranceFor(sourceId, product, off);
  const lastOfficial = [...off.keys()].at(-1) ?? null;
  return {
    sourceId, product, date: dig?.date ?? date ?? null, digital: dig?.value ?? null,
    ...cmp, light: cmp.status === 'ok' ? classify(cmp.abs, tol) : cmp.status === 'no_comparable' ? 'rojo' : null,
    tolerance: tol, lastOfficialDate: lastOfficial,
  };
}

/** Comparación más reciente en la que SÍ existe referencia oficial. */
export function lastComparable(sourceId, product) {
  const pairs = pairsFor(sourceId, product);
  return pairs.length ? comparisonFor(sourceId, product, pairs.at(-1).date) : null;
}

/** Serie diaria de diferencias para graficar e inspeccionar. */
export function diffHistory(sourceId, product, from) {
  const tol = toleranceFor(sourceId, product);
  return pairsFor(sourceId, product, { from }).map((p) => {
    const signed = p.digital - p.official;
    return { date: p.date, digital: p.digital, official: p.official, signed, abs: Math.abs(signed), pct: (signed / p.official) * 100, light: classify(Math.abs(signed), tol) };
  });
}

/** Expectativa de observaciones: días con dato oficial dentro del rango cubierto por la fuente digital. */
function expectedDays(sourceId, product, off) {
  const s = seriesFor(sourceId, product);
  if (!s.length) return 0;
  const a = s[0].date, b = s.at(-1).date;
  let n = 0;
  for (const d of off.keys()) if (d >= a && d <= b) n++;
  return n;
}

/** Estadísticas completas por fuente y producto, por año, por régimen de mercado y por desfase. */
export function fullStats() {
  const out = { generatedAt: new Date().toISOString(), coverage: officialCoverage(), products: {} };
  for (const product of LPG) {
    const off = officialMap(product);
    const offDates = [...off.keys()];
    // Régimen de mercado: volatilidad = |cambio diario oficial|; "volátil" si > P75 histórico.
    const moves = new Map();
    for (let i = 1; i < offDates.length; i++) moves.set(offDates[i], Math.abs(off.get(offDates[i]) - off.get(offDates[i - 1])));
    const volCut = percentile([...moves.values()], 0.75);

    out.products[product] = lpgSources(product).map((src) => {
      const pairs = pairsFor(src.id, product, { official: off });
      const expected = expectedDays(src.id, product, off);
      const overall = errorStats(pairs, { expected });
      const byYear = {};
      for (const p of pairs) (byYear[p.date.slice(0, 4)] ||= []).push(p);
      const lags = [-1, 0, 1].map((lag) => {
        const s = errorStats(pairsFor(src.id, product, { lag, official: off }));
        return { lag, n: s.n, mae: s.mae, corrChanges: s.corrChanges };
      });
      const calm = pairs.filter((p) => (moves.get(p.date) ?? 0) <= volCut);
      const volatile = pairs.filter((p) => (moves.get(p.date) ?? 0) > volCut);
      // Meses con mayor error medio: dónde pierde precisión la fuente.
      const byMonth = {};
      for (const p of pairs) (byMonth[p.date.slice(0, 7)] ||= []).push(p);
      const worstMonths = Object.entries(byMonth).filter(([, ps]) => ps.length >= 5)
        .map(([m, ps]) => ({ month: m, ...pick(errorStats(ps), ['n', 'mae', 'bias']) }))
        .sort((a, b) => b.mae - a.mae).slice(0, 5);
      return {
        sourceId: src.id, name: src.shortName, comparable: src.comparable !== false, comparableNote: src.comparableNote ?? null,
        overall,
        byYear: Object.entries(byYear).map(([y, ps]) => ({ year: y, ...pick(errorStats(ps), ['n', 'mae', 'bias', 'p90Abs', 'p95Abs', 'corrChanges']) })),
        regimes: {
          threshold: volCut,
          calm: pick(errorStats(calm), ['n', 'mae', 'p90Abs']),
          volatile: pick(errorStats(volatile), ['n', 'mae', 'p90Abs']),
        },
        lags,
        worstMonths,
        tolerance: toleranceFor(src.id, product, off),
      };
    });
  }
  out.recommendation = recommend(out.products);
  out.indices = Object.fromEntries(LPG.map((p) => [p, indexStats(p)]));
  out.estimates = Object.fromEntries(LPG.map((p) => [p, estimateStats(p)]).filter(([, v]) => v));
  return out;
}

/**
 * Resumen de la estimación virtual de un producto: último valor, variaciones,
 * margen de error histórico con el mismo desfase que tiene hoy la base oficial.
 */
export function estimateStats(product) {
  const v = VIRTUAL.find((x) => x.products.includes(product));
  if (!v) return null;
  const rows = seriesFor(v.id, product);
  if (!rows.length) return null;
  const off = officialMap(product);
  const last = rows.at(-1);
  const lastOfficial = [...off.keys()].at(-1) ?? null;
  // Días hábiles entre el último dato oficial y la estimación: el error crece con ese desfase.
  const gap = Math.max(1, lastOfficial ? businessDaysBetween(lastOfficial, last.date) : 1);
  const backtest = (g) => errorStats(pairSeries(new Map(seriesFor(v.id, product, { gap: g }).map((r) => [r.date, r.value])), off).slice(-500));
  const now = backtest(gap);
  return {
    sourceId: v.id, name: v.name, date: last.date, value: last.value, ratio: last.ratio, ratioTo: last.ratioTo,
    lastOfficialDate: lastOfficial, gapBusinessDays: gap, hasOfficial: off.has(last.date),
    error: { n: now.n, mae: now.mae, p90: now.p90Abs, bias: now.bias, directionHit: now.directionHit },
  };
}

/**
 * Evalúa índices mensuales (PPI) contra el oficial con dos alineaciones:
 * promedio mensual oficial y precio oficial del día de referencia del BLS.
 * Incluye la estimación fuera de muestra del último mes publicado del índice.
 */
export function indexStats(product) {
  const off = officialMap(product);
  return SOURCES.filter((s) => s.enabled !== false && s.kind === 'index' && s.relatesTo?.includes(product)).flatMap((s) => s.products.map((ip) => {
    const idx = getSeries(s.id, ip);
    const variants = ['promedio', 'dia_bls'].map((align) => {
      const r = indexVsOfficial(idx, off, { align });
      const tol = r.pairs.length >= 10 ? proposeTolerance(r.pairs.slice(-60), { ...settings.tolerance, minN: 36 }) : { status: 'insuficiente', n: r.pairs.length };
      return { align, months: r.months, from: r.from, to: r.to, changes: r.changes, estimate: r.estimate, tolerance: tol, recent: r.pairs.slice(-24) };
    });
    const best = [...variants].filter((v) => v.estimate.n).sort((a, b) => a.estimate.mae - b.estimate.mae)[0] ?? variants[0];
    // Estimación para meses del índice posteriores al último oficial (fuera de muestra).
    const lastOff = [...off.keys()].at(-1)?.slice(0, 7);
    const factor = best.estimate.lastFactor;
    const beyond = factor && lastOff ? idx.filter((r) => r.date.slice(0, 7) > lastOff).map((r) => ({ month: r.date.slice(0, 7), index: r.value, estimate: r.value * factor })) : [];
    return { sourceId: s.id, name: s.shortName, indexProduct: ip, best: best.align, variants, beyondOfficial: beyond, lastOfficialMonth: lastOff ?? null };
  }));
}

function pick(o, keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
}

/**
 * Recomienda fuente principal y respaldo por producto: menor P90 del error
 * absoluto en la ventana de tolerancia, con al menos minN observaciones y
 * fuente comparable. Desempata por MAE.
 */
export function recommend(products) {
  const rec = {};
  for (const [product, rows] of Object.entries(products)) {
    const ranked = rows.filter((r) => r.comparable && r.tolerance.status !== 'insuficiente')
      .sort((a, b) => (a.tolerance.green - b.tolerance.green) || (a.overall.mae - b.overall.mae));
    rec[product] = {
      primary: ranked[0]?.sourceId ?? null,
      backup: ranked[1]?.sourceId ?? null,
      validated: ranked[0]?.tolerance.status === 'validada',
      note: ranked.length ? null : 'No hay fuentes digitales comparables con historial suficiente para este producto.',
    };
  }
  return rec;
}
