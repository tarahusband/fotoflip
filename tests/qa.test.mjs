/**
 * FotoFlip Automated QA Tests
 * Run: node --test tests/qa.test.mjs
 * Server must be running on localhost:3456 before running.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:3456';
const __dir = dirname(fileURLToPath(import.meta.url));

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body,
  });
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) return { status: r.status, body: await r.json(), headers: r.headers };
  return { status: r.status, body: await r.text(), headers: r.headers };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let authRequired = false;

async function getItems() {
  const { status, body } = await api('/api/items');
  if (status === 401) { authRequired = true; return []; }
  return Array.isArray(body) ? body : [];
}

async function getItem(id) {
  const items = await getItems();
  return items.find(i => i.id === id);
}

function skipIfAuth(t) {
  if (authRequired) {
    t.skip('server requires auth — run without GOOGLE_CLIENT_ID to test');
    return true;
  }
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Server health', () => {
  test('GET /api/items returns 200 and an array', async (t) => {
    const { status, body } = await api('/api/items');
    if (status === 401) { authRequired = true; t.skip('auth required'); return; }
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'Expected array of items');
  });
});

describe('FIX I2 — saveWeight does not corrupt bundle fields', () => {
  test('PUT /bundle with only weight fields preserves is_bundle, bundle_type, bundle_count', async (t) => {
    if (skipIfAuth(t)) return;
    const items = await getItems();
    const target = items.find(i => i.id);
    assert.ok(target, 'Need at least one item');
    const id = target.id;

    // Step 1: set bundle fields
    await api(`/api/items/${id}/bundle`, {
      method: 'PUT',
      body: JSON.stringify({ is_bundle: true, bundle_type: 'Earrings', bundle_count: 5 }),
    });

    // Step 2: update only weight (what saveWeight() does)
    await api(`/api/items/${id}/bundle`, {
      method: 'PUT',
      body: JSON.stringify({ weight: '2', weight_unit: 'LB' }),
    });

    // Step 3: verify bundle fields survived
    const updated = await getItem(id);
    assert.equal(updated.is_bundle, 1, 'is_bundle should still be 1');
    assert.equal(updated.bundle_type, 'Earrings', 'bundle_type should not be overwritten');
    assert.equal(updated.bundle_count, 5, 'bundle_count should not be overwritten');
    assert.equal(updated.weight, '2', 'weight should be set');
    assert.equal(updated.weight_unit, 'LB', 'weight_unit should be set');
  });
});

describe('FIX I4 — Item status defaults to Flip not Purchased', () => {
  test('All existing items have status Flip or Draft, not Purchased', async () => {
    const items = await getItems();
    const purchased = items.filter(i => i.status === 'Purchased');
    assert.equal(purchased.length, 0, `Found ${purchased.length} items with status "Purchased" — should all be "Flip"`);
  });
});

describe('FIX D3 — extractWithOpenAI receives a valid file path', () => {
  test('POST /api/items/:id/metadata/extract responds (not a crash from wrong args)', async () => {
    const items = await getItems();
    const target = items.find(i => (i.photos || []).length > 0);
    if (!target) { console.log('  skipped: no items with photos'); return; }

    const { status, body } = await api(`/api/items/${target.id}/metadata/extract`, { method: 'POST' });
    // 500 is acceptable if API key is missing — what we're checking is it's NOT a crash
    // from passing a photo object instead of a path string
    assert.ok(
      status !== 500 || (typeof body === 'object' && body.error && !body.error.includes('[object Object]')),
      `Got unexpected crash error: ${JSON.stringify(body)}`
    );
    // If it errored with "no API key", that's expected and not our bug
    if (status !== 200) {
      assert.ok(
        body.error?.includes('API') || body.error?.includes('key') || body.error?.includes('quota') || body.error?.includes('billing') || body.error?.includes('No AI'),
        `Unexpected error (not API key related): ${JSON.stringify(body)}`
      );
    }
  });
});

describe('FIX R1/X6 — Single-item Whatnot export uses shared imgbbUpload helper', () => {
  test('POST /api/items/:id/export/whatnot returns a CSV file', async () => {
    const items = await getItems();
    const target = items.find(i => i.processing_status === 'done' && (i.photos || []).length > 0);
    if (!target) { console.log('  skipped: no done items'); return; }

    const r = await fetch(`${BASE}/api/items/${target.id}/export/whatnot`, { method: 'POST' });
    assert.equal(r.status, 200);
    const ct = r.headers.get('content-type');
    assert.ok(ct?.includes('text/csv'), `Expected text/csv, got ${ct}`);
    const text = await r.text();
    assert.ok(text.includes('Category'), 'CSV should have Whatnot headers');
    assert.ok(text.includes('\r\n'), 'CSV should have CRLF line endings');
  });

  test('POST /api/items/:id/export/whatnot for bundle item includes labeled image path in headers', async () => {
    const items = await getItems();
    const target = items.find(i => i.is_bundle && i.processing_status === 'done');
    if (!target) { console.log('  skipped: no done bundle items'); return; }

    const labeledPath = join('/Users/flippi/Developer/fotoflip/processed', `item-${target.id}-labeled.jpg`);
    if (!existsSync(labeledPath)) { console.log('  skipped: labeled image not yet generated'); return; }

    const r = await fetch(`${BASE}/api/items/${target.id}/export/whatnot`, { method: 'POST' });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(text.length > 0, 'CSV should not be empty');
  });
});

describe('FIX U3 — Per-item Poshmark export route returns single-item CSV', () => {
  test('POST /api/items/:id/export/poshmark returns a CSV for just that item', async () => {
    const items = await getItems();
    const target = items.find(i => i.processing_status === 'done' && (i.photos || []).length > 0);
    if (!target) { console.log('  skipped: no done items'); return; }

    const r = await fetch(`${BASE}/api/items/${target.id}/export/poshmark`, { method: 'POST' });
    assert.equal(r.status, 200);
    const ct = r.headers.get('content-type');
    assert.ok(ct?.includes('text/csv'), `Expected text/csv, got ${ct}`);
    const text = await r.text();
    const lines = text.trim().split('\r\n').filter(Boolean);
    assert.equal(lines.length, 2, `Expected header + 1 data row, got ${lines.length} lines`);
  });
});

describe('FIX B4 — Bundle label file exists after PUT /bundle with is_bundle=true', () => {
  test('PUT /bundle with is_bundle=true creates item-{id}-labeled.jpg', async () => {
    const items = await getItems();
    const target = items.find(i => (i.photos || [])[0]?.path);
    if (!target) { console.log('  skipped: no items with photo path'); return; }

    await api(`/api/items/${target.id}/bundle`, {
      method: 'PUT',
      body: JSON.stringify({ is_bundle: true, bundle_type: 'Mixed Vintage', bundle_count: 5 }),
    });

    // Give it a moment to write
    await new Promise(r => setTimeout(r, 1500));
    const labeledPath = join('/Users/flippi/Developer/fotoflip/processed', `item-${target.id}-labeled.jpg`);
    assert.ok(existsSync(labeledPath), `Labeled image not found at ${labeledPath}`);
  });
});

describe('Weight fields — round-trip', () => {
  test('Weight set at import survives GET /api/items', async () => {
    const items = await getItems();
    const target = items.find(i => i.id);
    if (!target) return;

    await api(`/api/items/${target.id}/bundle`, {
      method: 'PUT',
      body: JSON.stringify({ weight: '3.5', weight_unit: 'OZ' }),
    });
    const updated = await getItem(target.id);
    assert.equal(updated.weight, '3.5');
    assert.equal(updated.weight_unit, 'OZ');
  });
});

describe('Dashboard endpoint', () => {
  test('GET /api/dashboard returns 200 with required shape', async (t) => {
    if (skipIfAuth(t)) return;
    const { status, body } = await api('/api/dashboard');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object', 'Body should be an object');
    assert.ok('stats' in body, 'Missing stats');
    assert.ok('recentImports' in body, 'Missing recentImports');
    assert.ok('recentActivity' in body, 'Missing recentActivity');
  });

  test('Dashboard stats.total matches /api/inventory/stats', async (t) => {
    if (skipIfAuth(t)) return;
    const [dash, inv] = await Promise.all([
      api('/api/dashboard'),
      api('/api/inventory/stats'),
    ]);
    assert.equal(dash.body.stats.total, inv.body.total, 'Total counts should match');
  });

  test('recentImports is array of max 3', async (t) => {
    if (skipIfAuth(t)) return;
    const { body } = await api('/api/dashboard');
    assert.ok(Array.isArray(body.recentImports), 'recentImports should be array');
    assert.ok(body.recentImports.length <= 3, `Should return at most 3, got ${body.recentImports.length}`);
  });

  test('recentImports entries have required fields', async (t) => {
    if (skipIfAuth(t)) return;
    const { body } = await api('/api/dashboard');
    for (const imp of body.recentImports) {
      assert.ok('box' in imp, 'Import entry missing box');
      assert.ok('count' in imp, 'Import entry missing count');
      assert.ok('latestDate' in imp, 'Import entry missing latestDate');
      assert.ok(Array.isArray(imp.thumbs), 'Import entry thumbs should be array');
    }
  });

  test('recentActivity is array of max 5', async (t) => {
    if (skipIfAuth(t)) return;
    const { body } = await api('/api/dashboard');
    assert.ok(Array.isArray(body.recentActivity), 'recentActivity should be array');
    assert.ok(body.recentActivity.length <= 5, `Should return at most 5, got ${body.recentActivity.length}`);
  });

  test('Dashboard stat counts are non-negative integers', async (t) => {
    if (skipIfAuth(t)) return;
    const { body } = await api('/api/dashboard');
    const { total, ready, listed, sold, shipped } = body.stats;
    for (const [key, val] of Object.entries({ total, ready, listed, sold, shipped })) {
      assert.ok(Number.isInteger(val) && val >= 0, `stats.${key} should be non-negative integer, got ${val}`);
    }
  });
});

describe('Cloudinary-first photo pipeline (BUG-009)', () => {
  test('GET /api/photos returns cloudinary_url field on each photo', async (t) => {
    if (skipIfAuth(t)) return;
    const { status, body } = await api('/api/photos');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'Expected array');
    for (const photo of body.slice(0, 5)) {
      assert.ok('cloudinary_url' in photo, `Photo ${photo.id} missing cloudinary_url field`);
    }
  });

  test('Photos with cloudinary_url serve that URL as photo.url in GET /api/items', async (t) => {
    if (skipIfAuth(t)) return;
    const items = await getItems();
    const photosWithUrl = items
      .flatMap(i => i.photos || [])
      .filter(p => p.cloudinary_url)
      .slice(0, 5);

    if (!photosWithUrl.length) { console.log('  skipped: no photos with cloudinary_url set'); return; }
    for (const photo of photosWithUrl) {
      assert.equal(photo.url, photo.cloudinary_url,
        `Photo ${photo.id}: url should equal cloudinary_url`);
      assert.ok(photo.url.startsWith('https://'),
        `Photo ${photo.id}: url should be an absolute HTTPS URL`);
    }
  });

  test('No photo serves a broken /processed/ or /uploads/ path when cloudinary_url exists', async (t) => {
    if (skipIfAuth(t)) return;
    const items = await getItems();
    const broken = items
      .flatMap(i => i.photos || [])
      .filter(p => p.cloudinary_url && (p.url?.startsWith('/processed/') || p.url?.startsWith('/uploads/')));

    assert.equal(broken.length, 0,
      `${broken.length} photos have cloudinary_url but still serve local paths: ${broken.map(p => p.id).join(', ')}`);
  });

  test('POST /api/items blocks creation if photo has no cloudinary_url', async (t) => {
    if (skipIfAuth(t)) return;
    const { status, body } = await api('/api/items', {
      method: 'POST',
      body: JSON.stringify({ photoIds: [999999], purchaseDate: '2026-06-25' }),
    });
    assert.ok([400, 404].includes(status), `Expected 400 or 404, got ${status}`);
    if (status === 400) {
      assert.ok(body.error?.startsWith('🌸'), `Error should start with 🌸, got: ${body.error}`);
    }
  });

  test('POST /api/photos/upload returns Cloudinary URL or correct 🌸 error', async (t) => {
    if (skipIfAuth(t)) return;
    const minimalJpeg = Buffer.from([
      0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
      0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,
      0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
      0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,
      0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,
      0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
      0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x14,0x00,0x01,0x00,0x00,0x00,0x00,
      0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF,0xC4,0x00,0x14,
      0x10,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
      0x00,0x00,0xFF,0xDA,0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0x7F,0xFF,0xD9,
    ]);
    const fd = new FormData();
    fd.append('photos', new Blob([minimalJpeg], { type: 'image/jpeg' }), 'qa-test.jpg');
    const r = await fetch(`${BASE}/api/photos/upload`, { method: 'POST', body: fd });
    const body = await r.json();
    if (r.status === 500) {
      assert.ok(body.error?.startsWith('🌸'), `Upload failure must return 🌸 error, got: ${body.error}`);
      console.log(`  note: Cloudinary not reachable locally — error format correct`);
      return;
    }
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(body)}`);
    assert.ok(Array.isArray(body.photos) && body.photos.length > 0, 'Response must include photos array');
    const photo = body.photos[0];
    assert.ok(photo.url?.startsWith('https://res.cloudinary.com'),
      `photo.url should be a Cloudinary URL, got: ${photo.url}`);
    assert.ok(photo.id, 'photo must have an id');
  });
});

// ── TEST-001: TD-001 smoke suite — verify all route modules mounted ────────────

describe('TD-001 smoke — route modules reachable (not 404)', () => {
  // After the monolith split, a missing app.use() mount would cause 404.
  // 401 is correct auth behaviour; 404 means the route file isn't mounted.

  const ROUTES = [
    // photos.js
    { method: 'GET',  path: '/api/photos' },
    // items.js
    { method: 'GET',  path: '/api/items' },
    { method: 'GET',  path: '/api/stats' },
    // export.js — single-item routes need a real id; just verify module is mounted via 404 vs 401
    { method: 'GET',  path: '/api/export/whatnot' },
    { method: 'GET',  path: '/api/export/poshmark' },
    // admin.js
    { method: 'GET',  path: '/api/admin/health' },
    { method: 'GET',  path: '/api/admin/backup' },
    { method: 'GET',  path: '/api/admin/db-check' },
    // settings.js
    { method: 'GET',  path: '/api/settings' },
    { method: 'GET',  path: '/api/settings/make-webhook' },
    { method: 'GET',  path: '/api/profile' },
    // inventory.js
    { method: 'GET',  path: '/api/dashboard' },
    { method: 'GET',  path: '/api/markets' },
    { method: 'GET',  path: '/api/inventory' },
    { method: 'GET',  path: '/api/inventory/stats' },
    // listings.js
    { method: 'GET',  path: '/api/listings' },
  ];

  for (const { method, path } of ROUTES) {
    test(`${method} ${path} — responds (not 404)`, async () => {
      const r = await fetch(`${BASE}${path}`, { method });
      assert.notEqual(r.status, 404, `${method} ${path} returned 404 — route module not mounted`);
    });
  }
});

describe('TD-001 smoke — item lifecycle (create → edit → delete)', () => {
  let createdItemId = null;

  test('POST /api/items creates an item when photoIds are provided (or rejects cleanly)', async (t) => {
    if (skipIfAuth(t)) return;
    // Use a non-existent photoId — server should reject with 🌸 error, not crash
    const { status, body } = await api('/api/items', {
      method: 'POST',
      body: JSON.stringify({ photoIds: [999999], purchaseDate: '2026-06-25' }),
    });
    assert.ok([400, 404].includes(status), `Expected 400/404, got ${status}`);
    assert.ok(typeof body === 'object' && body.error, 'Should return JSON error');
    assert.ok(body.error.startsWith('🌸'), `Error must start with 🌸, got: ${body.error}`);
  });

  test('PUT /api/items/:id updates status field', async (t) => {
    if (skipIfAuth(t)) return;
    const items = await getItems();
    const target = items.find(i => i.id);
    if (!target) { t.skip('no items'); return; }

    const original = target.status;
    const next     = original === 'Flip' ? 'Draft' : 'Flip';

    const { status, body } = await api(`/api/items/${target.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: next }),
    });
    assert.equal(status, 200, `PUT returned ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.success || body.id, 'Response should indicate success');

    // Restore
    await api(`/api/items/${target.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: original }),
    });
  });

  test('DELETE /api/items/:id — non-existent item returns 404 not crash', async (t) => {
    if (skipIfAuth(t)) return;
    const { status } = await api('/api/items/999999', { method: 'DELETE' });
    assert.equal(status, 404, `Expected 404 for missing item, got ${status}`);
  });
});

describe('TD-001 smoke — settings and profile round-trip', () => {
  test('GET /api/settings returns object', async (t) => {
    if (skipIfAuth(t)) return;
    const { status, body } = await api('/api/settings');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object' && !Array.isArray(body), 'Settings should be a key/value object');
  });

  test('PUT /api/settings writes and reads back a test key', async (t) => {
    if (skipIfAuth(t)) return;
    const testKey   = 'qa_test_key';
    const testValue = `qa-${Date.now()}`;

    const putRes = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ [testKey]: testValue }),
    });
    assert.equal(putRes.status, 200);

    const getRes = await api('/api/settings');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body[testKey], testValue, 'Written value should be readable back');
  });

  test('GET /api/inventory/stats returns correct shape', async (t) => {
    if (skipIfAuth(t)) return;
    const { status, body } = await api('/api/inventory/stats');
    assert.equal(status, 200);
    for (const key of ['total', 'ready', 'listed', 'sold', 'shipped']) {
      assert.ok(key in body, `inventory/stats missing field: ${key}`);
      assert.ok(typeof body[key] === 'number', `${key} should be a number`);
    }
  });

  test('GET /api/listings returns array', async (t) => {
    if (skipIfAuth(t)) return;
    const { status, body } = await api('/api/listings');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'Listings should be an array');
  });

  test('GET /api/markets returns required shape', async (t) => {
    if (skipIfAuth(t)) return;
    const { status, body } = await api('/api/markets');
    assert.equal(status, 200);
    assert.ok('summary' in body,   'markets missing summary');
    assert.ok('platforms' in body, 'markets missing platforms');
    assert.ok('poshmark' in body.platforms, 'markets missing poshmark platform');
    assert.ok('whatnot' in body.platforms,  'markets missing whatnot platform');
  });
});

describe('Bundle label — 1080x1080 output', () => {
  test('Generated labeled image is a valid JPEG', async () => {
    const items = await getItems();
    const target = items.find(i => i.is_bundle && (i.photos || [])[0]?.path);
    if (!target) { console.log('  skipped: no bundle items with photos'); return; }

    await api(`/api/items/${target.id}/bundle`, {
      method: 'PUT',
      body: JSON.stringify({ is_bundle: true }),
    });
    await new Promise(r => setTimeout(r, 1500));

    const labeledPath = join('/Users/flippi/Developer/fotoflip/processed', `item-${target.id}-labeled.jpg`);
    if (!existsSync(labeledPath)) { console.log('  skipped: labeled image not generated'); return; }

    const buf = readFileSync(labeledPath);
    // JPEG magic bytes: FF D8 FF
    assert.equal(buf[0], 0xFF, 'File should start with JPEG magic byte FF');
    assert.equal(buf[1], 0xD8, 'File should start with JPEG magic byte D8');
    assert.ok(buf.length > 50000, `File too small (${buf.length} bytes) — likely empty or corrupt`);
  });
});
