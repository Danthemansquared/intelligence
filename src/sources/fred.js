// Adaptador genérico para series de FRED (Federal Reserve Bank of St. Louis)
// mediante la descarga CSV pública (sin llave): fredgraph.csv?id=SERIE.
// Columnas: observation_date,<SERIE>. Los faltantes vienen como "." o vacío.
import { httpGet, parseCsv, signature } from './http.js';

export function fredCsvUrl(seriesId, from) {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}${from ? `&cosd=${from}` : ''}`;
}

export function parseFredCsv(text, seriesId) {
  const { header, rows } = parseCsv(text);
  if (header.length < 2 || !/date/i.test(header[0]) || header[1] !== seriesId) {
    throw Object.assign(new Error(`Estructura CSV inesperada de FRED (${header.join(',')})`), { retryable: false });
  }
  return {
    signature: signature(header),
    points: rows.filter((r) => r[1] && r[1] !== '.').map((r) => ({ date: r[0], value: Number(r[1]) })),
  };
}

/** Crea fetch() para un mapeo { producto: { series, unit } }. */
export function fredFetcher(map, { historyFrom = '2000-01-01' } = {}) {
  return async () => {
    const rows = [];
    const sigs = [];
    for (const [product, { series, unit }] of Object.entries(map)) {
      const { points, signature: sig } = parseFredCsv(await httpGet(fredCsvUrl(series, historyFrom)), series);
      sigs.push(sig);
      for (const p of points) rows.push({ product, quoteDate: p.date, value: p.value, unit });
    }
    return { rows, signature: sigs.join(';') };
  };
}
