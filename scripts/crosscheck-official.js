// Coteja un Excel con precios Mont Belvieu contra la base oficial privada,
// SIN importar nada y SIN imprimir precios: sólo conteos, fechas y rangos de
// magnitud de las discrepancias.
//
// Uso: node scripts/crosscheck-official.js --file "/ruta/archivo.xlsx"
import ExcelJS from 'exceljs';
import path from 'node:path';
import { detectProfile, extractRows } from '../src/private/import-official.js';
import { officialMap } from '../src/db/private.js';

const EXACT = 0.0005; // cUSD/gal: diferencias menores se consideran redondeo
const BANDS = [[EXACT, 0.01], [0.01, 0.1], [0.1, 1], [1, 5], [5, Infinity]];

function band(d) {
  const b = BANDS.find(([lo, hi]) => d >= lo && d < hi);
  return `${b[0]}–${b[1] === Infinity ? '∞' : b[1]}`;
}

async function main() {
  const i = process.argv.indexOf('--file');
  const file = process.argv[i + 1];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  console.log(`Archivo: ${path.basename(file)}`);
  for (const sheet of wb.worksheets) {
    const profile = detectProfile(sheet);
    if (!profile) continue;
    const { rows, stats } = extractRows(sheet, profile);
    console.log(`\n▸ Hoja "${sheet.name}" [${profile.id}] filas ${stats.read}, rechazadas ${stats.rejected}, fines de semana ${stats.weekend}, fechas futuras ${stats.future}`);
    for (const product of ['propano', 'butano']) {
      const off = officialMap(product);
      const offDates = [...off.keys()];
      const mine = rows.filter((r) => r.product === product).sort((a, b) => a.quoteDate.localeCompare(b.quoteDate));
      if (!mine.length) { console.log(`  ${product}: sin datos`); continue; }
      const first = mine[0].quoteDate, last = mine.at(-1).quoteDate;
      let same = 0;
      const diffs = [];
      const onlyFile = [];
      for (const r of mine) {
        if (!off.has(r.quoteDate)) { onlyFile.push(r.quoteDate); continue; }
        const d = Math.abs(r.value - off.get(r.quoteDate));
        if (d < EXACT) same++; else diffs.push({ date: r.quoteDate, d });
      }
      const fileDates = new Set(mine.map((r) => r.quoteDate));
      const onlyBase = offDates.filter((d) => d >= first && d <= last && !fileDates.has(d));
      const overlap = same + diffs.length;
      const bands = {};
      for (const x of diffs) bands[band(x.d)] = (bands[band(x.d)] || 0) + 1;
      const signedBias = diffs.length ? diffs.length : 0;
      console.log(`  ${product}: ${mine.length} días (${first} → ${last}); en común con la base ${overlap}; idénticos ${same} (${overlap ? ((same / overlap) * 100).toFixed(1) : '—'}%); distintos ${diffs.length}`);
      if (diffs.length) {
        console.log(`    magnitud de las diferencias (cUSD/gal): ${Object.entries(bands).map(([k, v]) => `${k}: ${v}`).join(' · ')}`);
        console.log(`    fechas distintas (primeras 12): ${diffs.slice(0, 12).map((x) => x.date).join(', ')}${diffs.length > 12 ? ' …' : ''}`);
        // ¿Las diferencias son de un día de desfase? Compara contra el oficial del día hábil anterior/siguiente.
        for (const lag of [-1, 1]) {
          let hits = 0;
          for (const x of diffs) {
            const k = offDates.indexOf(x.date);
            const other = offDates[k + lag];
            const v = mine.find((r) => r.quoteDate === x.date).value;
            if (other && Math.abs(v - off.get(other)) < EXACT) hits++;
          }
          if (hits) console.log(`    ${hits} de esas fechas coinciden exactamente con el oficial del día hábil ${lag < 0 ? 'anterior' : 'siguiente'}`);
        }
        void signedBias;
      }
      if (onlyFile.length) console.log(`    sólo en el archivo (no en la base): ${onlyFile.length} días, ${onlyFile[0]} → ${onlyFile.at(-1)}`);
      if (onlyBase.length) console.log(`    sólo en la base dentro del rango del archivo: ${onlyBase.length} días (p. ej. ${onlyBase.slice(0, 6).join(', ')})`);
    }
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
