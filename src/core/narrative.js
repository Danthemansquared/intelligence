// "¿Qué movió el mercado?" — explicación ejecutiva construida de forma
// determinista a partir de datos públicos y notas con fuente verificable.
// No usa servicios de IA ni datos oficiales. Las relaciones se describen como
// coincidencias o contexto, nunca como causalidad.

import { percentile } from './metrics.js';
import { addDays, toDate } from './dates.js';

const NAMES = { propano: 'El propano', butano: 'El butano', wti: 'El WTI', brent: 'El Brent' };
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function fmtDateEs(s) {
  const d = toDate(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function verb(x) {
  return x > 0 ? 'subió' : x < 0 ? 'bajó' : 'se mantuvo sin cambio';
}

function fmtNum(x, d = 1) {
  return Math.abs(x).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Cambios porcentuales semanales históricos (t vs ≤ t−7) para calibrar qué es "relevante". */
export function weeklyChangeDistribution(rows, years = 2) {
  if (rows.length < 30) return null;
  const from = addDays(rows.at(-1).date, -365 * years);
  const pts = rows.filter((r) => r.date >= from);
  const out = [];
  let j = 0;
  for (let i = 0; i < pts.length; i++) {
    const target = addDays(pts[i].date, -7);
    while (j + 1 < pts.length && pts[j + 1].date <= target) j++;
    if (pts[j].date <= target && pts[j].value) out.push(Math.abs((pts[i].value - pts[j].value) / pts[j].value) * 100);
  }
  return out.length >= 20 ? { p50: percentile(out, 0.5), p75: percentile(out, 0.75), p90: percentile(out, 0.9) } : null;
}

export function relevance(pctAbs, dist) {
  if (!dist) return 'sin_historial';
  if (pctAbs > dist.p90) return 'fuera_de_lo_habitual';
  if (pctAbs > dist.p75) return 'relevante';
  return 'normal';
}

/** Próximo miércoles (publicación habitual del reporte semanal de EIA). */
export function nextWednesday(today) {
  let d = addDays(today, 1);
  while (toDate(d).getUTCDay() !== 3) d = addDays(d, 1);
  return d;
}

// Lectura económica habitual de cada indicador de contexto: signo del cambio
// que, por sí solo, tendería a presionar el precio al alza.
const BULLISH_SIGN = { inv_propano_eeuu: -1, exp_propano_eeuu: +1 };
const READING = {
  inv_propano_eeuu: { '-1': 'menos producto disponible, lo que suele sostener el precio', '1': 'más producto disponible, lo que suele presionar el precio a la baja' },
  exp_propano_eeuu: { '1': 'mayor demanda externa, lo que suele sostener el precio', '-1': 'menor demanda externa, lo que suele presionar el precio a la baja' },
};

/**
 * series: { propano: {variations, dist, unit}, butano: ..., wti: ..., brent: ... }
 * context: [{ key, label, date, value, change, unit, source, url, products }]
 * notes: [{ event_date, title, summary, factor, products, source_name, url }]
 */
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (d) => `${MONTH_NAMES[toDate(d).getUTCMonth()]} de ${toDate(d).getUTCFullYear()}`;

/** Narrativa a partir de un índice mensual cuando no hay precio diario (p. ej. PPI de butano). */
function indexNarrative(product, ix, notes) {
  const m = ix.mom;
  const level = !m || !ix.dist ? 'sin_historial' : Math.abs(m.pct) > ix.dist.p90 ? 'fuera_de_lo_habitual' : Math.abs(m.pct) > ix.dist.p75 ? 'relevante' : 'normal';
  const enc = (x) => (x > 0 ? 'se encareció' : x < 0 ? 'se abarató' : 'se mantuvo estable');
  const headline = m
    ? `El ${product} ${enc(m.pct)} ${fmtNum(m.pct)}% en Estados Unidos durante ${monthName(ix.date)}.`
    : `Precio del ${product} en Estados Unidos, ${monthName(ix.date)}.`;
  const body = [];
  if (ix.yoy) body.push(`Está ${fmtNum(ix.yoy.pct)}% ${ix.yoy.pct >= 0 ? 'por arriba' : 'por debajo'} de hace un año.`);
  if (level === 'fuera_de_lo_habitual') body.push('Es un cambio mensual mayor que el 90% de los últimos cinco años.');
  else if (level === 'relevante') body.push('Es un cambio mayor al típico de un mes.');
  const rel = notes.filter((n) => n.event_date >= ix.date && n.products.includes(product));
  for (const n of rel) body.push(`${n.title} (${n.source_name}, ${fmtDateEs(n.event_date)}).`);
  if (rel.length) body.push('Estos hechos podrían estar relacionados con el movimiento; los datos disponibles no permiten atribuirles toda la variación.');
  else body.push('Sin factores determinantes identificados en las noticias registradas.');
  return {
    product, level, headline, body,
    watch: `A vigilar: el dato de ${monthName(addDays(ix.date, 32))} se publica a mediados del mes siguiente (BLS).`,
    sources: [{ name: 'BLS vía FRED', url: ix.url, date: ix.date, title: 'Índice de precios del butano' }, ...rel.map((n) => ({ name: n.source_name, url: n.url, date: n.event_date, title: n.title }))],
  };
}

export function buildNarrative({ series, context = [], notes = [], today, indices = {} }) {
  const items = [];
  for (const product of ['propano', 'butano']) {
    const s = series[product];
    if (!s?.variations?.weekly && indices[product]?.length) {
      items.push(indexNarrative(product, indices[product][0], notes));
      continue;
    }
    if (!s?.variations?.weekly) {
      items.push({
        product, level: 'sin_datos', sources: [], body: [],
        headline: `${NAMES[product]}: sin precio digital para medir la variación.`,
        ...(product === 'butano' ? { body: ['No existe una fuente pública gratuita del butano normal de Mont Belvieu. El propano y el crudo son las mejores referencias de contexto mientras no se contrate una fuente (OPIS, Argus).'] } : {}),
      });
      continue;
    }
    const w = s.variations.weekly;
    const level = relevance(Math.abs(w.pct), s.dist);
    const headline = `${NAMES[product]} ${verb(w.abs)} ${fmtNum(w.abs)} ${s.unit} (${w.pct >= 0 ? '+' : '−'}${fmtNum(w.pct)}%) en la semana al ${fmtDateEs(s.variations.date)}.`;
    const body = [];
    if (level === 'fuera_de_lo_habitual') body.push(`Es un movimiento fuera de lo habitual: mayor que el 90% de las variaciones semanales de los últimos dos años (${fmtNum(s.dist.p90)}%).`);
    else if (level === 'relevante') body.push('Es un movimiento mayor al típico: más amplio que el 75% de las semanas de los últimos dos años.');
    else if (level === 'normal') body.push('La variación está dentro del rango semanal habitual.');

    const factors = [];
    const crude = series.wti?.variations?.weekly ?? series.brent?.variations?.weekly;
    const crudeName = series.wti?.variations?.weekly ? 'WTI' : 'Brent';
    if (crude) {
      const same = Math.sign(crude.pct) === Math.sign(w.pct) && crude.pct !== 0;
      factors.push(same
        ? `Crudo: el ${crudeName} ${verb(crude.pct)} ${fmtNum(crude.pct)}% en el mismo periodo; el movimiento coincidió con el del crudo.`
        : `Crudo: el ${crudeName} ${verb(crude.pct)} ${fmtNum(crude.pct)}%, en sentido distinto; el movimiento parece responder a factores propios del GLP.`);
    }
    for (const c of context.filter((c) => c.products?.includes(product) && c.change)) {
      const sign = Math.sign(c.change);
      const reading = READING[c.key]?.[String(sign)];
      const consistent = BULLISH_SIGN[c.key] ? Math.sign(w.abs) === sign * BULLISH_SIGN[c.key] : null;
      factors.push(`${c.label} ${sign > 0 ? 'aumentaron' : 'disminuyeron'} ${fmtNum(c.change)} ${c.unit} en la semana al ${fmtDateEs(c.date)} (${c.source})${reading ? `: ${reading}` : ''}${consistent === null ? '.' : consistent ? '; es consistente con el movimiento.' : '; no explica el movimiento.'}`);
    }
    const from = addDays(s.variations.date, -10);
    const rel = notes.filter((n) => n.event_date >= from && n.products.includes(product));
    for (const n of rel) factors.push(`${n.title} (${n.source_name}, ${fmtDateEs(n.event_date)}).`);

    if (!factors.length) body.push('Sin factores determinantes identificados.');
    else {
      body.push(...factors);
      if (!rel.length && level !== 'normal') body.push('No se registraron noticias específicas del sector en el periodo.');
      body.push('Estos factores podrían estar relacionados con el movimiento; los datos disponibles no permiten atribuirles toda la variación.');
    }
    const watch = today ? `A vigilar: próximo reporte semanal de la EIA (inventarios, exportaciones y precio) el ${fmtDateEs(nextWednesday(today))}, y la tendencia del crudo.` : null;
    items.push({
      product, headline, level, body, watch,
      sources: rel.map((n) => ({ name: n.source_name, url: n.url, date: n.event_date, title: n.title })),
    });
  }
  return items;
}
