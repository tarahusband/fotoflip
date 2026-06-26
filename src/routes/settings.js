const express   = require('express');
const { getDb } = require('../db');
const { getUserId } = require('../auth');

const router = express.Router();

router.get('/api/settings', (req, res) => {
  const db   = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/api/settings', (req, res) => {
  const db = getDb();
  for (const [key, value] of Object.entries(req.body)) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
  }
  res.json({ success: true });
});

router.post('/api/settings/make-webhook', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('https://hook.')) return res.status(400).json({ error: '🌸 Invalid webhook URL — must start with https://hook.' });
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('make_webhook_url',?)`).run(url);
  res.json({ success: true });
});

router.get('/api/settings/make-webhook', (req, res) => {
  const db  = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key='make_webhook_url'`).get();
  res.json({ url: row?.value || '' });
});

router.get('/api/profile', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  if (!userId) return res.json({});
  const profile = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(userId);
  res.json(profile || { user_id: userId });
});

router.put('/api/profile', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: '🌸 Not authenticated' });
  const allowed = ['business_name','seller_handle','default_listing_style','default_condition_notes','shipping_zip','timezone'];
  const fields  = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: '🌸 No valid fields' });
  const existing = db.prepare(`SELECT user_id FROM user_profiles WHERE user_id = ?`).get(userId);
  if (existing) {
    const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE user_profiles SET ${setClauses}, updated_at = datetime('now') WHERE user_id = ?`)
      .run(...fields.map(([,v]) => v), userId);
  } else {
    const keys = ['user_id', ...fields.map(([k]) => k)].join(', ');
    const vals = '?, '.repeat(fields.length + 1).slice(0, -2);
    db.prepare(`INSERT INTO user_profiles (${keys}) VALUES (${vals})`)
      .run(userId, ...fields.map(([,v]) => v));
  }
  res.json({ success: true });
});

module.exports = router;
