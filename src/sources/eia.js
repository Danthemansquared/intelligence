// Adaptador EIA (U.S. Energy Information Administration) por las tablas HTML
// públicas de historia (dnav/pet/hist), que no requieren llave.
//
// Diaria: filas semanales "2026 Oct-12 to Oct-16" (celda class B6) seguidas de
//   5 celdas B3 (lunes a viernes; vacías en festivos).
// Semanal: filas mensuales "2026-Oct" (B6) seguidas de pares B5 (fecha mm/dd de
//   fin de semana) + B3 (valor).
// La página incluye "Release Date: mm/dd/yyyy" → fecha de publicación.
import { httpGet, signature } from './http.js';
import { addDays } from '../core/dates.js';
import { fredCsvUrl, parseFredCsv } from './fred.js';

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

export function eiaHistUrl(seriesId, freq) {
  return `https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=${encodeURIComponent(seriesId)}&f=${freq}`;
}

function cells(html) {
  const out = [];
  const re = /<td class='(B[356])'>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) out.push({ cls: m[1], text: m[2].replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim() });
  return out;
}

function toNumber(t) {
  const v = Number(t.replace(/,/g, ''));
  return t !== '' && Number.isFinite(v) ? v : null;
}

export function releaseDate(html) {
  const m = html.match(/Release Date:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export function parseEiaDaily(html) {
  const cs = cells(html);
  const points = [];
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].cls !== 'B6') continue;
    const m = cs[i].text.match(/^(\d{4})\s+([A-Z][a-z]{2})-\s?(\d{1,2})\s+to/);
    if (!m) continue;
    const start = `${m[1]}-${pad(MONTHS[m[2]])}-${pad(Number(m[3]))}`;
    for (let k = 0; k < 5; k++) {
      const c = cs[i + 1 + k];
      if (!c || c.cls !== 'B3') break;
      const v = toNumber(c.text);
      if (v !== null) points.push({ date: addDays(start, k), value: v });
    }
  }
  return points;
}

export function parseEiaWeekly(html) {
  const cs = cells(html);
  const points = [];
  let year = null, month = null;
  for (const c of cs) {
    if (c.cls === 'B6') {
      const m = c.text.match(/^(\d{4})-([A-Z][a-z]{2})$/);
      if (m) { year = Number(m[1]); month = MONTHS[m[2]]; }
      continue;
    }
    if (c.cls === 'B5') {
      const m = c.text.match(/^(\d{2})\/(\d{2})$/);
      c.date = m && year ? `${Number(m[1]) === 12 && month === 1 ? year - 1 : year}-${m[1]}-${m[2]}` : null;
      points.pending = c.date;
      continue;
    }
    if (c.cls === 'B3' && points.pending) {
      const v = toNumber(c.text);
      if (v !== null) points.push({ date: points.pending, value: v });
      points.pending = null;
    }
  }
  return points.filter((p) => p.date);
}

/**
 * fetch() para un mapeo { producto: { series, freq: 'D'|'W', unit, scale?, fred? } }.
 * Si la página de EIA falla o cambia de formato, intenta el espejo CSV de FRED (si se indica).
 */
export function eiaFetcher(map) {
  return async () => {
    const rows = [];
    const sigs = [];
    const notes = [];
    for (const [product, cfg] of Object.entries(map)) {
      let points, published = null, via = 'EIA';
      try {
        const html = await httpGet(eiaHistUrl(cfg.series, cfg.freq));
        points = cfg.freq === 'W' ? parseEiaWeekly(html) : parseEiaDaily(html);
        published = releaseDate(html);
        if (points.length < 20) throw Object.assign(new Error('Tabla EIA sin datos reconocibles (¿cambió el formato?)'), { structure: true });
        sigs.push(signature(['eia-html', cfg.freq, 'B6/B3']));
      } catch (e) {
        if (!cfg.fred) throw e;
        const csv = parseFredCsv(await httpGet(fredCsvUrl(cfg.fred)), cfg.fred);
        points = csv.points;
        sigs.push(csv.signature);
        via = 'FRED';
        notes.push(`${product}: EIA no disponible (${e.message}); se usó el espejo FRED.`);
      }
      const scale = cfg.scale ?? 1;
      for (const p of points) {
        // La fecha de publicación sólo aplica a los datos de la última entrega (≈ 2 semanas);
        // para el historial previo no se conoce y se deja vacía.
        const pub = published && p.date >= addDays(published, -14) ? published : null;
        rows.push({ product, quoteDate: p.date, value: p.value * scale, unit: cfg.unit, publishedAt: pub, via });
      }
    }
    return { rows, signature: sigs.join(';'), note: notes.join(' ') || null };
  };
}
