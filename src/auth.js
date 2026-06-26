const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const SqliteStore = require('better-sqlite3-session-store')(require('express-session'));
const { getDb } = require('./db');

function setupAuth(app, session) {
  app.use(session({
    store: new SqliteStore({ client: getDb() }),
    secret: process.env.SESSION_SECRET || 'fotoflip-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: !!process.env.APP_URL?.startsWith('https'),
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3456'}/auth/google/callback`,
  }, (accessToken, refreshToken, profile, done) => {
    const db = getDb();
    const email = profile.emails?.[0]?.value || '';
    const isAdmin = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL;

    let user = db.prepare(`SELECT * FROM users WHERE google_id = ?`).get(profile.id);

    if (!user) {
      const role = isAdmin ? 'admin' : 'user';
      const result = db.prepare(
        `INSERT INTO users (google_id, email, name, picture, role) VALUES (?, ?, ?, ?, ?)`
      ).run(profile.id, email, profile.displayName, profile.photos?.[0]?.value || '', role);
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid);
    }

    // Update last login
    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);

    // Admin claims all NULL user_id records on first login
    if (user.role === 'admin') {
      db.prepare(`UPDATE items  SET user_id = ? WHERE user_id IS NULL`).run(user.id);
      db.prepare(`UPDATE photos SET user_id = ? WHERE user_id IS NULL`).run(user.id);
      db.prepare(`UPDATE listings SET user_id = ? WHERE user_id IS NULL`).run(user.id);
    }

    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    done(null, user);
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const db   = getDb();
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    // SEC-002: kill existing sessions for revoked users on every request
    if (!user || user.status === 'revoked') return done(null, false);
    done(null, user);
  });

  // Google OAuth routes
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=1' }),
    (req, res) => {
      const userEmail = req.user?.email || '';

      // SEC-002: block revoked users immediately
      if (req.user?.status === 'revoked') {
        return req.logout(() => res.redirect('/not-invited?email=' + encodeURIComponent(userEmail)));
      }

      // BETA-001 — invite gate: admin always passes; everyone else must be on the allow list
      if (req.user?.role !== 'admin') {
        const db      = getDb();
        const allowed = db.prepare('SELECT id FROM allowed_users WHERE email = ?').get(userEmail);
        if (!allowed) {
          return req.logout(() => res.redirect('/not-invited?email=' + encodeURIComponent(userEmail)));
        }
      }

      // BETA-006 — store consent record on login if not already recorded for this version
      try {
        const db = getDb();
        db.prepare(`
          INSERT OR IGNORE INTO user_consents (user_id, email, consent_version, ip_address, user_agent)
          VALUES (?, ?, '1.0', ?, ?)
        `).run(req.user.id, userEmail, req.ip || '', req.headers['user-agent'] || '');
      } catch {}

      res.redirect('/');
    }
  );

  app.get('/auth/logout', (req, res) => {
    req.logout(() => res.redirect('/login'));
  });

  // Forces Google account picker — used by "Try Another Account" on /not-invited
  app.get('/auth/switch-account', passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
  }));

  app.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '🌸 Not authenticated' });
    const impId = req.session?.impersonating_user_id;
    let impersonating = null;
    if (impId) {
      const db = getDb();
      const target = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(impId);
      if (target) impersonating = target;
    }
    res.json({ id: req.user.id, email: req.user.email, name: req.user.name, picture: req.user.picture, role: req.user.role, impersonating });
  });
}

// Middleware — only enforced when GOOGLE_CLIENT_ID is set
function requireAuth(req, res, next) {
  if (!process.env.GOOGLE_CLIENT_ID) return next();
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '🌸 Not authenticated — please sign in' });
  res.redirect('/login');
}

// Returns user_id for queries — uses impersonated user when admin is in support mode
function getUserId(req) {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  if (req.session?.impersonating_user_id) return req.session.impersonating_user_id;
  return req.user?.id || null;
}

module.exports = { setupAuth, requireAuth, getUserId };
