const express   = require('express');
const { getDb, getUserSetting } = require('../db');
const { getUserId } = require('../auth');
const { resolvePhotoUrl } = require('../lib/images');
const { buildSku } = require('../lib/csv');

const router = express.Router();

function toPublicUrl(filePath) {
  if (!filePath) return null;
  if (filePath.includes('/processed/')) return '/processed/' + filePath.split('/processed/').pop();
  if (filePath.includes('/uploads/'))   return '/uploads/'   + filePath.split('/uploads/').pop();
  return null;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/api/dashboard', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const userFilter = userId ? `WHERE user_id = ${userId}` : `WHERE 1=1`;
  const userAnd    = userId ? `AND user_id = ${userId}` : '';

  const stats = {
    total:   db.prepare(`SELECT COUNT(*) as n FROM items ${userFilter}`).get().n,
    ready:   db.prepare(`SELECT COUNT(*) as n FROM items ${userFilter} AND inv_status = 'ready'`.replace('WHERE 1=1 AND', 'WHERE').replace('WHERE user_id', 'WHERE user_id')).get().n,
    listed:  db.prepare(`SELECT COUNT(*) as n FROM listings WHERE status = 'published' ${userAnd}`).get().n,
    sold:    db.prepare(`SELECT COUNT(*) as n FROM listings WHERE status = 'sold' ${userAnd}`).get().n,
    shipped: db.prepare(`SELECT COUNT(*) as n FROM items ${userFilter} AND inv_status = 'shipped'`.replace('WHERE 1=1 AND', 'WHERE')).get().n,
    platforms: db.prepare(`SELECT COUNT(DISTINCT platform) as n FROM listings WHERE status = 'published' ${userAnd}`).get().n,
  };

  const makeUrl = getUserSetting(db, userId, 'make_webhook_url');
  const platforms = {
    poshmark: { connected: true, count: db.prepare(`SELECT COUNT(*) as n FROM listings WHERE platform='poshmark' AND status='published' ${userAnd}`).get().n },
    whatnot:  { connected: true, count: db.prepare(`SELECT COUNT(*) as n FROM listings WHERE platform='whatnot'  AND status='published' ${userAnd}`).get().n },
    etsy:     { connected: !!makeUrl },
  };

  if (stats.total === 0) {
    return res.json({ stats, recentImports: [], recentActivity: [], draftQueue: [], platforms, isEmpty: true });
  }

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

  const boxMap = new Map();
  for (const item of recentItems) {
    const firstId = JSON.parse(item.photo_ids || '[]')[0];
    const photo   = firstId ? photoMap[firstId] : null;
    const meta    = photo?.metadata ? JSON.parse(photo.metadata) : {};
    const box     = meta.box || 'Unboxed';
    if (!boxMap.has(box)) boxMap.set(box, { box, count: 0, latestDate: item.created_at, thumbs: [] });
    const entry = boxMap.get(box);
    entry.count++;
    if (item.created_at > entry.latestDate) entry.latestDate = item.created_at;
    if (entry.thumbs.length < 4) {
      const url = photo ? resolvePhotoUrl(photo, item.id) : null;
      if (url) entry.thumbs.push(url);
    }
  }

  const recentImports = [...boxMap.values()]
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate))
    .slice(0, 3);

  const activity = recentImports.map(imp => ({
    type:  'import',
    label: `Import completed: ${imp.box} (${imp.count} item${imp.count !== 1 ? 's' : ''})`,
    date:  imp.latestDate,
  }));

  const poshCount  = db.prepare(`SELECT COUNT(*) as n FROM items WHERE poshmark_exported = 1 ${userAnd}`).get().n;
  const whatCount  = db.prepare(`SELECT COUNT(*) as n FROM items WHERE whatnot_exported = 1 ${userAnd}`).get().n;
  const latestExport = db.prepare(`SELECT date_listed FROM items WHERE date_listed IS NOT NULL ${userAnd} ORDER BY date_listed DESC LIMIT 1`).get();

  if (poshCount && latestExport) activity.push({ type: 'poshmark', label: `Poshmark CSV generated (${poshCount} item${poshCount !== 1 ? 's' : ''})`, date: latestExport.date_listed });
  if (whatCount && latestExport) activity.push({ type: 'whatnot', label: `Whatnot CSV generated (${whatCount} item${whatCount !== 1 ? 's' : ''})`, date: latestExport.date_listed });

  const draftRows = userId
    ? db.prepare(`SELECT * FROM items WHERE user_id = ? AND inv_status = 'draft' ORDER BY created_at DESC LIMIT 5`).all(userId)
    : db.prepare(`SELECT * FROM items WHERE inv_status = 'draft' ORDER BY created_at DESC LIMIT 5`).all();
  const draftFirstIds = draftRows.map(i => { try { return JSON.parse(i.photo_ids||'[]')[0]; } catch { return null; } }).filter(Boolean);
  const draftPhotoMap = draftFirstIds.length
    ? Object.fromEntries(db.prepare(`SELECT * FROM photos WHERE id IN (${draftFirstIds.map(()=>'?').join(',')})`).all(...draftFirstIds).map(p => [p.id, p]))
    : {};
  const draftQueue = draftRows.map(item => {
    const firstId = JSON.parse(item.photo_ids||'[]')[0];
    const photo   = firstId ? draftPhotoMap[firstId] : null;
    const meta    = photo?.metadata ? JSON.parse(photo.metadata) : {};
    return { id: item.id, sku: item.sku, title: meta.title || 'Untitled', thumb: photo ? resolvePhotoUrl(photo, item.id) : null, created_at: item.created_at };
  });

  res.json({ stats, recentImports, recentActivity: activity.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5), draftQueue, platforms });
});

// ── Markets ───────────────────────────────────────────────────────────────────

router.get('/api/markets', (req, res) => {
  const db = getDb();

  const ready  = db.prepare(`SELECT COUNT(*) as n FROM items WHERE processing_status='done'`).get().n;
  const failed = db.prepare(`SELECT COUNT(*) as n FROM items WHERE processing_status='failed'`).get().n;
  const review = db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status='review'`).get().n;

  const poshExported = db.prepare(`SELECT COUNT(*) as n FROM items WHERE poshmark_exported=1`).get().n;
  const whatExported = db.prepare(`SELECT COUNT(*) as n FROM items WHERE whatnot_exported=1`).get().n;
  const poshLastDate = db.prepare(`SELECT MAX(date_listed) as d FROM items WHERE poshmark_exported=1`).get()?.d || null;
  const whatLastDate = db.prepare(`SELECT MAX(date_listed) as d FROM items WHERE whatnot_exported=1`).get()?.d || null;

  const makeUrl   = db.prepare(`SELECT value FROM settings WHERE key='make_webhook_url'`).get()?.value || null;
  const etsyToken = db.prepare(`SELECT value FROM settings WHERE key='etsy_access_token'`).get()?.value || null;

  const errorRows = db.prepare(`SELECT id, photo_ids FROM items WHERE processing_status='failed' ORDER BY id DESC LIMIT 20`).all();
  const allPhotos = db.prepare(`SELECT * FROM photos`).all();
  const photoMap  = Object.fromEntries(allPhotos.map(p => [p.id, p]));
  const errorItems = errorRows.map(r => {
    const photoIds = JSON.parse(r.photo_ids || '[]');
    const photo    = photoMap[photoIds[0]];
    const m        = photo?.metadata ? JSON.parse(photo.metadata) : {};
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
  const lastExport     = [poshLastDate, whatLastDate].filter(Boolean).sort().pop() || null;

  res.json({
    summary: { ready, errors: failed + review, connectedCount, lastExport },
    platforms: {
      poshmark: { ready, exported: poshExported, lastExport: poshLastDate, fields: ['title', 'description', 'category', 'brand', 'size', 'price'] },
      whatnot:  { ready, exported: whatExported, lastExport: whatLastDate, fields: ['title', 'description', 'category', 'price', 'image URLs'] },
      etsy:     { connected: !!(makeUrl || etsyToken), webhookUrl: makeUrl, fields: ['title', 'description', 'price', 'tags', 'category'] },
    },
    exportHistory: historyRows,
    errorItems,
  });
});

// ── Inventory ─────────────────────────────────────────────────────────────────

router.get('/api/inventory', (req, res) => {
  const db = getDb();
  const { status, search } = req.query;

  let query    = `SELECT * FROM items`;
  const params  = [];
  const clauses = [];

  if (status && status !== 'all') { clauses.push(`inv_status = ?`); params.push(status); }
  if (clauses.length) query += ` WHERE ` + clauses.join(' AND ');
  query += ` ORDER BY created_at DESC`;

  const items    = db.prepare(query).all(...params);
  const photos   = db.prepare(`SELECT * FROM photos`).all();
  const photoMap = Object.fromEntries(photos.map(p => [p.id, p]));

  let result = items.map(item => {
    const photoIds = JSON.parse(item.photo_ids || '[]');
    const photo    = photoMap[photoIds[0]] || null;
    const meta     = photo?.metadata ? JSON.parse(photo.metadata) : {};
    return { ...item, meta, thumbPath: photo ? resolvePhotoUrl(photo, item.id) : null };
  });

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(item =>
      (item.meta_title  || item.meta.title  || '').toLowerCase().includes(q) ||
      (item.meta_brand  || item.meta.brand  || '').toLowerCase().includes(q) ||
      (item.meta_category || item.meta.category || '').toLowerCase().includes(q) ||
      buildSku(item.id, item.meta).toLowerCase().includes(q) ||
      (item.location || '').toLowerCase().includes(q)
    );
  }

  res.json(result);
});

router.get('/api/inventory/stats', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);

  const count = (status) => {
    if (userId) {
      return db.prepare(`SELECT COUNT(*) as n FROM items WHERE user_id = ? AND inv_status = ?`).get(userId, status).n;
    }
    return db.prepare(`SELECT COUNT(*) as n FROM items WHERE inv_status = ?`).get(status).n;
  };
  const total = userId
    ? db.prepare(`SELECT COUNT(*) as n FROM items WHERE user_id = ?`).get(userId).n
    : db.prepare(`SELECT COUNT(*) as n FROM items`).get().n;

  res.json({
    total,
    ready:    count('ready'),
    listed:   count('listed'),
    sold:     count('sold'),
    shipped:  count('shipped'),
    archived: count('archived'),
    review:   count('review'),
    draft:    count('draft'),
  });
});

router.put('/api/items/:id/inventory', (req, res) => {
  const db   = getDb();
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

router.put('/api/inventory/bulk', (req, res) => {
  const db = getDb();
  const { ids, ...fields } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '🌸 No item IDs provided' });

  const allowed = ['location', 'inv_status', 'date_listed', 'date_sold', 'date_shipped', 'poshmark_exported', 'whatnot_exported', 'etsy_exported'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: '🌸 No valid fields to update' });

  const setClauses   = updates.map(([col]) => `${col} = ?`).join(', ');
  const setValues    = updates.map(([, v]) => v);
  const placeholders = ids.map(() => '?').join(',');

  db.prepare(`UPDATE items SET ${setClauses} WHERE id IN (${placeholders})`).run(...setValues, ...ids);

  const newStatus = fields.inv_status;
  if (newStatus === 'sold' || newStatus === 'shipped') {
    const soldAt = fields.date_sold || fields.date_shipped || new Date().toISOString().slice(0, 10);
    db.prepare(`UPDATE listings SET status = 'sold', sold_at = ? WHERE item_id IN (${placeholders})`)
      .run(soldAt, ...ids);
  }

  res.json({ success: true, updated: ids.length });
});

module.exports = router;
