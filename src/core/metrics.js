// Cálculos de diferencias, variaciones, estadísticas de error y tolerancias.
// Es la ÚNICA implementación de estas fórmulas: servidor, scripts y pruebas
// la reutilizan. Los valores se calculan con precisión completa; el redondeo
// se hace exclusivamente en la interfaz.

import { addDays, addMonths, businessDaysBetween } from './dates.js';

// ───────────────────────── Diferencia vs. referencia ─────────────────────────

/**
 * Δ = P_digital − P_oficial (misma unidad).
 * signed > 0 → la fuente digital está POR ENCIMA del oficial.
 */
export function difference(pDigital, pOfficial) {
  if (!Number.isFinite(pDigital) || !Number.isFinite(pOfficial)) {
    throw new Error('Se requieren dos precios numéricos');
  }
  if (pOfficial <= 0) throw new Error('El precio de referencia debe ser positivo');
  const signed = pDigital - pOfficial;
  return {
    signed,
    abs: Math.abs(signed),
    pct: (signed / pOfficial) * 100,
    direction: signed > 0 ? 'arriba' : signed < 0 ? 'abajo' : 'igual',
  };
}

/** Umbral bajo el cual dos precios se consideran iguales por la precisión de los datos. */
export const ZERO_EPS = 1e-9;

/**
 * Determina si dos observaciones son comparables y, si lo son, calcula la
 * diferencia. Nunca reutiliza un precio oficial de otra fecha.
 *
 * digital/official: { product, quoteDate, value, unit, reference? }
 * source: metadatos de la fuente digital ({ comparable: bool, comparableNote })
 */
export function compareObservations(digital, official, source = {}) {
  if (!digital) return { status: 'sin_dato_digital', reason: 'La fuente digital no tiene dato para esta fecha.' };
  if (!official) {
    return { status: 'sin_referencia', reason: 'Sin referencia oficial disponible para esta fecha.' };
  }
  if (digital.product !== official.product) {
    return { status: 'no_comparable', reason: `Productos distintos (${digital.product} vs ${official.product}).` };
  }
  if (digital.unit !== official.unit) {
    return { status: 'no_comparable', reason: `Unidades distintas (${digital.unit} vs ${official.unit}); normalice antes de comparar.` };
  }
  if (digital.quoteDate !== official.quoteDate) {
    return { status: 'no_comparable', reason: `Fechas de cotización distintas (${digital.quoteDate} vs ${official.quoteDate}).` };
  }
  if (source.comparable === false) {
    return { status: 'no_comparable', reason: source.comparableNote || 'La fuente no publica la misma referencia de mercado.' };
  }
  const d = difference(digital.value, official.value);
  if (Math.abs(d.signed) < ZERO_EPS) d.direction = 'igual';
  return { status: 'ok', ...d, digital: digital.value, official: official.value, quoteDate: digital.quoteDate };
}

// ─────────────────────────────── Estadística ───────────────────────────────

export function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Desviación estándar muestral (n − 1). */
export function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Percentil con interpolación lineal (método 7 de Hyndman-Fan, como Excel PERCENTILE.INC). */
export function percentile(xs, p) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const h = (a.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return a[lo] + (h - lo) * (a[hi] - a[lo]);
}

/** Correlación de Pearson. */
export function correlation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export const DEFAULT_BANDS = [0.5, 1, 2, 3, 5]; // cUSD/gal

/**
 * Empareja dos series por fecha de cotización exacta (con desfase opcional en
 * días hábiles de la serie digital). Sin interpolación ni relleno.
 * digital/official: Map(quoteDate → value)
 */
export function pairSeries(digital, official, { lagBusinessDays = 0 } = {}) {
  const officialDates = [...official.keys()].sort();
  const pairs = [];
  for (let i = 0; i < officialDates.length; i++) {
    const od = officialDates[i];
    // Con desfase: compara el oficial del día t con el dato digital de t+lag (en la secuencia de días oficiales).
    const dd = officialDates[i + lagBusinessDays];
    if (dd === undefined) continue;
    if (digital.has(dd)) pairs.push({ date: od, digitalDate: dd, digital: digital.get(dd), official: official.get(od) });
  }
  return pairs;
}

/**
 * Estadísticas de error para pares { date, digital, official } ordenados por fecha.
 * error = digital − oficial.
 */
export function errorStats(pairs, { bands = DEFAULT_BANDS, expected = null } = {}) {
  const n = pairs.length;
  const base = { n, expected, coverage: expected ? n / expected : null };
  if (n === 0) return { ...base, mae: null };
  const err = pairs.map((p) => p.digital - p.official);
  const absErr = err.map(Math.abs);
  const pctAbs = pairs.filter((p) => p.official > 0).map((p) => Math.abs((p.digital - p.official) / p.official) * 100);
  const within = {};
  for (const b of bands) within[b] = absErr.filter((e) => e <= b).length / n;

  // Capacidad para identificar movimientos: compara cambios entre observaciones consecutivas.
  const dD = [], dO = [];
  let sameDir = 0, moves = 0;
  for (let i = 1; i < n; i++) {
    const a = pairs[i].digital - pairs[i - 1].digital;
    const b = pairs[i].official - pairs[i - 1].official;
    dD.push(a); dO.push(b);
    if (b !== 0) { moves++; if (Math.sign(a) === Math.sign(b)) sameDir++; }
  }

  return {
    ...base,
    from: pairs[0].date,
    to: pairs[n - 1].date,
    mae: mean(absErr),
    mape: pctAbs.length ? mean(pctAbs) : null,
    bias: mean(err),
    sdError: stdev(err),
    medianAbs: percentile(absErr, 0.5),
    p90Abs: percentile(absErr, 0.9),
    p95Abs: percentile(absErr, 0.95),
    p99Abs: percentile(absErr, 0.99),
    maxAbs: Math.max(...absErr),
    corrLevels: correlation(pairs.map((p) => p.digital), pairs.map((p) => p.official)),
    corrChanges: correlation(dD, dO),
    directionHit: moves ? sameDir / moves : null,
    within,
  };
}

// ─────────────────────────────── Tolerancias ───────────────────────────────

export const MIN_N_VALIDATED = 120; // ~6 meses hábiles

/**
 * Propone umbrales del semáforo a partir del error absoluto histórico:
 *   verde  ≤ P90  (comportamiento normal)
 *   amarillo ≤ P99 (inusual, revisar)
 *   rojo   > P99  (fuera de lo observado históricamente)
 * Los percentiles son configurables. Si n < MIN_N_VALIDATED se marca como preliminar.
 */
export function proposeTolerance(pairs, { greenP = 0.9, yellowP = 0.99, minN = MIN_N_VALIDATED } = {}) {
  const absErr = pairs.map((p) => Math.abs(p.digital - p.official));
  if (absErr.length < 10) return { status: 'insuficiente', n: absErr.length };
  return {
    status: absErr.length >= minN ? 'validada' : 'preliminar',
    n: absErr.length,
    green: percentile(absErr, greenP),
    yellow: percentile(absErr, yellowP),
    greenP,
    yellowP,
    from: pairs[0].date,
    to: pairs[pairs.length - 1].date,
  };
}

/** Semáforo para una diferencia absoluta dada una tolerancia. */
export function classify(absDiff, tol) {
  if (!tol || tol.green == null) return 'sin_tolerancia';
  if (absDiff <= tol.green) return 'verde';
  if (absDiff <= tol.yellow) return 'amarillo';
  return 'rojo';
}

// ─────────────────────────────── Variaciones ───────────────────────────────

/**
 * Último valor con fecha ≤ date. rows: [{ date, value }] ordenado ascendente.
 */
export function valueAtOrBefore(rows, date) {
  let lo = 0, hi = rows.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) { ans = rows[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Variación diaria (vs observación previa), semanal (vs ≤ t−7 días) y mensual (vs ≤ t−1 mes).
 * Devuelve el cambio absoluto y porcentual, con la fecha base usada.
 */
export function variations(rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const mk = (base) => base && base.value
    ? { base: base.date, baseValue: base.value, abs: last.value - base.value, pct: ((last.value - base.value) / base.value) * 100 }
    : null;
  return {
    date: last.date,
    value: last.value,
    daily: mk(rows.length > 1 ? rows[rows.length - 2] : null),
    weekly: mk(valueAtOrBefore(rows, addDays(last.date, -7))),
    monthly: mk(valueAtOrBefore(rows, addMonths(last.date, -1))),
  };
}

// ─────────────────────────────── Antigüedad ───────────────────────────────

/**
 * Evalúa si el último dato de una fuente está al día.
 * maxLagBusinessDays: rezago normal de publicación de la fuente.
 */
export function freshness(lastQuoteDate, today, maxLagBusinessDays) {
  if (!lastQuoteDate) return { status: 'sin_datos', lag: null };
  const lag = businessDaysBetween(lastQuoteDate, today);
  if (lag <= maxLagBusinessDays) return { status: 'al_dia', lag };
  if (lag <= maxLagBusinessDays * 2 + 2) return { status: 'atrasada', lag };
  return { status: 'detenida', lag };
}

// ─────────────────────── Índices mensuales (p. ej. PPI del BLS) ───────────────────────
// Un índice no es un precio: no se calcula «Diferencia vs. AMEXGAS» con él. Se mide
// (1) si sigue la dirección y magnitud de los cambios mensuales del precio oficial y
// (2) el error de una estimación calibrada fuera de muestra (índice × factor de los
// 12 meses previos), en cUSD/gal.

/** Martes de la semana (dom–sáb) que contiene el día 13: fecha de referencia de precios del PPI (BLS). */
export function blsPricingDate(year, month) {
  const d13 = new Date(Date.UTC(year, month - 1, 13));
  const day = 13 - d13.getUTCDay() + 2;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Referencia oficial por mes: promedio mensual (≥ minDays días) o el valor exacto del día de referencia BLS. */
export function monthlyReference(official, align = 'promedio', { minDays = 10 } = {}) {
  const out = new Map();
  if (align === 'promedio') {
    const acc = new Map();
    for (const [d, v] of official) {
      const m = d.slice(0, 7);
      const a = acc.get(m) ?? { s: 0, n: 0 };
      a.s += v; a.n++; acc.set(m, a);
    }
    for (const [m, a] of acc) if (a.n >= minDays) out.set(m, a.s / a.n);
  } else {
    const months = new Set([...official.keys()].map((d) => d.slice(0, 7)));
    for (const m of months) {
      const d = blsPricingDate(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
      if (official.has(d)) out.set(m, official.get(d)); // sin día exacto → se omite el mes (no se rellena)
    }
  }
  return out;
}

/**
 * index: [{ date: 'YYYY-MM-01', value }] ascendente; official: Map(fecha → cUSD/gal).
 */
export function indexVsOfficial(index, official, { align = 'promedio', calibMonths = 12, minCalib = 6 } = {}) {
  const ref = monthlyReference(official, align);
  const rows = index.map((r) => ({ month: r.date.slice(0, 7), index: r.value, official: ref.get(r.date.slice(0, 7)) }))
    .filter((r) => r.official !== undefined && r.index > 0);
  // Cambios mensuales (meses consecutivos con ambos datos)
  const ci = [], co = [];
  let hit = 0, moves = 0;
  for (let i = 1; i < rows.length; i++) {
    const [a, b] = [rows[i - 1], rows[i]];
    if (addMonths(`${a.month}-01`, 1).slice(0, 7) !== b.month) continue;
    const di = (b.index / a.index - 1) * 100, dof = (b.official / a.official - 1) * 100;
    ci.push(di); co.push(dof);
    if (dof !== 0) { moves++; if (Math.sign(di) === Math.sign(dof)) hit++; }
  }
  // Estimación calibrada fuera de muestra
  const pairs = [];
  for (let i = 0; i < rows.length; i++) {
    const from = addMonths(`${rows[i].month}-01`, -calibMonths).slice(0, 7);
    const prev = rows.slice(0, i).filter((r) => r.month >= from).map((r) => r.official / r.index);
    if (prev.length < minCalib) continue;
    const k = percentile(prev, 0.5);
    pairs.push({ date: rows[i].month, digital: rows[i].index * k, official: rows[i].official, factor: k });
  }
  return {
    align, months: rows.length, from: rows[0]?.month ?? null, to: rows.at(-1)?.month ?? null,
    changes: { n: ci.length, corr: correlation(ci, co), directionHit: moves ? hit / moves : null, maeChangePts: ci.length ? mean(ci.map((x, i) => Math.abs(x - co[i]))) : null },
    estimate: { ...errorStats(pairs), lastFactor: pairs.at(-1)?.factor ?? null },
    pairs,
  };
}

/** Cambio mensual (vs mes previo) e interanual (vs mismo mes del año anterior) de una serie mensual. */
export function indexChanges(rows) {
  if (!rows.length) return null;
  const last = rows.at(-1);
  const at = (date) => rows.find((r) => r.date === date);
  const mk = (base) => (base && base.value ? { base: base.date, baseValue: base.value, abs: last.value - base.value, pct: (last.value / base.value - 1) * 100 } : null);
  const momPcts = [];
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].value) momPcts.push(Math.abs(rows[i].value / rows[i - 1].value - 1) * 100);
  const recent = momPcts.slice(-60); // últimos 5 años
  return {
    date: last.date, value: last.value,
    mom: mk(at(addMonths(last.date, -1))),
    yoy: mk(at(addMonths(last.date, -12))),
    dist: recent.length >= 24 ? { p75: percentile(recent, 0.75), p90: percentile(recent, 0.9) } : null,
  };
}

// ─────────────── Estimación por relación (p. ej. butano a partir del propano) ───────────────

/**
 * Estima un precio objetivo a partir de un precio base diario y la relación
 * objetivo/base observada recientemente:
 *   estimado(d) = base(d) × mediana(objetivo/base) de las últimas `window` fechas con ambos datos
 * Sólo usa relaciones con fecha ≤ la observación base `gap` posiciones antes de d
 * (gap ≥ 1 ⇒ nunca usa el dato del mismo día: estimación fuera de muestra).
 * base: [{ date, value }] ascendente; target: Map(fecha → valor).
 */
export function ratioEstimates(base, target, { window = 20, gap = 1, minRatios = 10 } = {}) {
  const ratios = base.filter((b) => target.has(b.date) && b.value > 0).map((b) => ({ date: b.date, r: target.get(b.date) / b.value }));
  const out = [];
  let j = -1; // último índice de `ratios` con fecha ≤ cutoff
  for (let i = gap; i < base.length; i++) {
    const cutoff = base[i - gap].date;
    while (j + 1 < ratios.length && ratios[j + 1].date <= cutoff) j++;
    if (j + 1 < minRatios) continue;
    const slice = ratios.slice(Math.max(0, j + 1 - window), j + 1);
    const ratio = percentile(slice.map((x) => x.r), 0.5);
    out.push({ date: base[i].date, value: base[i].value * ratio, ratio, ratioFrom: slice[0].date, ratioTo: slice.at(-1).date });
  }
  return out;
}
