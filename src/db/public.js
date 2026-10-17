// Almacenamiento de datos PÚBLICOS (observaciones digitales, ejecuciones de
// actualización, notas de mercado). Nunca contiene precios oficiales: esos
// viven en una base separada (src/db/private.js).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
  source_id   TEXT NOT NULL,
  product     TEXT NOT NULL,
  quote_date  TEXT NOT NULL,          -- fecha de cotización (día de operación)
  value_orig  REAL NOT NULL,          -- valor tal como lo publica la fuente
  unit_orig   TEXT NOT NULL,
  value_norm  REAL NOT NULL,          -- valor normalizado (cUSD/gal GLP, USD/bbl crudo)
  unit_norm   TEXT NOT NULL,
  conversion  TEXT NOT NULL,          -- conversión aplicada
  published_at TEXT,                  -- fecha de publicación de la fuente, si se conoce
  fetched_at  TEXT NOT NULL,          -- fecha/hora de consulta
  run_id      INTEGER,
  PRIMARY KEY (source_id, product, quote_date)
);
CREATE TABLE IF NOT EXISTS observation_revisions (
  source_id TEXT NOT NULL, product TEXT NOT NULL, quote_date TEXT NOT NULL,
  old_value REAL NOT NULL, new_value REAL NOT NULL, revised_at TEXT NOT NULL, run_id INTEGER
);
CREATE TABLE IF NOT EXISTS fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,               -- ok | sin_cambios | error | omitida
  attempts INTEGER DEFAULT 1,
  rows_received INTEGER DEFAULT 0,
  rows_new INTEGER DEFAULT 0,
  rows_revised INTEGER DEFAULT 0,
  rows_rejected INTEGER DEFAULT 0,
  last_quote_date TEXT,
  structure_signature TEXT,           -- huella del formato de la respuesta
  structure_changed INTEGER DEFAULT 0,
  message TEXT
);
CREATE TABLE IF NOT EXISTS market_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  factor TEXT NOT NULL,               -- crudo | inventarios | demanda | clima | exportaciones | logistica | regulatorio | geopolitica | otro
  products TEXT NOT NULL,             -- lista separada por comas
  source_name TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  added_at TEXT NOT NULL,
  UNIQUE (url, event_date)
);
CREATE INDEX IF NOT EXISTS idx_obs_product ON observations(product, quote_date);
`;

let db;

export function openPublicDb(file = process.env.PUBLIC_DB || path.join(ROOT, 'data', 'market.db')) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function closePublicDb() {
  if (db) { db.close(); db = undefined; }
}

/**
 * Inserta observaciones normalizadas. Detecta duplicados (misma fuente,
 * producto y fecha): si el valor es igual no hace nada; si cambió, conserva
 * la revisión en observation_revisions.
 */
export function upsertObservations(rows, runId) {
  const d = openPublicDb();
  const get = d.prepare('SELECT value_orig FROM observations WHERE source_id=? AND product=? AND quote_date=?');
  const ins = d.prepare(`INSERT INTO observations
    (source_id, product, quote_date, value_orig, unit_orig, value_norm, unit_norm, conversion, published_at, fetched_at, run_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const upd = d.prepare(`UPDATE observations SET value_orig=?, value_norm=?, unit_orig=?, unit_norm=?, conversion=?,
    published_at=?, fetched_at=?, run_id=? WHERE source_id=? AND product=? AND quote_date=?`);
  const rev = d.prepare('INSERT INTO observation_revisions VALUES (?,?,?,?,?,?,?)');
  let added = 0, revised = 0;
  d.exec('BEGIN');
  try {
    for (const r of rows) {
      const cur = get.get(r.sourceId, r.product, r.quoteDate);
      if (!cur) {
        ins.run(r.sourceId, r.product, r.quoteDate, r.valueOrig, r.unitOrig, r.valueNorm, r.unitNorm, r.conversion,
          r.publishedAt ?? null, r.fetchedAt, runId ?? null);
        added++;
      } else if (Math.abs(cur.value_orig - r.valueOrig) > 1e-9) {
        rev.run(r.sourceId, r.product, r.quoteDate, cur.value_orig, r.valueOrig, r.fetchedAt, runId ?? null);
        upd.run(r.valueOrig, r.valueNorm, r.unitOrig, r.unitNorm, r.conversion, r.publishedAt ?? null, r.fetchedAt, runId ?? null,
          r.sourceId, r.product, r.quoteDate);
        revised++;
      }
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { added, revised };
}

export function getSeries(sourceId, product, from = '0000-00-00', to = '9999-99-99') {
  return openPublicDb().prepare(`SELECT quote_date AS date, value_norm AS value, unit_norm AS unit, value_orig, unit_orig
    FROM observations WHERE source_id=? AND product=? AND quote_date BETWEEN ? AND ? ORDER BY quote_date`)
    .all(sourceId, product, from, to).map((r) => ({ ...r }));
}

export function lastObservation(sourceId, product) {
  const r = openPublicDb().prepare(`SELECT quote_date AS date, value_norm AS value, unit_norm AS unit, value_orig, unit_orig,
    published_at, fetched_at FROM observations WHERE source_id=? AND product=? ORDER BY quote_date DESC LIMIT 1`).get(sourceId, product);
  return r ? { ...r } : null;
}

export function startRun(sourceId) {
  const r = openPublicDb().prepare("INSERT INTO fetch_runs (source_id, started_at, status) VALUES (?, ?, 'en_curso')")
    .run(sourceId, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function finishRun(id, fields) {
  const keys = Object.keys(fields);
  openPublicDb().prepare(`UPDATE fetch_runs SET finished_at=?, ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`)
    .run(new Date().toISOString(), ...keys.map((k) => fields[k] ?? null), id);
}

export function lastRuns(sourceId) {
  const d = openPublicDb();
  const last = d.prepare('SELECT * FROM fetch_runs WHERE source_id=? ORDER BY id DESC LIMIT 1').get(sourceId);
  const lastOk = d.prepare("SELECT * FROM fetch_runs WHERE source_id=? AND status IN ('ok','sin_cambios') ORDER BY id DESC LIMIT 1").get(sourceId);
  const lastSig = d.prepare('SELECT structure_signature FROM fetch_runs WHERE source_id=? AND structure_signature IS NOT NULL ORDER BY id DESC LIMIT 1').get(sourceId);
  return { last: last ? { ...last } : null, lastOk: lastOk ? { ...lastOk } : null, lastSignature: lastSig?.structure_signature ?? null };
}

export function insertNote(n) {
  return openPublicDb().prepare(`INSERT OR IGNORE INTO market_notes
    (event_date, title, summary, factor, products, source_name, url, published_at, added_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(n.eventDate, n.title, n.summary, n.factor, n.products.join(','), n.sourceName, n.url, n.publishedAt ?? null, new Date().toISOString());
}

export function notesBetween(from, to) {
  return openPublicDb().prepare('SELECT * FROM market_notes WHERE event_date BETWEEN ? AND ? ORDER BY event_date DESC, id DESC')
    .all(from, to).map((r) => ({ ...r, products: r.products.split(',') }));
}
