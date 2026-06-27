const express  = require('express');
const path     = require('path');
const fs       = require('fs').promises;
const { getDb, syncItemMeta }  = require('../db');
const { getUserId } = require('../auth');
const { processItem } = require('../processor');
const { resolvePhotoUrl, cloudinaryUpload, cloudinaryDestroy, applyBundleLabel, getBundleLabel } = require('../lib/images');
const { buildSku } = require('../lib/csv');
const { PROCESSED_DIR, logError } = require('../lib/config');

const router = express.Router();

// SEC-001: verify the requesting user owns the item (admin exempt in dev mode)
function ownershipCheck(req, item, res) {
  const userId = getUserId(req);
  if (userId && item.user_id !== userId) {
    res.status(403).json({ error: '🌸 You do not have access to this item' });
    return false;
  }
  return true;
}

router.get('/api/items', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const items  = userId
    ? db.prepare(`SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC`).all(userId)
    : db.prepare(`SELECT * FROM items ORDER BY created_at DESC`).all();
  const photos = userId
    ? db.prepare(`SELECT * FROM photos WHERE user_id = ?`).all(userId)
    : db.prepare(`SELECT * FROM photos`).all();
  const photoMap = Object.fromEntries(photos.map(p => [p.id, p]));

  res.json(items.map(item => ({
    ...item,
    photoIds: JSON.parse(item.photo_ids || '[]'),
    photos: JSON.parse(item.photo_ids || '[]').map(id => photoMap[id]).filter(Boolean).map(p => ({ ...p, url: resolvePhotoUrl(p, item.id) })),
  })));
});

router.post('/api/items', async (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const { photoIds, purchaseDate } = req.body;

  if (!photoIds || !photoIds.length) return res.status(400).json({ error: '🌸 No photos provided' });

  for (const photoId of photoIds) {
    const photo = db.prepare(`SELECT cloudinary_url FROM photos WHERE id = ?`).get(photoId);
    if (!photo?.cloudinary_url) return res.status(400).json({ error: '🌸 Photo not saved to cloud — upload may have failed. Please try again.' });
  }

  const date        = purchaseDate || new Date().toISOString().slice(0, 10);
  const isBundle    = req.body.is_bundle ? 1 : 0;
  const bundleType  = req.body.bundle_type || '';
  const bundleCount = parseInt(req.body.bundle_count) || 0;
  const weight      = req.body.weight || '';
  const weightUnit  = req.body.weight_unit || 'LB';
  const box         = req.body.box || '';
  const hint        = req.body.hint || '';

  const result = db
    .prepare(`INSERT INTO items (status, purchase_date, photo_ids, processing_status, is_bundle, bundle_type, bundle_count, weight, weight_unit, created_at, user_id) VALUES ('Flip', ?, ?, 'review', ?, ?, ?, ?, ?, datetime('now'), ?)`)
    .run(date, JSON.stringify(photoIds), isBundle, bundleType, bundleCount, weight, weightUnit, userId);

  const itemId = result.lastInsertRowid;
  for (const photoId of photoIds) {
    db.prepare(`UPDATE photos SET status = 'grouped' WHERE id = ?`).run(photoId);
    if (box || hint) {
      const photo = db.prepare('SELECT metadata FROM photos WHERE id = ?').get(photoId);
      const meta  = photo?.metadata ? JSON.parse(photo.metadata) : {};
      if (box)  meta.box  = box;
      if (hint) meta.hint = hint;
      db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), photoId);
    }
  }

  res.json({ id: itemId, photoIds });
});

router.get('/api/items/:id', (req, res) => {
  const db   = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photos   = photoIds.map(id => db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id)).filter(Boolean).map(p => ({ ...p, url: resolvePhotoUrl(p, item.id) }));
  res.json({ ...item, photoIds, photos });
});

router.post('/api/items/:id/process', async (req, res) => {
  const db   = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;
  const photoIds = JSON.parse(item.photo_ids || '[]');

  if (req.body.is_bundle !== undefined) {
    db.prepare(`UPDATE items SET is_bundle=?, bundle_type=?, bundle_count=? WHERE id=?`)
      .run(req.body.is_bundle ? 1 : 0, req.body.bundle_type || '', parseInt(req.body.bundle_count) || 0, req.params.id);
  }

  res.json({ processing: true });
  processItem(parseInt(req.params.id), photoIds, PROCESSED_DIR, cloudinaryUpload)
    .catch(err => logError(`Processing item ${req.params.id}`, err));
});

router.delete('/api/items/:id', async (req, res) => {
  const db   = getDb();
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;

  const photoIds = JSON.parse(item.photo_ids || '[]');
  for (const photoId of photoIds) {
    const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(photoId);
    if (photo) {
      await fs.unlink(photo.path).catch(() => {});
      if (photo.cloudinary_url) await cloudinaryDestroy(photo.cloudinary_url);
      db.prepare(`DELETE FROM photos WHERE id = ?`).run(photoId);
    }
  }

  if (item.bundle_label_url) await cloudinaryDestroy(item.bundle_label_url);
  db.prepare(`DELETE FROM listings WHERE item_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM items WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

router.get('/api/stats', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const filter = userId ? 'WHERE user_id = ?' : '';
  const args   = userId ? [userId] : [];
  const total     = db.prepare(`SELECT COUNT(*) as n FROM items ${filter}`).get(...args).n;
  const flips     = db.prepare(`SELECT COUNT(*) as n FROM items WHERE status = 'Flip'${userId ? ' AND user_id = ?' : ''}`).get(...args).n;
  const processed = db.prepare(`SELECT COUNT(*) as n FROM items WHERE processing_status = 'done'${userId ? ' AND user_id = ?' : ''}`).get(...args).n;
  res.json({ total, flips, processed });
});

router.put('/api/items/:id', (req, res) => {
  const db   = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;
  const { status, processing_status } = req.body;
  if (status)            db.prepare('UPDATE items SET status = ? WHERE id = ?').run(status, req.params.id);
  if (processing_status) db.prepare('UPDATE items SET processing_status = ? WHERE id = ?').run(processing_status, req.params.id);
  res.json({ success: true });
});

router.put('/api/items/:id/bundle', async (req, res) => {
  const db      = getDb();
  const current = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, current, res)) return;
  const { is_bundle, bundle_type, bundle_count, weight, weight_unit } = req.body;
  db.prepare('UPDATE items SET is_bundle=?, bundle_type=?, bundle_count=?, weight=?, weight_unit=? WHERE id=?')
    .run(
      is_bundle    !== undefined ? (is_bundle ? 1 : 0)             : current.is_bundle,
      bundle_type  !== undefined ? (bundle_type || '')              : current.bundle_type,
      bundle_count !== undefined ? (parseInt(bundle_count) || 0)   : current.bundle_count,
      weight       !== undefined ? (weight || '')                   : current.weight,
      weight_unit  !== undefined ? (weight_unit || 'LB')           : current.weight_unit,
      req.params.id
    );

  let bundle_label_url = null;
  if (is_bundle) {
    try {
      const item     = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      const photoIds = JSON.parse(item.photo_ids || '[]');
      const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
      if (photo) {
        const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
        // Prefer processed file (best quality); fall back to Cloudinary URL
        let imageSource = photo.cloudinary_url || meta.imgbbUrl;
        if (photo.processed_path) {
          try { await fs.access(photo.processed_path); imageSource = photo.processed_path; } catch {}
        }
        if (imageSource) {
          const { main, sub } = getBundleLabel(meta, item);
          const buf      = await applyBundleLabel(imageSource, main, sub);
          const labelUrl = await cloudinaryUpload(buf, `item-${req.params.id}-labeled`);
          if (labelUrl) {
            db.prepare('UPDATE items SET bundle_label_url = ? WHERE id = ?').run(labelUrl, req.params.id);
            bundle_label_url = labelUrl;
          }
          const labeledPath = path.join(PROCESSED_DIR, `item-${req.params.id}-labeled.jpg`);
          await fs.writeFile(labeledPath, buf).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[FotoFlip] Bundle label generation failed:', e.message);
    }
  }

  res.json({ success: true, bundle_label_url });
});

router.put('/api/items/:id/metadata', async (req, res) => {
  const db     = getDb();
  const item   = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;
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
  syncItemMeta(db, req.params.id);
  res.json({ success: true });
});

router.post('/api/items/:id/metadata/extract', async (req, res) => {
  const db     = getDb();
  const item   = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const { extractWithOpenAI } = require('../processor');
  try {
    const existing = photo.metadata ? JSON.parse(photo.metadata) : {};
    const metadata = await extractWithOpenAI(photo.path, existing.hint || '');
    const updated  = { ...existing, ...metadata };
    db.prepare('UPDATE photos SET metadata = ? WHERE id = ?').run(JSON.stringify(updated), photo.id);
    if (photo.processed_path) {
      const dir = path.dirname(photo.processed_path);
      await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(updated, null, 2)).catch(() => {});
    }
    syncItemMeta(db, req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/items/:id/listing/generate', async (req, res) => {
  const db     = getDb();
  const item   = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;
  const photoIds = JSON.parse(item.photo_ids || '[]');
  const photo    = photoIds.map(id => db.prepare('SELECT * FROM photos WHERE id = ?').get(id)).filter(Boolean)[0];
  if (!photo) return res.status(400).json({ error: 'No photos' });
  const metadata    = photo.metadata ? JSON.parse(photo.metadata) : {};
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) return res.status(400).json({ error: '🌸 No AI API key configured' });

  try {
    let imageData;
    let ext = photo.path?.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
    try {
      imageData = await fs.readFile(photo.path);
    } catch {
      if (!photo.cloudinary_url) return res.status(400).json({ error: '🌸 Photo file not found and no cloud backup available.' });
      const resp = await fetch(photo.cloudinary_url);
      imageData  = Buffer.from(await resp.arrayBuffer());
      ext        = photo.cloudinary_url.match(/\.png(\?|$)/i) ? 'image/png' : 'image/jpeg';
    }
    const base64 = imageData.toString('base64');
    const isBundle  = item.is_bundle;
    const weight    = item.weight || '';
    const weightUnit = item.weight_unit || 'LB';
    const weightStr = weight ? `${weight} ${weightUnit}` : '';

    const listingPrompt = `Write a resale listing for this item for the BocaBelle shop.

Known metadata: ${JSON.stringify(metadata)}${weightStr ? `\nWeight: ${weightStr}` : ''}
Is lot/bundle: ${isBundle ? 'yes' : 'no'}

TITLE RULES:
- Must begin with ⚜️ and end with 💗
- Maximum 80 characters total (including emojis)
- Individual item template: ⚜️ [Brand/Item Type] | [Style/Category] | [Size/Color/Hook] 💗
- Lot/bundle template: ⚜️ [Weight/Count + Lot Type] | [Key Contents] | Make Offer 💗
- Never use "Unknown" or "Resell Collect"
- "Make Offer" only for lots when it fits within the character limit

DESCRIPTION RULES:
- One paragraph only — no bullet points, no sections
- Use this exact template:
  ✨ Hi, thank you for looking. [One sentence about the product.] 💌 Make an offer, have it come to your house, and bundle to save. 💛 Sold as-is with no promise of anything specific or precious metals. Pieces are not cleaned in order to preserve their integrity. To protect against item switching, all lots are sold as-is and photographed as packed. Have fun treasure hunting! — BocaBelle
- Never include: "Unknown", "Might discover", "Please review photos", "Not tested for metal content"
- No keyword stuffing or long lists

FIELD RULES:
- Never use "Unknown" in any field
- brand: leave as empty string if not identifiable
- category: pick the closest match from the list
- size: empty string if not applicable
- color: empty string if unclear
- tags: 8–12 relevant search terms

Return JSON only — no markdown, no explanation:
{
  "title": "...",
  "description": "...",
  "brand": "...",
  "category": "one of: necklace|bracelet|ring|earrings|pendant|brooch|watch|tote|crossbody|wallet|clutch|satchel|handbag|backpack|clothing|shoes|accessory|toy|collectible|other",
  "tags": ["8 to 12 relevant search tags"]
}`;

    let text = '';
    if (anthropicKey) {
      const Anthropic = require('@anthropic-ai/sdk');
      const client    = new Anthropic.default({ apiKey: anthropicKey });
      const response  = await client.messages.create({
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
      const client     = new OpenAI({ apiKey: openaiKey });
      const response   = await client.chat.completions.create({
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
    syncItemMeta(db, req.params.id);
    res.json(listing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/items/:id/sold', (req, res) => {
  const db   = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!ownershipCheck(req, item, res)) return;
  const { date_sold, date_shipped } = req.body;
  const inv_status = date_shipped ? 'shipped' : 'sold';
  db.prepare(`UPDATE items SET inv_status = ?, date_sold = ?, date_shipped = ? WHERE id = ?`)
    .run(inv_status, date_sold || null, date_shipped || null, req.params.id);
  db.prepare(`UPDATE listings SET status = 'sold', sold_at = ? WHERE item_id = ?`)
    .run(date_sold || date_shipped, req.params.id);
  res.json({ success: true });
});

module.exports = router;
