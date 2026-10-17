// Genera el reporte PRIVADO de precisión y tolerancias con los datos oficiales
// reales: private/reporte-precision.md. Imprime sólo la ruta del archivo.
// Uso: npm run private-report
import fs from 'node:fs';
import path from 'node:path';
import { fullStats } from '../src/private/validation.js';
import { privateDbPath } from '../src/db/private.js';
import { sourceById } from '../src/sources/index.js';

const n2 = (v) => (v == null ? '—' : v.toFixed(2));
const sg = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
const pc = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

const st = fullStats();
const L = [];
L.push('# Reporte privado de precisión vs. AMEXGAS', '', `Generado: ${st.generatedAt}. **Confidencial — no compartir fuera del grupo autorizado.**`, '');
L.push('## Cobertura de la base oficial', '');
for (const c of st.coverage) L.push(`- ${c.product}: ${c.n} días (${c.first_date} → ${c.last_date})`);
for (const [product, rows] of Object.entries(st.products)) {
  L.push('', `## ${product[0].toUpperCase()}${product.slice(1)}`, '');
  if (!rows.length) { L.push('Sin fuentes digitales activas para este producto.'); continue; }
  const rec = st.recommendation[product];
  L.push(`**Recomendación:** principal ${rec.primary ? sourceById(rec.primary).shortName : '—'}, respaldo ${rec.backup ? sourceById(rec.backup).shortName : '—'}${rec.validated ? '' : ' (tolerancia preliminar)'}. ${rec.note ?? ''}`, '');
  L.push('| Fuente | Días | Cobertura | MAE | Sesgo | Mediana | P90 | P95 | P99 | ±1 | ±2 | ±5 | MAPE % | Acierto dir. | Corr. cambios |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const o = r.overall;
    L.push(`| ${sourceById(r.sourceId).shortName} | ${o.n} | ${pc(o.coverage)} | ${n2(o.mae)} | ${sg(o.bias)} | ${n2(o.medianAbs)} | ${n2(o.p90Abs)} | ${n2(o.p95Abs)} | ${n2(o.p99Abs)} | ${pc(o.within?.[1])} | ${pc(o.within?.[2])} | ${pc(o.within?.[5])} | ${n2(o.mape)} | ${pc(o.directionHit)} | ${n2(o.corrChanges)} |`);
  }
  for (const r of rows) {
    const t = r.tolerance;
    L.push('', `### Tolerancia propuesta — ${sourceById(r.sourceId).shortName}`, '');
    if (t.status === 'insuficiente') { L.push(`Historial insuficiente (${t.n} días).`); continue; }
    L.push(`- Verde ≤ ${n2(t.green)} cUSD/gal (P${t.greenP * 100}); amarillo ≤ ${n2(t.yellow)} (P${t.yellowP * 100}); rojo > ${n2(t.yellow)}.`);
    L.push(`- Base: ${t.n} días comparables, ${t.from} → ${t.to} (ventana ${t.windowMonths} meses). Estado: **${t.status}**.`);
    L.push(`- Mercado tranquilo vs. volátil (corte ${n2(r.regimes.threshold)} cUSD/gal de cambio diario oficial): P90 ${n2(r.regimes.calm.p90Abs)} vs ${n2(r.regimes.volatile.p90Abs)}.`);
    L.push(`- Desfase de fechas (MAE): ${r.lags.map((l) => `${l.lag > 0 ? '+' : ''}${l.lag} d: ${n2(l.mae)}`).join(' · ')}.`);
    L.push(`- Meses con mayor error: ${r.worstMonths.map((m) => `${m.month} (MAE ${n2(m.mae)})`).join(', ')}.`);
    L.push('', '| Año | Días | MAE | Sesgo | P90 | Corr. cambios |', '|---|---|---|---|---|---|');
    for (const y of [...r.byYear].reverse()) L.push(`| ${y.year} | ${y.n} | ${n2(y.mae)} | ${sg(y.bias)} | ${n2(y.p90Abs)} | ${n2(y.corrChanges)} |`);
  }
}
L.push('', '## Índices mensuales (PPI) como aproximación', '');
for (const [product, list] of Object.entries(st.indices ?? {})) for (const r of list) {
  L.push(`### ${r.name} → ${product} (mejor ajuste: ${r.best})`, '', '| Comparado contra | Meses | Corr. cambios | Acierto dir. | MAE | Sesgo | P90 | P95 | Tolerancia |', '|---|---|---|---|---|---|---|---|---|');
  for (const v of r.variants) L.push(`| ${v.align} | ${v.estimate.n ?? 0} | ${n2(v.changes.corr)} | ${pc(v.changes.directionHit)} | ${n2(v.estimate.mae)} | ${sg(v.estimate.bias)} | ${n2(v.estimate.p90Abs)} | ${n2(v.estimate.p95Abs)} | ${v.tolerance.status === 'insuficiente' ? '—' : `≤${n2(v.tolerance.green)} / ≤${n2(v.tolerance.yellow)} (${v.tolerance.status})`} |`);
  if (r.beyondOfficial.length) L.push('', `Estimaciones para meses sin dato oficial: ${r.beyondOfficial.map((b) => `${b.month}: ${n2(b.estimate)} cUSD/gal`).join(' · ')}`);
  L.push('');
}
const out = path.join(path.dirname(privateDbPath()), 'reporte-precision.md');
fs.writeFileSync(out, L.join('\n'), { mode: 0o600 });
console.log(`Reporte privado generado: ${out}`);
