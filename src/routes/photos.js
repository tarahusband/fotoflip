const express = require('express');
const multer  = require('multer');
const { getDb } = require('../db');
const { getUserId } = require('../auth');
const { cloudinaryUpload, resolvePhotoUrl } = require('../lib/images');
const { UPLOAD_DIR } = require('../lib/config');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const fs = require('fs').promises;

router.post('/api/photos/upload', upload.array('photos'), async (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const photos = [];

  for (const file of req.files) {
    const result = db
      .prepare(`INSERT INTO photos (path, name, size, status, created_at, user_id) VALUES (?, ?, ?, 'pending', datetime('now'), ?)`)
      .run(file.path, file.originalname, file.size, userId);
    const photoId = result.lastInsertRowid;

    const cloudinaryUrl = await cloudinaryUpload(file.path, `photo-${photoId}`);
    if (!cloudinaryUrl) {
      db.prepare(`DELETE FROM photos WHERE id = ?`).run(photoId);
      await fs.unlink(file.path).catch(() => {});
      return res.status(500).json({ error: '🌸 Failed to save photo to cloud storage — please try again' });
    }

    db.prepare(`UPDATE photos SET cloudinary_url = ? WHERE id = ?`).run(cloudinaryUrl, photoId);
    photos.push({ id: photoId, name: file.originalname, uploadName: file.filename, path: file.path, url: cloudinaryUrl });
  }

  res.json({ photos });
});

router.get('/api/photos', (req, res) => {
  const db     = getDb();
  const userId = getUserId(req);
  const query  = userId
    ? `SELECT * FROM photos WHERE user_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM photos ORDER BY created_at DESC`;
  const rows = userId ? db.prepare(query).all(userId) : db.prepare(query).all();
  res.json(rows.map(p => ({ ...p, url: resolvePhotoUrl(p) })));
});

module.exports = router;
