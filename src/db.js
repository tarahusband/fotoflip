const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'fotoflip');
const DB_PATH = path.join(DB_DIR, 'fotoflip.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      processed_path TEXT,
      created_at TEXT,
      processed_at TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'Flip',
      purchase_date TEXT,
      photo_ids TEXT,
      processing_status TEXT DEFAULT 'pending',
      sku TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      is_bundle INTEGER DEFAULT 0,
      bundle_type TEXT DEFAULT '',
      bundle_count INTEGER DEFAULT 0
    );


    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
  `);

  // drop obsolete tables
  db.exec(`DROP TABLE IF EXISTS processing_queue`);

  // migrate bundle columns onto existing DBs
  const cols = db.pragma('table_info(items)').map(c => c.name);
  if (!cols.includes('is_bundle'))     db.exec(`ALTER TABLE items ADD COLUMN is_bundle INTEGER DEFAULT 0`);
  if (!cols.includes('bundle_type'))   db.exec(`ALTER TABLE items ADD COLUMN bundle_type TEXT DEFAULT ''`);
  if (!cols.includes('bundle_count'))  db.exec(`ALTER TABLE items ADD COLUMN bundle_count INTEGER DEFAULT 0`);
  if (!cols.includes('weight'))        db.exec(`ALTER TABLE items ADD COLUMN weight TEXT DEFAULT ''`);
  if (!cols.includes('weight_unit'))   db.exec(`ALTER TABLE items ADD COLUMN weight_unit TEXT DEFAULT 'LB'`);

  return db;
}

module.exports = { getDb, initDb, DB_PATH };
