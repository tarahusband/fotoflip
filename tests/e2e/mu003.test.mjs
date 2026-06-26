/**
 * MU-003 — Per-user platform connections
 *
 * Acceptance criteria:
 *   - User A and user B can store different make_webhook_url values without collision
 *   - GET /api/settings for user A does not include user B's settings
 *   - GET /api/settings/make-webhook returns the requesting user's URL
 *   - POST /api/settings/make-webhook stores per-user (not global)
 *   - Etsy status reflects per-user connection (tested via /api/etsy/status)
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testLogin, testCleanup, api, TEST_USERS } from './helpers.mjs';

describe('MU-003 — Settings isolation between users', () => {
  let cookieA, cookieB;
  const webhookA = 'https://hook.us2.make.com/user-a-webhook-test';
  const webhookB = 'https://hook.us2.make.com/user-b-webhook-test';

  before(async () => {
    cookieA = await testLogin(TEST_USERS.userA.email, TEST_USERS.userA.role);
    cookieB = await testLogin(TEST_USERS.userB.email, TEST_USERS.userB.role);
  });

  after(testCleanup);

  test('Test auth available (skip suite if not)', async (t) => {
    if (!cookieA) return t.skip('test auth not available — start server with NODE_ENV=test and GOOGLE_CLIENT_ID');
    assert.ok(cookieA.startsWith('connect.sid='));
  });

  test('User A can set make_webhook_url', async (t) => {
    if (!cookieA) return t.skip('test auth not available');
    const { status, body } = await api('/api/settings/make-webhook', {
      method: 'POST',
      body: JSON.stringify({ url: webhookA }),
    }, cookieA);
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.success);
  });

  test('User B can set a different make_webhook_url', async (t) => {
    if (!cookieB) return t.skip('test auth not available');
    const { status, body } = await api('/api/settings/make-webhook', {
      method: 'POST',
      body: JSON.stringify({ url: webhookB }),
    }, cookieB);
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.success);
  });

  test('GET /api/settings/make-webhook for user A returns user A webhook', async (t) => {
    if (!cookieA) return t.skip('test auth not available');
    const { status, body } = await api('/api/settings/make-webhook', {}, cookieA);
    assert.equal(status, 200);
    assert.equal(body.url, webhookA, `User A should get their own webhook, got: ${body.url}`);
  });

  test('GET /api/settings/make-webhook for user B returns user B webhook', async (t) => {
    if (!cookieB) return t.skip('test auth not available');
    const { status, body } = await api('/api/settings/make-webhook', {}, cookieB);
    assert.equal(status, 200);
    assert.equal(body.url, webhookB, `User B should get their own webhook, got: ${body.url}`);
  });

  test('User A webhook does not appear in user B GET /api/settings', async (t) => {
    if (!cookieA || !cookieB) return t.skip('test auth not available');
    const { body: settingsB } = await api('/api/settings', {}, cookieB);
    assert.notEqual(settingsB.make_webhook_url, webhookA, 'User B settings must not contain user A webhook');
  });

  test('GET /api/settings returns only the requesting user settings object', async (t) => {
    if (!cookieA || !cookieB) return t.skip('test auth not available');
    const [{ body: sA }, { body: sB }] = await Promise.all([
      api('/api/settings', {}, cookieA),
      api('/api/settings', {}, cookieB),
    ]);
    assert.equal(sA.make_webhook_url, webhookA, 'User A settings should have webhookA');
    assert.equal(sB.make_webhook_url, webhookB, 'User B settings should have webhookB');
    assert.notDeepEqual(sA, sB, 'User A and user B settings should differ');
  });

  test('PUT /api/settings writes key only to requesting user', async (t) => {
    if (!cookieA || !cookieB) return t.skip('test auth not available');
    const uniqueKey = 'mu003_test_isolation_key';
    const { status } = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ [uniqueKey]: 'user-a-only' }),
    }, cookieA);
    assert.equal(status, 200);

    const { body: sB } = await api('/api/settings', {}, cookieB);
    assert.ok(!(uniqueKey in sB), `User B settings should not contain ${uniqueKey} written by user A`);
  });

  test('GET /api/etsy/status returns per-user connection (not connected by default for test users)', async (t) => {
    if (!cookieA) return t.skip('test auth not available');
    const { status, body } = await api('/api/etsy/status', {}, cookieA);
    assert.equal(status, 200);
    assert.ok('connected' in body, 'etsy/status missing connected field');
    assert.equal(body.connected, false, 'Test user should not have Etsy connected');
  });
});
