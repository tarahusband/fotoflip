require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const crypto = require('crypto');
const sharp = require('sharp');
const { getDb, initDb } = require('./src/db');
const { processItem } = require('./src/processor');
const { setupAuth, requireAuth, getUserId } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3456;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PROCESSED_DIR = path.join(__dirname, 'processed');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Auth setup (must come before static + routes)
if (process.env.GOOGLE_CLIENT_ID) {
  setupAuth(app, session);
}

// Login page — public, no auth required
app.get('/login', (req, res) => {
  if (process.env.GOOGLE_CLIENT_ID && req.isAuthenticated?.()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/admin/db-check', (req, res) => {
  if (req.headers['x-admin-secret'] !== process.env.SESSION_SECRET) return res.status(403).json({ error: 'forbidden' });
  const db = getDb();
  const items = db.prepare('SELECT COUNT(*) as count FROM items').get();
  const users = db.prepare('SELECT id, email, role FROM users').all();
  const itemsByUser = db.prepare('SELECT user_id, COUNT(*) as count FROM items GROUP BY user_id').all();
  const dbPath = process.env.DATA_DIR ? `${process.env.DATA_DIR}/fotoflip.db` : 'local';
  res.json({ dbPath, items, users, itemsByUser });
});

// All other routes require auth when GOOGLE_CLIENT_ID is set
app.use(requireAuth);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/processed', express.static(PROCESSED_DIR));

// ── Photos ──────────────────────────────────────────────────────────────────

app.post('/api/photos/upload', upload.array('photos'), async (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  const photos = [];

  for (const file of req.files) {
    const result = db
      .prepare(`INSERT INTO photos (path, name, size, status, created_at, user_id) VALUES (?, ?, ?, 'pending', datetime('now'), ?)`)
      .run(file.path, file.originalname, file.size, userId);

    photos.push({
      id: result.lastInsertRowid,
      name: file.originalname,
      uploadName: file.filename,
      path: file.path,
      url: `/uploads/${file.filename}`,
    });
  }

  res.json({ photos });
});

app.get('/api/photos', (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  const query = userId
    ? `SELECT * FROM photos WHERE user_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM photos ORDER BY created_at DESC`;
  res.json(userId ? db.prepare(query).all(userId) : db.prepare(query).all());
});

// ── Items ────────────────────────────────────────────────────────────────────

app.get('/api/items', (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  const items = userId
    ? db.prepare(`SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC`).all(userId)
    : db.prepare(`SELECT * FROM items ORDER BY created_at DESC`).all();
  const photos = userId
    ? db.prepare(`SELECT * FROM photos WHERE user_id = ?`).all(userId)
    : db.prepare(`SELECT * FROM photos`).all();
  const photoMap = Object.fromEntries(photos.map((p) => [p.id, p]));

  res.json(items.map((item) => ({
    ...item,
    photoIds: JSON.parse(item.photo_ids || '[]'),
    photos: JSON.parse(item.photo_ids || '[]').map((id) => photoMap[id]).filter(Boolean),
  })));
});

app.post('/api/items', async (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  const { photoIds, purchaseDate } = req.body;

  if (!photoIds || !photoIds.length) {
    return res.status(400).json({ error: 'photoIds required' });
  }

  const date = purchaseDate || new Date().toISOString().slice(0, 10);
  const isBundle = req.body.is_bundle ? 1 : 0;
  const bundleType = req.body.bundle_type || '';
  const bundleCount = parseInt(req.body.bundle_count) || 0;
  const weight = req.body.weight || '';
  const weightUnit = req.body.weight_unit || 'LB';

  const box = req.body.box || '';
  const hint = req.body.hint || '';

  const result = db
    .prepare(`INSERT INTO items (status, purchase_date, photo_ids, processing_status, is_bundle, bundle_type, bundle_count, weight, weight_unit, created_at, user_id) VALUES ('Flip', ?, ?, 'review', ?, ?, ?, ?, ?, datetime('now'), ?)`)
    .run(date, JSON.stringify(photoIds), isBundle, bundleType, bundleCount, weight, weightUnit, userId);

  const itemId = result.lastInsertRowid;

  for (const photoId of photoIds) {
    db.prepare(`UPDATE photos SET status = 'grouped' WHERE id = ?`).run(photoId);
    if (box || hint) {
      const photo = db.prepare('SELECT metadata FROM photos WHERE id = ?').get(photoId);
      const meta = photo?.metadata ? JSON.parse(photo.metadata) : {};
      if (box) meta.box = box;
      if (hint) meta.hint = hint;
      db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photoId);
    }
  }

  res.json({ id: itemId, photoIds });
});

app.get('/api/items/:id', (req, res) => {
  const db = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photos = photoIds.map((id) => db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id)).filter(Boolean);
  res.json({ ...item, photoIds, photos });
});

// Process (first time or redo)
app.post('/api/items/:id/process', async (req, res) => {
  const db = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');

  // Save any bundle updates sent alongside process trigger
  if (req.body.is_bundle !== undefined) {
    db.prepare(`UPDATE items SET is_bundle=?, bundle_type=?, bundle_count=? WHERE id=?`)
      .run(req.body.is_bundle ? 1 : 0, req.body.bundle_type || '', parseInt(req.body.bundle_count) || 0, req.params.id);
  }

  // Fire and forget — client polls for status updates
  res.json({ processing: true });
  processItem(parseInt(req.params.id), photoIds, PROCESSED_DIR)
    .catch(err => console.error(`[FotoFlip] Processing error item ${req.params.id}:`, err.message));
});

// Delete item + its photos
app.delete('/api/items/:id', async (req, res) => {
  const db = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const photoIds = JSON.parse(item.photo_ids || '[]');
  for (const photoId of photoIds) {
    const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(photoId);
    if (photo) {
      await fs.unlink(photo.path).catch(() => {});
      db.prepare(`DELETE FROM photos WHERE id = ?`).run(photoId);
    }
  }

  db.prepare(`DELETE FROM items WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// ── Stats ────────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) as n FROM items`).get().n;
  const flips = db.prepare(`SELECT COUNT(*) as n FROM items WHERE status = 'Flip'`).get().n;
  const processed = db.prepare(`SELECT COUNT(*) as n FROM items WHERE processing_status = 'done'`).get().n;
  res.json({ total, flips, processed });
});


// ── Settings ─────────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

app.put('/api/settings', (req, res) => {
  const db = getDb();
  for (const [key, value] of Object.entries(req.body)) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
  }
  res.json({ success: true });
});

// ── Item status update ────────────────────────────────────────────────────────

app.put('/api/items/:id', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { status, processing_status } = req.body;
  if (status) db.prepare('UPDATE items SET status = ? WHERE id = ?').run(status, req.params.id);
  if (processing_status) db.prepare('UPDATE items SET processing_status = ? WHERE id = ?').run(processing_status, req.params.id);
  res.json({ success: true });
});

// Bundle fields update — generates labeled preview when is_bundle=true
app.put('/api/items/:id/bundle', async (req, res) => {
  const db = getDb();
  const current = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Not found' });
  const { is_bundle, bundle_type, bundle_count, weight, weight_unit } = req.body;
  db.prepare('UPDATE items SET is_bundle=?, bundle_type=?, bundle_count=?, weight=?, weight_unit=? WHERE id=?')
    .run(
      is_bundle !== undefined ? (is_bundle ? 1 : 0) : current.is_bundle,
      bundle_type !== undefined ? (bundle_type || '') : current.bundle_type,
      bundle_count !== undefined ? (parseInt(bundle_count) || 0) : current.bundle_count,
      weight !== undefined ? (weight || '') : current.weight,
      weight_unit !== undefined ? (weight_unit || 'LB') : current.weight_unit,
      req.params.id
    );

  res.json({ success: true });

  if (is_bundle) {
    try {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      const photoIds = JSON.parse(item.photo_ids || '[]');
      const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
      if (!photo?.path) return;
      const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
      const { main, sub } = getBundleLabel(meta, item);
      const buf = await applyBundleLabel(photo.path, main, sub);
      const labeledPath = path.join(PROCESSED_DIR, `item-${req.params.id}-labeled.jpg`);
      await fs.writeFile(labeledPath, buf);
    } catch (e) {
      console.warn('[FotoFlip] Bundle label generation failed:', e.message);
    }
  }
});

// ── Metadata save ────────────────────────────────────────────────────────────

app.put('/api/items/:id/metadata', async (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  for (const photoId of photoIds) {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
    if (!photo) continue;
    const current = photo.metadata ? JSON.parse(photo.metadata) : {};
    const updated = { ...current, ...req.body };
    db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(updated), photoId);
    if (photo.processed_path) {
      const dir = path.dirname(photo.processed_path);
      await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(updated, null, 2)).catch(() => {});
    }
  }
  res.json({ success: true });
});

// ── Metadata re-extraction (no image reprocess) ───────────────────────────────

app.post('/api/items/:id/metadata/extract', async (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const { extractWithOpenAI } = require('./src/processor');
  try {
    const existing = photo.metadata ? JSON.parse(photo.metadata) : {};
    const metadata = await extractWithOpenAI(photo.path, existing.hint || '');
    const current = photo.metadata ? JSON.parse(photo.metadata) : {};
    const updated = { ...current, ...metadata };
    db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(updated), photo.id);
    if (photo.processed_path) {
      const dir = require('path').dirname(photo.processed_path);
      await require('fs').promises.writeFile(require('path').join(dir, 'metadata.json'), JSON.stringify(updated, null, 2)).catch(() => {});
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI listing generation ─────────────────────────────────────────────────────

app.post('/api/items/:id/listing/generate', async (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const metadata = photo.metadata ? JSON.parse(photo.metadata) : {};
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) return res.status(400).json({ error: '🌸 No AI API key configured' });
  try {
    const imageData = await fs.readFile(photo.path);
    const base64 = imageData.toString('base64');
    const ext = photo.path.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
    const isBundle = item.is_bundle;
    const weight = item.weight || '';
    const weightUnit = item.weight_unit || 'LB';
    const weightStr = weight ? `${weight} ${weightUnit}` : '';

    const listingPrompt = isBundle
      ? `Write a Poshmark resale listing for this jewelry lot/bundle for the shop BocaBelle.\n\nKnown metadata: ${JSON.stringify(metadata)}\nWeight: ${weightStr || 'unknown'}\n\nTitle format: [qty/weight] [Lot Type] | [Era] [Materials] | Resell Collect\n- Start with quantity or weight if visible or known — e.g. "100+ pcs", "1 LB", "Large Lot", "50+ pcs"\n- Lot Type: "Jewelry Lot", "Mystery Box", "Estate Lot", "Vintage Lot" — pick best fit\n- Era: Vintage / Estate / Y2K / Modern / Mixed\n- Materials: name 2-3 SPECIFIC materials you can actually see in the photo — examples: "Lampwork Beads", "Rhinestone Charms", "Vintage Buttons", "Pearl Drops", "Enamel Pins", "Crystal Rondelles", "Cameo Pendants", "Seed Beads", "Lucite Flowers", "Copper Wire". NEVER use vague terms like "Craft Lot", "Mixed Pieces", or "Assorted Items"\n- End with use case: "Resell Collect", "Resell DIY", "Resell Wear"\n- Keep total title under 80 characters\n- Add one emoji bookend each side (⚜️ ✨ 💎 🌹)\n\nDescription must follow this exact 6-part structure:\n1. Hook line — excitement/mystery opener (1 sentence, no brand name)\n2. What You Might Discover — 3-4 bullet points with ✨, list item types and styles from the photo\n3. The BocaBelle Promise — "Every box is topped off and always includes extra pieces. ✨"\n4. Condition Notes — include all of these points: wearable lot that may include a flawed piece; sold as is with no promise of anything; grab bag style — remove one piece at a time to prevent tangling; as to not compromise the integrity of the items, pieces are not cleaned — that is the buyer's job\n5. Metal Clarity — gold-tone/silver-tone, not tested or verified, sold as found\n6. SEO Tags line — "You may also like~" followed by 8-10 comma-separated search terms\n7. No Returns block — use this exactly: "💛 Final sale: To protect against item switching or missing pieces, all lots/bundles are sold as-is with no returns, exchanges, cancellations, or refunds unless required by platform policy, so please message me with any questions before purchasing. Thank you."\n\nReturn JSON only:\n{\n  "title": "...",\n  "description": "...",\n  "category": "one of: necklace|bracelet|ring|earrings|pendant|brooch|watch|tote|crossbody|wallet|clutch|satchel|handbag|backpack|clothing|shoes|accessory|toy|collectible|other",\n  "tags": ["8 to 12 relevant search tags"]\n}`
      : `Write a Whatnot resale listing for this item.\n\nKnown metadata: ${JSON.stringify(metadata)}\n\nTitle format: 🅑 | Brand | Category | Resale Keyword ♻️\n- Brand: use the brand name, or "Vintage" if unknown/unbranded\n- Category: item type (Brooch, Earrings, Necklace, Bracelet, Ring, Watch, Handbag, Tote, Crossbody, etc.)\n- Resale Keyword: pick the most fitting: "Vintage Find" | "High Resale" | "Collector's Piece" | "Trending Pick" | "Estate Find" | "Statement Piece" | "Boutique Find" | "Flips Well"\n- Keep total title under 80 characters\n\nDescription format: Brand — material — condition notes. Happy to answer any questions! ♻️\n- One or two sentences max\n- Mention any visible wear, repairs, or notable features honestly\n- Keep it conversational and buyer-friendly\n\nReturn JSON only:\n{\n  "title": "...",\n  "description": "...",\n  "category": "one of: necklace|bracelet|ring|earrings|pendant|brooch|watch|tote|crossbody|wallet|clutch|satchel|handbag|backpack|clothing|shoes|accessory|toy|collectible|other",\n  "tags": ["8 to 12 relevant search tags"]\n}`;

    let text = '';
    if (anthropicKey) {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: ext, data: base64 } },
          { type: 'text', text: listingPrompt },
        ]}],
      });
      text = response.content[0]?.text?.trim() || '';
    } else {
      const { OpenAI } = require('openai');
      const client = new OpenAI({ apiKey: openaiKey });
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${ext};base64,${base64}` } },
          { type: 'text', text: listingPrompt },
        ]}],
        max_tokens: 700,
      });
      text = response.choices[0].message.content.trim();
    }
    const listing = JSON.parse(text.replace(/^```json?\n?/, '').replace(/\n?```$/, ''));
    for (const photoId of photoIds) {
      const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
      if (!p) continue;
      const current = p.metadata ? JSON.parse(p.metadata) : {};
      const updated = { ...current, ...listing };
      db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(updated), photoId);
      if (p.processed_path) {
        const dir = path.dirname(p.processed_path);
        await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(updated, null, 2)).catch(() => {});
      }
    }
    res.json(listing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Whatnot CSV export ────────────────────────────────────────────────────────

app.post('/api/items/:id/export/whatnot', async (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};

  let uploadSource = photo.processed_path;
  if (item.is_bundle) {
    const labeledPath = path.join(PROCESSED_DIR, `item-${item.id}-labeled.jpg`);
    try { await fs.access(labeledPath); uploadSource = labeledPath; } catch (_) {}
  }
  const imageUrl = uploadSource ? await uploadImage(uploadSource, item.id) : '';

  const cat = (meta.category || '').toLowerCase();
  const { whatnotCat, whatnotSub } = whatnotCategoryMap(cat);
  const condition = whatnotCondition(meta.conditionText);
  const title = (meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim()).slice(0, 80);
  const description = whatnotDescription(meta);
  const price = parseFloat(meta.suggestedPrice) || 25;
  const sku = buildSku(item.id, meta);

  const HEADERS = ['Category','Sub Category','Title','Description','Quantity','Type','Price','Shipping Profile','Offerable','Hazmat','Condition','Cost Per Item','SKU','Image URL 1','Image URL 2','Image URL 3','Image URL 4','Image URL 5','Image URL 6','Image URL 7','Image URL 8'];
  const q = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const row = [q(whatnotCat),q(whatnotSub),q(title),q(description),1,'Buy it Now',price,q(whatnotShipping(meta)),'TRUE','Not Hazmat',q(condition),'',q(sku),q(imageUrl),'','','','','','',''];
  const csv = HEADERS.join(',') + '\r\n' + row.join(',') + '\r\n';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="whatnot-${item.id}.csv"`);
  res.send(csv);
});

// ── Whatnot bulk CSV export ───────────────────────────────────────────────────

app.get('/api/export/whatnot', async (req, res) => {
  const db = getDb();
  const items = db.prepare(`SELECT * FROM items WHERE processing_status = 'done' ORDER BY id`).all();
  if (!items.length) return res.status(400).json({ error: '🌸 No ready items to export' });

  const HEADERS = ['Category','Sub Category','Title','Description','Quantity','Type','Price','Shipping Profile','Offerable','Hazmat','Condition','Cost Per Item','SKU','Image URL 1','Image URL 2','Image URL 3','Image URL 4','Image URL 5','Image URL 6','Image URL 7','Image URL 8'];
  const q = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };

  const rows = [];
  for (const item of items) {
    const photoIds = JSON.parse(item.photo_ids || '[]');
    const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
    if (!photo) continue;
    const meta = photo.metadata ? JSON.parse(photo.metadata) : {};

    let imageUrl = meta.imgbbUrl || '';
    if (!imageUrl) {
      const labeledPath = path.join(__dirname, 'processed', `item-${item.id}-labeled.jpg`);
      const wUploadSource = (item.is_bundle && require('fs').existsSync(labeledPath)) ? labeledPath : photo.processed_path;
      if (wUploadSource) {
        imageUrl = await uploadImage(wUploadSource, item.id);
        if (imageUrl) {
          meta.imgbbUrl = imageUrl;
          db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photo.id);
        }
      }
    }

    const cat = (meta.category || '').toLowerCase();
    const { whatnotCat, whatnotSub } = whatnotCategoryMap(cat);
    const condition = whatnotCondition(meta.conditionText);
    const title = (meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim()).slice(0, 80);
    const description = whatnotDescription(meta);
    const price = parseFloat(meta.suggestedPrice) || 25;
    const sku = buildSku(item.id, meta);
    rows.push([q(whatnotCat),q(whatnotSub),q(title),q(description),1,'Buy it Now',price,q(whatnotShipping(meta)),'TRUE','Not Hazmat',q(condition),'',q(sku),q(imageUrl),'','','','','','',''].join(','));
  }

  const today = new Date().toISOString().slice(0,10);
  const csv = HEADERS.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';

  // Write to listings table
  const userId = getUserId(req);
  const upsertListing = db.prepare(`
    INSERT INTO listings (user_id, item_id, platform, status, published_at, source)
    VALUES (?, ?, 'whatnot', 'published', ?, 'manual')
    ON CONFLICT(item_id, platform) DO UPDATE SET status='published', published_at=excluded.published_at
  `);
  try {
    const insertAll = db.transaction(() => { for (const item of items) upsertListing.run(userId, item.id, today); });
    insertAll();
  } catch (_) {}

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="whatnot-bulk-${today}.csv"`);
  res.setHeader('X-Export-Item-Ids', JSON.stringify(items.map(i => i.id)));
  res.send(csv);
});

// ── Poshmark helpers ──────────────────────────────────────────────────────────

function poshmarkCategoryMap(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('necklace') || c.includes('pendant')) return { dept: 'Women', cat: 'Jewelry', subcat: 'Necklaces' };
  if (c.includes('bracelet')) return { dept: 'Women', cat: 'Jewelry', subcat: 'Bracelets' };
  if (c.includes('earring')) return { dept: 'Women', cat: 'Jewelry', subcat: 'Earrings' };
  if (c.includes('ring')) return { dept: 'Women', cat: 'Jewelry', subcat: 'Rings' };
  if (c.includes('brooch') || c.includes('pin')) return { dept: 'Women', cat: 'Jewelry', subcat: 'Brooches' };
  if (c.includes('watch')) return { dept: 'Women', cat: 'Accessories', subcat: 'Watches' };
  if (c.includes('tote')) return { dept: 'Women', cat: 'Bags', subcat: 'Tote Bags' };
  if (c.includes('crossbody')) return { dept: 'Women', cat: 'Bags', subcat: 'Crossbody Bags' };
  if (c.includes('wallet')) return { dept: 'Women', cat: 'Bags', subcat: 'Wallets' };
  if (c.includes('clutch')) return { dept: 'Women', cat: 'Bags', subcat: 'Clutches & Wristlets' };
  if (c.includes('satchel')) return { dept: 'Women', cat: 'Bags', subcat: 'Satchels' };
  if (c.includes('backpack')) return { dept: 'Women', cat: 'Bags', subcat: 'Backpacks' };
  if (c.includes('handbag') || c.includes('purse')) return { dept: 'Women', cat: 'Bags', subcat: 'Hobos' };
  if (c.includes('shoe') || c.includes('boot') || c.includes('sandal') || c.includes('heel')) return { dept: 'Women', cat: 'Shoes', subcat: '' };
  if (c.includes('scarf')) return { dept: 'Women', cat: 'Accessories', subcat: 'Scarves & Wraps' };
  if (c.includes('belt')) return { dept: 'Women', cat: 'Accessories', subcat: 'Belts' };
  if (c.includes('sunglasses') || c.includes('sunglass') || c.includes('eyewear') || c.includes('glasses')) return { dept: 'Women', cat: 'Accessories', subcat: 'Sunglasses' };
  if (c.includes('lego')) return { dept: 'Kids', cat: 'Toys', subcat: 'Building Sets & Blocks' };
  if (c.includes('toy') || c.includes('game')) return { dept: 'Kids', cat: 'Toys', subcat: 'Action Figures & Playsets' };
  // Everything else (collectible, accessory, jewel, charm, other, mixed lots) → Necklaces (most generic valid jewelry sub-category)
  return { dept: 'Women', cat: 'Jewelry', subcat: 'Necklaces' };
}

function poshmarkCondition(t) {
  const c = (t || '').toLowerCase();
  if (c.includes('nwt') || c === 'new with tags') return 'NWT';
  if (c.includes('nwot') || c.includes('new without')) return 'Like New';
  if (c.includes('excellent')) return 'Like New';
  if (c.includes('very good') || c.includes('good')) return 'Good';
  if (c.includes('fair') || c.includes('poor') || c.includes('damage')) return 'Fair';
  return 'Good';
}

const POSHMARK_VALID_COLORS = new Set(['Red','Pink','Orange','Yellow','Green','Blue','Purple','Gold','Silver','Black','Gray','White','Cream','Brown','Tan']);

function poshmarkColor(colorStr) {
  const c = (colorStr || '').toLowerCase().replace(/-tone$/,'').replace(/-tone\b/g,'').trim();
  if (!c || c === 'tone' || c === 'mixed' || c === 'various' || c === 'assorted') return '';
  if (c.includes('black')) return 'Black';
  if (c.includes('white') || c.includes('ivory')) return 'White';
  if (c.includes('cream')) return 'Cream';
  if (c.includes('gold') || c.includes('brass') || c.includes('copper')) return 'Gold';
  if (c.includes('silver') || c.includes('chrome') || c.includes('pewter') || c.includes('rhodium')) return 'Silver';
  if (c.includes('pink') || c.includes('blush') || c.includes('rose') || c.includes('magenta') || c.includes('fuchsia')) return 'Pink';
  if (c.includes('red') || c.includes('burgundy') || c.includes('wine') || c.includes('maroon') || c.includes('crimson')) return 'Red';
  if (c.includes('orange') || c.includes('coral') || c.includes('peach') || c.includes('amber')) return 'Orange';
  if (c.includes('yellow') || c.includes('lemon') || c.includes('mustard')) return 'Yellow';
  if (c.includes('teal') || c.includes('green') || c.includes('olive') || c.includes('emerald') || c.includes('sage') || c.includes('mint')) return 'Green';
  if (c.includes('blue') || c.includes('navy') || c.includes('cobalt') || c.includes('indigo') || c.includes('sapphire')) return 'Blue';
  if (c.includes('purple') || c.includes('violet') || c.includes('lavender') || c.includes('plum') || c.includes('amethyst')) return 'Purple';
  if (c.includes('brown') || c.includes('tan') || c.includes('beige') || c.includes('nude') || c.includes('tortoise') || c.includes('camel')) return 'Brown';
  if (c.includes('gray') || c.includes('grey') || c.includes('charcoal') || c.includes('ash')) return 'Gray';
  return '';
}

function poshmarkSize(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('shoe') || c.includes('boot') || c.includes('sandal')) return '';
  return 'OS';
}

function buildSku(itemId, meta) {
  const box = (meta.box || '').trim() || 'BOX-001';
  return `${box}-${String(itemId).padStart(3, '0')}`;
}

function extractPillLabel(title) {
  if (!title) return null;
  const clean = title.replace(/[\u{1F300}-\u{1FFFF}⚜✨💎🌹♻🅑]/gu, '').trim();
  const parts = clean.split('|').map(p => p.trim());
  // Middle pipe section has the specific material words
  if (parts.length >= 2) {
    const mid = parts[1] || '';
    const stripped = mid.replace(/\b(vintage|estate|y2k|modern|mixed|era|resell|collect|diy|wear|jewelry|lot)\b/gi, '').trim();
    const words = stripped.split(/\s+/).filter(w => w.length > 1);
    if (words.length >= 1) return words.slice(0, 3).join(' ').toUpperCase();
  }
  // Fallback: first 3 non-trivial words
  const words = clean.split(/\s+/).filter(w => w.length > 2 && !/^(lot|the|and|for|with|this|that)$/i.test(w));
  return words.slice(0, 3).join(' ').toUpperCase() || null;
}

function getBundleLabel(meta, item) {
  const fromTitle = extractPillLabel(meta.title || '');
  if (fromTitle) return { main: fromTitle, sub: '' };
  const cat = (meta.category || '').toLowerCase();
  const bt  = (item.bundle_type || '').toLowerCase();
  if (cat.includes('earring') || bt.includes('earring'))                   return { main: 'RETRO EARRING LOT', sub: '' };
  if (cat.includes('brooch') || cat.includes('pin') || bt.includes('brooch')) return { main: 'VINTAGE BROOCH LOT', sub: '' };
  if (cat.includes('necklace') || cat.includes('pendant'))                 return { main: 'VINTAGE NECKLACE LOT', sub: '' };
  if (cat.includes('bracelet'))                                             return { main: 'VINTAGE BRACELET LOT', sub: '' };
  if (cat.includes('lego') || bt.includes('lego'))                         return { main: 'LEGO PARTS LOT', sub: '' };
  if (cat.includes('toy') || bt.includes('toy'))                           return { main: 'VINTAGE TOY LOT', sub: '' };
  if (cat.includes('button') || cat.includes('magnet'))                    return { main: 'BUTTON MAGNET LOT', sub: '' };
  if (bt.includes('gold'))                                                  return { main: 'GOLD TONE LOT', sub: '' };
  if (bt.includes('floral'))                                                return { main: 'FLORAL JEWELRY LOT', sub: '' };
  if (bt.includes('animal'))                                                return { main: 'ANIMAL PRINT LOT', sub: '' };
  if (bt.includes('mixed') || bt.includes('vintage'))                      return { main: 'MIXED LOT', sub: '' };
  if (cat.includes('jewel'))                                                return { main: 'MIXED LOT', sub: '' };
  return { main: 'VINTAGE TREASURE', sub: '' };
}

async function applyBundleLabel(imagePath, main, sub) {
  const SIZE = 1080;

  const star4 = (x, y, r, op = 0.92) =>
    `<path transform="translate(${x},${y}) scale(${r})" d="M0,-1 L.25,-.25 L1,0 L.25,.25 L0,1 L-.25,.25 L-1,0 L-.25,-.25Z" fill="white" fill-opacity="${op}"/>`;
  const bubble = (x, y, r, op = 0.32) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill-opacity="0" stroke="white" stroke-width="2.5" stroke-opacity="${op}"/>`;

  const svg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <!-- Pink frame — doubled thickness -->
    <rect x="14" y="14" width="1052" height="1052" fill-opacity="0" stroke="#ff4fb8" stroke-width="28" rx="6"/>

    <!-- Pearl/white stars -->
    ${star4(40,  20, 18)} ${star4(80,  44, 11)} ${star4(52,  70, 14)}
    ${star4(24,   8, 13)} ${star4(8,   90, 10)} ${star4(140, 14,  9)}
    ${star4(1042, 192, 17)} ${star4(1060, 218, 10)} ${star4(1048, 240, 7)}
    ${star4(1058, 858, 19)} ${star4(1034, 888, 11)} ${star4(1056, 830,  7)}
    ${star4(68,  1010, 15)} ${star4(96,   980,  9)} ${star4(44,   985,  7)}
    ${star4(200,   74, 13)} ${star4(168,   48,  8)} ${star4(240,   92,  6)}
    ${star4(860,   56, 12)} ${star4(888,   30,  7)} ${star4(828,   78,  6)}
    ${star4(120,  480, 12)} ${star4(88,   510,  7)} ${star4(148,  452,  6)}
    ${star4(974,  548,  9)} ${star4(1000, 520,  6)} ${star4(950,  572,  5)}
    ${star4(960,  308, 13)} ${star4(986,  278,  8)} ${star4(932,  332,  6)}
    ${star4(182,  884, 11)} ${star4(152,  856,  7)} ${star4(214,  910,  6)}
    ${star4(500,   30, 10)} ${star4(470,   58,  6)} ${star4(534,   14,  5)}
    ${star4(540, 1050,  9)} ${star4(510, 1030,  5)} ${star4(572, 1040,  6)}
    ${star4(300,  200,  8)} ${star4(780,  900,  7)} ${star4(880,  400,  6)}
    ${star4(140,  700,  9)} ${star4(920,  700,  7)} ${star4(500,  900,  6)}

    <!-- Bubbles -->
    ${bubble(984, 78, 40)} ${bubble(1020, 54, 20)} ${bubble(1044, 80, 10)}
    ${bubble(52, 912, 36)} ${bubble(42, 940, 18)}  ${bubble(74, 884, 10)}
    ${bubble(1048, 516, 28)} ${bubble(800, 1058, 30)} ${bubble(248, 1066, 14)}
  </svg>`;

  const photoBuffer = await sharp(imagePath)
    .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 1.10, saturation: 1.06 })
    .sharpen({ sigma: 0.75, m1: 0.8, m2: 1.8 })
    .toBuffer();

  return sharp(photoBuffer)
    .composite([
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function imgbbUpload(source, imgbbKey) {
  try {
    const imgData = Buffer.isBuffer(source) ? source : await fs.readFile(source);
    const b64 = imgData.toString('base64');
    const form = new URLSearchParams({ key: imgbbKey, image: b64 });
    const r = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
    const j = await r.json();
    return j.data?.url || '';
  } catch (e) {
    console.warn('[FotoFlip] ImgBB upload failed:', e.message);
    return '';
  }
}

async function githubUpload(source, filename) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    if (!token || !repo) return '';
    const imgData = Buffer.isBuffer(source) ? source : await fs.readFile(source);
    const b64 = imgData.toString('base64');
    const apiUrl = `https://api.github.com/repos/${repo}/contents/images/${filename}`;
    const headers = { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'fotoflip' };
    // check if file already exists (need SHA to update)
    const existing = await fetch(apiUrl, { headers }).then(r => r.json()).catch(() => null);
    const body = { message: `upload ${filename}`, content: b64 };
    if (existing?.sha) body.sha = existing.sha;
    const r = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.content) { console.warn('[FotoFlip] GitHub upload failed:', JSON.stringify(j)); return ''; }
    return `https://cdn.jsdelivr.net/gh/${repo}@main/images/${filename}`;
  } catch (e) {
    console.warn('[FotoFlip] GitHub upload failed:', e.message);
    return '';
  }
}

async function cloudinaryUpload(source, itemId) {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) return '';
    const imgData = Buffer.isBuffer(source) ? source : await fs.readFile(source);
    const b64 = imgData.toString('base64');
    const publicId = `fotoflip/item-${itemId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const str = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const crypto = require('crypto');
    const signature = crypto.createHash('sha1').update(str).digest('hex');
    const form = new URLSearchParams({
      file: `data:image/jpeg;base64,${b64}`,
      api_key: apiKey,
      timestamp: timestamp.toString(),
      public_id: publicId,
      overwrite: 'true',
      signature,
    });
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form });
    const j = await r.json();
    if (!j.secure_url) { console.warn('[FotoFlip] Cloudinary upload failed:', JSON.stringify(j)); return ''; }
    return j.secure_url;
  } catch (e) {
    console.warn('[FotoFlip] Cloudinary upload failed:', e.message);
    return '';
  }
}

async function uploadImage(source, itemId) {
  const url = await cloudinaryUpload(source, itemId);
  if (url) return url;
  // fallback to GitHub
  const filename = `item-${itemId}-labeled.jpg`;
  return await githubUpload(source, filename);
}

const POSHMARK_HEADERS = ['SKU','ProductID (GTIN)','Title','Description','Department','Category','Sub-category','Quantity','Size','Condition','Brand','Color1','Color2','VariantGroupID','VariantType','VariantAttribute','Style Tag1','Style Tag2','Style Tag3','Orig price','Listing price','Shipping Discount','Price Floor Percent','Minimum Price','Availability','Drop time','Other info','Copy Listing?','Update Existing SKU?','NEW SKU','Primary image','Alt image 1','Alt image 2','Alt image 3','Alt image 4','Alt image 5','Alt image 6','Alt image 7','Alt image 8','Alt image 9','Alt image 10','Alt image 11','Alt image 12','Alt image 13','Alt image 14','Alt image 15'];

function buildPoshmarkRow(item, meta, imageUrl, q) {
  const { dept, cat, subcat } = poshmarkCategoryMap(meta.category || '');
  const condition = poshmarkCondition(meta.conditionText);
  const title = (meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim()).slice(0, 80);
  const description = (meta.description || meta.conditionNotes || '').replace(/\n/g, ' ').slice(0, 1490);
  const price = parseFloat(meta.suggestedPrice) || 25;
  const origPrice = parseFloat(meta.msrp) || Math.round(price * 2);
  const sku = buildSku(item.id, meta);
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const size = poshmarkSize(meta.category);
  const rawColor = meta.color || '';
  const colorParts = rawColor.split(/\s*[—–\-\/,]\s*/);
  const firstIsMulti = /multi|mixed|rainbow|various|assorted/i.test(colorParts[0]);
  let color1, color2;
  if (firstIsMulti) {
    color1 = (colorParts[1] ? poshmarkColor(colorParts[1]) : '') || 'Gold';
    color2 = '';
  } else {
    color1 = poshmarkColor(colorParts[0]) || (colorParts[1] ? poshmarkColor(colorParts[1]) : '') || 'Gold';
    const c2 = colorParts[1] ? poshmarkColor(colorParts[1]) : '';
    color2 = (c2 && c2 !== color1) ? c2 : '';
  }

  const row = new Array(46).fill('');
  row[0]  = q(sku);
  row[2]  = q(title);
  row[3]  = q(description);
  row[4]  = q(dept);
  row[5]  = q(cat);
  row[6]  = q(subcat);
  row[7]  = 1;
  row[8]  = q(size);
  row[9]  = q(condition);
  row[10] = q(meta.brand || '');
  row[11] = q(color1);
  row[12] = q(color2);
  row[16] = q((tags[0] || '').slice(0, 25));
  row[17] = q((tags[1] || '').slice(0, 25));
  row[18] = q((tags[2] || '').slice(0, 25));
  row[19] = origPrice;
  row[20] = price;
  row[24] = 'For Sale';
  row[26] = q(meta.box || '');
  row[30] = q(imageUrl);
  return row.join(',');
}

// ── Poshmark single-item CSV export ──────────────────────────────────────────

app.post('/api/items/:id/export/poshmark', async (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
  const q = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };

  let imageUrl = meta.imgbbUrl || '';
  if (!imageUrl) {
    const labeledPath = path.join(__dirname, 'processed', `item-${item.id}-labeled.jpg`);
    const uploadSource = (item.is_bundle && require('fs').existsSync(labeledPath)) ? labeledPath : photo.processed_path;
    if (uploadSource) {
      imageUrl = await uploadImage(uploadSource, item.id);
      if (imageUrl) {
        meta.imgbbUrl = imageUrl;
        db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photo.id);
      }
    }
  }

  const csv = [POSHMARK_HEADERS.join(','), buildPoshmarkRow(item, meta, imageUrl, q)].join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="poshmark-${item.id}.csv"`);
  res.send(csv);
});

// ── Poshmark bulk CSV export ──────────────────────────────────────────────────

app.get('/api/export/poshmark', async (req, res) => {
  const db = getDb();
  const items = db.prepare(`SELECT * FROM items WHERE processing_status = 'done' ORDER BY id`).all();
  if (!items.length) return res.status(400).json({ error: '🌸 No ready items to export' });

  const q = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const rows = [];

  for (const item of items) {
    const photoIds = JSON.parse(item.photo_ids || '[]');
    const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
    if (!photo) continue;
    const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
    let imageUrl = meta.imgbbUrl || '';
    if (!imageUrl) {
      const labeledPath = path.join(__dirname, 'processed', `item-${item.id}-labeled.jpg`);
      const uploadSource = (item.is_bundle && require('fs').existsSync(labeledPath)) ? labeledPath : photo.processed_path;
      if (uploadSource) {
        imageUrl = await uploadImage(uploadSource, item.id);
        if (imageUrl) {
          meta.imgbbUrl = imageUrl;
          db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photo.id);
        }
      }
    }
    rows.push(buildPoshmarkRow(item, meta, imageUrl, q));
  }

  const today = new Date().toISOString().slice(0,10);
  const csv = [POSHMARK_HEADERS.join(','), ...rows].join('\r\n') + '\r\n';

  // Write to listings table
  const userId = getUserId(req);
  const upsertListing = db.prepare(`
    INSERT INTO listings (user_id, item_id, platform, status, published_at, source)
    VALUES (?, ?, 'poshmark', 'published', ?, 'manual')
    ON CONFLICT(item_id, platform) DO UPDATE SET status='published', published_at=excluded.published_at
  `);
  try {
    const insertAll = db.transaction(() => { for (const item of items) upsertListing.run(userId, item.id, today); });
    insertAll();
  } catch (_) {}

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="poshmark-bulk-${today}.csv"`);
  res.setHeader('X-Export-Item-Ids', JSON.stringify(items.map(i => i.id)));
  res.send(csv);
});

function whatnotCategoryMap(cat) {
  if (cat.includes('necklace') || cat.includes('pendant') || cat.includes('charm')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('bracelet')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('earring')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('ring')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('brooch') || cat.includes('pin')) return { whatnotCat: 'Jewelry', whatnotSub: 'Vintage & Antique Jewelry' };
  if (cat.includes('watch')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('jewel')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('tote') || cat.includes('crossbody') || cat.includes('wallet') || cat.includes('clutch') || cat.includes('satchel') || cat.includes('backpack') || cat.includes('handbag') || cat.includes('purse')) return { whatnotCat: 'Bags & Accessories', whatnotSub: 'Midrange & Fashion Bags' };
  if (cat.includes('toy') || cat.includes('lego')) return { whatnotCat: 'Action Figures', whatnotSub: 'Other Action Figures' };
  if (cat.includes('collectible')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  if (cat.includes('accessory') || cat.includes('accessories')) return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
  return { whatnotCat: 'Jewelry', whatnotSub: 'Contemporary Costume' };
}

function whatnotDescription(meta) {
  const full = meta.description || meta.conditionNotes || '';
  const hook = full.split('\n').find(l => l.trim().length > 0) || full.slice(0, 200);
  const condition = meta.conditionNotes ? meta.conditionNotes.split('.')[0].trim() + '.' : '';
  return `${hook.trim()} ${condition} Final sale — no returns/exchanges due to item switchouts on lots.`.trim();
}

function whatnotCondition(t) {
  const c = (t||'').toLowerCase();
  if (c.includes('nwt') || c.includes('new with tag')) return 'New with box';
  if (c.includes('nwot') || c.includes('new without tag')) return 'New without box';
  if (c.includes('excellent') || c.includes('very good')) return 'Pre-owned - Excellent';
  if (c.includes('good')) return 'Pre-owned - Good';
  if (c.includes('fair')) return 'Pre-owned - Fair';
  if (c.includes('poor')) return 'Pre-owned - Damaged';
  return 'Pre-owned - Good';
}

function whatnotShipping(meta) {
  return '4-7 oz';
}

// ── Etsy OAuth + Listing ──────────────────────────────────────────────────────

const ETSY_API_KEY    = process.env.ETSY_API_KEY;
const ETSY_SECRET     = process.env.ETSY_SHARED_SECRET;
const ETSY_REDIRECT   = `${process.env.APP_URL || 'http://localhost:3456'}/auth/etsy/callback`;
const ETSY_SCOPES     = 'listings_w listings_r';

// PKCE helpers
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// In-memory store for PKCE state (single-user desktop app)
let etsyPKCE = null;

// Step 1 — redirect user to Etsy to authorize
app.get('/auth/etsy', (req, res) => {
  if (!ETSY_API_KEY) return res.status(500).send('ETSY_API_KEY not configured');
  const { verifier, challenge } = generatePKCE();
  const state = base64url(crypto.randomBytes(16));
  etsyPKCE = { verifier, state };

  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: ETSY_REDIRECT,
    scope: ETSY_SCOPES,
    client_id: ETSY_API_KEY,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  res.redirect(`https://www.etsy.com/oauth/connect?${params}`);
});

// Step 2 — Etsy redirects back with code
app.get('/auth/etsy/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!etsyPKCE || state !== etsyPKCE.state) return res.status(400).send('Invalid state');

  try {
    const tokenRes = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ETSY_API_KEY,
        redirect_uri: ETSY_REDIRECT,
        code,
        code_verifier: etsyPKCE.verifier,
      }),
    });

    const token = await tokenRes.json();
    if (!token.access_token) throw new Error(JSON.stringify(token));

    // Save tokens to settings DB
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('etsy_access_token',?)`).run(token.access_token);
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('etsy_refresh_token',?)`).run(token.refresh_token || '');
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('etsy_user_id',?)`).run(String(token.access_token.split('.')[0]));
    etsyPKCE = null;

    // Get shop ID
    const meRes = await fetch('https://api.etsy.com/v3/application/users/me', {
      headers: { 'x-api-key': ETSY_API_KEY, 'Authorization': `Bearer ${token.access_token}` },
    });
    const me = await meRes.json();
    if (me.shop_id) {
      db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('etsy_shop_id',?)`).run(String(me.shop_id));
    }

    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>✓ Etsy connected!</h2>
      <p>Shop ID: ${me.shop_id || 'saved'}</p>
      <p><a href="/">Return to FotoFlip</a></p>
    </body></html>`);
  } catch (err) {
    res.status(500).send(`OAuth error: ${err.message}`);
  }
});

// Etsy connection status
app.get('/api/etsy/status', (req, res) => {
  const db = getDb();
  const token = db.prepare(`SELECT value FROM settings WHERE key='etsy_access_token'`).get();
  const shopId = db.prepare(`SELECT value FROM settings WHERE key='etsy_shop_id'`).get();
  res.json({ connected: !!(token?.value), shopId: shopId?.value || null });
});

// Upload item to Etsy as draft listing
app.post('/api/items/:id/export/etsy', async (req, res) => {
  const db = getDb();
  const token = db.prepare(`SELECT value FROM settings WHERE key='etsy_access_token'`).get()?.value;
  const shopId = db.prepare(`SELECT value FROM settings WHERE key='etsy_shop_id'`).get()?.value;
  if (!token || !shopId) return res.status(400).json({ error: '🌸 Etsy not connected — click Connect Etsy first' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};

  const title = (meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim()).slice(0, 140);
  const description = meta.description || meta.conditionNotes || 'See photos for details.';
  const price = parseFloat(meta.suggestedPrice) || 25;
  const tags = Array.isArray(meta.tags) ? meta.tags.slice(0, 13).map(t => t.slice(0, 20)) : [];
  const { etsyTaxonomyId } = etsyCategoryMap(meta.category || '');

  const authHeader = `Bearer ${token}`;
  const apiKeyHeader = `${ETSY_API_KEY}:${ETSY_SECRET}`;

  try {
    // Create draft listing
    const listingBody = new URLSearchParams({
      quantity: '1',
      title,
      description,
      price: price.toFixed(2),
      who_made: 'someone_else',
      when_made: 'made_to_order',
      taxonomy_id: String(etsyTaxonomyId),
      state: 'draft',
      ...(tags.length ? { tags: tags.join(',') } : {}),
    });

    const listingRes = await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKeyHeader,
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: listingBody,
    });

    const listing = await listingRes.json();
    if (!listing.listing_id) throw new Error(listing.error || JSON.stringify(listing));

    // Upload processed photo
    const imgPath = photo.processed_path;
    if (imgPath) {
      try {
        const imgData = await fs.readFile(imgPath);
        const boundary = `----FormBoundary${crypto.randomBytes(8).toString('hex')}`;
        const imgName = path.basename(imgPath);
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${imgName}"\r\nContent-Type: image/jpeg\r\n\r\n`),
          imgData,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        await fetch(`https://api.etsy.com/v3/application/shops/${shopId}/listings/${listing.listing_id}/images`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKeyHeader,
            'Authorization': authHeader,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        });
      } catch (imgErr) {
        console.warn('[FotoFlip] Etsy image upload failed:', imgErr.message);
      }
    }

    const draftUrl = `https://www.etsy.com/your/shops/me/listings/${listing.listing_id}/edit`;
    res.json({ success: true, listingId: listing.listing_id, url: draftUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function etsyCategoryMap(category) {
  const c = category.toLowerCase();
  if (c.includes('necklace') || c.includes('pendant')) return { etsyTaxonomyId: 1229 };
  if (c.includes('bracelet')) return { etsyTaxonomyId: 1232 };
  if (c.includes('earring')) return { etsyTaxonomyId: 1233 };
  if (c.includes('ring')) return { etsyTaxonomyId: 1230 };
  if (c.includes('brooch') || c.includes('pin')) return { etsyTaxonomyId: 1234 };
  if (c.includes('watch')) return { etsyTaxonomyId: 164 };
  if (c.includes('jewel') || c.includes('charm')) return { etsyTaxonomyId: 1228 };
  if (c.includes('tote') || c.includes('handbag') || c.includes('purse') || c.includes('bag')) return { etsyTaxonomyId: 1716 };
  if (c.includes('wallet')) return { etsyTaxonomyId: 1717 };
  if (c.includes('backpack')) return { etsyTaxonomyId: 1720 };
  return { etsyTaxonomyId: 1 };
}

// ── Make.com relay ────────────────────────────────────────────────────────────

app.post('/api/items/:id/export/make', async (req, res) => {
  const db = getDb();
  const webhookUrl = db.prepare(`SELECT value FROM settings WHERE key='make_webhook_url'`).get()?.value;
  if (!webhookUrl) return res.status(400).json({ error: '🌸 Make.com webhook not configured — add it in Settings' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};

  // Upload image to ImgBB for Make.com to use
  let imageUrl = '';
  const imgbbKey = process.env.IMGBB_API_KEY;
  if (imgbbKey && photo.processed_path) {
    try {
      const imgData = await fs.readFile(photo.processed_path);
      const b64 = imgData.toString('base64');
      const form = new URLSearchParams({ key: imgbbKey, image: b64 });
      const r = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
      const j = await r.json();
      if (j.data?.url) imageUrl = j.data.url;
    } catch (e) {
      console.warn('[FotoFlip] ImgBB upload failed:', e.message);
    }
  }

  const payload = {
    title: meta.title || `${meta.brand || 'Item'} ${meta.category || ''}`.trim(),
    description: meta.description || meta.conditionNotes || '',
    price: parseFloat(meta.suggestedPrice) || 25,
    quantity: 1,
    brand: meta.brand || '',
    category: meta.category || '',
    condition: meta.conditionText || meta.condition || '',
    color: meta.color || '',
    material: meta.material || '',
    size: meta.size || '',
    sku: buildSku(item.id, meta),
    tags: Array.isArray(meta.tags) ? meta.tags.join(',') : '',
    imageUrl,
    itemId: item.id,
  };

  try {
    const makeRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!makeRes.ok) throw new Error(`Make responded ${makeRes.status}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Normalize all titles: strip leading/trailing emoji, wrap with ⚜️ … 🩷
app.post('/api/admin/normalize-titles', (req, res) => {
  const db = getDb();
  const photos = db.prepare(`SELECT id, metadata FROM photos WHERE metadata IS NOT NULL`).all();
  let done = 0, skipped = 0;
  for (const photo of photos) {
    try {
      const meta = JSON.parse(photo.metadata);
      if (!meta.title) { skipped++; continue; }
      const clean = meta.title
        .replace(/^[\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}️\s]+/gu, '')
        .replace(/[\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}️\s]+$/gu, '')
        .trim();
      if (!clean) { skipped++; continue; }
      meta.title = `⚜️ ${clean} 🩷`;
      if (meta.imgbbUrl) delete meta.imgbbUrl;
      db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photo.id);
      done++;
    } catch { skipped++; }
  }
  res.json({ done, skipped });
});

// Batch regenerate all bundle labeled images + clear Cloudinary cache
app.post('/api/admin/regenerate-labels', async (req, res) => {
  const db = getDb();
  const items = db.prepare(`SELECT * FROM items WHERE is_bundle = 1`).all();
  let done = 0, skipped = 0, errors = [];
  for (const item of items) {
    try {
      const photoIds = JSON.parse(item.photo_ids || '[]');
      const photo = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
      if (!photo?.path) { skipped++; continue; }
      const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
      const { main, sub } = getBundleLabel(meta, item);
      const buf = await applyBundleLabel(photo.path, main, sub);
      const labeledPath = require('path').join(PROCESSED_DIR, `item-${item.id}-labeled.jpg`);
      await fs.writeFile(labeledPath, buf);
      // Clear Cloudinary cache so it re-uploads on next export
      if (meta.imgbbUrl) {
        delete meta.imgbbUrl;
        db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photo.id);
      }
      done++;
    } catch (e) {
      errors.push({ id: item.id, err: e.message });
    }
  }
  res.json({ done, skipped, errors });
});

// Save Make webhook URL
app.post('/api/settings/make-webhook', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('https://hook.')) return res.status(400).json({ error: '🌸 Invalid webhook URL — must start with https://hook.' });
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('make_webhook_url',?)`).run(url);
  res.json({ success: true });
});

app.get('/api/settings/make-webhook', (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key='make_webhook_url'`).get();
  res.json({ url: row?.value || '' });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

function toPublicUrl(filePath) {
  if (!filePath) return null;
  if (filePath.includes('/processed/')) return '/processed/' + filePath.split('/processed/').pop();
  if (filePath.includes('/uploads/'))   return '/uploads/'   + filePath.split('/uploads/').pop();
  return null;
}

app.get('/api/dashboard', (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  const userFilter = userId ? `WHERE user_id = ${userId}` : `WHERE 1=1`;
  const userAnd    = userId ? `AND user_id = ${userId}` : '';

  const stats = {
    total:      db.prepare(`SELECT COUNT(*) as n FROM items ${userFilter}`).get().n,
    ready:      db.prepare(`SELECT COUNT(*) as n FROM items ${userFilter} AND inv_status = 'ready'`.replace('WHERE 1=1 AND', 'WHERE').replace('WHERE user_id', 'WHERE user_id')).get().n,
    listed:     db.prepare(`SELECT COUNT(*) as n FROM listings WHERE status = 'published' ${userAnd}`).get().n,
    sold:       db.prepare(`SELECT COUNT(*) as n FROM listings WHERE status = 'sold' ${userAnd}`).get().n,
    shipped:    db.prepare(`SELECT COUNT(*) as n FROM items ${userFilter} AND inv_status = 'shipped'`.replace('WHERE 1=1 AND', 'WHERE')).get().n,
    platforms:  db.prepare(`SELECT COUNT(DISTINCT platform) as n FROM listings WHERE status = 'published' ${userAnd}`).get().n,
  };

  const makeUrl = db.prepare(`SELECT value FROM settings WHERE key='make_webhook_url'`).get()?.value || null;
  const platforms = {
    poshmark: { connected: true, count: db.prepare(`SELECT COUNT(*) as n FROM listings WHERE platform='poshmark' AND status='published' ${userAnd}`).get().n },
    whatnot:  { connected: true, count: db.prepare(`SELECT COUNT(*) as n FROM listings WHERE platform='whatnot'  AND status='published' ${userAnd}`).get().n },
    etsy:     { connected: !!makeUrl },
  };

  // Empty state for new users
  if (stats.total === 0) {
    return res.json({ stats, recentImports: [], recentActivity: [], draftQueue: [], platforms, isEmpty: true });
  }

  // Load last 100 items scoped to user
  const recentItems = userId
    ? db.prepare(`SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(userId)
    : db.prepare(`SELECT * FROM items ORDER BY created_at DESC LIMIT 100`).all();
  const firstPhotoIds = [...new Set(
    recentItems.map(i => { try { return JSON.parse(i.photo_ids || '[]')[0]; } catch { return null; } }).filter(Boolean)
  )];
  const photoMap = firstPhotoIds.length
    ? Object.fromEntries(
        db.prepare(`SELECT * FROM photos WHERE id IN (${firstPhotoIds.map(() => '?').join(',')})`)
          .all(...firstPhotoIds).map(p => [p.id, p])
      )
    : {};

  // Group by box → recent imports
  const boxMap = new Map();
  for (const item of recentItems) {
    const firstId = JSON.parse(item.photo_ids || '[]')[0];
    const photo = firstId ? photoMap[firstId] : null;
    const meta = photo?.metadata ? JSON.parse(photo.metadata) : {};
    const box = meta.box || 'Unboxed';
    if (!boxMap.has(box)) boxMap.set(box, { box, count: 0, latestDate: item.created_at, thumbs: [] });
    const entry = boxMap.get(box);
    entry.count++;
    if (item.created_at > entry.latestDate) entry.latestDate = item.created_at;
    if (entry.thumbs.length < 4) {
      const url = toPublicUrl(photo?.processed_path || photo?.path);
      if (url) entry.thumbs.push(url);
    }
  }

  const recentImports = [...boxMap.values()]
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate))
    .slice(0, 3);

  // Synthetic activity feed
  const activity = recentImports.map(imp => ({
    type: 'import',
    label: `Import completed: ${imp.box} (${imp.count} item${imp.count !== 1 ? 's' : ''})`,
    date: imp.latestDate,
  }));

  const poshCount = db.prepare(`SELECT COUNT(*) as n FROM items WHERE poshmark_exported = 1`).get().n;
  const whatCount = db.prepare(`SELECT COUNT(*) as n FROM items WHERE whatnot_exported = 1`).get().n;
  const latestExport = db.prepare(`SELECT date_listed FROM items WHERE date_listed IS NOT NULL ORDER BY date_listed DESC LIMIT 1`).get();

  if (poshCount && latestExport) activity.push({ type: 'poshmark', label: `Poshmark CSV generated (${poshCount} item${poshCount !== 1 ? 's' : ''})`, date: latestExport.date_listed });
  if (whatCount && latestExport) activity.push({ type: 'whatnot', label: `Whatnot CSV generated (${whatCount} item${whatCount !== 1 ? 's' : ''})`, date: latestExport.date_listed });

  // Draft queue — items needing attention
  const draftRows = userId
    ? db.prepare(`SELECT * FROM items WHERE user_id = ? AND inv_status = 'draft' ORDER BY created_at DESC LIMIT 5`).all(userId)
    : db.prepare(`SELECT * FROM items WHERE inv_status = 'draft' ORDER BY created_at DESC LIMIT 5`).all();
  const draftFirstIds = draftRows.map(i => { try { return JSON.parse(i.photo_ids||'[]')[0]; } catch { return null; } }).filter(Boolean);
  const draftPhotoMap = draftFirstIds.length
    ? Object.fromEntries(db.prepare(`SELECT * FROM photos WHERE id IN (${draftFirstIds.map(()=>'?').join(',')})`).all(...draftFirstIds).map(p => [p.id, p]))
    : {};
  const draftQueue = draftRows.map(item => {
    const firstId = JSON.parse(item.photo_ids||'[]')[0];
    const photo = firstId ? draftPhotoMap[firstId] : null;
    const meta = photo?.metadata ? JSON.parse(photo.metadata) : {};
    return { id: item.id, sku: item.sku, title: meta.title || 'Untitled', thumb: toPublicUrl(photo?.processed_path || photo?.path) || null, created_at: item.created_at };
  });

  res.json({
    stats,
    recentImports,
    recentActivity: activity.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    draftQueue,
    platforms,
  });
});

// ── Markets API ───────────────────────────────────────────────────────────────

app.get('/api/markets', (req, res) => {
  const db = getDb();

  const ready    = db.prepare(`SELECT COUNT(*) as n FROM items WHERE processing_status='done'`).get().n;
  const failed   = db.prepare(`SELECT COUNT(*) as n FROM items WHERE processing_status='failed'`).get().n;
  const review   = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status='review'`).get().n;

  const poshExported  = db.prepare(`SELECT COUNT(*) as n FROM items WHERE poshmark_exported=1`).get().n;
  const whatExported  = db.prepare(`SELECT COUNT(*) as n FROM items WHERE whatnot_exported=1`).get().n;
  const poshLastDate  = db.prepare(`SELECT MAX(date_listed) as d FROM items WHERE poshmark_exported=1`).get()?.d || null;
  const whatLastDate  = db.prepare(`SELECT MAX(date_listed) as d FROM items WHERE whatnot_exported=1`).get()?.d || null;

  const makeUrl   = db.prepare(`SELECT value FROM settings WHERE key='make_webhook_url'`).get()?.value || null;
  const etsyToken = db.prepare(`SELECT value FROM settings WHERE key='etsy_access_token'`).get()?.value || null;

  const errorRows = db.prepare(
    `SELECT id, photo_ids FROM items WHERE processing_status='failed' ORDER BY id DESC LIMIT 20`
  ).all();
  const allPhotos = db.prepare(`SELECT * FROM photos`).all();
  const photoMap = Object.fromEntries(allPhotos.map(p => [p.id, p]));
  const errorItems = errorRows.map(r => {
    const photoIds = JSON.parse(r.photo_ids || '[]');
    const photo = photoMap[photoIds[0]];
    const m = photo?.metadata ? JSON.parse(photo.metadata) : {};
    return { id: r.id, title: m.title || '' };
  });

  const historyRows = db.prepare(`
    SELECT date_listed,
           SUM(poshmark_exported) as posh,
           SUM(whatnot_exported)  as whatnot
    FROM items
    WHERE date_listed IS NOT NULL AND (poshmark_exported=1 OR whatnot_exported=1)
    GROUP BY date_listed
    ORDER BY date_listed DESC
    LIMIT 10
  `).all();

  const connectedCount = 2 + (makeUrl ? 1 : 0);
  const lastExport = [poshLastDate, whatLastDate].filter(Boolean).sort().pop() || null;

  res.json({
    summary: { ready, errors: failed + review, connectedCount, lastExport },
    platforms: {
      poshmark: {
        ready,
        exported: poshExported,
        lastExport: poshLastDate,
        fields: ['title', 'description', 'category', 'brand', 'size', 'price'],
      },
      whatnot: {
        ready,
        exported: whatExported,
        lastExport: whatLastDate,
        fields: ['title', 'description', 'category', 'price', 'image URLs'],
      },
      etsy: {
        connected: !!(makeUrl || etsyToken),
        webhookUrl: makeUrl,
        fields: ['title', 'description', 'price', 'tags', 'category'],
      },
    },
    exportHistory: historyRows,
    errorItems,
  });
});

// ── Inventory API ─────────────────────────────────────────────────────────────

app.get('/api/inventory', (req, res) => {
  const db = getDb();
  const { status, search } = req.query;

  let query = `SELECT * FROM items`;
  const params = [];
  const clauses = [];

  if (status && status !== 'all') {
    clauses.push(`inv_status = ?`);
    params.push(status);
  }

  if (clauses.length) query += ` WHERE ` + clauses.join(' AND ');
  query += ` ORDER BY created_at DESC`;

  const items = db.prepare(query).all(...params);
  const photos = db.prepare(`SELECT * FROM photos`).all();
  const photoMap = Object.fromEntries(photos.map(p => [p.id, p]));

  let result = items.map(item => {
    const photoIds = JSON.parse(item.photo_ids || '[]');
    const photo = photoMap[photoIds[0]] || null;
    const meta = photo?.metadata ? JSON.parse(photo.metadata) : {};
    return { ...item, meta, thumbPath: photo?.processed_path || photo?.path || null };
  });

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(item =>
      (item.meta.title || '').toLowerCase().includes(q) ||
      buildSku(item.id, item.meta).toLowerCase().includes(q) ||
      (item.location || '').toLowerCase().includes(q)
    );
  }

  res.json(result);
});

// Inventory stats
app.get('/api/inventory/stats', (req, res) => {
  const db = getDb();
  const total    = db.prepare(`SELECT COUNT(*) as n FROM items`).get().n;
  const ready    = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = 'ready'`).get().n;
  const listed   = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = 'listed'`).get().n;
  const sold     = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = 'sold'`).get().n;
  const shipped  = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = 'shipped'`).get().n;
  const archived = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = 'archived'`).get().n;
  const review   = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = 'review'`).get().n;
  const draft    = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = 'draft'`).get().n;
  res.json({ total, ready, listed, sold, shipped, archived, review, draft });
});

// Update a single item's inventory fields
app.put('/api/items/:id/inventory', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: '🌸 Item not found' });

  const allowed = ['location', 'inv_status', 'date_listed', 'date_sold', 'date_shipped', 'poshmark_exported', 'whatnot_exported', 'etsy_exported'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: '🌸 No valid fields to update' });

  for (const [col, val] of updates) {
    db.prepare(`UPDATE items SET ${col} = ? WHERE id = ?`).run(val, req.params.id);
  }
  res.json({ success: true });
});

// Bulk update inventory fields for multiple items
app.put('/api/inventory/bulk', (req, res) => {
  const db = getDb();
  const { ids, ...fields } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '🌸 No item IDs provided' });

  const allowed = ['location', 'inv_status', 'date_listed', 'date_sold', 'date_shipped', 'poshmark_exported', 'whatnot_exported', 'etsy_exported'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: '🌸 No valid fields to update' });

  const setClauses = updates.map(([col]) => `${col} = ?`).join(', ');
  const setValues = updates.map(([, v]) => v);
  const placeholders = ids.map(() => '?').join(',');

  db.prepare(`UPDATE items SET ${setClauses} WHERE id IN (${placeholders})`).run(...setValues, ...ids);

  // Propagate sold/shipped to listings table
  const newStatus = fields.inv_status;
  if (newStatus === 'sold' || newStatus === 'shipped') {
    const soldAt = fields.date_sold || fields.date_shipped || new Date().toISOString().slice(0,10);
    const listingPlaceholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE listings SET status = 'sold', sold_at = ? WHERE item_id IN (${listingPlaceholders})`)
      .run(soldAt, ...ids);
  }

  res.json({ success: true, updated: ids.length });
});

// ── Listings API ──────────────────────────────────────────────────────────────

app.get('/api/listings', (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  const { platform, status } = req.query;
  let query = `SELECT l.*, i.photo_ids FROM listings l JOIN items i ON i.id = l.item_id WHERE 1=1`;
  const params = [];
  if (userId) { query += ` AND l.user_id = ?`; params.push(userId); }
  if (platform) { query += ` AND l.platform = ?`; params.push(platform); }
  if (status)   { query += ` AND l.status = ?`;   params.push(status); }
  query += ` ORDER BY l.created_at DESC`;
  res.json(db.prepare(query).all(...params));
});

app.post('/api/listings', (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  const { item_id, platform, status, price, published_at, source } = req.body;
  if (!item_id || !platform) return res.status(400).json({ error: '🌸 item_id and platform are required' });
  const existing = db.prepare(`SELECT id FROM listings WHERE item_id = ? AND platform = ?`).get(item_id, platform);
  if (existing) {
    db.prepare(`UPDATE listings SET status = ?, price = ?, published_at = ? WHERE id = ?`)
      .run(status || 'published', price, published_at, existing.id);
    return res.json({ id: existing.id, updated: true });
  }
  const result = db.prepare(
    `INSERT INTO listings (user_id, item_id, platform, status, price, published_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, item_id, platform, status || 'published', price, published_at, source || 'manual');
  res.json({ id: result.lastInsertRowid, created: true });
});

app.put('/api/listings/:id', (req, res) => {
  const db = getDb();
  const allowed = ['status', 'price', 'platform_listing_id', 'published_at', 'sold_at', 'error_message'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: '🌸 No valid fields to update' });
  const setClauses = updates.map(([k]) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE listings SET ${setClauses} WHERE id = ?`).run(...updates.map(([,v]) => v), req.params.id);
  res.json({ success: true });
});

// When item is marked sold/shipped, propagate to all its listings
app.post('/api/items/:id/sold', (req, res) => {
  const db = getDb();
  const { date_sold, date_shipped } = req.body;
  const inv_status = date_shipped ? 'shipped' : 'sold';
  db.prepare(`UPDATE items SET inv_status = ?, date_sold = ?, date_shipped = ? WHERE id = ?`)
    .run(inv_status, date_sold || null, date_shipped || null, req.params.id);
  db.prepare(`UPDATE listings SET status = 'sold', sold_at = ? WHERE item_id = ?`)
    .run(date_sold || date_shipped, req.params.id);
  res.json({ success: true });
});

// ── User Profile API ───────────────────────────────────────────────────────────

app.get('/api/profile', (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  if (!userId) return res.json({});
  const profile = db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(userId);
  res.json(profile || { user_id: userId });
});

app.put('/api/profile', (req, res) => {
  const db = getDb();
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: '🌸 Not authenticated' });
  const allowed = ['business_name','seller_handle','default_listing_style','default_condition_notes','shipping_zip','timezone'];
  const fields = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: '🌸 No valid fields' });
  const existing = db.prepare(`SELECT user_id FROM user_profiles WHERE user_id = ?`).get(userId);
  if (existing) {
    const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE user_profiles SET ${setClauses}, updated_at = datetime('now') WHERE user_id = ?`)
      .run(...fields.map(([,v]) => v), userId);
  } else {
    const keys = ['user_id', ...fields.map(([k]) => k)].join(', ');
    const vals = '?, '.repeat(fields.length + 1).slice(0, -2);
    db.prepare(`INSERT INTO user_profiles (${keys}) VALUES (${vals})`)
      .run(userId, ...fields.map(([,v]) => v));
  }
  res.json({ success: true });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  initDb();
  app.listen(PORT, () => {
    console.log(`\nFotoFlip running at http://localhost:${PORT}\n`);
  });
})();
