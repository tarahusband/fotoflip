const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { getDb } = require('./db');

const BRAND_BG = { r: 250, g: 246, b: 241, alpha: 1 }; // #FAF6F1
const OUTPUT_SIZE = 1200;
const OBJECT_SIZE = 960; // object fits within this square, centered

async function removeBackground(inputBuffer) {
  try {
    const { removeBackground } = require('@imgly/background-removal-node');
    const blob = await removeBackground(inputBuffer);
    return Buffer.from(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

async function buildWatermark(width) {
  const text = 'flippi.ai';
  const fontSize = Math.max(18, Math.round(width * 0.022));
  const padX = Math.round(width * 0.02);
  const padY = Math.round(width * 0.015);
  const svgW = fontSize * text.length * 0.6 + padX * 2;
  const svgH = fontSize + padY * 2;
  const svg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
    <text x="${padX}" y="${fontSize + padY * 0.5}"
      font-family="Arial,sans-serif" font-size="${fontSize}"
      fill="rgba(102,68,223,0.55)">${text}</text>
  </svg>`;
  return { buffer: Buffer.from(svg), width: svgW, height: svgH };
}

async function processPhoto(photoPath, outputDir, photoId) {
  // 1. EXIF rotation fix
  let buf = await sharp(photoPath).rotate().toBuffer();

  // 2. Background removal (best-effort, local ML)
  const noBg = await removeBackground(buf);
  const hasBg = noBg !== null;
  if (hasBg) buf = noBg;

  // 3. Resize to fit within OBJECT_SIZE, preserving aspect ratio
  buf = await sharp(buf)
    .resize(OBJECT_SIZE, OBJECT_SIZE, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const meta = await sharp(buf).metadata();
  const objW = meta.width;
  const objH = meta.height;

  // 4. Composite onto brand background (OUTPUT_SIZE × OUTPUT_SIZE)
  const left = Math.round((OUTPUT_SIZE - objW) / 2);
  const top = Math.round((OUTPUT_SIZE - objH) / 2);

  let composed = await sharp({
    create: {
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      channels: 3,
      background: BRAND_BG,
    },
  })
    .composite([{ input: buf, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer();

  // 5. Brighten + sharpen
  composed = await sharp(composed)
    .modulate({ brightness: 1.06, saturation: 1.08 })
    .sharpen({ sigma: 1.0, m1: 1.2, m2: 0.8 })
    .jpeg({ quality: 92 })
    .toBuffer();

  // 6. Watermark (bottom-right)
  const wm = await buildWatermark(OUTPUT_SIZE);
  composed = await sharp(composed)
    .composite([
      {
        input: wm.buffer,
        left: OUTPUT_SIZE - wm.width - Math.round(OUTPUT_SIZE * 0.02),
        top: OUTPUT_SIZE - wm.height - Math.round(OUTPUT_SIZE * 0.02),
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  // 7. Save to processed directory
  const timestamp = Date.now();
  const dirName = `photo_${photoId}_${timestamp}`;
  const itemDir = path.join(outputDir, dirName);
  await fs.mkdir(itemDir, { recursive: true });

  const originalName = path.basename(photoPath);
  const processedName = originalName.replace(/\.[^.]+$/, '_processed.jpg');

  await fs.copyFile(photoPath, path.join(itemDir, originalName));
  await sharp(composed).jpeg({ quality: 92 }).toFile(path.join(itemDir, processedName));

  return { dirName, processedName, itemDir };
}

async function processItem(itemId, photoIds, processedDir) {
  const db = getDb();

  db.prepare(`UPDATE items SET processing_status = 'processing' WHERE id = ?`).run(itemId);

  const results = [];
  for (const photoId of photoIds) {
    const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(photoId);
    if (!photo) continue;

    db.prepare(`UPDATE photos SET status = 'processing' WHERE id = ?`).run(photoId);

    try {
      const { dirName, processedName, itemDir } = await processPhoto(
        photo.path,
        processedDir,
        photoId,
      );

      const processedPath = path.join(itemDir, processedName);
      db.prepare(
        `UPDATE photos SET status = 'done', processed_path = ?, processed_at = datetime('now') WHERE id = ?`,
      ).run(processedPath, photoId);

      // Write metadata stub (Phase 2: OpenAI will fill this)
      const metadata = await extractMetadata(photo, processedPath);
      await fs.writeFile(path.join(itemDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

      db.prepare(`UPDATE photos SET metadata = ? WHERE id = ?`).run(
        JSON.stringify(metadata),
        photoId,
      );

      results.push({ photoId, dirName, processedName, success: true });
    } catch (err) {
      db.prepare(
        `UPDATE photos SET status = 'failed', error_message = ? WHERE id = ?`,
      ).run(err.message, photoId);
      results.push({ photoId, success: false, error: err.message });
    }
  }

  db.prepare(`UPDATE items SET processing_status = 'done' WHERE id = ?`).run(itemId);
  return results;
}

async function extractMetadata(photo, processedPath) {
  // Phase 1: return stub metadata. Phase 2: OpenAI Vision fills this.
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      return await extractWithOpenAI(photo, processedPath, openaiKey);
    } catch {
      // fall through to stub
    }
  }

  return {
    brand: 'Unknown',
    model: '',
    color: '',
    material: '',
    condition: '5',
    conditionText: 'Good',
    conditionNotes: '',
    category: 'bag',
    suggestedPrice: '50',
    msrp: '',
    size: '',
    isProject: false,
  };
}

async function extractWithOpenAI(photo, processedPath, apiKey) {
  const { OpenAI, toFile } = require('openai');
  const client = new OpenAI({ apiKey });

  const imageData = await require('fs').promises.readFile(processedPath);
  const imageFile = await toFile(imageData, 'image.jpg', { type: 'image/jpeg' });

  const response = await client.responses.create({
    model: 'gpt-4o',
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            source: imageFile,
          },
          {
            type: 'input_text',
            text: `You are analyzing a resale bag/purse photo. Extract these details as JSON:
{
  "brand": "brand name or Unknown",
  "model": "model/style name or empty string",
  "color": "primary color",
  "material": "material (leather/canvas/nylon/etc)",
  "condition": "1-10 numeric rating (10=new)",
  "conditionText": "NWT|NWOT|Excellent|Very Good|Good|Fair",
  "conditionNotes": "brief notes on wear",
  "category": "tote|crossbody|wallet|clutch|satchel|handbag|backpack|other",
  "suggestedPrice": "suggested resale price as number",
  "msrp": "original retail price as number or empty",
  "size": "size description or empty",
  "isProject": false
}
Return ONLY valid JSON, no markdown.`,
          },
        ],
      },
    ],
  });

  const text = response.output_text.trim();
  return JSON.parse(text.replace(/^```json?\n?/, '').replace(/\n?```$/, ''));
}

module.exports = { processItem, processPhoto };
