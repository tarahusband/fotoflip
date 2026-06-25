const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { getDb } = require('./db');

const BRAND_BG = { r: 246, g: 241, b: 235, alpha: 1 }; // #F6F1EB
const OUTPUT_SIZE = 2000;

const DETECT_PROMPT = `Look at this photo and return JSON only: { "mode": "frame" or "studio" }

Use "frame" if: many items (5+), a bin or pile, bulk jewelry spread, items heavily overlapping, cluttered or dark background, LEGO, toys in a lot.
Use "studio" if: 1–4 items, items are clearly separated, background is simple, composition is already relatively clean.

Default to "frame" if uncertain. Return only the JSON object.`;

const LUXURY_SCENE = `
Scene: white Carrara marble surface with natural veining. Scattered water droplets on the marble surface near the items. Background: softly blurred cream linen fabric with shallow depth of field. Lighting: soft overhead product studio lighting with a single clean shadow beneath each item. Lens: 85mm macro feel, sharp focus on items, gentle bokeh on background. Aesthetic: high-end estate sale, commercial product photography from a luxury home in Boca Raton, Florida. No logos, no text overlays, no watermarks.`;

const FRAME_PROMPT = `You are creating a luxury product photograph for a high-end resale marketplace.

Do NOT extract, move, resize, crop, or alter the items in any way. Keep the exact composition, arrangement, and condition of all items as they appear in the original photo.

Replace only the background and surface beneath the items with the following luxury scene:
${LUXURY_SCENE}

The items must sit naturally on the marble surface as if photographed there. Preserve every item's exact appearance, condition, color, and detail. Do not make anything look newer, cleaner, or more valuable than it is.

Priority order:
1. Preserve every item exactly as photographed — appearance, condition, position, quantity.
2. Replace background/surface with the luxury marble scene.
3. Apply soft studio lighting and shadow.
4. Keep all items fully visible with space for marketplace cropping.`;

const STUDIO_PROMPT = `You are creating a luxury product photograph for a high-end resale marketplace.

Extract all visible sale items from the source image. Do not preserve the original background. Rebuild the scene using the extracted items only, elegantly composed on the luxury surface below.
${LUXURY_SCENE}

You may reposition items slightly to improve spacing and composition. Place items as if arranged by a professional product photographer. Preserve the overall appearance, category, colors, materials, and condition of every item exactly — do not make anything look newer, cleaner, repaired, or more valuable than it is.

Do not place the original photo, a rectangle, frame, or image layer over the scene. Items must be extracted and integrated directly onto the marble surface as individual objects.

Do not crop off any item.
Do not hide any item behind another.
Keep all items fully visible.
Keep the same number of items.
Keep size-reference objects if present.
Use realistic contact shadows on the marble.
Leave enough blank space for marketplace cropping.

Priority order:
1. Keep every item visible and true to its original condition.
2. Place items naturally on the Carrara marble surface.
3. Apply luxury studio lighting and single shadow per item.
4. Blurred cream linen background with shallow depth of field.`;

// ── Mode detection ────────────────────────────────────────────────────────────

async function detectMode(photoPath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return 'frame';
  try {
    const { OpenAI } = require('openai');
    const client = new OpenAI({ apiKey });
    const imageData = await fs.readFile(photoPath);
    const b64 = imageData.toString('base64');
    const ext = path.extname(photoPath).toLowerCase();
    const mimeType = ['.heic', '.heif'].includes(ext) ? 'image/jpeg' : (ext === '.png' ? 'image/png' : 'image/jpeg');

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'low' } },
        { type: 'text', text: DETECT_PROMPT },
      ]}],
      max_tokens: 20,
    });
    const text = response.choices[0]?.message?.content?.trim() || '';
    const clean = text.replace(/^```json\s*/,'').replace(/```\s*$/,'');
    const result = JSON.parse(clean);
    const mode = result.mode === 'studio' ? 'studio' : 'frame';
    console.log(`[FotoFlip] detected mode: ${mode}`);
    return mode;
  } catch (err) {
    console.warn(`[FotoFlip] mode detection failed, defaulting to frame: ${err.message}`);
    return 'frame';
  }
}

// ── Free processing: bg removal → clean cream backdrop ───────────────────────

async function sharpFallback(photoPath) {
  return sharp(photoPath)
    .rotate()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: BRAND_BG, withoutEnlargement: false })
    .flatten({ background: BRAND_BG })
    .modulate({ brightness: 1.08, saturation: 1.05 })
    .sharpen({ sigma: 0.9, m1: 0.5, m2: 2.0 })
    .png()
    .toBuffer();
}

async function freeProcess(photoPath) {
  // @imgly downloads ~80MB ONNX models and crashes Railway — skip it in cloud deployments
  if (process.env.DATA_DIR) {
    console.log('[FotoFlip] Cloud env detected — using sharp fallback (no bg removal)');
    return sharpFallback(photoPath);
  }

  const os = require('os');
  const tmpIn  = path.join(os.tmpdir(), `ff_in_${Date.now()}.png`);
  const tmpOut = path.join(os.tmpdir(), `ff_out_${Date.now()}.png`);
  try {
    const { removeBackground } = require('@imgly/background-removal-node');

    // Write a normalised PNG to disk — @imgly needs a file path or URL
    await sharp(photoPath)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toFile(tmpIn);

    const result = await removeBackground(tmpIn, {
      model: 'small',
      output: { format: 'image/png', quality: 1 },
    });

    // result is a Blob in newer versions, ArrayBuffer in older
    const noBgBuffer = Buffer.isBuffer(result)
      ? result
      : Buffer.from(result instanceof ArrayBuffer ? result : await result.arrayBuffer());

    const CANVAS = 1080;
    const BORDER = 18;
    const BG = '#F4EEE6';

    const contentSize = CANVAS - BORDER * 2; // 1044
    const subjectSize = Math.round(contentSize * 0.90);

    const subjectBuffer = await sharp(noBgBuffer)
      .trim()
      .modulate({ brightness: 1.03, saturation: 1.02 })
      .linear(1.04, -2)
      .sharpen({ sigma: 0.65, m1: 0.8, m2: 1.4 })
      .resize(subjectSize, subjectSize, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();

    const subMeta = await sharp(subjectBuffer).metadata();
    const left = Math.round((CANVAS - subMeta.width) / 2);
    const top  = Math.round((CANVAS - subMeta.height) / 2);

    // box-shadow: 0 6px 18px rgba(0,0,0,0.10)
    const { data: rawData, info } = await sharp(subjectBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const shadowData = Buffer.alloc(rawData.length);
    for (let i = 0; i < rawData.length; i += 4) {
      shadowData[i] = 0; shadowData[i + 1] = 0; shadowData[i + 2] = 0;
      shadowData[i + 3] = Math.round(rawData[i + 3] * 0.10);
    }
    const shadowOffsetY = Math.round(CANVAS * 0.006);
    const shadowBlur    = Math.round(CANVAS * 0.017);
    const shadowBuffer  = await sharp(shadowData, { raw: { width: info.width, height: info.height, channels: 4 } })
      .blur(shadowBlur)
      .png()
      .toBuffer();

    const borderSvg = Buffer.from(
      `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${BORDER}" y="${BORDER}" width="${CANVAS - BORDER * 2}" height="${CANVAS - BORDER * 2}"
          fill="none" stroke="#D8CEC2" stroke-width="2"/>
      </svg>`
    );

    const framed = await sharp({
      create: { width: CANVAS, height: CANVAS, channels: 4, background: BG }
    })
    .composite([{ input: borderSvg }])
    .png()
    .toBuffer();

    return sharp(framed)
      .composite([
        { input: shadowBuffer, left, top: top + shadowOffsetY },
        { input: subjectBuffer, left, top },
      ])
      .png()
      .toBuffer();
  } catch (err) {
    console.warn(`[FotoFlip] freeProcess failed, using plain fallback: ${err.message}`);
    return sharpFallback(photoPath);
  } finally {
    await fs.unlink(tmpIn).catch(() => {});
    await fs.unlink(tmpOut).catch(() => {});
  }
}

const freeFrameMode  = freeProcess;
const freeStudioMode = freeProcess;

// ── Frame Mode: preserve composition, luxury backdrop ────────────────────────

async function frameMode(photoPath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return freeFrameMode(photoPath);
  try {
    const { OpenAI, toFile } = require('openai');
    const client = new OpenAI({ apiKey });

    const pngBuffer = await sharp(photoPath)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    const imageFile = await toFile(pngBuffer, 'photo.png', { type: 'image/png' });

    const response = await client.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt: FRAME_PROMPT,
      size: '1024x1024',
      n: 1,
    });
    const item = response.data[0];
    const aiBuffer = item.b64_json
      ? Buffer.from(item.b64_json, 'base64')
      : Buffer.from(await (await fetch(item.url)).arrayBuffer());
    return sharp(aiBuffer)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: BRAND_BG })
      .flatten({ background: BRAND_BG })
      .png()
      .toBuffer();
  } catch (err) {
    console.warn(`[FotoFlip] Frame Mode AI failed, using free fallback: ${err.message}`);
    return freeFrameMode(photoPath);
  }
}

// ── Studio Mode: gpt-image-1 background removal + recomposition ──────────────

async function studioMode(photoPath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return freeStudioMode(photoPath);
  try {
    const { OpenAI, toFile } = require('openai');
    const client = new OpenAI({ apiKey });

    const pngBuffer = await sharp(photoPath)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    const imageFile = await toFile(pngBuffer, 'photo.png', { type: 'image/png' });

    const response = await client.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt: STUDIO_PROMPT,
      size: '1024x1024',
      n: 1,
    });
    const item = response.data[0];
    const aiBuffer = item.b64_json
      ? Buffer.from(item.b64_json, 'base64')
      : Buffer.from(await (await fetch(item.url)).arrayBuffer());
    return sharp(aiBuffer)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: BRAND_BG })
      .flatten({ background: BRAND_BG })
      .png()
      .toBuffer();
  } catch (err) {
    console.warn(`[FotoFlip] Studio Mode AI failed, using free fallback: ${err.message}`);
    return freeStudioMode(photoPath);
  }
}

// ── Photo processing: detect → route → JPEG ──────────────────────────────────

async function processPhoto(photoPath, outputDir, photoId) {
  const mode = await detectMode(photoPath);
  const productBuffer = mode === 'studio'
    ? await studioMode(photoPath)
    : await frameMode(photoPath);

  const timestamp = Date.now();
  const dirName = `photo_${photoId}_${timestamp}`;
  const itemDir = path.join(outputDir, dirName);
  await fs.mkdir(itemDir, { recursive: true });

  const originalName = path.basename(photoPath);
  const processedName = originalName.replace(/\.[^.]+$/, '_processed.jpg');

  await fs.copyFile(photoPath, path.join(itemDir, originalName));

  await sharp(productBuffer)
    .jpeg({ quality: 92 })
    .toFile(path.join(itemDir, processedName));

  console.log(`[FotoFlip] photo ${photoId} processed via ${mode}-mode`);
  return { dirName, processedName, itemDir, mode };
}

// ── Item orchestration ────────────────────────────────────────────────────────

async function processItem(itemId, photoIds, processedDir, uploadFn) {
  const db = getDb();
  db.prepare(`UPDATE items SET processing_status = 'processing' WHERE id = ?`).run(itemId);

  const results = [];
  for (const photoId of photoIds) {
    const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(photoId);
    if (!photo) continue;

    db.prepare(`UPDATE photos SET status = 'processing' WHERE id = ?`).run(photoId);

    try {
      const { dirName, processedName, itemDir, mode } = await processPhoto(
        photo.path, processedDir, photoId,
      );

      const processedPath = path.join(itemDir, processedName);
      db.prepare(
        `UPDATE photos SET status = 'done', processed_path = ?, processed_at = datetime('now') WHERE id = ?`,
      ).run(processedPath, photoId);

      // Re-upload Sharp-processed version to Cloudinary (overwrites original)
      let cloudinaryUrl = photo.cloudinary_url;
      if (uploadFn) {
        const newUrl = await uploadFn(processedPath, `photo-${photoId}`);
        if (newUrl) {
          cloudinaryUrl = newUrl;
          db.prepare(`UPDATE photos SET cloudinary_url = ? WHERE id = ?`).run(newUrl, photoId);
        }
      }

      const metadata = await extractMetadata(photo, processedPath, cloudinaryUrl);
      const aiAvailable = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
      const metaWithFlags = { ...metadata, _method: mode, ...(aiAvailable ? {} : { ai_unavailable: true }) };
      await fs.writeFile(path.join(itemDir, 'metadata.json'), JSON.stringify(metaWithFlags, null, 2));
      db.prepare(`UPDATE photos SET metadata = ? WHERE id = ?`).run(
        JSON.stringify(metaWithFlags), photoId,
      );

      results.push({ photoId, dirName, processedName, success: true, mode });
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

// ── Metadata extraction (gpt-4o vision) ──────────────────────────────────────

async function extractWithOpenAI(photoPath, hint, cloudinaryUrl) {
  const hintLine = hint ? `User hint: ${hint}. Use this to inform your analysis.\n\n` : '';
  const prompt = `${hintLine}You are a resale product expert specializing in estate and luxury goods. Analyze this photo and return ONLY valid JSON with these fields:
{
  "brand": "brand name or Unknown — look for logos/signatures/hallmarks: C canvas=Coach, GG=Gucci, LV=Louis Vuitton, CC=Chanel, MK=Michael Kors, also look for jewelry maker marks",
  "model": "model name if visible, else empty string",
  "color": "primary color(s)",
  "material": "primary material (gold-tone, silver-tone, sterling, brass, enamel, rhinestone, etc.)",
  "condition": "number 1-10",
  "conditionText": "one of: NWT|NWOT|Excellent|Very Good|Good|Fair|Poor",
  "conditionNotes": "brief honest description of any flaws, wear, or notable features",
  "category": "one of: necklace|bracelet|ring|earrings|pendant|brooch|watch|tote|crossbody|wallet|clutch|satchel|handbag|backpack|clothing|shoes|accessory|toy|collectible|other",
  "era": "decade or style era if identifiable (e.g. 1960s, Art Deco, Victorian, Mid-Century, 1980s)",
  "signed": "yes/no/idk — is it signed or marked by a maker",
  "signerName": "maker signature or hallmark text if visible, else empty string",
  "suggestedPrice": number (USD resale value),
  "msrp": number or null,
  "size": "size if visible, else empty string",
  "isProject": false
}
Return only the JSON object, no markdown, no explanation.`;

  // Try Claude first — prefer URL-based image (no base64 needed)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey: anthropicKey });

      let imageContent;
      if (cloudinaryUrl) {
        imageContent = { type: 'image', source: { type: 'url', url: cloudinaryUrl } };
      } else {
        const imageData = await fs.readFile(photoPath);
        const b64 = imageData.toString('base64');
        const ext = path.extname(photoPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
        imageContent = { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } };
      }

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }],
      });
      const text = response.content[0]?.text?.trim() || '';
      const clean = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
      return JSON.parse(clean);
    } catch (err) {
      console.warn(`[FotoFlip] Claude extraction failed, trying OpenAI: ${err.message}`);
    }
  }

  // Fall back to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;
  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey: openaiKey });

  let imageContent;
  if (cloudinaryUrl) {
    imageContent = { type: 'image_url', image_url: { url: cloudinaryUrl } };
  } else {
    const imageData = await fs.readFile(photoPath);
    const b64 = imageData.toString('base64');
    const ext = path.extname(photoPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    imageContent = { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'high' } };
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }],
    max_tokens: 600,
  });
  const text = response.choices[0]?.message?.content?.trim() || '';
  const clean = text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'');
  return JSON.parse(clean);
}

async function extractMetadata(photo, processedPath, cloudinaryUrl) {
  try {
    const existing = photo.metadata ? JSON.parse(photo.metadata) : {};
    const metadata = await extractWithOpenAI(photo.path, existing.hint || '', cloudinaryUrl);
    if (metadata) return metadata;
  } catch (err) {
    console.warn('[FotoFlip] Metadata extraction failed:', err.message);
  }
  return {
    brand: 'Unknown', model: '', color: '', material: '',
    condition: '', conditionText: '', conditionNotes: '',
    category: 'other', suggestedPrice: 0, msrp: null, size: '', isProject: false,
  };
}

module.exports = { processItem, processPhoto, extractWithOpenAI };
