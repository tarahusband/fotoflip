# FotoFlip

A desktop web app for resellers to prep listings at the point of purchase. Snap a photo, get AI-generated titles and descriptions, and export directly to Poshmark, Whatnot, and Etsy.

## What it does

- **Import photos** — drag and drop from phone or camera roll
- **Resale Studio** — AI removes background and generates a luxury product photo
- **AutoFlip** — AI writes title, description, condition notes, and tags from the photo
- **Bundle mode** — groups items into lots with a branded cover image
- **Marketplace export** — one-click CSV for Poshmark and Whatnot, direct to Etsy via Make.com
- **Inventory tracking** — lifecycle from Ready → Listed → Sold → Shipped

## Tech stack

- **Backend:** Node.js + Express, port 3456
- **Database:** SQLite via `better-sqlite3` (stored in `~/Library/Application Support/fotoflip/`)
- **Image processing:** `sharp` + `@imgly/background-removal-node` (local, no API required)
- **AI (images):** OpenAI `gpt-image-1` — Resale Studio background replacement
- **AI (text):** Claude `claude-sonnet-4-6` (primary) → OpenAI `gpt-4o` (fallback)
- **Image hosting:** Cloudinary (primary) → GitHub/jsDelivr (fallback)
- **Frontend:** Vanilla HTML/CSS/JS, no build step

## Setup

```bash
git clone https://github.com/yourusername/fotoflip.git
cd fotoflip
npm install
cp .env.example .env
# Fill in .env with your API keys
bash start-server.sh
open http://localhost:3456
```

## Required environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | AI text + image generation |
| `CLOUDINARY_CLOUD_NAME` | Image hosting for marketplace exports |
| `CLOUDINARY_API_KEY` | Cloudinary auth |
| `CLOUDINARY_API_SECRET` | Cloudinary auth |

See `.env.example` for all options.

## Project structure

```
fotoflip/
├── server.js           — Express server, all API routes
├── src/
│   ├── db.js           — SQLite setup and migrations
│   └── processor.js    — Image processing pipeline
├── public/
│   ├── index.html      — App shell (nav + views)
│   ├── app.js          — Frontend logic
│   └── style.css       — Design system
├── assets/
│   └── fonts/          — Bundled fonts (OFL licensed, no CDN)
├── tests/
│   ├── qa.test.mjs     — Automated API tests
│   └── qa-manual.md    — Manual QA checklist
├── epic-inventory.md   — Inventory feature spec
├── .env.example        — Environment variable template
└── start-server.sh     — Force-restart script
```

## Running tests

```bash
node --test tests/qa.test.mjs
```

## Notes

- Database and uploaded photos are stored outside the project directory and are never committed.
- All fonts are bundled locally — no CDN or network requests for assets.
- Poshmark CSV exports split automatically at 39 rows (Poshmark's batch limit).
