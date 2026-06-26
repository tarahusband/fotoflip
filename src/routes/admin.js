const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const fsSync  = require('fs');
const { getDb, DB_PATH }  = require('../db');
const { getBundleLabel, applyBundleLabel, cloudinaryUpload } = require('../lib/images');
const { PROCESSED_DIR, ERROR_LOG } = require('../lib/config');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '🌸 Admin only' });
  next();
}

router.get('/api/admin/health', requireAdmin, (req, res) => {
  let db_connected = false, items = 0, photos = 0, missing_thumbnails = 0;
  try {
    const db = getDb();
    db_connected = true;
    items             = db.prepare('SELECT COUNT(*) as n FROM items').get().n;
    photos            = db.prepare('SELECT COUNT(*) as n FROM photos').get().n;
    missing_thumbnails = db.prepare("SELECT COUNT(*) as n FROM photos WHERE cloudinary_url IS NULL OR cloudinary_url = ''").get().n;
  } catch {}
  res.json({
    db_connected,
    cloudinary_configured: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
    anthropic_configured:  !!process.env.ANTHROPIC_API_KEY,
    items,
    photos,
    missing_thumbnails,
  });
});

router.get('/api/admin/db-check', requireAdmin, (req, res) => {
  const db = getDb();
  const items      = db.prepare('SELECT COUNT(*) as count FROM items').get();
  const users      = db.prepare('SELECT id, email, role FROM users').all();
  const itemsByUser = db.prepare('SELECT user_id, COUNT(*) as count FROM items GROUP BY user_id').all();
  const dbPath     = process.env.DATA_DIR ? `${process.env.DATA_DIR}/fotoflip.db` : 'local';
  const tables     = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  const sessions   = tables.includes('sessions') ? db.prepare('SELECT COUNT(*) as count FROM sessions').get() : null;
  let recentErrors = [];
  try {
    const log = fsSync.readFileSync(ERROR_LOG, 'utf8');
    recentErrors = log.trim().split('\n').slice(-20);
  } catch {}
  const photosWithUrl    = db.prepare("SELECT COUNT(*) as count FROM photos WHERE cloudinary_url IS NOT NULL AND cloudinary_url != ''").get();
  const photosWithoutUrl = db.prepare("SELECT COUNT(*) as count FROM photos WHERE cloudinary_url IS NULL OR cloudinary_url = ''").get();
  const sampleBroken     = db.prepare("SELECT id, path, processed_path, cloudinary_url FROM photos WHERE (cloudinary_url IS NULL OR cloudinary_url = '') AND processed_path IS NOT NULL LIMIT 3").all();
  res.json({ dbPath, items, users, itemsByUser, tables, sessions, node_env: process.env.NODE_ENV || 'not set', recentErrors, photosWithUrl, photosWithoutUrl, sampleBroken });
});

router.get('/api/admin/backup', (req, res) => {
  const isAdmin = req.user?.role === 'admin' ||
    req.headers['x-admin-secret'] === process.env.SESSION_SECRET;
  if (!isAdmin) return res.status(403).json({ error: '🌸 Admin only' });
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="fotoflip-${date}.db"`);
    const stream = fsSync.createReadStream(DB_PATH);
    stream.on('error', e => {
      console.warn('[FotoFlip] Backup stream error:', e.message);
      if (!res.headersSent) res.status(500).json({ error: '🌸 Backup failed' });
    });
    stream.pipe(res);
  } catch (e) {
    console.warn('[FotoFlip] Backup failed:', e.message);
    res.status(500).json({ error: '🌸 Backup failed: ' + e.message });
  }
});

router.post('/api/admin/normalize-titles', requireAdmin, (req, res) => {
  const db = getDb();
  const photos = db.prepare(`SELECT id, metadata FROM photos WHERE metadata IS NOT NULL`).all();
  let done = 0, skipped = 0;
  for (const photo of photos) {
    try {
      const meta = JSON.parse(photo.metadata);
      if (!meta.title) { skipped++; continue; }
      const clean = meta.title
        .replace(/^[\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}️\s]+/gu, '')
        .replace(/[\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}️\s]+$/gu, '')
        .trim();
      if (!clean) { skipped++; continue; }
      meta.title = `⚜️ ${clean} 🩷`;
      if (meta.imgbbUrl) delete meta.imgbbUrl;
      db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photo.id);
      done++;
    } catch { skipped++; }
  }
  res.json({ done, skipped });
});

// ── ADMIN-002: User management ───────────────────────────────────────────────

router.get('/api/admin/users', requireAdmin, (req, res) => {
  const db    = getDb();
  const users = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.status, u.last_login_at, u.created_at,
           COUNT(i.id) as item_count,
           c.accepted_at as consented_at
    FROM users u
    LEFT JOIN items i ON i.user_id = u.id
    LEFT JOIN user_consents c ON c.user_id = u.id AND c.consent_version = '1.0'
    GROUP BY u.id
    ORDER BY u.created_at ASC
  `).all();
  res.json(users);
});

router.patch('/api/admin/users/:id/status', requireAdmin, express.json(), (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { status } = req.body || {};
  if (!['active', 'revoked'].includes(status)) {
    return res.status(400).json({ error: '🌸 Status must be "active" or "revoked"' });
  }
  if (targetId === req.user.id) {
    return res.status(400).json({ error: '🌸 You cannot change your own status' });
  }
  const db   = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: '🌸 User not found' });
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, targetId);
  res.json({ ok: true, id: targetId, status });
});

router.patch('/api/admin/users/:id/role', requireAdmin, express.json(), (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { role } = req.body || {};

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: '🌸 Role must be "admin" or "user"' });
  }
  if (targetId === req.user.id) {
    return res.status(400).json({ error: '🌸 You cannot change your own role' });
  }

  const db   = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: '🌸 User not found' });

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  res.json({ ok: true, id: targetId, role });
});

// ── BETA-001: Allow list management ──────────────────────────────────────────

router.get('/api/admin/allowed-users', requireAdmin, (req, res) => {
  const db = getDb();
  const list = db.prepare(
    'SELECT id, email, added_at FROM allowed_users ORDER BY added_at DESC'
  ).all();
  res.json(list);
});

router.post('/api/admin/allowed-users', requireAdmin, express.json(), (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: '🌸 Valid email address required' });
  }
  const db = getDb();
  try {
    db.prepare('INSERT INTO allowed_users (email, added_by) VALUES (?, ?)').run(email, req.user.id);
    res.json({ ok: true, email });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '🌸 That email is already on the allow list' });
    }
    throw e;
  }
});

router.delete('/api/admin/allowed-users/:email', requireAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase();
  const db = getDb();
  const r = db.prepare('DELETE FROM allowed_users WHERE email = ?').run(email);
  if (r.changes === 0) return res.status(404).json({ error: '🌸 Email not found on allow list' });
  res.json({ ok: true, email });
});

// ── BETA-003: Access request management ──────────────────────────────────────

router.get('/api/admin/access-requests', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM request_access ORDER BY created_at DESC`).all();
  res.json(rows);
});

router.patch('/api/admin/access-requests/:id', requireAdmin, express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { action } = req.body || {};
  if (!['approve', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: '🌸 Action must be "approve" or "dismiss"' });
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM request_access WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '🌸 Request not found' });

  if (action === 'approve') {
    try {
      db.prepare('INSERT OR IGNORE INTO allowed_users (email, added_by) VALUES (?, ?)').run(row.email, req.user.id);
    } catch {}
    db.prepare(`UPDATE request_access SET status = 'approved' WHERE id = ?`).run(id);
    return res.json({ ok: true, status: 'approved', email: row.email });
  }

  db.prepare(`UPDATE request_access SET status = 'dismissed' WHERE id = ?`).run(id);
  res.json({ ok: true, status: 'dismissed' });
});

// ── ADMIN-006: Impersonation / View as User ───────────────────────────────────

router.post('/api/admin/impersonate/exit', requireAdmin, (req, res) => {
  const logId = req.session.impersonation_log_id;
  if (logId) {
    const db = getDb();
    db.prepare(`UPDATE admin_impersonation_log SET ended_at = datetime('now') WHERE id = ?`).run(logId);
  }
  delete req.session.impersonating_user_id;
  delete req.session.impersonation_log_id;
  res.json({ ok: true });
});

router.post('/api/admin/impersonate/:id', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.id) {
    return res.status(400).json({ error: '🌸 You cannot impersonate yourself.' });
  }
  const db     = getDb();
  const target = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: '🌸 User not found.' });

  req.session.impersonating_user_id  = targetId;
  req.session.impersonation_log_id   = db.prepare(
    'INSERT INTO admin_impersonation_log (admin_id, target_user_id, ip_address) VALUES (?, ?, ?)'
  ).run(req.user.id, targetId, req.ip || '').lastInsertRowid;

  res.json({ ok: true, target });
});

// ── Content management ────────────────────────────────────────────────────────

router.post('/api/admin/regenerate-labels', requireAdmin, async (req, res) => {
  const db    = getDb();
  const items = db.prepare(`SELECT * FROM items WHERE is_bundle = 1`).all();
  let done = 0, skipped = 0, errors = [];
  for (const item of items) {
    try {
      const photoIds  = JSON.parse(item.photo_ids || '[]');
      const photo     = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
      const meta = photo?.metadata ? JSON.parse(photo.metadata) : {};
      let imageSource = photo?.cloudinary_url || meta.imgbbUrl;
      if (photo?.processed_path) {
        try { await fs.access(photo.processed_path); imageSource = photo.processed_path; } catch {}
      }
      if (!imageSource) { skipped++; continue; }
      const { main, sub } = getBundleLabel(meta, item);
      const buf      = await applyBundleLabel(imageSource, main, sub);
      const labelUrl = await cloudinaryUpload(buf, `item-${item.id}-labeled`);
      if (labelUrl) {
        db.prepare('UPDATE items SET bundle_label_url = ? WHERE id = ?').run(labelUrl, item.id);
      }
      const labeledPath = path.join(PROCESSED_DIR, `item-${item.id}-labeled.jpg`);
      await fs.writeFile(labeledPath, buf).catch(() => {});
      done++;
    } catch (e) {
      errors.push({ id: item.id, err: e.message });
    }
  }
  res.json({ done, skipped, errors });
});

module.exports = router;
