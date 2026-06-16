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

    CREATE TABLE IF NOT EXISTS processing_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER NOT NULL,
      priority INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      created_at TEXT,
      FOREIGN KEY (photo_id) REFERENCES photos(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'Purchased',
      purchase_date TEXT,
      photo_ids TEXT,
      processing_status TEXT DEFAULT 'pending',
      sku TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_queue_priority ON processing_queue(priority DESC);
  `);

  return db;
}

module.exports = { getDb, initDb, DB_PATH };
