# FotoFlip — Claude Code Instructions

## What this app is
FotoFlip is a personal resale listing tool. You photograph items at the point of purchase, import them, and the app generates marketplace-ready listings with AI. Target user: one power reseller (Boca), expanding to small teams.

## Rules — always enforced
- **🌸 on all user-visible error messages** — every `toast(..., 'error')` and every `res.status(4xx/5xx).json({ error: '...' })` must start with 🌸
- **No brand names** (Hermès, Hermes) in any code, comments, or config files
- **No Co-Authored-By** attribution in git commit messages
- **No third-party runtime connections** — all fonts and libraries are local
- **No API keys** committed to git — use `.env` (gitignored)

## Tech stack
- Node.js + Express, port 3456 (reads `PORT` env var)
- SQLite via `better-sqlite3` — DB path reads `DATA_DIR` env var, falls back to `~/Library/Application Support/fotoflip/fotoflip.db`
- Sharp for image processing; `@imgly/background-removal-node` for local background removal
- AI: Claude `claude-sonnet-4-6` (primary) → OpenAI `gpt-4o` (fallback)
- Image hosting: Cloudinary (primary) → GitHub/jsDelivr (fallback)
- Frontend: vanilla HTML/CSS/JS — no framework, no build step

## Key conventions
- `generateSku(item, meta)` — frontend function (takes full item object)
- `buildSku(itemId, meta)` — server function (takes item ID)
- `inv_status` — selling lifecycle (ready/review/draft/listed/sold/shipped/archived)
- `processing_status` — pipeline state (pending/review/processing/done/failed)
- `status` — app toggle (Flip/Draft)
- Meta (title, brand, price, etc.) lives in `photos.metadata` JSON, not on `items` directly

## Running locally
```bash
cp .env.example .env   # fill in keys
npm install
node server.js         # http://localhost:3456
```

## Running tests
```bash
# Server must be running first
node --test tests/qa.test.mjs
```

## File structure
```
server.js          # Express app + all API routes
src/db.js          # SQLite init + migrations
src/processor.js   # Image pipeline (Sharp + bg removal)
public/
  index.html       # Single-page app shell
  app.js           # All frontend JS
  style.css        # All styles
tests/
  qa.test.mjs      # Node test runner — integration tests
assets/fonts/      # Local fonts (Josefin Slab)
```

## Deployment
Railway — see `railway.json`. Set these env vars on the service:
- `DATA_DIR=/data` (volume mount)
- `APP_URL=https://your-app.railway.app`
- All keys from `.env.example`
