/**
 * BETA-001 — Invite-only access gate
 *
 * What's automated here:
 *   - /not-invited page loads (200)
 *   - Allow list CRUD (GET / POST / DELETE via /api/admin/allowed-users)
 *   - Non-admin cannot manage the allow list
 *   - Duplicate email is rejected (409)
 *   - Missing/invalid email is rejected (400 + 🌸 error)
 *
 * What requires manual verification (can't simulate Google OAuth in tests):
 *   - Sign in with an unapproved Google account → should land on /not-invited
 *   - Sign in with an approved Google account → should reach the app
 *   - Admin account always passes regardless of allow list
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testLogin, testCleanup, api, TEST_USERS, BASE } from './helpers.mjs';

describe('BETA-001 — /not-invited page', () => {
  test('GET /not-invited returns 200', async () => {
    const r = await fetch(`${BASE}/not-invited`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('invite-only'), 'Page should mention invite-only');
    assert.ok(html.includes('/login'),      'Page should link back to /login');
  });
});

describe('BETA-001 — Allow list CRUD (admin)', () => {
  let adminCookie;
  const testEmail = 'beta-test-invitee@fotoflip.test';

  before(async () => {
    adminCookie = await testLogin(TEST_USERS.admin.email, TEST_USERS.admin.role);
  });

  after(async () => {
    // clean up the invitee row if it was added
    if (adminCookie) {
      await api(`/api/admin/allowed-users/${encodeURIComponent(testEmail)}`, { method: 'DELETE' }, adminCookie)
        .catch(() => {});
    }
    await testCleanup();
  });

  test('Test auth available (skip suite if not)', async (t) => {
    if (!adminCookie) return t.skip('test auth not available — start server with NODE_ENV=test and GOOGLE_CLIENT_ID');
    assert.ok(adminCookie.startsWith('connect.sid='));
  });

  test('GET /api/admin/allowed-users returns array', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/allowed-users', {}, adminCookie);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'Expected array');
  });

  test('POST /api/admin/allowed-users adds email', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/allowed-users', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail }),
    }, adminCookie);
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.ok);
    assert.equal(body.email, testEmail);
  });

  test('GET /api/admin/allowed-users includes newly added email', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { body } = await api('/api/admin/allowed-users', {}, adminCookie);
    const found = body.find(u => u.email === testEmail);
    assert.ok(found, `${testEmail} not found in allow list`);
    assert.ok(found.added_at, 'Entry should have added_at timestamp');
  });

  test('POST /api/admin/allowed-users — duplicate returns 409 with 🌸 error', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/allowed-users', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail }),
    }, adminCookie);
    assert.equal(status, 409);
    assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
  });

  test('POST /api/admin/allowed-users — invalid email returns 400 with 🌸 error', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/allowed-users', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
    }, adminCookie);
    assert.equal(status, 400);
    assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
  });

  test('DELETE /api/admin/allowed-users/:email removes email', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api(
      `/api/admin/allowed-users/${encodeURIComponent(testEmail)}`,
      { method: 'DELETE' },
      adminCookie
    );
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.ok);
  });

  test('DELETE /api/admin/allowed-users/:email — missing email returns 404 with 🌸 error', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api(
      `/api/admin/allowed-users/${encodeURIComponent('nobody@fotoflip.test')}`,
      { method: 'DELETE' },
      adminCookie
    );
    assert.equal(status, 404);
    assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
  });
});

describe('BETA-001 — Allow list access control (non-admin)', () => {
  let userCookie;

  before(async () => {
    userCookie = await testLogin(TEST_USERS.userA.email, TEST_USERS.userA.role);
  });

  after(testCleanup);

  test('GET /api/admin/allowed-users — non-admin gets 403', async (t) => {
    if (!userCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/allowed-users', {}, userCookie);
    assert.equal(status, 403);
    assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
  });

  test('POST /api/admin/allowed-users — non-admin gets 403', async (t) => {
    if (!userCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/allowed-users', {
      method: 'POST',
      body: JSON.stringify({ email: 'hacker@example.com' }),
    }, userCookie);
    assert.equal(status, 403);
    assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
  });
});
