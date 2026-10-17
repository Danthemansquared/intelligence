// Gráfica de líneas en SVG, sin dependencias. Un solo eje Y con unidad
// explícita, cuadrícula discreta y cruz con tooltip al pasar el cursor/tocar.

const NS = 'http://www.w3.org/2000/svg';
const tip = () => document.getElementById('tooltip');

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

const t = (s) => Date.parse(`${s}T00:00:00Z`);

function niceTicks(min, max, count = 5) {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dateTick(ms, spanDays) {
  const d = new Date(ms);
  const m = MONTHS[d.getUTCMonth()];
  if (spanDays > 800) return String(d.getUTCFullYear());
  if (spanDays > 120) return `${m} ${String(d.getUTCFullYear()).slice(2)}`;
  return `${d.getUTCDate()} ${m}`;
}

export function fmtDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * opts: { series: [{ name, cls ('c1'…'c4'), rows: [[date, value]] }], unit, decimals, band: [lo, hi], zero: bool, signed: bool }
 */
export function lineChart(container, opts) {
  container.innerHTML = '';
  const W = container.clientWidth || 600;
  const H = container.clientHeight || 300;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || 'Gráfica' }, container);
  const series = opts.series.filter((s) => s.rows.length);
  if (!series.length) {
    el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' }, svg).textContent = opts.emptyText || 'Sin datos para el periodo seleccionado';
    return;
  }
  const dec = opts.decimals ?? 1;
  const fmt = (v) => (opts.signed && v > 0 ? '+' : '') + v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (const [d, v] of s.rows) {
    const x = t(d); xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, v); ymax = Math.max(ymax, v);
  }
  if (opts.band) { ymin = Math.min(ymin, opts.band[0]); ymax = Math.max(ymax, opts.band[1]); }
  if (opts.zero) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
  const pad = (ymax - ymin) * 0.08 || 1;
  const ticks = niceTicks(ymin - (opts.zero ? 0 : pad), ymax + pad);
  const y0 = ticks[0], y1 = ticks.at(-1);
  // Eje de valores a la derecha, como en Bolsa: la lectura empieza por la línea, no por los números.
  const right = 10 + Math.max(...ticks.map((v) => fmt(v).length)) * 6.6;
  const m = { l: 4, r: right, t: 24, b: 26 };
  const X = (ms) => m.l + ((ms - xmin) / (xmax - xmin || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);

  // Unidad explícita en el eje.
  el('text', { x: W, y: 11, 'text-anchor': 'end', class: 'unit-label' }, svg).textContent = opts.unit;
  for (const v of ticks) {
    el('line', { x1: m.l, x2: W - m.r + 4, y1: Y(v), y2: Y(v), class: v === 0 && opts.zero ? 'baseline' : 'gridline' }, svg);
    el('text', { x: W, y: Y(v) + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(v);
  }
  if (opts.band) el('rect', { x: m.l, width: W - m.l - m.r, y: Y(opts.band[1]), height: Math.max(0, Y(opts.band[0]) - Y(opts.band[1])), class: 'band' }, svg);
  const spanDays = (xmax - xmin) / 86400000;
  const nx = Math.max(2, Math.min(6, Math.floor((W - m.l) / 110)));
  for (let i = 0; i <= nx; i++) {
    const ms = xmin + ((xmax - xmin) * i) / nx;
    el('text', { x: X(ms), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nx ? 'end' : 'middle', class: 'tick' }, svg).textContent = dateTick(ms, spanDays);
  }
  for (const s of series) {
    // Huecos de datos (> 7 días) se dibujan como cortes, no se interpolan.
    const segs = [];
    let prev = null;
    for (const [d, v] of s.rows) {
      const ms = t(d);
      if (prev === null || ms - prev > (opts.maxGapDays ?? 7) * 86400000) segs.push([]);
      segs.at(-1).push([X(ms), Y(v)]);
      prev = ms;
    }
    const path = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    // Área tenue bajo la línea sólo con una serie de precios (con varias se vuelve ruido).
    if (series.length === 1 && !opts.zero) {
      const base = H - m.b;
      for (const pts of segs) if (pts.length > 1) el('path', { d: `${path(pts)}L${pts.at(-1)[0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`, class: `area fl-${s.cls}` }, svg);
    }
    el('path', { d: segs.map(path).join(''), class: `series st-${s.cls}` }, svg);
    const end = segs.at(-1).at(-1);
    if (!opts.zero) el('circle', { cx: end[0], cy: end[1], r: 4, class: `end fl-${s.cls}` }, svg);
  }

  // Capa de interacción
  const cross = el('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' }, svg);
  const dots = series.map((s) => el('circle', { r: 4, class: `dot fl-${s.cls}`, visibility: 'hidden' }, svg));
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const dates = [...new Set(series.flatMap((s) => s.rows.map((r) => r[0])))].sort();
  const lookup = series.map((s) => new Map(s.rows));
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const ms = xmin + ((px - m.l) / (W - m.l - m.r)) * (xmax - xmin);
    let lo = 0, hi = dates.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t(dates[mid]) < ms) lo = mid + 1; else hi = mid; }
    const cand = [dates[lo - 1], dates[lo]].filter(Boolean);
    const d = cand.sort((a, b) => Math.abs(t(a) - ms) - Math.abs(t(b) - ms))[0];
    const x = X(t(d));
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    let rows = '';
    series.forEach((s, i) => {
      const v = lookup[i].get(d);
      if (v === undefined) { dots[i].setAttribute('visibility', 'hidden'); return; }
      dots[i].setAttribute('cx', x); dots[i].setAttribute('cy', Y(v)); dots[i].setAttribute('visibility', 'visible');
      rows += `<div class="t-row"><span><i class="bg-${s.cls}"></i>${s.name}</span><b>${fmt(v)}</b></div>`;
    });
    const tt = tip();
    tt.innerHTML = `<div class="t-date">${fmtDate(d)} · ${opts.unit}</div>${rows}${opts.tooltipExtra ? opts.tooltipExtra(d) : ''}`;
    tt.hidden = false;
    const tw = tt.offsetWidth;
    const left = ev.clientX + 16 + tw > window.innerWidth ? ev.clientX - tw - 16 : ev.clientX + 16;
    tt.style.left = `${Math.max(8, left)}px`;
    tt.style.top = `${Math.max(8, ev.clientY - 20)}px`;
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); tip().hidden = true; };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}
