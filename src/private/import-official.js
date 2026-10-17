// Importa precios oficiales AMEXGAS (Excel) a la base privada.
//
// Uso:  npm run import-official -- --file "/ruta/archivo.xlsx" [--file otro.xlsx]
//         [--sheet "Nombre de hoja"]  sólo esa hoja
//         [--only-new]                sólo agrega fechas nuevas; no modifica valores ya cargados
//
// La salida sólo muestra conteos y fechas; NUNCA imprime precios.
// El formato se detecta por los encabezados (ver PROFILES).

import ExcelJS from 'exceljs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { upsertOfficial, logImport, officialCoverage } from '../db/private.js';
import { isPlausible } from '../core/units.js';
import { isWeekend, todayHouston } from '../core/dates.js';

// Perfiles conocidos. Las columnas son 1-based; varias columnas por producto
// significan "usar la primera que tenga valor" y marcar conflicto si difieren.
export const PROFILES = [
  {
    id: 'mb-historico',
    description: 'Serie diaria Mont Belvieu (Fecha, Propano, Butano, Propano 2026, Butano 2026) en cUSD/gal',
    headers: { 1: 'fecha', 2: 'propano', 3: 'butano' },
    date: 1,
    cols: { propano: [2, 4], butano: [3, 5] },
    unit: 'cUSD/gal',
  },
  {
    id: 'mb-diario',
    description: 'Hoja diaria con "propano USDc/Gal" y "butano USDc/Gal"',
    headers: { 1: 'fecha', 5: 'propano usdc/gal', 6: 'butano usdc/gal' },
    date: 1,
    cols: { propano: [5], butano: [6] },
    unit: 'cUSD/gal',
  },
];

function cellValue(cell) {
  const v = cell?.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result; // fórmula
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
  }
  return v;
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

export function detectProfile(sheet) {
  const row = sheet.getRow(1);
  return PROFILES.find((p) => Object.entries(p.headers).every(([c, h]) => norm(cellValue(row.getCell(Number(c)))) === h));
}

function toIso(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
}

/** Extrae filas válidas. Devuelve { rows, stats } sin exponer valores en stats. */
export function extractRows(sheet, profile, today = todayHouston()) {
  const rows = [];
  const stats = { read: 0, rejected: 0, conflicts: 0, duplicates: 0, future: 0, weekend: 0, outOfRange: 0, empty: 0, badDate: 0 };
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    stats.read++;
    const date = toIso(cellValue(row.getCell(profile.date)));
    if (!date) { stats.badDate++; return; }
    if (date > today) { stats.future++; return; }
    if (isWeekend(date)) stats.weekend++;
    for (const [product, cols] of Object.entries(profile.cols)) {
      const vals = cols.map((c) => cellValue(row.getCell(c))).filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (!vals.length) { stats.empty++; continue; }
      if (vals.some((v) => Math.abs(v - vals[0]) > 1e-9)) { stats.conflicts++; stats.rejected++; continue; }
      if (!isPlausible(product, vals[0])) { stats.outOfRange++; stats.rejected++; continue; }
      rows.push({ product, quoteDate: date, value: vals[0] });
    }
  });
  // Fechas repetidas: si los valores coinciden se conserva una; si difieren se
  // descartan todas (no hay forma objetiva de elegir) y se reportan.
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.product}|${r.quoteDate}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)).push(r);
  }
  const out = [];
  stats.duplicateDates = [];
  for (const group of byKey.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    stats.duplicates++;
    if (group.every((r) => Math.abs(r.value - group[0].value) < 1e-9)) out.push(group[0]);
    else { stats.rejected += group.length; stats.duplicateDates.push(`${group[0].product} ${group[0].quoteDate}`); }
  }
  return { rows: out, stats };
}

export async function importFile(file, { sheet: onlySheet, onlyNew = false } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const results = [];
  for (const sheet of wb.worksheets) {
    if (onlySheet && sheet.name !== onlySheet) continue;
    const profile = detectProfile(sheet);
    if (!profile) continue;
    const { rows, stats } = extractRows(sheet, profile);
    const { added, changed, kept } = upsertOfficial(rows, path.basename(file), { onlyNew });
    const dates = rows.map((r) => r.quoteDate).sort();
    const entry = {
      sourceFile: `${path.basename(file)} › ${sheet.name}`, rowsRead: stats.read, rowsNew: added, rowsChanged: changed,
      rowsRejected: stats.rejected, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
      note: `perfil ${profile.id}; fines de semana ${stats.weekend}; futuras ${stats.future}; conflictos ${stats.conflicts}; fechas repetidas ${stats.duplicates}${stats.duplicateDates.length ? ` (descartadas por valores distintos: ${stats.duplicateDates.join(', ')})` : ''}; fuera de rango ${stats.outOfRange}${onlyNew ? `; existentes no modificadas ${kept} (modo --only-new)` : ''}`,
    };
    logImport(entry);
    results.push({ sheet: sheet.name, profile: profile.id, valid: rows.length, ...entry, stats });
  }
  if (!results.length) throw new Error(`No se reconoció ningún formato en ${path.basename(file)}. Revise PROFILES en import-official.js.`);
  return results;
}

async function main() {
  const files = [];
  const opts = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') files.push(argv[++i]);
    else if (argv[i] === '--sheet') opts.sheet = argv[++i];
    else if (argv[i] === '--only-new') opts.onlyNew = true;
  }
  if (!files.length) {
    console.error('Uso: npm run import-official -- --file "/ruta/archivo.xlsx"');
    process.exit(1);
  }
  for (const f of files) {
    try {
      for (const r of await importFile(f, opts)) {
        console.log(`✓ ${r.sourceFile} [${r.profile}] filas leídas ${r.rowsRead}, válidas ${r.valid}, nuevas ${r.rowsNew}, ` +
          `modificadas ${r.rowsChanged}, rechazadas ${r.rowsRejected} (${r.firstDate} → ${r.lastDate}); ${r.note}`);
      }
    } catch (e) {
      // El mensaje de error nunca incluye valores de celdas.
      console.error(`✗ ${path.basename(f)}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log('Cobertura en base privada:');
  for (const c of officialCoverage()) console.log(`  ${c.product}: ${c.n} días (${c.first_date} → ${c.last_date})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
