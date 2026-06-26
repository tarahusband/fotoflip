/**
 * ADMIN-001 + ADMIN-002 — Admin panel and user management
 *
 * ADMIN-001 acceptance criteria:
 *   - /api/admin/* routes are accessible to admin and blocked for regular users
 *   - Health, db-check, and backup endpoints return correct shapes
 *
 * ADMIN-002 acceptance criteria:
 *   - Admin can list all users
 *   - Admin can promote a user to admin role
 *   - Admin can demote an admin to user role
 *   - Regular user cannot access user management endpoints
 *
 * Status: ADMIN-001 partially testable now; ADMIN-002 stubs until implemented.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testLogin, testCleanup, api, TEST_USERS } from './helpers.mjs';

describe('ADMIN-001 — Admin route access control', () => {
  let adminCookie, userCookie;

  before(async () => {
    adminCookie = await testLogin(TEST_USERS.admin.email, TEST_USERS.admin.role);
    userCookie  = await testLogin(TEST_USERS.userA.email, TEST_USERS.userA.role);
  });

  after(testCleanup);

  test('Test auth available (skip suite if not)', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    assert.ok(true);
  });

  test('GET /api/admin/health — admin gets 200', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/health', {}, adminCookie);
    assert.equal(status, 200, `Expected 200, got ${status}`);
    assert.ok('db_connected' in body, 'health missing db_connected');
    assert.ok('items' in body,        'health missing items count');
  });

  test('GET /api/admin/health — non-admin gets 403', async (t) => {
    if (!userCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/health', {}, userCookie);
    assert.equal(status, 403);
    assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
  });

  test('GET /api/admin/db-check — admin gets 200 with correct shape', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/db-check', {}, adminCookie);
    assert.equal(status, 200);
    assert.ok('users'  in body, 'db-check missing users');
    assert.ok('tables' in body, 'db-check missing tables');
    // Verify sensitive env fields are NOT exposed (BUG-012 regression)
    assert.ok(!('cloudinary_configured' in body), 'db-check must not expose env var presence');
  });

  test('GET /api/admin/db-check — non-admin gets 403', async (t) => {
    if (!userCookie) return t.skip('test auth not available');
    const { status } = await api('/api/admin/db-check', {}, userCookie);
    assert.equal(status, 403);
  });
});

describe('ADMIN-002 — User management', () => {
  let adminCookie, userCookie, userAId;

  before(async () => {
    adminCookie = await testLogin(TEST_USERS.admin.email, TEST_USERS.admin.role);
    userCookie  = await testLogin(TEST_USERS.userA.email, TEST_USERS.userA.role);
  });

  after(testCleanup);

  test('GET /api/admin/users returns array with required fields', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/users', {}, adminCookie);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'Expected array');
    assert.ok(body.length > 0, 'Should have at least one user');
    const u = body[0];
    assert.ok('id'           in u, 'user missing id');
    assert.ok('email'        in u, 'user missing email');
    assert.ok('role'         in u, 'user missing role');
    assert.ok('item_count'   in u, 'user missing item_count');
    assert.ok('last_login_at'in u, 'user missing last_login_at');
    assert.ok(!('google_id'  in u), 'google_id must not be exposed');
  });

  test('GET /api/admin/users includes the test user A', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { body } = await api('/api/admin/users', {}, adminCookie);
    const found = body.find(u => u.email === TEST_USERS.userA.email);
    assert.ok(found, `${TEST_USERS.userA.email} not found in user list`);
    userAId = found.id;
    assert.equal(found.role, 'user');
    assert.equal(found.item_count, 0);
  });

  test('Non-admin GET /api/admin/users returns 403', async (t) => {
    if (!userCookie) return t.skip('test auth not available');
    const { status, body } = await api('/api/admin/users', {}, userCookie);
    assert.equal(status, 403);
    assert.ok(body.error?.startsWith('🌸'));
  });

  test('PATCH /api/admin/users/:id/role promotes user to admin', async (t) => {
    if (!adminCookie || !userAId) return t.skip('test auth not available or user not found');
    const { status, body } = await api(`/api/admin/users/${userAId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin' }),
    }, adminCookie);
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.ok);
    assert.equal(body.role, 'admin');
  });

  test('Promoted user now appears as admin in user list', async (t) => {
    if (!adminCookie || !userAId) return t.skip('test auth not available or user not found');
    const { body } = await api('/api/admin/users', {}, adminCookie);
    const found = body.find(u => u.id === userAId);
    assert.equal(found?.role, 'admin', 'User should now be admin');
  });

  test('PATCH /api/admin/users/:id/role demotes back to user', async (t) => {
    if (!adminCookie || !userAId) return t.skip('test auth not available or user not found');
    const { status, body } = await api(`/api/admin/users/${userAId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'user' }),
    }, adminCookie);
    assert.equal(status, 200);
    assert.equal(body.role, 'user');
  });

  test('PATCH with invalid role returns 400 with 🌸 error', async (t) => {
    if (!adminCookie || !userAId) return t.skip('test auth not available or user not found');
    const { status, body } = await api(`/api/admin/users/${userAId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'superuser' }),
    }, adminCookie);
    assert.equal(status, 400);
    assert.ok(body.error?.startsWith('🌸'));
  });

  test('Admin cannot change their own role', async (t) => {
    if (!adminCookie) return t.skip('test auth not available');
    const { body: me } = await api('/api/test/whoami', {}, adminCookie);
    const { status, body } = await api(`/api/admin/users/${me.user.id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'user' }),
    }, adminCookie);
    assert.equal(status, 400);
    assert.ok(body.error?.startsWith('🌸'));
  });

  test('Non-admin PATCH /api/admin/users/:id/role returns 403', async (t) => {
    if (!userCookie || !userAId) return t.skip('test auth not available or user not found');
    const { status, body } = await api(`/api/admin/users/${userAId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin' }),
    }, userCookie);
    assert.equal(status, 403);
    assert.ok(body.error?.startsWith('🌸'));
  });
});
