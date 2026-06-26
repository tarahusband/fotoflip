/**
 * Shared utilities for FotoFlip E2E tests.
 *
 * Requires server running with NODE_ENV=test and GOOGLE_CLIENT_ID set.
 * Call testLogin() to get a session cookie; pass it to api() for authenticated requests.
 */

export const BASE = 'http://localhost:3456';

/**
 * Creates (or reuses) a test DB user and returns their session cookie.
 * Returns null if the test auth endpoint is unavailable (skip the test in that case).
 */
export async function testLogin(email, role = 'user') {
  const r = await fetch(`${BASE}/api/test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });

  // 401 = test routes not mounted (old server or missing NODE_ENV=test)
  // 404 = route not found; 503 = no Passport session (no GOOGLE_CLIENT_ID)
  if (r.status === 401 || r.status === 404 || r.status === 503) return null;

  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`testLogin(${email}) failed (${r.status}): ${body.error || 'unknown'}`);
  }

  const setCookie = r.headers.get('set-cookie') || '';
  const match = setCookie.match(/connect\.sid=[^;]+/);
  if (!match) throw new Error(`No session cookie for ${email}`);
  return match[0]; // 'connect.sid=s%3A...'
}

/**
 * Removes all *.test users created during this kit run.
 * Call in after() hooks to keep the DB clean.
 */
export async function testCleanup() {
  await fetch(`${BASE}/api/test/cleanup`, { method: 'POST' }).catch(() => {});
}

/**
 * Authenticated fetch wrapper. Pass cookie from testLogin().
 */
export async function api(path, opts = {}, cookie = null) {
  const headers = { ...opts.headers };
  if (cookie) headers['Cookie'] = cookie;
  if (!(opts.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await r.json() : await r.text();
  return { status: r.status, body, headers: r.headers };
}

/**
 * Canonical test email addresses used across the kit.
 * All end in .test so they're recognized as synthetic and cleaned up by testCleanup().
 */
export const TEST_USERS = {
  admin:   { email: 'qa-admin@fotoflip.test',   role: 'admin' },
  userA:   { email: 'qa-user-a@fotoflip.test',  role: 'user'  },
  userB:   { email: 'qa-user-b@fotoflip.test',  role: 'user'  },
  blocked: { email: 'qa-blocked@fotoflip.test', role: 'user'  },
};
