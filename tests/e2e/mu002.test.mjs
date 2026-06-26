/**
 * MU-002 — Profile / settings UI and validation
 *
 * Acceptance criteria:
 *   - GET /api/profile returns the correct shape for the authenticated user
 *   - PUT /api/profile persists changes and reads them back
 *   - Empty/invalid body returns 🌸 error
 *   - Profile changes for user A do not affect user B
 *
 * Status: CLOSED — implemented in settings.js
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testLogin, testCleanup, api, TEST_USERS } from './helpers.mjs';

describe('MU-002 — Profile round-trip', () => {
  let cookieA, cookieB;

  before(async () => {
    cookieA = await testLogin(TEST_USERS.userA.email, TEST_USERS.userA.role);
    cookieB = await testLogin(TEST_USERS.userB.email, TEST_USERS.userB.role);
  });

  after(testCleanup);

  test('GET /api/profile returns 200 with user_id', async (t) => {
    if (!cookieA) return t.skip('test auth not available');
    const { status, body } = await api('/api/profile', {}, cookieA);
    assert.equal(status, 200);
    assert.ok('user_id' in body, 'profile missing user_id');
  });

  // MU-002: profile response should also include email + name from users table
  test.todo('GET /api/profile includes email and name from users table (MU-002 enhancement)');

  test('PUT /api/profile saves business_name and reads it back', async (t) => {
    if (!cookieA) return t.skip('test auth not available');
    const unique = `TestBiz-${Date.now()}`;
    const put = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ business_name: unique }),
    }, cookieA);
    assert.equal(put.status, 200, `PUT failed: ${JSON.stringify(put.body)}`);
    assert.ok(put.body.success);

    const get = await api('/api/profile', {}, cookieA);
    assert.equal(get.status, 200);
    assert.equal(get.body.business_name, unique, 'business_name not persisted');
  });

  test('PUT /api/profile with no valid fields returns 🌸 400', async (t) => {
    if (!cookieA) return t.skip('test auth not available');
    const { status, body } = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ unknown_field: 'nope' }),
    }, cookieA);
    assert.equal(status, 400);
    assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
  });

  test('Profile data is scoped per user — user B cannot see user A business_name', async (t) => {
    if (!cookieA || !cookieB) return t.skip('test auth not available');
    const unique = `UserA-Biz-${Date.now()}`;
    await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ business_name: unique }),
    }, cookieA);

    const { body: profileB } = await api('/api/profile', {}, cookieB);
    assert.notEqual(profileB.business_name, unique, 'User B should not see user A business_name');
  });
});

describe('MU-002 — Settings validation', () => {
  let cookieA;

  before(async () => {
    cookieA = await testLogin(TEST_USERS.userA.email, TEST_USERS.userA.role);
  });

  after(testCleanup);

  // NOTE: PUT /api/settings currently accepts any key without restriction.
  // Key allowlisting is not implemented; leave as todo until a ticket is filed.
  test.todo('PUT /api/settings with invalid key is rejected (requires key allowlist — not yet implemented)');

  test('Settings written by user A are readable by user A', async (t) => {
    if (!cookieA) return t.skip('test auth not available');
    const testUrl = 'https://hook.make.com/test-mu002';
    const put = await api('/api/settings/make-webhook', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    }, cookieA);
    assert.equal(put.status, 200, `Webhook save failed: ${JSON.stringify(put.body)}`);

    const get = await api('/api/settings/make-webhook', {}, cookieA);
    assert.equal(get.status, 200);
    assert.equal(get.body.url, testUrl, 'Webhook URL not persisted');
  });
});
