# FotoFlip Manual QA Checklist

Run these in the browser after `node --test tests/qa.test.mjs` passes.

---

## U1 — Tags field always visible (was hidden until tags existed)

1. Open any item → Listing tab
2. Scroll to bottom of listing fields
3. **PASS:** "Tags" section with an "Add tag…" input is visible even if no tags exist
4. Type a tag into the input and press Enter
5. **PASS:** Tag chip appears

---

## U2 — Condition Notes field always visible (was hidden until AI populated it)

1. Open any item → Listing tab
2. **PASS:** "Condition Notes" field is always visible (even if empty)
3. Click into it and type something
4. Tab out
5. **PASS:** No error, field saves

---

## U3 — Per-item Marketplace tab exports ONLY that item

1. Open any item with status "done" → Marketplaces tab
2. Click **⬇ This Item** under Whatnot
3. **PASS:** A file named `whatnot-{id}.csv` downloads (not `whatnot-bulk-...csv`)
4. Open the CSV — it should have exactly **2 lines** (header + 1 row for that item only)
5. Repeat for Poshmark → **PASS:** `poshmark-{id}.csv` with header + 1 row

---

## B4 — Bundle review panel generates labeled preview

1. Import a new photo
2. In the review panel, toggle **Bundle / flat lay** ON
3. Select a bundle type (e.g. Mixed Vintage)
4. Click **▶ Resale Studio**
5. Wait for processing to complete
6. Open the item → Photo tab
7. **PASS:** "Bundle Label" panel on the right shows the labeled image (not a placeholder)

---

## I2 — Weight field does not erase bundle type

1. Open any item → Photo tab
2. Toggle Bundle ON, set type to "Earrings"
3. Go to → Listing tab
4. Enter a weight (e.g. "3") and change unit to OZ
5. Tab out of the weight field
6. Go back to → Photo tab
7. **PASS:** Bundle toggle is still ON, bundle type is still "Earrings"

---

## Bundle listing generation — BocaBelle template

1. Open a bundle item → Listing tab
2. Make sure weight is filled in (e.g. "2 LB")
3. Click **↺ Regenerate**
4. **PASS — Title** starts with weight (e.g. "2 LB Vintage Jewelry Lot...")
5. **PASS — Description** has all 7 parts:
   - Hook line (excitement opener)
   - "What You Might Discover" bullets with ✨
   - BocaBelle Promise (topped off, extra pieces)
   - Condition notes (no cleaning, sold as-is, grab bag, remove one piece at a time)
   - Metal clarity (gold-tone/silver-tone, not tested)
   - "You may also like~" SEO tags
   - "💛 Final sale..." closing block

---

## Import — weight prompt

1. Click **+ Import Photos**
2. Drop or select a photo
3. **PASS:** Weight input and LB/OZ toggle appear in the footer after photo is staged
4. Enter a weight and select OZ
5. Click **Flip →**
6. Open the new item → Listing tab
7. **PASS:** Weight field shows the value you entered with OZ selected

---

## Automated test reference

```
node --test tests/qa.test.mjs
```

Expected: all tests pass or skip (skips are OK when no matching items exist yet).
