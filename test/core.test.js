// Pruebas de cálculos, conversión de unidades, fechas y datos faltantes.
// Usan sólo números sintéticos (nunca datos oficiales).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCentsPerGallon, normalize, kgPerGallon, isPlausible } from '../src/core/units.js';
import {
  difference, compareObservations, errorStats, percentile, pairSeries, proposeTolerance, classify, variations, freshness, correlation,
} from '../src/core/metrics.js';
import { businessDaysBetween, addMonths, excelSerialToIso, isIsoDate, todayHouston } from '../src/core/dates.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('Diferencia: ejemplo ilustrativo del requerimiento (82.0 vs 84.5)', () => {
  const d = difference(82.0, 84.5);
  close(d.signed, -2.5);
  close(d.abs, 2.5);
  close(d.pct, -2.958579881656805);
  assert.equal(d.direction, 'abajo');
});

test('Diferencia: signo positivo cuando la fuente digital está por encima', () => {
  const d = difference(90, 85);
  assert.equal(d.direction, 'arriba');
  close(d.signed, 5);
  close(d.pct, (5 / 85) * 100);
});

test('Diferencia: cero cuando coinciden', () => {
  assert.equal(difference(80, 80).direction, 'igual');
});

test('Diferencia: rechaza referencia no positiva o valores no numéricos', () => {
  assert.throws(() => difference(80, 0));
  assert.throws(() => difference(NaN, 80));
});

test('Comparabilidad: fechas distintas → No comparable', () => {
  const r = compareObservations(
    { product: 'propano', quoteDate: '2026-08-04', value: 80, unit: 'cUSD/gal' },
    { product: 'propano', quoteDate: '2026-08-03', value: 81, unit: 'cUSD/gal' },
  );
  assert.equal(r.status, 'no_comparable');
  assert.match(r.reason, /Fechas/);
});

test('Comparabilidad: unidades o productos distintos → No comparable', () => {
  assert.equal(compareObservations(
    { product: 'propano', quoteDate: '2026-08-04', value: 0.8, unit: 'USD/gal' },
    { product: 'propano', quoteDate: '2026-08-04', value: 81, unit: 'cUSD/gal' }).status, 'no_comparable');
  assert.equal(compareObservations(
    { product: 'butano', quoteDate: '2026-08-04', value: 80, unit: 'cUSD/gal' },
    { product: 'propano', quoteDate: '2026-08-04', value: 81, unit: 'cUSD/gal' }).status, 'no_comparable');
});

test('Comparabilidad: fuente con referencia distinta → No comparable', () => {
  const r = compareObservations(
    { product: 'propano', quoteDate: '2026-08-04', value: 80, unit: 'cUSD/gal' },
    { product: 'propano', quoteDate: '2026-08-04', value: 81, unit: 'cUSD/gal' },
    { comparable: false, comparableNote: 'Futuro de mes próximo, no spot' });
  assert.equal(r.status, 'no_comparable');
  assert.equal(r.reason, 'Futuro de mes próximo, no spot');
});

test('Sin referencia oficial: nunca reutiliza el último oficial', () => {
  const r = compareObservations({ product: 'propano', quoteDate: '2026-10-16', value: 80, unit: 'cUSD/gal' }, null);
  assert.equal(r.status, 'sin_referencia');
  assert.equal(r.signed, undefined);
});

test('Unidades: USD/gal, USD/bbl, USD/t y USD/kg a cUSD/gal', () => {
  close(toCentsPerGallon(0.8125, 'USD/gal').value, 81.25);
  close(toCentsPerGallon(42, 'USD/bbl').value, 100);
  // 1 t de propano = 1000/(0.5070×3.785411784) gal
  const kg = kgPerGallon('propano');
  close(kg, 0.5070 * 3.785411784);
  close(toCentsPerGallon(500, 'USD/t', 'propano').value, 0.5 * kg * 100);
  close(toCentsPerGallon(0.5, 'USD/kg', 'butano').value, 0.5 * 0.5840 * 3.785411784 * 100);
  assert.throws(() => toCentsPerGallon(1, 'MXN/L', 'propano'));
});

test('Unidades: el crudo se queda en USD/bbl y rechaza otras unidades', () => {
  assert.deepEqual(normalize(70, 'USD/bbl', 'wti').unit, 'USD/bbl');
  assert.throws(() => normalize(70, 'USD/gal', 'wti'));
});

test('Rango plausible detecta errores de unidad (USD/gal guardado como cUSD/gal)', () => {
  assert.equal(isPlausible('propano', 0.8), false);
  assert.equal(isPlausible('propano', 80), true);
});

test('Percentiles: interpolación lineal tipo Excel PERCENTILE.INC', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  close(percentile(xs, 0.5), 5.5);
  close(percentile(xs, 0.9), 9.1);
  close(percentile(xs, 0), 1);
  assert.equal(percentile([], 0.5), null);
});

test('Correlación perfecta y nula', () => {
  close(correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(correlation([1, 1, 1], [1, 2, 3]), null);
});

test('Emparejamiento por fecha exacta, sin interpolar faltantes', () => {
  const dig = new Map([['2026-01-05', 80], ['2026-01-07', 82]]); // falta el 06
  const off = new Map([['2026-01-05', 81], ['2026-01-06', 81.5], ['2026-01-07', 82.5]]);
  const pairs = pairSeries(dig, off);
  assert.deepEqual(pairs.map((p) => p.date), ['2026-01-05', '2026-01-07']);
  const s = errorStats(pairs, { expected: 3 });
  assert.equal(s.n, 2);
  close(s.coverage, 2 / 3);
  close(s.mae, 0.75);
  close(s.bias, -0.75);
});

test('Emparejamiento con desfase de un día hábil', () => {
  const off = new Map([['2026-01-05', 80], ['2026-01-06', 81], ['2026-01-07', 82]]);
  const dig = new Map([['2026-01-06', 80], ['2026-01-07', 81]]); // digital publica t con fecha t+1
  const lag1 = pairSeries(dig, off, { lagBusinessDays: 1 });
  assert.equal(errorStats(lag1).mae, 0);
});

test('Estadísticas: sesgo, márgenes y dirección', () => {
  const pairs = [
    { date: 'a', digital: 81, official: 80 },
    { date: 'b', digital: 83, official: 82 },
    { date: 'c', digital: 80, official: 81 },
    { date: 'd', digital: 85, official: 83 },
  ];
  const s = errorStats(pairs, { bands: [1, 2] });
  close(s.bias, (1 + 1 - 1 + 2) / 4);
  close(s.mae, (1 + 1 + 1 + 2) / 4);
  close(s.within[1], 0.75);
  close(s.within[2], 1);
  close(s.directionHit, 1); // los tres movimientos coinciden en signo
});

test('Tolerancia: preliminar con poco historial, insuficiente con muy poco', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ date: String(i), digital: 80 + (i % 5) * 0.1, official: 80 }));
  assert.equal(proposeTolerance(mk(5)).status, 'insuficiente');
  assert.equal(proposeTolerance(mk(50)).status, 'preliminar');
  const t = proposeTolerance(mk(200));
  assert.equal(t.status, 'validada');
  assert.ok(t.green <= t.yellow);
  assert.equal(classify(0, t), 'verde');
  assert.equal(classify(t.yellow + 1, t), 'rojo');
});

test('Variaciones diaria, semanal y mensual', () => {
  const rows = [
    { date: '2026-09-15', value: 70 }, { date: '2026-10-08', value: 75 }, { date: '2026-10-09', value: 76 },
    { date: '2026-10-15', value: 78 }, { date: '2026-10-16', value: 80 },
  ];
  const v = variations(rows);
  close(v.daily.abs, 2);
  assert.equal(v.weekly.base, '2026-10-09');
  close(v.weekly.abs, 4);
  assert.equal(v.monthly.base, '2026-09-15');
  close(v.monthly.pct, (10 / 70) * 100);
});

test('Fechas: días hábiles, meses, serie de Excel, validación ISO', () => {
  assert.equal(businessDaysBetween('2026-10-16', '2026-10-19'), 1); // vie → lun
  assert.equal(businessDaysBetween('2026-10-16', '2026-10-16'), 0);
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(excelSerialToIso(46000), '2025-12-09');
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.match(todayHouston(new Date('2026-10-17T03:00:00Z')), /^2026-10-16$/);
});

test('Antigüedad: al día, atrasada, detenida', () => {
  assert.equal(freshness('2026-10-15', '2026-10-16', 2).status, 'al_dia');
  assert.equal(freshness('2026-10-09', '2026-10-16', 2).status, 'atrasada');
  assert.equal(freshness('2026-09-01', '2026-10-16', 2).status, 'detenida');
  assert.equal(freshness(null, '2026-10-16', 2).status, 'sin_datos');
});

import { blsPricingDate, monthlyReference, indexVsOfficial, indexChanges } from '../src/core/metrics.js';

test('PPI: día de referencia BLS = martes de la semana que contiene el 13', () => {
  assert.equal(blsPricingDate(2026, 10), '2026-10-13'); // 13-oct-2026 es martes
  assert.equal(blsPricingDate(2026, 9), '2026-09-15'); // 13-sep-2026 es domingo
  assert.equal(blsPricingDate(2026, 6), '2026-06-09'); // 13-jun-2026 es sábado
});

test('PPI: referencia mensual sin rellenar faltantes', () => {
  const off = new Map([['2026-10-13', 80], ['2026-10-14', 82]]);
  assert.equal(monthlyReference(off, 'promedio', { minDays: 2 }).get('2026-10'), 81);
  assert.equal(monthlyReference(off, 'promedio', { minDays: 3 }).has('2026-10'), false);
  assert.equal(monthlyReference(off, 'dia_bls').get('2026-10'), 80);
  assert.equal(monthlyReference(new Map([['2026-09-14', 80]]), 'dia_bls').has('2026-09'), false);
});

test('PPI: estimación calibrada fuera de muestra es exacta si el oficial es proporcional al índice', () => {
  const idx = [], off = new Map();
  for (let i = 0; i < 24; i++) {
    const m = addMonths('2024-01-01', i);
    const v = 100 + 10 * Math.sin(i);
    idx.push({ date: m, value: v });
    off.set(`${m.slice(0, 7)}-15`, v * 0.6); // un día por mes
  }
  const r = indexVsOfficial(idx, off, { align: 'promedio', minCalib: 6 });
  // minDays=10 por defecto → con un día por mes no hay referencia (no se inventa)
  assert.equal(r.months, 0);
  const off2 = new Map();
  for (const { date, value } of idx) for (let d = 1; d <= 12; d++) off2.set(`${date.slice(0, 7)}-${String(d).padStart(2, '0')}`, value * 0.6);
  const r2 = indexVsOfficial(idx, off2, { align: 'promedio' });
  assert.equal(r2.estimate.n, 24 - 6);
  assert.ok(r2.estimate.mae < 1e-9);
  close(r2.changes.corr, 1);
  assert.equal(r2.changes.directionHit, 1);
});

test('PPI: cambios mensual e interanual', () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ date: addMonths('2025-09-01', i), value: 100 + i }));
  const c = indexChanges(rows);
  close(c.mom.pct, (112 / 111 - 1) * 100);
  close(c.yoy.pct, 12);
});

import { ratioEstimates } from '../src/core/metrics.js';

test('Estimación por relación: fuera de muestra y exacta si la relación es constante', () => {
  const base = Array.from({ length: 40 }, (_, i) => ({ date: addMonths('2026-01-01', 0).slice(0, 8) + String(i + 1).padStart(2, '0'), value: 80 + i }))
    .filter((r) => isIsoDate(r.date));
  const target = new Map(base.map((r) => [r.date, r.value * 1.15]));
  const est = ratioEstimates(base, target, { window: 5, minRatios: 5 });
  assert.equal(est[0].date, base[5].date); // necesita 5 relaciones previas, nunca la del mismo día
  for (const e of est) close(e.value, target.get(e.date));
  // Con desfase de 3 posiciones la relación más reciente usada es la de 3 días antes.
  const g3 = ratioEstimates(base, target, { window: 5, minRatios: 5, gap: 3 });
  assert.equal(g3[0].ratioTo, base[g3.length ? base.findIndex((b) => b.date === g3[0].date) - 3 : 0].date);
});
