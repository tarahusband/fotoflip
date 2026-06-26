/**
 * Test-only routes — mounted in server.js only when NODE_ENV=test.
 * Never reaches production.
 */
const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// POST /api/test/login
// Creates (or updates) a test user and establishes a Passport session.
// Email must end in .test to prevent accidental use of real accounts.
router.post('/api/test/login', express.json(), (req, res) => {
  const { email, role = 'user', name } = req.body || {};

  if (!email || !email.endsWith('.test')) {
    return res.status(400).json({ error: '🌸 Test email must end in .test' });
  }

  if (typeof req.logIn !== 'function') {
    return res.status(503).json({
      error: '🌸 No Passport session — start server with GOOGLE_CLIENT_ID set',
    });
  }

  const db = getDb();
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    const result = db.prepare(
      'INSERT INTO users (google_id, email, name, picture, role) VALUES (?, ?, ?, ?, ?)'
    ).run(`test-${email}`, email, name || email.split('@')[0], '', role);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  } else if (role !== user.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  req.logIn(user, err => {
    if (err) return res.status(500).json({ error: '🌸 Session error: ' + err.message });
    res.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } });
  });
});

// GET /api/test/whoami — returns the current session's user
router.get('/api/test/whoami', (req, res) => {
  if (!req.user) return res.status(401).json({ user: null });
  res.json({ user: { id: req.user.id, email: req.user.email, role: req.user.role } });
});

// POST /api/test/cleanup — removes all *.test users created by the kit
router.post('/api/test/cleanup', (req, res) => {
  const db = getDb();
  const r = db.prepare("DELETE FROM users WHERE email LIKE '%.test'").run();
  res.json({ ok: true, deleted: r.changes });
});

module.exports = router;
