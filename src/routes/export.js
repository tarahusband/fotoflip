const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const crypto  = require('crypto');
const { getDb, getUserSetting, setUserSetting } = require('../db');
const { getUserId } = require('../auth');
const { buildSku, POSHMARK_HEADERS, buildPoshmarkRow, whatnotCategoryMap, whatnotDescription, whatnotCondition, whatnotShipping, etsyCategoryMap } = require('../lib/csv');

const router = express.Router();

const ETSY_API_KEY  = process.env.ETSY_API_KEY;
const ETSY_SECRET   = process.env.ETSY_SHARED_SECRET;
const ETSY_REDIRECT = `${process.env.APP_URL || 'http://localhost:3456'}/auth/etsy/callback`;
const ETSY_SCOPES   = 'listings_w listings_r';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function generatePKCE() {
  const verifier  = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

let etsyPKCE = null;

function resolveImageUrl(item, photo, meta) {
  if (item.is_bundle && item.bundle_label_url) return item.bundle_label_url;
  return photo.cloudinary_url || meta.imgbbUrl || '';
}

// ── Whatnot single ────────────────────────────────────────────────────────────

router.post('/api/items/:id/export/whatnot', async (req, res) => {
  const db   = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};

  const imageUrl  = resolveImageUrl(item, photo, meta);
  const cat       = (meta.category || '').toLowerCase();
  const { whatnotCat, whatnotSub } = whatnotCategoryMap(cat);
  const condition = whatnotCondition(meta.conditionText);
  const title     = (meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim()).slice(0, 80);
  const description = whatnotDescription(meta);
  const price     = parseFloat(meta.suggestedPrice) || 25;
  const sku       = buildSku(item.id, meta);

  const HEADERS = ['Category','Sub Category','Title','Description','Quantity','Type','Price','Shipping Profile','Offerable','Hazmat','Condition','Cost Per Item','SKU','Image URL 1','Image URL 2','Image URL 3','Image URL 4','Image URL 5','Image URL 6','Image URL 7','Image URL 8'];
  const q   = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const row = [q(whatnotCat),q(whatnotSub),q(title),q(description),1,'Buy it Now',price,q(whatnotShipping()),'TRUE','Not Hazmat',q(condition),'',q(sku),q(imageUrl),'','','','','','',''];
  const csv = HEADERS.join(',') + '\r\n' + row.join(',') + '\r\n';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="whatnot-${item.id}.csv"`);
  res.send(csv);
});

// ── Whatnot bulk ──────────────────────────────────────────────────────────────

router.get('/api/export/whatnot', async (req, res) => {
  const db    = getDb();
  const items = db.prepare(`SELECT * FROM items WHERE processing_status = 'done' ORDER BY id`).all();
  if (!items.length) return res.status(400).json({ error: '🌸 No ready items to export' });

  const HEADERS = ['Category','Sub Category','Title','Description','Quantity','Type','Price','Shipping Profile','Offerable','Hazmat','Condition','Cost Per Item','SKU','Image URL 1','Image URL 2','Image URL 3','Image URL 4','Image URL 5','Image URL 6','Image URL 7','Image URL 8'];
  const q    = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const rows = [];

  for (const item of items) {
    const photoIds = JSON.parse(item.photo_ids || '[]');
    const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
    if (!photo) continue;
    const meta        = photo.metadata ? JSON.parse(photo.metadata) : {};
    const imageUrl    = resolveImageUrl(item, photo, meta);
    const cat         = (meta.category || '').toLowerCase();
    const { whatnotCat, whatnotSub } = whatnotCategoryMap(cat);
    const condition   = whatnotCondition(meta.conditionText);
    const title       = (meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim()).slice(0, 80);
    const description = whatnotDescription(meta);
    const price       = parseFloat(meta.suggestedPrice) || 25;
    const sku         = buildSku(item.id, meta);
    rows.push([q(whatnotCat),q(whatnotSub),q(title),q(description),1,'Buy it Now',price,q(whatnotShipping()),'TRUE','Not Hazmat',q(condition),'',q(sku),q(imageUrl),'','','','','','',''].join(','));
  }

  const today  = new Date().toISOString().slice(0, 10);
  const csv    = HEADERS.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
  const userId = getUserId(req);
  const upsert = db.prepare(`INSERT INTO listings (user_id, item_id, platform, status, published_at, source) VALUES (?, ?, 'whatnot', 'published', ?, 'manual') ON CONFLICT(item_id, platform) DO UPDATE SET status='published', published_at=excluded.published_at`);
  try { db.transaction(() => { for (const item of items) upsert.run(userId, item.id, today); })(); } catch (_) {}

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="whatnot-bulk-${today}.csv"`);
  res.setHeader('X-Export-Item-Ids', JSON.stringify(items.map(i => i.id)));
  res.send(csv);
});

// ── Poshmark single ───────────────────────────────────────────────────────────

router.post('/api/items/:id/export/poshmark', async (req, res) => {
  const db   = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta     = photo.metadata ? JSON.parse(photo.metadata) : {};
  const q        = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const imageUrl = resolveImageUrl(item, photo, meta);
  const csv      = [POSHMARK_HEADERS.join(','), buildPoshmarkRow(item, meta, imageUrl, q)].join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="poshmark-${item.id}.csv"`);
  res.send(csv);
});

// ── Poshmark bulk ─────────────────────────────────────────────────────────────

const POSHMARK_BATCH_SIZE = 39;

router.get('/api/export/poshmark', async (req, res) => {
  const db    = getDb();
  const items = db.prepare(`SELECT * FROM items WHERE processing_status = 'done' ORDER BY id`).all();
  if (!items.length) return res.status(400).json({ error: '🌸 No ready items to export' });

  const q    = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const allRows = [];

  for (const item of items) {
    const photoIds = JSON.parse(item.photo_ids || '[]');
    const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
    if (!photo) continue;
    const meta     = photo.metadata ? JSON.parse(photo.metadata) : {};
    const imageUrl = resolveImageUrl(item, photo, meta);
    allRows.push({ row: buildPoshmarkRow(item, meta, imageUrl, q), item });
  }

  const totalBatches = Math.ceil(allRows.length / POSHMARK_BATCH_SIZE);

  // ?info=1 — return batch metadata as JSON (no download)
  if (req.query.info) {
    return res.json({ totalBatches, totalItems: allRows.length, batchSize: POSHMARK_BATCH_SIZE });
  }

  const batchNum = Math.max(1, Math.min(parseInt(req.query.batch) || 1, totalBatches));
  const start    = (batchNum - 1) * POSHMARK_BATCH_SIZE;
  const batch    = allRows.slice(start, start + POSHMARK_BATCH_SIZE);

  const today  = new Date().toISOString().slice(0, 10);
  const csv    = [POSHMARK_HEADERS.join(','), ...batch.map(b => b.row)].join('\r\n') + '\r\n';
  const userId = getUserId(req);
  const upsert = db.prepare(`INSERT INTO listings (user_id, item_id, platform, status, published_at, source) VALUES (?, ?, 'poshmark', 'published', ?, 'manual') ON CONFLICT(item_id, platform) DO UPDATE SET status='published', published_at=excluded.published_at`);
  try { db.transaction(() => { for (const { item } of batch) upsert.run(userId, item.id, today); })(); } catch (_) {}

  const suffix = totalBatches > 1 ? `-part${batchNum}of${totalBatches}` : '';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="poshmark-bulk-${today}${suffix}.csv"`);
  res.setHeader('X-Total-Batches', totalBatches);
  res.setHeader('X-Batch-Number', batchNum);
  res.setHeader('X-Export-Item-Ids', JSON.stringify(batch.map(b => b.item.id)));
  res.send(csv);
});

// ── Etsy OAuth ────────────────────────────────────────────────────────────────

router.get('/auth/etsy', (req, res) => {
  if (!ETSY_API_KEY) return res.status(500).send('ETSY_API_KEY not configured');
  const { verifier, challenge } = generatePKCE();
  const state = base64url(crypto.randomBytes(16));
  etsyPKCE = { verifier, state };
  const params = new URLSearchParams({ response_type: 'code', redirect_uri: ETSY_REDIRECT, scope: ETSY_SCOPES, client_id: ETSY_API_KEY, state, code_challenge: challenge, code_challenge_method: 'S256' });
  res.redirect(`https://www.etsy.com/oauth/connect?${params}`);
});

router.get('/auth/etsy/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!etsyPKCE || state !== etsyPKCE.state) return res.status(400).send('Invalid state');
  try {
    const tokenRes = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: ETSY_API_KEY, redirect_uri: ETSY_REDIRECT, code, code_verifier: etsyPKCE.verifier }),
    });
    const token  = await tokenRes.json();
    if (!token.access_token) throw new Error(JSON.stringify(token));
    const db     = getDb();
    const userId = getUserId(req);
    setUserSetting(db, userId, 'etsy_access_token',  token.access_token);
    setUserSetting(db, userId, 'etsy_refresh_token', token.refresh_token || '');
    setUserSetting(db, userId, 'etsy_user_id',       String(token.access_token.split('.')[0]));
    etsyPKCE = null;
    const meRes = await fetch('https://api.etsy.com/v3/application/users/me', { headers: { 'x-api-key': ETSY_API_KEY, 'Authorization': `Bearer ${token.access_token}` } });
    const me    = await meRes.json();
    if (me.shop_id) setUserSetting(db, userId, 'etsy_shop_id', String(me.shop_id));
    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>✓ Etsy connected!</h2><p>Shop ID: ${me.shop_id || 'saved'}</p><p><a href="/">Return to FotoFlip</a></p></body></html>`);
  } catch (err) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

router.get('/api/etsy/status', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const token  = getUserSetting(db, userId, 'etsy_access_token');
  const shopId = getUserSetting(db, userId, 'etsy_shop_id');
  res.json({ connected: !!token, shopId: shopId || null });
});

router.post('/api/items/:id/export/etsy', async (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const token  = getUserSetting(db, userId, 'etsy_access_token');
  const shopId = getUserSetting(db, userId, 'etsy_shop_id');
  if (!token || !shopId) return res.status(400).json({ error: '🌸 Etsy not connected — click Connect Etsy first' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};

  const title       = (meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim()).slice(0, 140);
  const description = meta.description || meta.conditionNotes || 'See photos for details.';
  const price       = parseFloat(meta.suggestedPrice) || 25;
  const tags        = Array.isArray(meta.tags) ? meta.tags.slice(0, 13).map(t => t.slice(0, 20)) : [];
  const { etsyTaxonomyId } = etsyCategoryMap(meta.category || '');
  const authHeader  = `Bearer ${token}`;
  const apiKeyHeader = `${ETSY_API_KEY}:${ETSY_SECRET}`;

  try {
    const listingBody = new URLSearchParams({ quantity: '1', title, description, price: price.toFixed(2), who_made: 'someone_else', when_made: 'made_to_order', taxonomy_id: String(etsyTaxonomyId), state: 'draft', ...(tags.length ? { tags: tags.join(',') } : {}) });
    const listingRes  = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings`, { method: 'POST', headers: { 'x-api-key': apiKeyHeader, 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, body: listingBody });
    const listing     = await listingRes.json();
    if (!listing.listing_id) throw new Error(listing.error || JSON.stringify(listing));

    if (photo.processed_path) {
      try {
        const imgData  = await fs.readFile(photo.processed_path);
        const boundary = `----FormBoundary${crypto.randomBytes(8).toString('hex')}`;
        const imgName  = path.basename(photo.processed_path);
        const body     = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${imgName}"\r\nContent-Type: image/jpeg\r\n\r\n`),
          imgData,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings/${listing.listing_id}/images`, { method: 'POST', headers: { 'x-api-key': apiKeyHeader, 'Authorization': authHeader, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
      } catch (imgErr) {
        console.warn('[FotoFlip] Etsy image upload failed:', imgErr.message);
      }
    }

    res.json({ success: true, listingId: listing.listing_id, url: `https://www.etsy.com/your/shops/me/listings/${listing.listing_id}/edit` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Make.com relay ────────────────────────────────────────────────────────────

router.post('/api/items/:id/export/make', async (req, res) => {
  const db         = getDb();
  const webhookUrl = getUserSetting(db, getUserId(req), 'make_webhook_url');
  if (!webhookUrl) return res.status(400).json({ error: '🌸 Make.com webhook not configured — add it in Settings' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};

  let imageUrl = '';
  const imgbbKey = process.env.IMGBB_API_KEY;
  if (imgbbKey && photo.processed_path) {
    try {
      const imgData = await fs.readFile(photo.processed_path);
      const b64     = imgData.toString('base64');
      const form    = new URLSearchParams({ key: imgbbKey, image: b64 });
      const r       = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
      const j       = await r.json();
      if (j.data?.url) imageUrl = j.data.url;
    } catch (e) {
      console.warn('[FotoFlip] ImgBB upload failed:', e.message);
    }
  }

  const payload = {
    title:       meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim(),
    description: meta.description || meta.conditionNotes || '',
    price:       parseFloat(meta.suggestedPrice) || 25,
    quantity:    1,
    brand:       meta.brand || '',
    category:    meta.category || '',
    condition:   meta.conditionText || meta.condition || '',
    color:       meta.color || '',
    material:    meta.material || '',
    size:        meta.size || '',
    sku:         buildSku(item.id, meta),
    tags:        Array.isArray(meta.tags) ? meta.tags.join(',') : '',
    imageUrl,
    itemId:      item.id,
  };

  try {
    const makeRes = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!makeRes.ok) throw new Error(`Make responded ${makeRes.status}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
