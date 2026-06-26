const fs = require('fs').promises;
const crypto = require('crypto');
const sharp = require('sharp');
const { PROCESSED_DIR } = require('./config');

function resolvePhotoUrl(photo, itemId) {
  if (photo.cloudinary_url) return photo.cloudinary_url;
  try {
    const meta = typeof photo.metadata === 'string' ? JSON.parse(photo.metadata) : (photo.metadata || {});
    if (meta.imgbbUrl) return meta.imgbbUrl;
  } catch {}
  if (itemId && process.env.CLOUDINARY_CLOUD_NAME) {
    return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/fotoflip/item-${itemId}.jpg`;
  }
  if (photo.processed_path) {
    const part = photo.processed_path.split('/processed/')[1];
    if (part) return `/processed/${part}`;
  }
  const name = (photo.path || '').split('/uploads/')[1] || photo.name;
  return `/uploads/${name}`;
}

async function cloudinaryUpload(source, tag) {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) return '';
    const imgData   = Buffer.isBuffer(source) ? source : await fs.readFile(source);
    const b64       = imgData.toString('base64');
    const publicId  = `fotoflip/${tag}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const str       = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
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

async function cloudinaryDestroy(url) {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) return;
    const match = url.match(/\/image\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/i);
    if (!match) { console.warn('[FotoFlip] cloudinaryDestroy: could not parse public_id from', url); return; }
    const publicId = match[1];
    const ts  = Math.floor(Date.now() / 1000);
    const sig = crypto.createHash('sha1').update(`public_id=${publicId}&timestamp=${ts}${apiSecret}`).digest('hex');
    const r   = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: 'POST',
      body: new URLSearchParams({ public_id: publicId, timestamp: ts.toString(), api_key: apiKey, signature: sig }),
    });
    const j = await r.json();
    if (j.result !== 'ok') console.warn('[FotoFlip] Cloudinary destroy unexpected result:', JSON.stringify(j), 'for', publicId);
  } catch (e) {
    console.warn('[FotoFlip] Cloudinary destroy failed:', e.message);
  }
}

async function githubUpload(source, filename) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const repo  = process.env.GITHUB_REPO;
    if (!token || !repo) return '';
    const imgData = Buffer.isBuffer(source) ? source : await fs.readFile(source);
    const b64     = imgData.toString('base64');
    const apiUrl  = `https://api.github.com/repos/${repo}/contents/images/${filename}`;
    const headers = { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'fotoflip' };
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

async function uploadImage(source, tag) {
  const url = await cloudinaryUpload(source, tag);
  if (url) return url;
  return await githubUpload(source, `${tag}-labeled.jpg`);
}

function extractPillLabel(title) {
  if (!title) return null;
  const clean = title.replace(/[\u{1F300}-\u{1FFFF}⚜✨💎🌹♻🅑]/gu, '').trim();
  const parts = clean.split('|').map(p => p.trim());
  if (parts.length >= 2) {
    const mid      = parts[1] || '';
    const stripped = mid.replace(/\b(vintage|estate|y2k|modern|mixed|era|resell|collect|diy|wear|jewelry|lot)\b/gi, '').trim();
    const words    = stripped.split(/\s+/).filter(w => w.length > 1);
    if (words.length >= 1) return words.slice(0, 3).join(' ').toUpperCase();
  }
  const words = clean.split(/\s+/).filter(w => w.length > 2 && !/^(lot|the|and|for|with|this|that)$/i.test(w));
  return words.slice(0, 3).join(' ').toUpperCase() || null;
}

function getBundleLabel(meta, item) {
  const fromTitle = extractPillLabel(meta.title || '');
  if (fromTitle) return { main: fromTitle, sub: '' };
  const cat = (meta.category     || '').toLowerCase();
  const bt  = (item.bundle_type  || '').toLowerCase();
  if (cat.includes('earring') || bt.includes('earring'))                    return { main: 'RETRO EARRING LOT',    sub: '' };
  if (cat.includes('brooch') || cat.includes('pin') || bt.includes('brooch')) return { main: 'VINTAGE BROOCH LOT',  sub: '' };
  if (cat.includes('necklace') || cat.includes('pendant'))                  return { main: 'VINTAGE NECKLACE LOT', sub: '' };
  if (cat.includes('bracelet'))                                              return { main: 'VINTAGE BRACELET LOT', sub: '' };
  if (cat.includes('lego') || bt.includes('lego'))                          return { main: 'LEGO PARTS LOT',       sub: '' };
  if (cat.includes('toy') || bt.includes('toy'))                            return { main: 'VINTAGE TOY LOT',      sub: '' };
  if (cat.includes('button') || cat.includes('magnet'))                     return { main: 'BUTTON MAGNET LOT',    sub: '' };
  if (bt.includes('gold'))                                                   return { main: 'GOLD TONE LOT',        sub: '' };
  if (bt.includes('floral'))                                                 return { main: 'FLORAL JEWELRY LOT',   sub: '' };
  if (bt.includes('animal'))                                                 return { main: 'ANIMAL PRINT LOT',     sub: '' };
  if (bt.includes('mixed') || bt.includes('vintage'))                       return { main: 'MIXED LOT',            sub: '' };
  if (cat.includes('jewel'))                                                 return { main: 'MIXED LOT',            sub: '' };
  return { main: 'VINTAGE TREASURE', sub: '' };
}

async function applyBundleLabel(imagePath, main, sub) {
  const SIZE = 1080;

  const star4  = (x, y, r, op = 0.92) =>
    `<path transform="translate(${x},${y}) scale(${r})" d="M0,-1 L.25,-.25 L1,0 L.25,.25 L0,1 L-.25,.25 L-1,0 L-.25,-.25Z" fill="white" fill-opacity="${op}"/>`;
  const bubble = (x, y, r, op = 0.32) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill-opacity="0" stroke="white" stroke-width="2.5" stroke-opacity="${op}"/>`;

  const svg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect x="14" y="14" width="1052" height="1052" fill-opacity="0" stroke="#ff4fb8" stroke-width="28" rx="6"/>
    ${star4(40,20,18)} ${star4(80,44,11)} ${star4(52,70,14)}
    ${star4(24,8,13)} ${star4(8,90,10)} ${star4(140,14,9)}
    ${star4(1042,192,17)} ${star4(1060,218,10)} ${star4(1048,240,7)}
    ${star4(1058,858,19)} ${star4(1034,888,11)} ${star4(1056,830,7)}
    ${star4(68,1010,15)} ${star4(96,980,9)} ${star4(44,985,7)}
    ${star4(200,74,13)} ${star4(168,48,8)} ${star4(240,92,6)}
    ${star4(860,56,12)} ${star4(888,30,7)} ${star4(828,78,6)}
    ${star4(120,480,12)} ${star4(88,510,7)} ${star4(148,452,6)}
    ${star4(974,548,9)} ${star4(1000,520,6)} ${star4(950,572,5)}
    ${star4(960,308,13)} ${star4(986,278,8)} ${star4(932,332,6)}
    ${star4(182,884,11)} ${star4(152,856,7)} ${star4(214,910,6)}
    ${star4(500,30,10)} ${star4(470,58,6)} ${star4(534,14,5)}
    ${star4(540,1050,9)} ${star4(510,1030,5)} ${star4(572,1040,6)}
    ${star4(300,200,8)} ${star4(780,900,7)} ${star4(880,400,6)}
    ${star4(140,700,9)} ${star4(920,700,7)} ${star4(500,900,6)}
    ${bubble(984,78,40)} ${bubble(1020,54,20)} ${bubble(1044,80,10)}
    ${bubble(52,912,36)} ${bubble(42,940,18)} ${bubble(74,884,10)}
    ${bubble(1048,516,28)} ${bubble(800,1058,30)} ${bubble(248,1066,14)}
  </svg>`;

  const imageInput = /^https?:\/\//.test(imagePath)
    ? Buffer.from(await fetch(imagePath).then(r => r.arrayBuffer()))
    : imagePath;
  const photoBuffer = await sharp(imageInput)
    .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 1.10, saturation: 1.06 })
    .sharpen({ sigma: 0.75, m1: 0.8, m2: 1.8 })
    .toBuffer();

  return sharp(photoBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

module.exports = {
  resolvePhotoUrl,
  cloudinaryUpload,
  cloudinaryDestroy,
  uploadImage,
  githubUpload,
  getBundleLabel,
  applyBundleLabel,
};
