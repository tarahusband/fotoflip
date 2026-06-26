require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs').promises;
const cors    = require('cors');
const { getDb, initDb } = require('./src/db');
const { setupAuth, requireAuth } = require('./src/auth');
const { logError } = require('./src/lib/config');
const { UPLOAD_DIR, PROCESSED_DIR } = require('./src/lib/config');

const app  = express();
const PORT = process.env.PORT || 3456;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Auth setup (must come before static + routes)
if (process.env.GOOGLE_CLIENT_ID) {
  setupAuth(app, session);
}

// Public routes (no auth required)
app.get('/login', (req, res) => {
  if (process.env.GOOGLE_CLIENT_ID && req.isAuthenticated?.()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/not-invited', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'not-invited.html'));
});

app.get('/health', (req, res) => res.json({ ok: true, v: '2026-06-26' }));

// Public — request access form submission (no auth required)
app.post('/api/access-request', (req, res) => {
  const { first_name, email, seller_handle, sells_on, sells_what, inventory_size, phone, business_name, notes } = req.body || {};
  if (!first_name?.trim() || !email?.trim() || !email.includes('@')) {
    return res.status(400).json({ error: '🌸 First name and a valid email are required.' });
  }
  if (!sells_on?.trim() || !sells_what?.trim() || !inventory_size?.trim()) {
    return res.status(400).json({ error: '🌸 Please fill in all required fields.' });
  }
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO request_access (first_name, email, seller_handle, sells_on, sells_what, inventory_size, phone, business_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      first_name.trim(), email.trim().toLowerCase(),
      seller_handle?.trim() || '', sells_on.trim(), sells_what.trim(), inventory_size.trim(),
      phone?.trim() || '', business_name?.trim() || '', notes?.trim() || ''
    );
    res.json({ ok: true, status: 'created' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ ok: true, status: 'duplicate' });
    throw e;
  }
});

// Test-only routes — must come before requireAuth so they can create sessions
if (process.env.NODE_ENV === 'test') {
  app.use(require('./src/routes/test'));
}

// All other routes require auth when GOOGLE_CLIENT_ID is set
app.use(requireAuth);

// Admin panel — served only after role check; not in public/ so static can't bypass
app.get('/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'src', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads',   express.static(UPLOAD_DIR));
app.use('/processed', express.static(PROCESSED_DIR));

// ── Route modules ─────────────────────────────────────────────────────────────

app.use(require('./src/routes/photos'));
app.use(require('./src/routes/items'));
app.use(require('./src/routes/export'));
app.use(require('./src/routes/admin'));
app.use(require('./src/routes/settings'));
app.use(require('./src/routes/inventory'));
app.use(require('./src/routes/listings'));

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  logError(`${req.method} ${req.path}`, err);
  res.status(500).json({ error: '🌸 Server error — check logs' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  await fs.mkdir(UPLOAD_DIR,    { recursive: true });
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  const bootDb = initDb();
  bootDb.pragma('wal_checkpoint(TRUNCATE)');
  app.listen(PORT, () => {
    console.log(`\nFotoFlip running at http://localhost:${PORT}\n`);
  });
})();
