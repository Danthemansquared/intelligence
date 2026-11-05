// Mezcla de gas LP (propano/butano) en $/kg y referencia semanal.
// Replica la convención de los archivos de trabajo AMEXGAS:
//   USD/kg  = cUSD/gal ÷ (2.0441214 × 100)          (mismo factor para propano y butano)
//   $/kg    = tipo de cambio (MXN/USD) × USD/kg
//   Mezcla  = propano $/kg × p + butano $/kg × (1 − p)   (proporción en masa)
// Semana de referencia: viernes a jueves; el pronóstico compara el promedio de la
// última semana completa (T-1) contra la anterior (T-2).

import { addDays, toDate, businessDaysBetween } from './dates.js';

export const KG_PER_GAL = 2.0441214;
export const MIXES = { '90-10': 0.9, '89-11': 0.89, '60-40': 0.6 };

export function mxnPerKg(cusdPerGal, fx) {
  return (cusdPerGal / (KG_PER_GAL * 100)) * fx;
}

export function mixValue(propanoKg, butanoKg, wPropano) {
  return propanoKg * wPropano + butanoKg * (1 - wPropano);
}

/** Viernes en que empieza la semana de referencia (viernes a jueves) de una fecha. */
export function weekStart(date) {
  const wd = toDate(date).getUTCDay(); // 0 dom … 5 vie
  return addDays(date, -((wd - 5 + 7) % 7));
}

/**
 * Tipo de cambio para una fecha: el del archivo oficial si existe; si no, el
 * público (FRED). Si ninguno publica ese día (festivo), se usa el último
 * disponible hasta 3 días hábiles antes y se marca; nunca se inventa.
 */
export function fxFor(date, fileFx, publicFx, publicDates) {
  if (fileFx.has(date)) return { fx: fileFx.get(date), source: 'archivo' };
  if (publicFx.has(date)) return { fx: publicFx.get(date), source: 'FRED' };
  // último público anterior, búsqueda binaria en fechas ordenadas
  let lo = 0, hi = publicDates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (publicDates[m] < date) { ans = m; lo = m + 1; } else hi = m - 1; }
  if (ans >= 0 && businessDaysBetween(publicDates[ans], date) <= 3) return { fx: publicFx.get(publicDates[ans]), source: 'FRED (día previo)' };
  return null;
}

/**
 * Serie diaria de la mezcla. propano/butano: Map(fecha → cUSD/gal).
 * Sólo fechas con ambos productos y tipo de cambio.
 */
export function dailyMix(propano, butano, wPropano, fileFx = new Map(), publicFx = new Map()) {
  const publicDates = [...publicFx.keys()].sort();
  const out = [];
  for (const date of [...propano.keys()].sort()) {
    if (!butano.has(date)) continue;
    const f = fxFor(date, fileFx, publicFx, publicDates);
    if (!f) continue;
    const p = propano.get(date), b = butano.get(date);
    const pk = mxnPerKg(p, f.fx), bk = mxnPerKg(b, f.fx);
    out.push({ date, value: mixValue(pk, bk, wPropano), propano: p, butano: b, fx: f.fx, fxSource: f.source });
  }
  return out;
}

const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** Promedios por semana de referencia (viernes a jueves). */
export function weeklyAverages(daily) {
  const by = new Map();
  for (const r of daily) {
    const w = weekStart(r.date);
    (by.get(w) ?? by.set(w, []).get(w)).push(r);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, rs]) => ({
    week, end: addDays(week, 6), n: rs.length,
    value: avg(rs.map((r) => r.value)), propano: avg(rs.map((r) => r.propano)),
    butano: avg(rs.map((r) => r.butano)), fx: avg(rs.map((r) => r.fx)),
  }));
}

/**
 * Pronóstico de la referencia: última semana completa (T-1) vs. la anterior (T-2).
 * Una semana está completa cuando su jueves ya pasó y hay precios hasta ese jueves
 * (o el miércoles, si el jueves fue festivo). `upToDate` indica si T-1 es la semana
 * inmediatamente anterior a la actual; si no, faltan precios recientes.
 */
export function weeklyForecast(weeks, today, lastDate = weeks.at(-1)?.end) {
  const done = weeks.filter((w) => w.end < today && lastDate >= addDays(w.end, -1));
  if (done.length < 2) return null;
  const [t2, t1] = done.slice(-2);
  const pct = (a, b) => (b ? (a / b - 1) * 100 : null);
  return {
    t1, t2,
    change: t1.value - t2.value, // MXN/kg
    changePct: pct(t1.value, t2.value),
    propanoPct: pct(t1.propano, t2.propano),
    butanoPct: pct(t1.butano, t2.butano),
    fxPct: pct(t1.fx, t2.fx),
    consecutive: t1.week === addDays(t2.week, 7),
    current: weekStart(today),
    upToDate: t1.week === addDays(weekStart(today), -7),
  };
}

const n2 = (x) => x.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p2 = (x) => `${n2(x)}%`;

/** Mensaje para compartir, con el mismo formato del archivo de trabajo (unidades explícitas). */
export function forecastMessage(f, label) {
  if (!f) return null;
  const centavos = Math.abs(f.change * 100);
  const when = f.upToDate === false
    ? 'Con los últimos precios disponibles (semanas sin actualizar) se estima un'
    : 'Esta semana se estima un';
  return `Buena tarde, comparto el pronóstico de variación del precio de la referencia. ${when} ${f.change < 0 ? 'decremento' : 'incremento'} de ${n2(centavos)} centavos de peso por kg (${f.change < 0 ? '−' : '+'}${n2(Math.abs(f.change))} MXN/kg).

Comentarios:
- Los promedios semanales T-1 vs T-2 muestran variaciones de ${p2(f.propanoPct)} para el propano MB y ${p2(f.butanoPct)} para el butano MB, así como ${p2(f.fxPct)} para el tipo de cambio.
- A lo largo de la semana, el Mix ${label} de MB ${f.change < 0 ? 'bajó' : 'subió'} de ${n2(f.t2.value)} a ${n2(f.t1.value)} MXN/kg; el tipo de cambio ${f.fxPct < 0 ? 'bajó' : 'subió'} de ${n2(f.t2.fx)} a ${n2(f.t1.fx)} MXN/USD.`;
}
