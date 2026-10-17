// Adaptadores de fuentes web no oficiales (cotización del día).
import { httpGet, signature } from './http.js';

const nyDate = (unixSec) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(unixSec * 1000));

// ─── Yahoo Finance (API de gráficas, no oficial) ───
// JSON: chart.result[0].timestamp[] + indicators.quote[0].close[].
export function parseYahooChart(json, symbol) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp, close = r?.indicators?.quote?.[0]?.close;
  if (!r || !Array.isArray(ts) || !Array.isArray(close)) {
    throw Object.assign(new Error(`Respuesta de Yahoo sin estructura esperada para ${symbol}`), { retryable: false });
  }
  const points = [];
  ts.forEach((t, i) => { if (Number.isFinite(close[i])) points.push({ date: nyDate(t), value: close[i] }); });
  // La barra del día en curso es provisional mientras el mercado está abierto: se descarta.
  const marketOpen = r.meta?.currentTradingPeriod?.regular && Date.now() / 1000 < r.meta.currentTradingPeriod.regular.end;
  if (marketOpen && points.length && points.at(-1).date === nyDate(Date.now() / 1000)) points.pop();
  return { points, signature: signature(['yahoo-chart', Object.keys(r).sort().join(','), r.meta?.instrumentType]) };
}

export function yahooFetcher(map, range = '2y') {
  return async () => {
    const rows = [], sigs = [];
    for (const [product, { symbol, unit }] of Object.entries(map)) {
      const json = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { as: 'json' });
      const { points, signature: sig } = parseYahooChart(json, symbol);
      sigs.push(sig);
      for (const p of points) rows.push({ product, quoteDate: p.date, value: p.value, unit });
    }
    return { rows, signature: sigs.join(';') };
  };
}

// ─── Trading Economics (página pública del commodity) ───
// El resumen dice: "Propane rose to 1.10 USD/Gal on October 16, 2026, ...".
const EN_MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

export function parseTradingEconomics(html) {
  const m = html.match(/Propane (?:rose|fell|increased|decreased|was unchanged|remained unchanged|climbed|dropped|declined|edged \w+)[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?) USD\/Gal on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  if (!m) throw Object.assign(new Error('No se encontró la cotización en la página de Trading Economics (¿cambió el formato?)'), { retryable: false });
  const date = `${m[4]}-${String(EN_MONTHS[m[2]]).padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return { date, value: Number(m[1]), signature: signature(['te-summary', 'USD/Gal on'] ) };
}

export function tradingEconomicsFetcher() {
  return async () => {
    const html = await httpGet('https://tradingeconomics.com/commodity/propane');
    const { date, value, signature: sig } = parseTradingEconomics(html);
    return { rows: [{ product: 'propano', quoteDate: date, value, unit: 'USD/gal' }], signature: sig };
  };
}
