const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getDb } = require('./db');

function setupAuth(app, session) {
  app.use(session({
    secret: process.env.SESSION_SECRET || 'fotoflip-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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
    const existing = db.prepare(`SELECT * FROM users WHERE google_id = ?`).get(profile.id);
    if (existing) return done(null, existing);
    const result = db.prepare(
      `INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)`
    ).run(profile.id, email, profile.displayName, profile.photos?.[0]?.value || '');
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid);
    done(null, user);
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const db = getDb();
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    done(null, user || false);
  });

  // Google OAuth routes
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=1' }),
    (req, res) => res.redirect('/')
  );

  app.get('/auth/logout', (req, res) => {
    req.logout(() => res.redirect('/login'));
  });

  app.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '🌸 Not authenticated' });
    res.json({ id: req.user.id, email: req.user.email, name: req.user.name, picture: req.user.picture });
  });
}

// Middleware — only enforced when GOOGLE_CLIENT_ID is set
function requireAuth(req, res, next) {
  if (!process.env.GOOGLE_CLIENT_ID) return next();
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '🌸 Not authenticated — please sign in' });
  res.redirect('/login');
}

// Returns user_id for queries — null in dev mode (no auth)
function getUserId(req) {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  return req.user?.id || null;
}

module.exports = { setupAuth, requireAuth, getUserId };
