# Epic: Inventory Management & Lifecycle Tracking

**Created:** 2026-06-18

## Problem

FotoFlip currently manages photo processing, listing generation, and marketplace exports, but does not provide a way to track where inventory is physically stored or where an item is in the selling lifecycle.

As users scale beyond a few dozen listings, they need to quickly answer:

- Where is this item located?
- Has this item been listed yet?
- Which marketplace was it exported to?
- Has it sold?
- Has it shipped?

Without inventory tracking, users spend time searching through boxes and manually maintaining spreadsheets.

## Goals

Add lightweight inventory management without turning FotoFlip into a full inventory system.

Focus on:
- Physical item location
- Listing lifecycle tracking
- Marketplace export tracking
- Bulk inventory management

---

## Core Workflow

```
Import Photos
→ Generate Listings
→ Assign BOX-001
→ Export
→ Listed
→ Sold
→ Shipped
```

Inventory is a first-class feature, not two extra fields. This pipeline is the spine of the app.

---

## Navigation Change

Left vertical nav replaces current top header:

```
Photos
Listings
Inventory   ← new
Marketplaces
```

Dark black header. Marketplaces + Import Photos buttons top-right.

---

## Data Model

### New Fields

| Field | Description |
|---|---|
| `location` | Physical storage ID. Examples: BOX-001, SHELF-A-BOX-003. Default: BOX-001 |
| `status` | Lifecycle status (see below) |
| `date_listed` | Date exported to first marketplace |
| `date_sold` | Date sale completed |
| `date_shipped` | Date order fulfilled |
| `poshmark_exported` | Boolean |
| `whatnot_exported` | Boolean |
| `etsy_exported` | Boolean |

---

## Status Lifecycle

```
Ready → Review → Draft → Listed → Sold → Shipped → Archived
```

| Status | Definition |
|---|---|
| Ready | Listing generated, ready for export |
| Review | Needs user review |
| Draft | User intentionally saved for later |
| Listed | Exported to at least one marketplace |
| Sold | Sale completed |
| Shipped | Order fulfilled |
| Archived | No longer active inventory |

---

## Inventory Screen

### Stats Bar
Total Items · Ready · Listed · Sold · Shipped

### Status Filters (with counts)
ALL · READY · REVIEW · DRAFT · LISTED · SOLD · SHIPPED · ARCHIVED

### Search
By title, SKU, or location

### Table Columns
| Column | Notes |
|---|---|
| Image | Thumbnail |
| Item | Title |
| SKU | e.g. B0001 |
| Location | Pill badge (BOX-001) |
| Status | Colored pill |
| Poshmark | P ✓ / — |
| Whatnot | W ✓ / — |
| Etsy | E ✓ / — |
| Date Added | |
| Date Sold | |

### Status Color Guide
- Ready — green
- Review — orange
- Draft — gray
- Listed — blue
- Sold — green (dark)
- Shipped — teal
- Archived — gray (muted)

### Bulk Actions (appear on selection)
- Assign Location
- Change Status
- Export Selected
- Archive Selected
- Clear Selection

---

## Marketplace Integration

### Export Behavior
Current: Ready → CSV Export
New: Ready → export → prompt "Mark exported items as Listed?"

When confirmed, item status changes to Listed and the marketplace export flag is set.

---

## MVP Acceptance Criteria

- [ ] Left vertical nav with Inventory tab
- [ ] Stats bar (Total / Ready / Listed / Sold / Shipped)
- [ ] Location field added to data model
- [ ] Status field added (replaces current processing_status)
- [ ] Status filter tabs with live counts
- [ ] Search by title, SKU, location
- [ ] Table with all columns (image, item, SKU, location, status, P/W/E, dates)
- [ ] Bulk assign location
- [ ] Bulk change status
- [ ] Export → prompt to mark as Listed
- [ ] Existing items default: Status = Ready, Location = empty

---

## Phase 2

- Inventory counts by box
- Sold item reporting
- Marketplace sync status
- QR code labels
- Barcode scanning
- Inventory aging reports
