# FotoFlip — Solution Architecture

## Overview

FotoFlip is a single-user (expanding to small-team) desktop web app for resellers. It turns raw item photos into marketplace-ready listings — titles, descriptions, categories, prices, and export CSVs — as fast as possible after purchase.

**Core principle:** Listing starts the moment you buy.

---

## System Diagram

```
Browser (localhost:3456)
        │
        ▼
┌──────────────────────────────────────┐
│           Express Server             │
│           (server.js)                │
│                                      │
│  Static: /public (HTML/CSS/JS)       │
│  API:    /api/*                      │
│  Files:  /uploads, /processed        │
└────────┬─────────────────────────────┘
         │
    ┌────┴──────────────────┐
    │                       │
    ▼                       ▼
SQLite DB            Image Processor
(better-sqlite3)     (src/processor.js)
~/Library/...        Sharp + @imgly/bg-removal
fotoflip.db
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Web framework | Express 4 |
| Database | SQLite via better-sqlite3 |
| Image processing | Sharp, @imgly/background-removal-node |
| AI — text | Claude claude-sonnet-4-6 (primary), OpenAI gpt-4o (fallback) |
| AI — image | OpenAI gpt-image-1 (primary), free Sharp pipeline (fallback) |
| Image hosting | Cloudinary (primary), GitHub/jsDelivr (fallback) |
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Fonts | Josefin Slab (local, OFL licensed) |
| Deployment | Railway |

---

## Data Flow

### 1. Import
```
User drops photos → /api/photos (multer upload)
→ saved to /uploads/
→ photos row created (status: ungrouped)
→ User groups photos into an item
→ /api/items created with photo_ids[]
→ Processing triggered automatically
```

### 2. Processing Pipeline
```
Item created
    │
    ▼
gpt-4o vision (detail:low) — detect mode
    │
    ├── frame mode  → preserve composition, replace background
    └── studio mode → extract subject, luxury backdrop
    │
    ▼
OpenAI gpt-image-1 (if available)
    OR
@imgly/background-removal-node + Sharp (free fallback)
    │
    ▼
1080×1080px output → /processed/item-{id}-main.jpg
processing_status → 'done'
```

### 3. AI Metadata Extraction
```
POST /api/items/:id/metadata/extract
    │
    ▼
Claude claude-sonnet-4-6 (primary)
    OR OpenAI gpt-4o (fallback)
    │
    ▼
Returns: title, brand, category, condition,
         price, material, color, size, era,
         signed, signerName, tags, description
    │
    ▼
Saved to photos.metadata (JSON)
```

### 4. Listing Generation
```
POST /api/items/:id/listing/generate
    │
    ▼
Claude/OpenAI → structured listing copy
    │
    ▼
Saved to photos.metadata
inv_status → 'ready'
```

### 5. Export
```
GET /api/export/poshmark  (or /whatnot)
    │
    ▼
Fetch all inv_status='ready' items
Upload images to Cloudinary
Build CSV (46 cols Poshmark / 21 cols Whatnot)
    │
    ▼
Response header: X-Export-Item-Ids
CSV file download
    │
    ▼
Frontend prompt: "Mark as Listed?"
PUT /api/inventory/bulk → inv_status='listed'
```

---

## Database Schema

### `items`
| Column | Type | Description |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| status | TEXT | App toggle: Flip / Draft |
| processing_status | TEXT | pending / review / processing / done / failed |
| inv_status | TEXT | ready / review / draft / listed / sold / shipped / archived |
| photo_ids | TEXT | JSON array of photo IDs |
| purchase_date | TEXT | YYYY-MM-DD |
| is_bundle | INTEGER | 0 or 1 |
| bundle_type | TEXT | Floral / Gold Tone / Mixed Vintage / etc. |
| bundle_count | INTEGER | 3 / 5 / 8 / 10 |
| weight | TEXT | Numeric string |
| weight_unit | TEXT | LB / OZ |
| location | TEXT | Physical storage (BOX-001, SHELF-A) |
| sku | TEXT | Generated SKU |
| poshmark_exported | INTEGER | 0 or 1 |
| whatnot_exported | INTEGER | 0 or 1 |
| etsy_exported | INTEGER | 0 or 1 |
| date_listed | TEXT | YYYY-MM-DD |
| date_sold | TEXT | YYYY-MM-DD |
| date_shipped | TEXT | YYYY-MM-DD |
| created_at | TEXT | ISO datetime |

### `photos`
| Column | Type | Description |
|---|---|---|
| id | TEXT PK | UUID |
| path | TEXT | Original upload path |
| processed_path | TEXT | Output image path |
| status | TEXT | ungrouped / grouped |
| metadata | TEXT | JSON — all AI-extracted fields |

### `settings`
| Column | Type | Description |
|---|---|---|
| key | TEXT PK | Setting name |
| value | TEXT | Setting value |

Settings keys: `make_webhook_url`, `etsy_access_token`, `etsy_refresh_token`, `etsy_shop_id`, `etsy_user_id`

---

## API Reference

### Items
| Method | Path | Description |
|---|---|---|
| GET | /api/items | All items with photos |
| POST | /api/items | Create item from photo IDs |
| GET | /api/items/:id | Single item |
| DELETE | /api/items/:id | Delete item |
| PUT | /api/items/:id/status | Toggle Flip/Draft |
| PUT | /api/items/:id/bundle | Update bundle/weight fields |
| PUT | /api/items/:id/inventory | Update inventory fields |

### Metadata & AI
| Method | Path | Description |
|---|---|---|
| PUT | /api/items/:id/metadata | Save metadata manually |
| POST | /api/items/:id/metadata/extract | AI extraction |
| POST | /api/items/:id/listing/generate | AI listing copy |

### Exports
| Method | Path | Description |
|---|---|---|
| GET | /api/export/poshmark | Bulk Poshmark CSV |
| GET | /api/export/whatnot | Bulk Whatnot CSV |
| POST | /api/items/:id/export/poshmark | Single-item Poshmark CSV |
| POST | /api/items/:id/export/whatnot | Single-item Whatnot CSV |

### Inventory
| Method | Path | Description |
|---|---|---|
| GET | /api/inventory | Filtered inventory list |
| GET | /api/inventory/stats | Counts by inv_status |
| PUT | /api/inventory/bulk | Bulk update fields |

### Dashboard & Markets
| Method | Path | Description |
|---|---|---|
| GET | /api/dashboard | KPIs, recent imports, activity |
| GET | /api/markets | Export hub — platform stats, history, errors |

### Settings
| Method | Path | Description |
|---|---|---|
| GET | /api/settings | All settings |
| PUT | /api/settings | Save setting key/value |
| POST | /api/settings/make-webhook | Save Make.com URL |
| GET | /api/settings/make-webhook | Get Make.com URL |

---

## Navigation (4 views)

| View | Purpose |
|---|---|
| Home | Dashboard — KPIs, quick actions, recent imports, activity |
| Photos | Import, process, and edit individual listings |
| Inventory | Lifecycle management — location, status, bulk actions |
| Markets | Export hub — Poshmark, Whatnot, Etsy, history, errors |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| PORT | No | Server port (default 3456) |
| APP_URL | Deployment | Public URL for OAuth callbacks |
| DATA_DIR | Deployment | SQLite directory (e.g. /data on Railway) |
| ANTHROPIC_API_KEY | Yes | Claude AI — metadata + listings |
| OPENAI_API_KEY | Yes* | Fallback AI + image generation |
| CLOUDINARY_CLOUD_NAME | Yes | Image hosting for CSV exports |
| CLOUDINARY_API_KEY | Yes | Cloudinary auth |
| CLOUDINARY_API_SECRET | Yes | Cloudinary auth |
| IMGBB_API_KEY | No | Whatnot image fallback |
| ETSY_API_KEY | No | Etsy OAuth |
| ETSY_SHARED_SECRET | No | Etsy OAuth |
| OUTPUT_BG_COLOR | No | Background color for free pipeline |
| GITHUB_TOKEN | No | GitHub image fallback |
| GITHUB_REPO | No | GitHub image fallback repo |

*One of ANTHROPIC_API_KEY or OPENAI_API_KEY required.

---

## Deployment (Railway)

1. Connect `tarahusband/fotoflip` repo to Railway
2. Add a **Volume** mounted at `/data`
3. Set env vars (see above) — `DATA_DIR=/data`, `APP_URL=https://your-app.railway.app`
4. Railway auto-deploys on push to `main`

SQLite database persists on the volume across deploys.

---

## Marketplace Integrations

| Platform | Method | Status |
|---|---|---|
| Poshmark | CSV upload (46 cols) | Live |
| Whatnot | CSV upload (21 cols, CRLF) | Live |
| Etsy | Make.com webhook → Etsy draft | Connected, scenario in progress |
| eBay | CSV export | Backlog |

---

## Version History

| Version | Date | Notes |
|---|---|---|
| v0.1 Alpha | 2026-06-21 | First external release — Home, Photos, Inventory, Markets |
