require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const { getDb, initDb } = require('./src/db');
const { processItem } = require('./src/processor');

const app = express();
const PORT = process.env.PORT || 3456;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PROCESSED_DIR = path.join(__dirname, 'processed');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Preserve original filename; prefix with timestamp if collision risk
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/processed', express.static(PROCESSED_DIR));

// ── Photos ─────────────────────────────────────────────────────────────────

app.post('/api/photos/upload', upload.array('photos'), async (req, res) => {
  const db = getDb();
  const photos = [];

  for (const file of req.files) {
    const result = db
      .prepare(
        `INSERT INTO photos (path, name, size, status, created_at) VALUES (?, ?, ?, 'pending', datetime('now'))`,
      )
      .run(file.path, file.originalname, file.size);

    photos.push({
      id: result.lastInsertRowid,
      name: file.originalname,
      uploadName: file.filename,
      path: file.path,
      url: `/uploads/${file.filename}`,
    });
  }

  res.json({ photos });
});

app.get('/api/photos', (req, res) => {
  const db = getDb();
  const photos = db.prepare(`SELECT * FROM photos ORDER BY created_at DESC`).all();
  res.json(photos);
});

app.get('/api/photos/:id', (req, res) => {
  const db = getDb();
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  res.json(photo);
});

// ── Items ───────────────────────────────────────────────────────────────────

app.get('/api/items', (req, res) => {
  const db = getDb();
  const items = db.prepare(`SELECT * FROM items ORDER BY created_at DESC`).all();
  const photos = db.prepare(`SELECT * FROM photos`).all();
  const photoMap = Object.fromEntries(photos.map((p) => [p.id, p]));

  const enriched = items.map((item) => ({
    ...item,
    photoIds: JSON.parse(item.photo_ids || '[]'),
    photos: JSON.parse(item.photo_ids || '[]').map((id) => photoMap[id]).filter(Boolean),
  }));

  res.json(enriched);
});

app.post('/api/items', async (req, res) => {
  const db = getDb();
  const { photoIds, status = 'Purchased', purchaseDate } = req.body;

  if (!photoIds || !photoIds.length) {
    return res.status(400).json({ error: 'photoIds required' });
  }

  const date = purchaseDate || new Date().toISOString().slice(0, 10);
  const result = db
    .prepare(
      `INSERT INTO items (status, purchase_date, photo_ids, processing_status, created_at)
       VALUES (?, ?, ?, 'pending', datetime('now'))`,
    )
    .run(status, date, JSON.stringify(photoIds));

  const itemId = result.lastInsertRowid;

  // Mark photos as grouped
  for (const photoId of photoIds) {
    db.prepare(`UPDATE photos SET status = 'grouped' WHERE id = ?`).run(photoId);
  }

  if (status === 'Purchased') {
    // Process async — don't block response
    processItem(itemId, photoIds, PROCESSED_DIR).catch((err) => {
      console.error(`Processing error for item ${itemId}:`, err.message);
    });
  } else {
    db.prepare(`UPDATE items SET processing_status = 'skipped' WHERE id = ?`).run(itemId);
  }

  res.json({ id: itemId, status, photoIds });
});

app.get('/api/items/:id', (req, res) => {
  const db = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photos = photoIds.map((id) => db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id)).filter(Boolean);

  res.json({ ...item, photoIds, photos });
});

app.put('/api/items/:id/status', (req, res) => {
  const db = getDb();
  const { status } = req.body;
  const valid = ['Purchased', 'Passed', 'Needs Cleaning', 'Needs Sorting'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare(`UPDATE items SET status = ? WHERE id = ?`).run(status, req.params.id);

  if (status === 'Purchased') {
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    const photoIds = JSON.parse(item.photo_ids || '[]');
    processItem(parseInt(req.params.id), photoIds, PROCESSED_DIR).catch(console.error);
  }

  res.json({ success: true });
});

app.post('/api/items/:id/process', async (req, res) => {
  const db = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const photoIds = JSON.parse(item.photo_ids || '[]');

  try {
    const results = await processItem(parseInt(req.params.id), photoIds, PROCESSED_DIR);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings ────────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

app.put('/api/settings', (req, res) => {
  const db = getDb();
  for (const [key, value] of Object.entries(req.body)) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
  }
  res.json({ success: true });
});

// ── Stats ───────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) as n FROM items`).get().n;
  const purchased = db.prepare(`SELECT COUNT(*) as n FROM items WHERE status = 'Purchased'`).get().n;
  const backlog = db.prepare(`SELECT COUNT(*) as n FROM items WHERE status IN ('Needs Cleaning','Needs Sorting')`).get().n;
  const processed = db.prepare(`SELECT COUNT(*) as n FROM items WHERE processing_status = 'done'`).get().n;
  res.json({ total, purchased, backlog, processed });
});

// ── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  initDb();
  app.listen(PORT, () => {
    console.log(`\nFotoFlip running at http://localhost:${PORT}\n`);
  });
})();
