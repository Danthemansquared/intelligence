// Entorno A — almacenamiento PRIVADO de precios oficiales AMEXGAS.
//
// Reglas:
//  • Archivo separado de la base pública, en private/ (permisos 0700/0600, excluido de git).
//  • Este módulo nunca escribe precios en logs, mensajes de error ni telemetría.
//  • Sólo se abre si PRIVATE_MODE está habilitado (ver src/config.js).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, settings } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS official_prices (
  product    TEXT NOT NULL,           -- propano | butano
  quote_date TEXT NOT NULL,
  value      REAL NOT NULL,           -- cUSD/gal
  unit       TEXT NOT NULL DEFAULT 'cUSD/gal',
  source_file TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (product, quote_date)
);
CREATE TABLE IF NOT EXISTS import_log (   -- sin valores, sólo metadatos
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL, source_file TEXT NOT NULL,
  rows_read INTEGER, rows_new INTEGER, rows_changed INTEGER, rows_rejected INTEGER,
  first_date TEXT, last_date TEXT, note TEXT
);
`;

let db;

export function privateDbPath() {
  return process.env.PRIVATE_DB || path.join(ROOT, 'private', 'official.db');
}

export function openPrivateDb(file = privateDbPath()) {
  if (!settings.privateMode) throw new Error('El modo privado está deshabilitado en este entorno.');
  if (db) return db;
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(file), 0o700);
  }
  db = new DatabaseSync(file);
  if (file !== ':memory:') fs.chmodSync(file, 0o600);
  db.exec(SCHEMA);
  return db;
}

export function closePrivateDb() {
  if (db) { db.close(); db = undefined; }
}

export function upsertOfficial(rows, sourceFile, { onlyNew = false } = {}) {
  const d = openPrivateDb();
  const get = d.prepare('SELECT value FROM official_prices WHERE product=? AND quote_date=?');
  const ins = d.prepare('INSERT INTO official_prices VALUES (?,?,?,?,?,?)');
  const upd = d.prepare('UPDATE official_prices SET value=?, source_file=?, imported_at=? WHERE product=? AND quote_date=?');
  const now = new Date().toISOString();
  let added = 0, changed = 0, kept = 0;
  d.exec('BEGIN');
  try {
    for (const r of rows) {
      const cur = get.get(r.product, r.quoteDate);
      if (!cur) { ins.run(r.product, r.quoteDate, r.value, 'cUSD/gal', sourceFile, now); added++; }
      else if (onlyNew) kept++;
      else if (Math.abs(cur.value - r.value) > 1e-9) { upd.run(r.value, sourceFile, now, r.product, r.quoteDate); changed++; }
    }
    d.exec('COMMIT');
  } catch {
    d.exec('ROLLBACK');
    throw new Error('Falló la escritura en la base privada (detalle omitido por confidencialidad).');
  }
  return { added, changed, kept };
}

export function logImport(entry) {
  openPrivateDb().prepare(`INSERT INTO import_log (imported_at, source_file, rows_read, rows_new, rows_changed, rows_rejected, first_date, last_date, note)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(new Date().toISOString(), entry.sourceFile, entry.rowsRead, entry.rowsNew, entry.rowsChanged,
    entry.rowsRejected, entry.firstDate, entry.lastDate, entry.note ?? null);
}

/** Map(quoteDate → value) para un producto. */
export function officialMap(product) {
  const rows = openPrivateDb().prepare('SELECT quote_date, value FROM official_prices WHERE product=? ORDER BY quote_date').all(product);
  return new Map(rows.map((r) => [r.quote_date, r.value]));
}

export function officialCoverage() {
  return openPrivateDb().prepare(`SELECT product, COUNT(*) n, MIN(quote_date) first_date, MAX(quote_date) last_date
    FROM official_prices GROUP BY product`).all().map((r) => ({ ...r }));
}

export function lastImport() {
  const r = openPrivateDb().prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
  return r ? { ...r } : null;
}
