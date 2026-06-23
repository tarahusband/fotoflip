const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DB_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR)
  : path.join(os.homedir(), 'Library', 'Application Support', 'fotoflip');
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


    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      role TEXT DEFAULT 'user',
      onboarding_complete INTEGER DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      business_name TEXT DEFAULT '',
      seller_handle TEXT DEFAULT '',
      default_listing_style TEXT DEFAULT 'studio',
      default_condition_notes TEXT DEFAULT '',
      shipping_zip TEXT DEFAULT '',
      timezone TEXT DEFAULT 'America/New_York',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      item_id INTEGER NOT NULL REFERENCES items(id),
      platform TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      price REAL,
      platform_listing_id TEXT,
      published_at TEXT,
      sold_at TEXT,
      source TEXT DEFAULT 'manual',
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_item_platform ON listings(item_id, platform);
    CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
    CREATE INDEX IF NOT EXISTS idx_listings_item ON listings(item_id);
    CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id);
  `);

  // drop obsolete tables
  db.exec(`DROP TABLE IF EXISTS processing_queue`);

  // migrate bundle columns onto existing DBs
  const cols = db.pragma('table_info(items)').map(c => c.name);
  if (!cols.includes('is_bundle'))          db.exec(`ALTER TABLE items ADD COLUMN is_bundle INTEGER DEFAULT 0`);
  if (!cols.includes('bundle_type'))        db.exec(`ALTER TABLE items ADD COLUMN bundle_type TEXT DEFAULT ''`);
  if (!cols.includes('bundle_count'))       db.exec(`ALTER TABLE items ADD COLUMN bundle_count INTEGER DEFAULT 0`);
  if (!cols.includes('weight'))             db.exec(`ALTER TABLE items ADD COLUMN weight TEXT DEFAULT ''`);
  if (!cols.includes('weight_unit'))        db.exec(`ALTER TABLE items ADD COLUMN weight_unit TEXT DEFAULT 'LB'`);
  // Inventory lifecycle columns
  if (!cols.includes('location'))           db.exec(`ALTER TABLE items ADD COLUMN location TEXT DEFAULT ''`);
  if (!cols.includes('inv_status'))         db.exec(`ALTER TABLE items ADD COLUMN inv_status TEXT DEFAULT 'ready'`);
  if (!cols.includes('date_listed'))        db.exec(`ALTER TABLE items ADD COLUMN date_listed TEXT`);
  if (!cols.includes('date_sold'))          db.exec(`ALTER TABLE items ADD COLUMN date_sold TEXT`);
  if (!cols.includes('date_shipped'))       db.exec(`ALTER TABLE items ADD COLUMN date_shipped TEXT`);
  if (!cols.includes('poshmark_exported'))  db.exec(`ALTER TABLE items ADD COLUMN poshmark_exported INTEGER DEFAULT 0`);
  if (!cols.includes('whatnot_exported'))   db.exec(`ALTER TABLE items ADD COLUMN whatnot_exported INTEGER DEFAULT 0`);
  if (!cols.includes('etsy_exported'))      db.exec(`ALTER TABLE items ADD COLUMN etsy_exported INTEGER DEFAULT 0`);
  if (!cols.includes('user_id'))            db.exec(`ALTER TABLE items ADD COLUMN user_id INTEGER REFERENCES users(id)`);

  const photoCols = db.pragma('table_info(photos)').map(c => c.name);
  if (!photoCols.includes('user_id'))       db.exec(`ALTER TABLE photos ADD COLUMN user_id INTEGER REFERENCES users(id)`);

  const userCols = db.pragma('table_info(users)').map(c => c.name);
  if (!userCols.includes('role'))               db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`);
  if (!userCols.includes('onboarding_complete'))db.exec(`ALTER TABLE users ADD COLUMN onboarding_complete INTEGER DEFAULT 0`);
  if (!userCols.includes('last_login_at'))      db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`);

  // Backfill listings table from legacy export flags (run once — skips existing rows)
  backfillListings(db);

  return db;
}

function backfillListings(db) {
  const statusMap = s => ['sold','shipped'].includes(s) ? 'sold' : 'published';

  const poshItems = db.prepare(`
    SELECT id, user_id, inv_status, date_listed FROM items
    WHERE poshmark_exported = 1
    AND id NOT IN (SELECT item_id FROM listings WHERE platform = 'poshmark')
  `).all();

  const whatnotItems = db.prepare(`
    SELECT id, user_id, inv_status, date_listed FROM items
    WHERE whatnot_exported = 1
    AND id NOT IN (SELECT item_id FROM listings WHERE platform = 'whatnot')
  `).all();

  const insert = db.prepare(`
    INSERT INTO listings (user_id, item_id, platform, status, published_at, source)
    VALUES (?, ?, ?, ?, ?, 'backfilled')
  `);

  const insertMany = db.transaction((rows, platform) => {
    for (const row of rows) {
      insert.run(row.user_id, row.id, platform, statusMap(row.inv_status), row.date_listed);
    }
  });

  insertMany(poshItems, 'poshmark');
  insertMany(whatnotItems, 'whatnot');
}

module.exports = { getDb, initDb, DB_PATH };
