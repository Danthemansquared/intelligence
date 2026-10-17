// Genera una base "oficial" SINTÉTICA para demostraciones y pruebas visuales
// de la sección privada sin exponer precios reales de AMEXGAS.
//   PRIVATE_DB=data/demo-sintetico.db node scripts/make-synthetic-official.js
// Propano = EIA spot + sesgo + ruido; butano = propano × 1.12 + ruido. Hasta 2026-08-04.
import { getSeries } from '../src/db/public.js';
import { upsertOfficial } from '../src/db/private.js';

if (!/sintetico/.test(process.env.PRIVATE_DB || '')) {
  console.error('Por seguridad, defina PRIVATE_DB con una ruta que contenga "sintetico" (nunca la base real).');
  process.exit(1);
}
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const rows = [];
for (const r of getSeries('eia_propano', 'propano', '2015-01-01', '2026-08-04')) {
  if (rnd() < 0.02) continue; // faltantes sintéticos
  const p = r.value + 0.6 + gauss() * 0.9;
  rows.push({ product: 'propano', quoteDate: r.date, value: p });
  rows.push({ product: 'butano', quoteDate: r.date, value: p * 1.12 + gauss() * 1.5 });
}
const res = upsertOfficial(rows, 'SINTETICO');
console.log(`Base sintética: ${res.added} filas nuevas en ${process.env.PRIVATE_DB}`);
