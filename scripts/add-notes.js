// Agrega notas de mercado verificadas ("¿Qué movió el mercado?").
// Uso: npm run add-notes -- --file notas.json
//
// Formato: [{ "eventDate": "2026-10-15", "title": "...", "summary": "...",
//            "factor": "inventarios", "products": ["propano"],
//            "sourceName": "EIA", "url": "https://...", "publishedAt": "2026-10-15" }]
// Reglas: URL http(s) real (no se inventan), fecha no futura, texto en español.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { insertNote } from '../src/db/public.js';
import { isIsoDate, todayHouston } from '../src/core/dates.js';

export const FACTORS = ['crudo', 'inventarios', 'demanda', 'clima', 'exportaciones', 'logistica', 'regulatorio', 'geopolitica', 'petroquimica', 'otro'];
const PRODUCTS = ['propano', 'butano', 'wti', 'brent'];

export function validateNote(n, today = todayHouston()) {
  const errs = [];
  if (!isIsoDate(n.eventDate)) errs.push('eventDate inválida');
  else if (n.eventDate > today) errs.push('eventDate en el futuro');
  if (!n.title || n.title.length > 160) errs.push('title vacío o > 160 caracteres');
  if (!n.summary || n.summary.length > 600) errs.push('summary vacío o > 600 caracteres');
  if (!FACTORS.includes(n.factor)) errs.push(`factor debe ser uno de: ${FACTORS.join(', ')}`);
  if (!Array.isArray(n.products) || !n.products.length || n.products.some((p) => !PRODUCTS.includes(p))) errs.push('products inválido');
  if (!n.sourceName) errs.push('sourceName vacío');
  try { if (!['http:', 'https:'].includes(new URL(n.url).protocol)) errs.push('url debe ser http(s)'); } catch { errs.push('url inválida'); }
  return errs;
}

function main() {
  const i = process.argv.indexOf('--file');
  if (i < 0) { console.error('Uso: npm run add-notes -- --file notas.json'); process.exit(1); }
  const notes = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  let ok = 0;
  for (const n of notes) {
    const errs = validateNote(n);
    if (errs.length) { console.error(`✗ "${n.title ?? '(sin título)'}": ${errs.join('; ')}`); process.exitCode = 1; continue; }
    const r = insertNote(n);
    if (r.changes) ok++; else console.log(`· ya existía: ${n.title}`);
  }
  console.log(`${ok} notas agregadas.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
