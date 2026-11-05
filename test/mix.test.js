// Mezcla en $/kg y referencia semanal (datos sintéticos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mxnPerKg, mixValue, weekStart, dailyMix, weeklyAverages, weeklyForecast, forecastMessage, fxFor, KG_PER_GAL } from '../src/core/mix.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('Conversión igual a la de los archivos de trabajo: cUSD/gal → USD/kg → MXN/kg', () => {
  close(mxnPerKg(204.41214, 20), 20); // 204.41214 cUSD/gal = 1 USD/kg
  close(mxnPerKg(100, 18.5), (100 / (KG_PER_GAL * 100)) * 18.5);
  close(mixValue(10, 12, 0.9), 10.2);
  close(mixValue(10, 12, 0.6), 10.8);
});

test('Semana de referencia: viernes a jueves', () => {
  assert.equal(weekStart('2026-10-30'), '2026-10-30'); // viernes
  assert.equal(weekStart('2026-11-04'), '2026-10-30'); // miércoles
  assert.equal(weekStart('2026-10-29'), '2026-10-23'); // jueves
  assert.equal(weekStart('2026-11-01'), '2026-10-30'); // domingo
});

test('Tipo de cambio: archivo primero, luego público; festivo usa el día previo (≤3 hábiles); nunca inventa', () => {
  const file = new Map([['2026-10-01', 18.1]]);
  const pub = new Map([['2026-10-01', 18.3], ['2026-10-02', 18.4]]);
  const dates = [...pub.keys()];
  assert.deepEqual(fxFor('2026-10-01', file, pub, dates), { fx: 18.1, source: 'archivo' });
  assert.deepEqual(fxFor('2026-10-02', file, pub, dates), { fx: 18.4, source: 'FRED' });
  assert.equal(fxFor('2026-10-05', file, pub, dates).source, 'FRED (día previo)');
  assert.equal(fxFor('2026-10-20', file, pub, dates), null);
});

test('Pronóstico semanal: T-1 vs T-2 sólo con semanas completas', () => {
  const prop = new Map(), but = new Map(), fx = new Map();
  // Semana 16–22 oct: propano 80; semana 23–29 oct: propano 84; semana 30 oct (incompleta): 90
  for (const [d, p] of [['2026-10-16', 80], ['2026-10-19', 80], ['2026-10-22', 80], ['2026-10-23', 84], ['2026-10-26', 84], ['2026-10-29', 84], ['2026-10-30', 90]]) {
    prop.set(d, p); but.set(d, 100); fx.set(d, 20);
  }
  const daily = dailyMix(prop, but, 0.9, fx);
  const weeks = weeklyAverages(daily);
  assert.deepEqual(weeks.map((w) => [w.week, w.n]), [['2026-10-16', 3], ['2026-10-23', 3], ['2026-10-30', 1]]);
  const f = weeklyForecast(weeks, '2026-11-04');
  assert.equal(f.t1.week, '2026-10-23');
  assert.equal(f.t2.week, '2026-10-16');
  close(f.change, mxnPerKg(84, 20) * 0.9 - mxnPerKg(80, 20) * 0.9);
  close(f.propanoPct, 5);
  close(f.butanoPct, 0);
  assert.equal(f.consecutive, true);
  assert.equal(f.upToDate, true);
  // Si los precios terminan a media semana, esa semana no cuenta como completa.
  assert.equal(weeklyForecast(weeks, '2026-11-20', '2026-10-27'), null); // sólo una semana completa
  // Precios hasta el 29-oct consultados el 20-nov: se calcula, pero se marca como desactualizado.
  const stale = weeklyForecast(weeks, '2026-11-20', '2026-10-29');
  assert.equal(stale.t1.week, '2026-10-23');
  assert.equal(stale.upToDate, false);
  const msg = forecastMessage(f, '90/10');
  assert.match(msg, /incremento de [\d.,]+ centavos de peso por kg \(\+[\d.,]+ MXN\/kg\)/);
  assert.equal(weeklyForecast(weeks.slice(0, 1), '2026-11-04'), null);
});
