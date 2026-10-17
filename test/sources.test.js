// Pruebas de parseo de fuentes, validación de ingesta y narrativa (datos sintéticos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEiaDaily, parseEiaWeekly, releaseDate } from '../src/sources/eia.js';
import { parseFredCsv } from '../src/sources/fred.js';
import { parseTradingEconomics, parseYahooChart } from '../src/sources/web.js';
import { validateRows } from '../src/ingest/run.js';
import { buildNarrative, relevance } from '../src/core/narrative.js';
import { validateNote } from '../scripts/add-notes.js';

test('EIA diaria: reconstruye fechas lun–vie, omite festivos y cruza de año', () => {
  const html = `<td class='B6'>&nbsp;&nbsp;2025 Dec-29 to Jan- 2</td>\r<td class='B3'>0.700</td><td class='B3'>0.710</td><td class='B3'></td><td class='B3'>0.720</td><td class='B3'>0.730</td>
  <td class='F2'>Release Date: 01/07/2026</td>`;
  const pts = parseEiaDaily(html);
  assert.deepEqual(pts.map((p) => p.date), ['2025-12-29', '2025-12-30', '2026-01-01', '2026-01-02']);
  assert.equal(pts[0].value, 0.7);
  assert.equal(releaseDate(html), '2026-01-07');
});

test('EIA semanal: fechas de fin de semana con año del mes y miles con coma', () => {
  const html = `<td class='B6'>&nbsp;&nbsp;2026-Oct</td><td class='B5'>10/02&nbsp;</td><td class='B3'>107,846&nbsp;</td><td class='B5'>10/09&nbsp;</td><td class='B3'>106,375</td><td class='B5'>&nbsp;</td><td class='B3'>&nbsp;</td>`;
  assert.deepEqual(parseEiaWeekly(html), [{ date: '2026-10-02', value: 107846 }, { date: '2026-10-09', value: 106375 }]);
});

test('FRED: omite faltantes "." y detecta cambio de estructura', () => {
  const r = parseFredCsv('observation_date,DPROPANEMBTX\n2026-10-13,1.038\n2026-10-14,.\n', 'DPROPANEMBTX');
  assert.equal(r.points.length, 1);
  assert.throws(() => parseFredCsv('DATE,VALUE\n2026-10-13,1', 'DPROPANEMBTX'), /Estructura/);
});

test('Trading Economics: extrae valor y fecha del resumen', () => {
  const r = parseTradingEconomics('<h2>Propane rose to 1.10 USD/Gal on October 16, 2026, up 2.92%</h2>');
  assert.deepEqual([r.date, r.value], ['2026-10-16', 1.1]);
  assert.throws(() => parseTradingEconomics('<html>nuevo diseño</html>'), /formato/);
});

test('Yahoo: descarta cierres nulos y valida estructura', () => {
  const json = { chart: { result: [{ meta: {}, timestamp: [1792000000, 1792086400], indicators: { quote: [{ close: [95.1, null] }] } }] } };
  assert.equal(parseYahooChart(json, 'CL=F').points.length, 1);
  assert.throws(() => parseYahooChart({ chart: { result: [] } }, 'CL=F'));
});

test('Ingesta: rechaza fechas futuras, unidades erróneas y productos no declarados; normaliza a cUSD/gal', () => {
  const src = { id: 'x', products: ['propano'] };
  const { ok, rejected } = validateRows(src, [
    { product: 'propano', quoteDate: '2026-10-14', value: 1.07, unit: 'USD/gal' },
    { product: 'propano', quoteDate: '2026-10-20', value: 1.07, unit: 'USD/gal' },
    { product: 'propano', quoteDate: '2026-10-13', value: 107, unit: 'USD/gal' }, // unidad equivocada → 10,700 cUSD/gal
    { product: 'butano', quoteDate: '2026-10-13', value: 1.2, unit: 'USD/gal' },
    { product: 'propano', quoteDate: '2026-13-01', value: 1, unit: 'USD/gal' },
  ], { today: '2026-10-17', fetchedAt: 't' });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].valueNorm, 107);
  assert.equal(ok[0].valueOrig, 1.07);
  assert.deepEqual(rejected.map((r) => r.why), ['fecha futura', 'fuera de rango plausible (¿unidad?)', 'producto no declarado', 'fecha inválida']);
});

test('Narrativa: sin factores → "Sin factores determinantes identificados"; nunca afirma causalidad', () => {
  const v = { date: '2026-10-14', value: 107, weekly: { abs: 5, pct: 5 } };
  const items = buildNarrative({ series: { propano: { variations: v, dist: { p50: 1, p75: 2, p90: 4 }, unit: 'cUSD/gal' } } });
  assert.equal(items[0].level, 'fuera_de_lo_habitual');
  assert.ok(items[0].body.includes('Sin factores determinantes identificados.'));
  assert.equal(items[1].level, 'sin_datos');
  const withCrude = buildNarrative({ series: { propano: { variations: v, dist: null, unit: 'cUSD/gal' }, wti: { variations: { weekly: { pct: -3 } } } } });
  assert.match(withCrude[0].body.join(' '), /sentido distinto/);
  assert.match(withCrude[0].body.join(' '), /no permiten atribuirles toda la variación/);
  assert.equal(relevance(1, null), 'sin_historial');
});

test('Notas de mercado: exige URL http(s), fecha no futura y factor válido', () => {
  const ok = { eventDate: '2026-10-15', title: 'T', summary: 'S', factor: 'inventarios', products: ['propano'], sourceName: 'EIA', url: 'https://www.eia.gov/' };
  assert.deepEqual(validateNote(ok, '2026-10-17'), []);
  assert.ok(validateNote({ ...ok, url: 'javascript:alert(1)' }, '2026-10-17').length);
  assert.ok(validateNote({ ...ok, eventDate: '2026-10-20' }, '2026-10-17').length);
  assert.ok(validateNote({ ...ok, factor: 'rumor' }, '2026-10-17').length);
});
