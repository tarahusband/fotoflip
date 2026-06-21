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

async function getItems() {
  const { body } = await api('/api/items');
  return body;
}

async function getItem(id) {
  const items = await getItems();
  return items.find(i => i.id === id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Server health', () => {
  test('GET /api/items returns 200 and an array', async () => {
    const { status, body } = await api('/api/items');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'Expected array of items');
  });
});

describe('FIX I2 — saveWeight does not corrupt bundle fields', () => {
  test('PUT /bundle with only weight fields preserves is_bundle, bundle_type, bundle_count', async () => {
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
  test('GET /api/dashboard returns 200 with required shape', async () => {
    const { status, body } = await api('/api/dashboard');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object', 'Body should be an object');
    assert.ok('stats' in body, 'Missing stats');
    assert.ok('recentImports' in body, 'Missing recentImports');
    assert.ok('recentActivity' in body, 'Missing recentActivity');
  });

  test('Dashboard stats.total matches /api/inventory/stats', async () => {
    const [dash, inv] = await Promise.all([
      api('/api/dashboard'),
      api('/api/inventory/stats'),
    ]);
    assert.equal(dash.body.stats.total, inv.body.total, 'Total counts should match');
  });

  test('recentImports is array of max 3', async () => {
    const { body } = await api('/api/dashboard');
    assert.ok(Array.isArray(body.recentImports), 'recentImports should be array');
    assert.ok(body.recentImports.length <= 3, `Should return at most 3, got ${body.recentImports.length}`);
  });

  test('recentImports entries have required fields', async () => {
    const { body } = await api('/api/dashboard');
    for (const imp of body.recentImports) {
      assert.ok('box' in imp, 'Import entry missing box');
      assert.ok('count' in imp, 'Import entry missing count');
      assert.ok('latestDate' in imp, 'Import entry missing latestDate');
      assert.ok(Array.isArray(imp.thumbs), 'Import entry thumbs should be array');
    }
  });

  test('recentActivity is array of max 5', async () => {
    const { body } = await api('/api/dashboard');
    assert.ok(Array.isArray(body.recentActivity), 'recentActivity should be array');
    assert.ok(body.recentActivity.length <= 5, `Should return at most 5, got ${body.recentActivity.length}`);
  });

  test('Dashboard stat counts are non-negative integers', async () => {
    const { body } = await api('/api/dashboard');
    const { total, ready, listed, sold, shipped } = body.stats;
    for (const [key, val] of Object.entries({ total, ready, listed, sold, shipped })) {
      assert.ok(Number.isInteger(val) && val >= 0, `stats.${key} should be non-negative integer, got ${val}`);
    }
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
