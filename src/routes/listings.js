const express   = require('express');
const { getDb } = require('../db');
const { getUserId } = require('../auth');

const router = express.Router();

router.get('/api/listings', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const { platform, status } = req.query;
  let query    = `SELECT l.*, i.photo_ids FROM listings l JOIN items i ON i.id = l.item_id WHERE 1=1`;
  const params = [];
  if (userId)  { query += ` AND l.user_id = ?`;  params.push(userId); }
  if (platform){ query += ` AND l.platform = ?`; params.push(platform); }
  if (status)  { query += ` AND l.status = ?`;   params.push(status); }
  query += ` ORDER BY l.created_at DESC`;
  res.json(db.prepare(query).all(...params));
});

router.post('/api/listings', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const { item_id, platform, status, price, published_at, source } = req.body;
  if (!item_id || !platform) return res.status(400).json({ error: '🌸 item_id and platform are required' });
  const existing = db.prepare(`SELECT id FROM listings WHERE item_id = ? AND platform = ?`).get(item_id, platform);
  if (existing) {
    db.prepare(`UPDATE listings SET status = ?, price = ?, published_at = ? WHERE id = ?`)
      .run(status || 'published', price, published_at, existing.id);
    return res.json({ id: existing.id, updated: true });
  }
  const result = db.prepare(
    `INSERT INTO listings (user_id, item_id, platform, status, price, published_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, item_id, platform, status || 'published', price, published_at, source || 'manual');
  res.json({ id: result.lastInsertRowid, created: true });
});

router.put('/api/listings/:id', (req, res) => {
  const db      = getDb();
  const userId  = getUserId(req);
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: '🌸 Listing not found' });
  if (userId && listing.user_id !== userId) return res.status(403).json({ error: '🌸 You do not have access to this listing' });
  const allowed = ['status', 'price', 'platform_listing_id', 'published_at', 'sold_at', 'error_message'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: '🌸 No valid fields to update' });
  const setClauses = updates.map(([k]) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE listings SET ${setClauses} WHERE id = ?`).run(...updates.map(([,v]) => v), req.params.id);
  res.json({ success: true });
});


module.exports = router;
