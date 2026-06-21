// FotoFlip — Frontend App

const API = '';

// ── State ─────────────────────────────────────────────────────────────────────
let items = [];
let stagedPhotos = [];
let pollTimer = null;
let activeItemId = null;
let activeTab = 'photo';
let activeFilter = 'all';
let searchQuery = '';
let selectedIds = new Set();

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function openMarketplaces() {
  activeItemId = null;
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  document.getElementById('detailEmpty').classList.add('hidden');
  const content = document.getElementById('detailContent');
  content.classList.remove('hidden');
  content.innerHTML = renderMarketplacesGlobal();
}

function renderMarketplacesGlobal() {
  const readyCount = items.filter(i => i.processing_status === 'done').length;
  const makeUrl = window._makeWebhookUrl || '';
  const etsyCard = makeUrl
    ? `<div class="marketplace-card">
        <div class="marketplace-header">
          <div class="marketplace-logo mp-etsy">E</div>
          <div class="marketplace-info">
            <div class="marketplace-name">Etsy via Make.com</div>
            <div class="marketplace-desc">Sends listing to Make.com → creates Etsy draft automatically</div>
          </div>
          <span class="status-pill status-done">Connected</span>
        </div>
        <div class="marketplace-actions">
          <button class="btn btn-sm btn-secondary" onclick="showMakeSetup()">⚙ Re-configure</button>
        </div>
      </div>`
    : `<div class="marketplace-card">
        <div class="marketplace-header">
          <div class="marketplace-logo mp-etsy">E</div>
          <div class="marketplace-info">
            <div class="marketplace-name">Etsy via Make.com</div>
            <div class="marketplace-desc">Paste your Make.com webhook URL to enable Etsy draft creation</div>
          </div>
          <span class="status-pill status-pending">Setup needed</span>
        </div>
        <div class="marketplace-actions">
          <button class="btn btn-sm btn-secondary" onclick="showMakeSetup()">⚙ Configure Make.com</button>
        </div>
      </div>`;

  return `<div class="detail-header">
    <div class="detail-header-left">
      <div class="detail-title">Marketplaces</div>
      <div class="detail-subtitle">${readyCount} item${readyCount !== 1 ? 's' : ''} ready to export</div>
    </div>
  </div>
  <div class="detail-tabs-content" style="padding:20px;display:flex;flex-direction:column;gap:16px;">
    <div class="marketplace-card">
      <div class="marketplace-header">
        <div class="marketplace-logo mp-whatnot">W</div>
        <div class="marketplace-info">
          <div class="marketplace-name">Whatnot</div>
          <div class="marketplace-desc">Exports all Ready items · uploads images to ImgBB</div>
        </div>
        <span class="status-pill status-done">Ready</span>
      </div>
      <div class="marketplace-actions">
        <button class="btn btn-sm btn-primary" onclick="exportAllWhatnot(this)" ${readyCount === 0 ? 'disabled' : ''}>⬇ Generate CSV</button>
      </div>
    </div>
    <div class="marketplace-card">
      <div class="marketplace-header">
        <div class="marketplace-logo mp-poshmark">P</div>
        <div class="marketplace-info">
          <div class="marketplace-name">Poshmark</div>
          <div class="marketplace-desc">Exports all Ready items · title, description, category, price</div>
        </div>
        <span class="status-pill status-done">Ready</span>
      </div>
      <div class="marketplace-actions">
        <button class="btn btn-sm btn-primary" onclick="exportAllPoshmark(this)" ${readyCount === 0 ? 'disabled' : ''}>⬇ Generate CSV</button>
      </div>
    </div>
    ${etsyCard}
  </div>`;
}

async function exportAllPoshmark(btn) {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  try {
    const res = await fetch('/api/export/poshmark');
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error || '🌸 Export failed', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `poshmark-bulk-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Poshmark CSV downloaded', 'success');
  } catch (e) {
    toast('🌸 Export failed', 'error');
  } finally {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

async function exportAllWhatnot(btn) {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Uploading…'; btn.disabled = true; }
  try {
    const res = await fetch('/api/export/whatnot');
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error || '🌸 Export failed', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `whatnot-bulk-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV downloaded', 'success');
  } catch (e) {
    toast('🌸 Export failed', 'error');
  } finally {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getMetadata(item) {
  const photo = (item.photos || [])[0];
  if (!photo || !photo.metadata) return {};
  try { return JSON.parse(photo.metadata); } catch { return {}; }
}

function generateSku(item, meta) {
  const box = (meta.box || '').trim() || 'BOX-001';
  return `${box}-${String(item.id).padStart(3, '0')}`;
}

function photoThumbUrl(photo) {
  if (!photo) return null;
  if (photo.processed_path) {
    const parts = photo.processed_path.split('/processed/');
    if (parts[1]) return `/processed/${parts[1]}`;
  }
  const filePath = photo.path || '';
  const uploadName = filePath.split('/uploads/').pop() || photo.name;
  return `/uploads/${uploadName}`;
}

function originalUrl(photo) {
  if (!photo) return null;
  const filePath = photo.path || '';
  const uploadName = filePath.split('/uploads/').pop() || photo.name;
  return `/uploads/${uploadName}`;
}

function processedUrl(photo) {
  if (!photo || !photo.processed_path) return null;
  const parts = photo.processed_path.split('/processed/');
  if (parts[1]) return `/processed/${parts[1]}`;
  return null;
}

function renderStatusPill(item) {
  const s = item.processing_status;
  if (s === 'processing') return `<span class="status-pill status-processing"><span class="spinner"></span> Processing</span>`;
  if (s === 'done') return `<span class="status-pill status-done">Ready</span>`;
  if (s === 'failed') return `<span class="status-pill status-failed">Error</span>`;
  if (s === 'review') return `<span class="status-pill status-review">Review</span>`;
  if (s === 'pending') return `<span class="status-pill status-pending">Queued</span>`;
  return '';
}

// ── Process ───────────────────────────────────────────────────────────────────
// ── Items ─────────────────────────────────────────────────────────────────────
async function loadItems() {
  try {
    items = await apiFetch('/api/items');
    renderSidebar();
    if (activeItemId) {
      const item = items.find(i => i.id === activeItemId);
      if (item) renderDetail(item);
    }
    scheduleRefreshIfNeeded();
  } catch (e) {
    toast('🌸 Failed to load items', 'error');
  }
}

function scheduleRefreshIfNeeded() {
  const hasPending = items.some(i => i.processing_status === 'processing' || i.processing_status === 'pending');
  clearTimeout(pollTimer);
  if (hasPending) pollTimer = setTimeout(loadItems, 2500);
}

function filteredItems() {
  let list = items;
  if (activeFilter === 'done') list = list.filter(i => i.processing_status === 'done');
  else if (activeFilter === 'draft') list = list.filter(i => i.processing_status === 'processing' || i.processing_status === 'pending');
  else if (activeFilter === 'review') list = list.filter(i => i.processing_status === 'review');
  else if (activeFilter === 'failed') list = list.filter(i => i.processing_status === 'failed');
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(i => {
      const meta = getMetadata(i);
      return String(i.id).includes(q) ||
        (meta.brand || '').toLowerCase().includes(q) ||
        (meta.category || '').toLowerCase().includes(q) ||
        (meta.color || '').toLowerCase().includes(q);
    });
  }
  return list;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  document.getElementById('countAll').textContent = items.length;
  document.getElementById('countDone').textContent = items.filter(i => i.processing_status === 'done').length;
  document.getElementById('countDraft').textContent = items.filter(i => i.processing_status === 'processing' || i.processing_status === 'pending').length;
  document.getElementById('countReview').textContent = items.filter(i => i.processing_status === 'review').length;
  document.getElementById('countError').textContent = items.filter(i => i.processing_status === 'failed').length;

  const list = document.getElementById('sidebarList');
  const filtered = filteredItems();

  if (!filtered.length) {
    list.innerHTML = '<div class="sidebar-empty">No items found</div>';
    return;
  }

  const allSelected = filtered.length > 0 && filtered.every(i => selectedIds.has(i.id));

  list.innerHTML = `
    <div class="sidebar-select-bar">
      <label class="sidebar-select-all" onclick="toggleSelectAll()">
        <input type="checkbox" ${allSelected ? 'checked' : ''} onclick="event.stopPropagation();toggleSelectAll()"> Select all
      </label>
      ${selectedIds.size > 0 ? `<span class="selected-count">${selectedIds.size} selected</span>` : ''}
    </div>
    ${filtered.map(item => {
      const photo = (item.photos || [])[0];
      const meta = getMetadata(item);
      const thumb = photoThumbUrl(photo);
      const isActive = item.id === activeItemId;
      const isSelected = selectedIds.has(item.id);
      const brand = meta.brand && meta.brand !== 'Unknown' ? meta.brand : '';
      const cat = meta.category || '';
      const label = brand && cat ? `${brand} ${cat}` : brand || cat || 'Item';
      return `<div class="sidebar-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" data-id="${item.id}" onclick="openItem(${item.id})">
        <div class="sidebar-item-check" onclick="event.stopPropagation();toggleSelect(${item.id})">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation();toggleSelect(${item.id})">
        </div>
        <div class="sidebar-thumb">
          ${thumb ? `<img src="${thumb}" alt="" onerror="this.style.display='none'">` : '<div class="sidebar-thumb-ph">📷</div>'}
        </div>
        <div class="sidebar-item-info">
          <div class="sidebar-item-id">#${String(item.id).padStart(3, '0')}</div>
          <div class="sidebar-item-label">${escHtml(label)}</div>
        </div>
        ${renderStatusPill(item)}
      </div>`;
    }).join('')}`;

  renderBulkBar();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderSidebar();
}

function toggleSelectAll() {
  const filtered = filteredItems();
  const allSelected = filtered.every(i => selectedIds.has(i.id));
  if (allSelected) filtered.forEach(i => selectedIds.delete(i.id));
  else filtered.forEach(i => selectedIds.add(i.id));
  renderSidebar();
}

function renderBulkBar() {
  let bar = document.getElementById('bulkActionBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulkActionBar';
    bar.className = 'bulk-action-bar';
    document.querySelector('.sidebar').appendChild(bar);
  }
  if (selectedIds.size === 0) {
    bar.innerHTML = '';
    bar.classList.remove('visible');
    return;
  }
  bar.classList.add('visible');
  bar.innerHTML = `
    <span class="bulk-count">${selectedIds.size} item${selectedIds.size > 1 ? 's' : ''}</span>
    <button class="btn btn-sm btn-primary" onclick="bulkUpdatePhotos()">↻ Update Photos</button>
    <button class="btn btn-sm btn-purple" onclick="bulkUpdateDescriptions()">✦ Update Descriptions</button>
    <button class="btn btn-sm btn-secondary" onclick="showBulkBundlePicker()">🏷 Bundle Label</button>
    <button class="btn btn-sm btn-secondary" onclick="bulkMarkReady()">✓ Mark Ready</button>
    <button class="btn btn-sm btn-secondary" onclick="selectedIds.clear();renderSidebar()">✕</button>
  `;
  renderBulkProgressEl();
}

async function waitForItem(id, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const item = await apiFetch(`/api/items/${id}`);
      if (item.processing_status === 'done' || item.processing_status === 'failed') return item;
    } catch (e) { /* keep polling */ }
  }
}

let bulkProgressLabel = '';

function setBulkProgress(label) {
  bulkProgressLabel = label;
  renderBulkProgressEl();
}

function renderBulkProgressEl() {
  const bar = document.getElementById('bulkActionBar');
  if (!bar) return;
  let el = bar.querySelector('.bulk-progress');
  if (bulkProgressLabel) {
    if (!el) {
      el = document.createElement('span');
      el.className = 'bulk-progress';
      bar.insertBefore(el, bar.firstChild);
    }
    el.textContent = bulkProgressLabel;
  } else if (el) {
    el.remove();
  }
}

async function bulkUpdatePhotos() {
  const ids = [...selectedIds];
  let done = 0;
  for (const id of ids) {
    setBulkProgress(`Photo ${++done} of ${ids.length}…`);
    try {
      await apiFetch(`/api/items/${id}/process`, { method: 'POST', body: JSON.stringify({}) });
      await waitForItem(id);
    } catch (e) { /* continue to next */ }
    await loadItems();
  }
  setBulkProgress('');
  toast(`${ids.length} photo${ids.length > 1 ? 's' : ''} processed`, 'success');
}

async function bulkUpdateDescriptions() {
  const ids = [...selectedIds];
  let done = 0;
  for (const id of ids) {
    setBulkProgress(`Description ${++done} of ${ids.length}…`);
    try {
      await apiFetch(`/api/items/${id}/listing/generate`, { method: 'POST' });
    } catch (e) { /* continue to next */ }
    await loadItems();
  }
  setBulkProgress('');
  toast(`${ids.length} description${ids.length > 1 ? 's' : ''} updated`, 'success');
}

async function bulkMarkReady() {
  const ids = [...selectedIds];
  let done = 0;
  for (const id of ids) {
    setBulkProgress(`Marking ${++done} of ${ids.length}…`);
    await apiFetch(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify({ processing_status: 'pending' }) }).catch(() => {});
    await loadItems();
    await new Promise(r => setTimeout(r, 300));
    await apiFetch(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify({ processing_status: 'done' }) }).catch(() => {});
    await loadItems();
  }
  setBulkProgress('');
  toast(`${ids.length} item${ids.length > 1 ? 's' : ''} marked ready`, 'success');
}

function showBulkBundlePicker() {
  const bar = document.getElementById('bulkActionBar');
  if (!bar) return;
  const BUNDLE_TYPES = ['Auto-detect', 'Floral', 'Gold Tone', 'Animal', 'Mixed Vintage', 'LEGO', 'Toys', 'Earrings', 'Custom'];
  bar.innerHTML = `
    <span class="bulk-count">${selectedIds.size} item${selectedIds.size > 1 ? 's' : ''}</span>
    <select id="bulkBundleType" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
      ${BUNDLE_TYPES.map(t => `<option value="${t === 'Auto-detect' ? '' : t}">${t}</option>`).join('')}
    </select>
    <button class="btn btn-sm btn-primary" onclick="bulkBundleLabel()">Apply</button>
    <button class="btn btn-sm btn-secondary" onclick="renderBulkBar()">Cancel</button>
  `;
}

async function bulkBundleLabel() {
  const ids = [...selectedIds];
  const bundleType = document.getElementById('bulkBundleType')?.value || '';
  let done = 0;
  for (const id of ids) {
    setBulkProgress(`Label ${++done} of ${ids.length}…`);
    try {
      await apiFetch(`/api/items/${id}/bundle`, {
        method: 'PUT',
        body: JSON.stringify({ is_bundle: true, bundle_type: bundleType }),
      });
    } catch (e) { /* continue */ }
  }
  await loadItems();
  setBulkProgress('');
  toast(`Bundle labels generated for ${ids.length} item${ids.length > 1 ? 's' : ''}`);
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function openItem(id) {
  activeItemId = id;
  document.querySelectorAll('.sidebar-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === id)
  );
  document.getElementById('detailEmpty').classList.add('hidden');
  document.getElementById('detailContent').classList.remove('hidden');
  const item = items.find(i => i.id === id);
  if (item) renderDetail(item);
}

function renderDetail(item) {
  const meta = getMetadata(item);
  const photo = (item.photos || [])[0];
  const dateStr = item.purchase_date || (item.created_at || '').slice(0, 10) || '';
  const photoCount = (item.photos || []).length;
  const thumb = photoThumbUrl(photo);
  const isDraft = item.status === 'Draft';

  const allFiltered = filteredItems();
  const idx = allFiltered.findIndex(i => i.id === item.id);
  const prevId = idx > 0 ? allFiltered[idx - 1].id : null;
  const nextId = idx < allFiltered.length - 1 ? allFiltered[idx + 1].id : null;

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-header">
      <div class="detail-header-left">
        <div class="detail-thumb">
          ${thumb ? `<img src="${thumb}" alt="">` : '<div class="detail-thumb-ph">📷</div>'}
        </div>
        <div>
          <div class="detail-item-id">
            Item #${String(item.id).padStart(3, '0')}
            ${renderStatusPill(item)}
            ${isDraft ? '<span class="status-pill status-draft">Draft</span>' : ''}
          </div>
          <div class="detail-item-sub">Imported: ${dateStr} · ${photoCount} photo${photoCount !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="detail-header-actions">
        <button class="btn btn-sm btn-outline-danger" onclick="deleteItem(${item.id})">Delete</button>
        <button class="btn btn-sm btn-outline ${isDraft ? 'btn-draft-active' : ''}" onclick="toggleDraft(${item.id})">
          ${isDraft ? '✓ Draft' : 'Mark Draft'}
        </button>
        <button class="nav-arrow" onclick="openItem(${prevId})" ${!prevId ? 'disabled' : ''}>←</button>
        <button class="nav-arrow" onclick="openItem(${nextId})" ${!nextId ? 'disabled' : ''}>→</button>
      </div>
    </div>

    <div class="detail-tabs">
      <button class="detail-tab ${activeTab === 'photo' ? 'active' : ''}" onclick="switchTab('photo')">Photo</button>
      <button class="detail-tab ${activeTab === 'listing' ? 'active' : ''}" onclick="switchTab('listing')">Listing</button>
      <button class="detail-tab ${activeTab === 'marketplaces' ? 'active' : ''}" onclick="switchTab('marketplaces')">Marketplaces</button>
    </div>

    <div class="detail-tab-content" id="tabContent">
      ${renderTabContent(item, meta, photo)}
    </div>`;
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.detail-tab').forEach(t =>
    t.classList.toggle('active', t.textContent.toLowerCase() === tab)
  );
  const item = items.find(i => i.id === activeItemId);
  if (!item) return;
  const meta = getMetadata(item);
  const photo = (item.photos || [])[0];
  document.getElementById('tabContent').innerHTML = renderTabContent(item, meta, photo);
}

function renderTabContent(item, meta, photo) {
  if (activeTab === 'photo') return renderPhotoTab(item, photo);
  if (activeTab === 'listing') return renderListingTab(item, meta);
  if (activeTab === 'marketplaces') return renderMarketplacesTab(item, meta);
  return '';
}

// ── Photo Tab ─────────────────────────────────────────────────────────────────
function renderPhotoTab(item, photo) {
  const orig = originalUrl(photo);
  const proc = processedUrl(photo);
  const isReview = item.processing_status === 'review';
  const isProcessing = item.processing_status === 'processing' || item.processing_status === 'pending';
  const isBundle = !!item.is_bundle;
  const bundleType = item.bundle_type || '';
  const bundleCount = item.bundle_count || 0;

  const BUNDLE_TYPES = ['Floral', 'Gold Tone', 'Animal', 'Mixed Vintage', 'LEGO', 'Toys', 'Earrings', 'Custom'];
  const BUNDLE_COUNTS = [3, 5, 8, 10];
  const BUNDLE_PRICES = { 3: 25, 5: 40, 8: 60, 10: 75 };

  const reviewPanel = isReview ? `
    <div class="review-panel">
      <div class="review-panel-title">Review your photo before processing</div>

      <div class="review-toggle-row">
        <label class="toggle-label">
          <input type="checkbox" id="bundleToggle" ${isBundle ? 'checked' : ''} onchange="onBundleToggle(${item.id})">
          <span class="toggle-track"></span>
          <span>Bundle / flat lay</span>
        </label>
      </div>

      <div id="bundleOptions" style="display:${isBundle ? 'flex' : 'none'};flex-direction:column;gap:10px;margin-top:4px">
        <div class="field-row">
          <div class="field-group">
            <label class="field-label">Bundle type</label>
            <select class="field-input" id="bundleTypeSelect" onchange="saveBundleMeta(${item.id})">
              <option value="">— select —</option>
              ${BUNDLE_TYPES.map(t => `<option value="${t}" ${bundleType === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">Item count</label>
            <select class="field-input" id="bundleCountSelect" onchange="saveBundleMeta(${item.id})">
              <option value="0">— select —</option>
              ${BUNDLE_COUNTS.map(n => `<option value="${n}" ${bundleCount === n ? 'selected' : ''}>${n} items · $${BUNDLE_PRICES[n]}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="review-actions">
        <button class="btn btn-primary" onclick="processNow(${item.id})">▶ Resale Studio</button>
      </div>
    </div>` : '';

  const labeledUrl = isBundle ? `/processed/item-${item.id}-labeled.jpg` : null;
  const studioDisplay = labeledUrl
    ? `<img src="${labeledUrl}?t=${Date.now()}" class="photo-full" alt="Bundle Label" onerror="this.src='${proc || ''}';">`
    : proc
      ? `<img src="${proc}" class="photo-full" alt="Enhanced">`
      : `<div class="photo-placeholder">${isProcessing ? '<span class="spinner"></span> Processing…' : 'Not processed yet'}</div>`;

  return `<div class="photo-tab">
    <div class="photo-comparison">
      <div class="photo-panel">
        <div class="photo-panel-label">Original</div>
        ${orig ? `<img src="${orig}" class="photo-full" alt="Original">` : `<div class="photo-placeholder">No original</div>`}
      </div>
      ${!isReview ? `<div class="photo-panel">
        <div class="photo-panel-label">${isBundle ? 'Bundle Label' : 'Resale Studio'}</div>
        ${studioDisplay}
      </div>` : ''}
    </div>

    ${reviewPanel}

    ${!isReview ? `<div class="photo-actions" style="flex-wrap:wrap;gap:12px;">
      <label class="toggle-label" style="font-size:13px;">
        <input type="checkbox" id="bundleToggle" ${isBundle ? 'checked' : ''} onchange="onBundleToggle(${item.id})">
        <span class="toggle-track"></span>
        <span>Bundle / lot</span>
      </label>
      <div id="bundleOptions" style="display:${isBundle ? 'flex' : 'none'};gap:8px;align-items:center;flex-wrap:wrap;">
        <select class="field-input" id="bundleTypeSelect" style="width:140px;font-size:12px;" onchange="saveBundleMeta(${item.id})">
          <option value="">— type —</option>
          ${['Floral','Gold Tone','Animal','Mixed Vintage','LEGO','Toys','Earrings','Custom'].map(t => `<option value="${t}" ${bundleType===t?'selected':''}>${t}</option>`).join('')}
        </select>
        <select class="field-input" id="bundleCountSelect" style="width:120px;font-size:12px;" onchange="saveBundleMeta(${item.id})">
          <option value="0">— count —</option>
          ${[3,5,8,10].map(n => `<option value="${n}" ${bundleCount===n?'selected':''}>${n} items</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary btn-sm" onclick="redo(${item.id})" ${isProcessing ? 'disabled' : ''}>↻ Resale Studio</button>
    </div>` : ''}
  </div>`;
}

function onBundleToggle(id) {
  const checked = document.getElementById('bundleToggle').checked;
  document.getElementById('bundleOptions').style.display = checked ? 'flex' : 'none';
  saveBundleMeta(id);
}

async function saveBundleMeta(id) {
  const isBundle = document.getElementById('bundleToggle')?.checked || false;
  const bundleType = document.getElementById('bundleTypeSelect')?.value || '';
  const bundleCount = parseInt(document.getElementById('bundleCountSelect')?.value) || 0;
  try {
    await apiFetch(`/api/items/${id}/bundle`, {
      method: 'PUT',
      body: JSON.stringify({ is_bundle: isBundle, bundle_type: bundleType, bundle_count: bundleCount }),
    });
    const item = items.find(i => i.id === id);
    if (item) {
      item.is_bundle = isBundle ? 1 : 0;
      item.bundle_type = bundleType;
      item.bundle_count = bundleCount;
      renderDetail(item);
    }
  } catch (e) { toast('🌸 Bundle save failed: ' + e.message, 'error'); }
}

async function exportItemWhatnot(id, btn) {
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const response = await fetch(`/api/items/${id}/export/whatnot`, { method: 'POST' });
    if (!response.ok) { const e = await response.json(); throw new Error(e.error || 'Export failed'); }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `whatnot-${id}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast('Whatnot CSV downloaded');
  } catch (e) { toast('🌸 ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = original; }
}

async function exportItemPoshmark(id, btn) {
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const response = await fetch(`/api/items/${id}/export/poshmark`, { method: 'POST' });
    if (!response.ok) { const e = await response.json(); throw new Error(e.error || 'Export failed'); }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `poshmark-${id}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast('Poshmark CSV downloaded');
  } catch (e) { toast('🌸 ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = original; }
}

async function processNow(id) {
  const isBundle = document.getElementById('bundleToggle')?.checked || false;
  const bundleType = document.getElementById('bundleTypeSelect')?.value || '';
  const bundleCount = parseInt(document.getElementById('bundleCountSelect')?.value) || 0;
  const item = items.find(i => i.id === id);
  if (item) { item.is_bundle = isBundle ? 1 : 0; item.bundle_type = bundleType; item.bundle_count = bundleCount; }
  try {
    await apiFetch(`/api/items/${id}/process`, {
      method: 'POST',
      body: JSON.stringify({ is_bundle: isBundle, bundle_type: bundleType, bundle_count: bundleCount }),
    });
    if (isBundle) {
      await apiFetch(`/api/items/${id}/bundle`, {
        method: 'PUT',
        body: JSON.stringify({ is_bundle: true, bundle_type: bundleType, bundle_count: bundleCount }),
      });
    }
    scheduleRefreshIfNeeded();
    await loadItems();
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

// ── Listing Tab ───────────────────────────────────────────────────────────────
function renderListingTab(item, meta) {
  const title = meta.title || '';
  const description = meta.description || '';
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const hasAI = !!(title || description);

  return `<div class="listing-tab">
    <div class="listing-header">
      <div class="listing-ai-label">AutoFlip <span class="ai-badge">AI Generated</span></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-outline" id="btnExtract" onclick="reExtract(${item.id})" title="Re-run metadata extraction from photo">↺ Re-extract</button>
        <button class="btn btn-sm btn-purple" id="btnGenerate" onclick="generateListing(${item.id})">
          ${hasAI ? '↺ Regenerate' : '✦ Generate Listing'}
        </button>
      </div>
    </div>

    <div class="listing-fields">
      ${hasAI ? `
      <div class="field-group">
        <label class="field-label">Title <span class="char-count">${title.length}/80</span></label>
        <input class="field-input" id="fTitle" value="${escHtml(title)}" maxlength="80"
          oninput="updateCharCount(this,80)" onchange="saveListing(${item.id})">
      </div>

      <div class="field-group">
        <label class="field-label">Description <span class="char-count">${description.length}/5000</span></label>
        <textarea class="field-textarea" id="fDesc" maxlength="5000"
          oninput="updateCharCount(this,5000)" onchange="saveListing(${item.id})">${escHtml(description)}</textarea>
      </div>` : `
      <div class="listing-empty">
        <p>Click <strong>Generate Listing</strong> to have AI write a title and description from this photo.</p>
      </div>`}

      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Brand</label>
          <input class="field-input" id="fBrand" value="${escHtml(meta.brand || '')}" onchange="saveListing(${item.id})">
        </div>
        <div class="field-group">
          <label class="field-label">Category</label>
          <input class="field-input" id="fCategory" value="${escHtml(meta.category || '')}" onchange="saveListing(${item.id})">
        </div>
      </div>

      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Condition</label>
          <select class="field-select" id="fCondition" onchange="saveListing(${item.id})">
            ${['NWT','NWOT','Excellent','Very Good','Good','Fair','Poor'].map(c =>
              `<option ${(meta.conditionText || 'Good') === c ? 'selected' : ''}>${escHtml(c)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Price ($)</label>
          <input class="field-input" type="number" id="fPrice" value="${meta.suggestedPrice || ''}" onchange="saveListing(${item.id})">
        </div>
      </div>

      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Material</label>
          <input class="field-input" id="fMaterial" value="${escHtml(meta.material || '')}" onchange="saveListing(${item.id})">
        </div>
        <div class="field-group">
          <label class="field-label">Color</label>
          <input class="field-input" id="fColor" value="${escHtml(meta.color || '')}" onchange="saveListing(${item.id})">
        </div>
      </div>

      <div class="field-row">
        <div class="field-group">
          <label class="field-label">SKU</label>
          <input class="field-input" id="fSku" value="${escHtml(generateSku(item, meta))}" onchange="saveListing(${item.id})">
        </div>
        <div class="field-group">
          <label class="field-label">Size</label>
          <input class="field-input" id="fSize" value="${escHtml(meta.size || '')}" onchange="saveListing(${item.id})">
        </div>
      </div>

      <div class="field-row">
        <div class="field-group">
          <label class="field-label">Box / Location</label>
          <input class="field-input" id="fBox" value="${escHtml(meta.box || '')}" placeholder="BOX-001" onchange="saveListing(${item.id})">
        </div>
        <div class="field-group">
          <label class="field-label">Weight</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input class="field-input" id="fWeight" type="text" inputmode="decimal" value="${escHtml(item.weight || '')}" placeholder="e.g. 3" style="flex:1" onchange="saveWeight(${item.id})">
            <select id="fWeightUnit" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:#fff" onchange="saveWeight(${item.id})">
              <option value="LB" ${(item.weight_unit||'LB')==='LB'?'selected':''}>LB</option>
              <option value="OZ" ${(item.weight_unit||'LB')==='OZ'?'selected':''}>OZ</option>
            </select>
          </div>
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">AI Hint <span class="field-hint">Tell AI what this item is before extraction</span></label>
        <input class="field-input" id="fHint" value="${escHtml(meta.hint || '')}" placeholder="e.g. vintage brooch" onchange="saveListing(${item.id})">
      </div>

      <div class="field-group">
        <label class="field-label">Condition Notes</label>
        <input class="field-input" id="fNotes" value="${escHtml(meta.conditionNotes || '')}" onchange="saveListing(${item.id})">
      </div>

      <div class="field-group">
        <label class="field-label">Tags <span class="char-count">${tags.length}/12</span></label>
        <div class="tags-container">
          ${tags.map(t => `<span class="tag-chip">${escHtml(t)}<button onclick="removeTag(${item.id},'${escHtml(t)}')">×</button></span>`).join('')}
          <input class="tag-input" placeholder="Add tag…" onkeydown="addTag(event,${item.id})">
        </div>
      </div>
    </div>
  </div>`;
}

// ── Marketplaces Tab ──────────────────────────────────────────────────────────
function renderMarketplacesTab(item, meta) {
  const hasListing = !!(meta.title || meta.brand);
  const makeUrl = window._makeWebhookUrl || '';
  const etsyCard = makeUrl
    ? `<div class="marketplace-card">
        <div class="marketplace-header">
          <div class="marketplace-logo mp-etsy">E</div>
          <div class="marketplace-info">
            <div class="marketplace-name">Etsy via Make.com</div>
            <div class="marketplace-desc">Sends listing to Make.com → creates Etsy draft automatically</div>
          </div>
          <span class="status-pill status-done">Connected</span>
        </div>
        <div class="marketplace-actions">
          <button class="btn btn-sm btn-primary" id="makeUploadBtn" onclick="sendToMake(${item.id})" ${!hasListing ? 'disabled' : ''}>↑ Send to Etsy via Make</button>
          <button class="btn btn-sm btn-secondary" onclick="showMakeSetup()" style="margin-left:8px">⚙ Re-configure</button>
        </div>
      </div>`
    : `<div class="marketplace-card">
        <div class="marketplace-header">
          <div class="marketplace-logo mp-etsy">E</div>
          <div class="marketplace-info">
            <div class="marketplace-name">Etsy via Make.com</div>
            <div class="marketplace-desc">Paste your Make.com webhook URL to enable Etsy draft creation</div>
          </div>
          <span class="status-pill status-pending">Setup needed</span>
        </div>
        <div class="marketplace-actions">
          <button class="btn btn-sm btn-secondary" onclick="showMakeSetup()">⚙ Configure Make.com</button>
        </div>
      </div>`;

  return `<div class="marketplaces-tab">
    ${!hasListing ? `<div class="marketplace-notice">Generate a listing first (Listing tab) to enable exports.</div>` : ''}

    <div class="marketplace-card">
      <div class="marketplace-header">
        <div class="marketplace-logo mp-whatnot">W</div>
        <div class="marketplace-info">
          <div class="marketplace-name">Whatnot</div>
          <div class="marketplace-desc">Download Whatnot-ready CSV · uploads image to ImgBB if key is set</div>
        </div>
        <span class="status-pill status-done">Ready</span>
      </div>
      <div class="marketplace-actions">
        <button class="btn btn-sm btn-primary" onclick="exportItemWhatnot(${item.id}, this)">⬇ This Item</button>
      </div>
    </div>

    <div class="marketplace-card">
      <div class="marketplace-header">
        <div class="marketplace-logo mp-poshmark">P</div>
        <div class="marketplace-info">
          <div class="marketplace-name">Poshmark</div>
          <div class="marketplace-desc">title, description, category, condition, brand, color, tags, price</div>
        </div>
        <span class="status-pill status-done">Ready</span>
      </div>
      <div class="marketplace-actions">
        <button class="btn btn-sm btn-primary" onclick="exportItemPoshmark(${item.id}, this)">⬇ This Item</button>
      </div>
    </div>

    ${etsyCard}

    <div class="marketplace-card marketplace-disabled">
      <div class="marketplace-header">
        <div class="marketplace-logo mp-ebay">e</div>
        <div class="marketplace-info">
          <div class="marketplace-name">eBay</div>
          <div class="marketplace-desc">Coming soon</div>
        </div>
        <span class="status-pill status-pending">Soon</span>
      </div>
    </div>
  </div>`;
}

async function checkMakeStatus() {
  try {
    const data = await apiFetch('/api/settings/make-webhook');
    window._makeWebhookUrl = data.url || '';
  } catch (e) {
    window._makeWebhookUrl = '';
  }
}

function showMakeSetup() {
  const current = window._makeWebhookUrl || '';
  const url = prompt(
    'Paste your Make.com webhook URL here.\n\n' +
    'In Make.com: New scenario → Webhooks module → Custom webhook → Copy URL\n\n' +
    'It should start with https://hook.make.com/ or https://hook.us1.make.com/',
    current
  );
  if (!url) return;
  apiFetch('/api/settings/make-webhook', {
    method: 'POST',
    body: JSON.stringify({ url }),
  }).then(() => {
    window._makeWebhookUrl = url;
    toast('Make.com webhook saved!', 'success');
    const item = items.find(i => i.id === activeItemId);
    if (item) renderDetail(item);
  }).catch(e => toast('🌸 ' + e.message, 'error'));
}

async function sendToMake(id) {
  const btn = document.getElementById('makeUploadBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await apiFetch(`/api/items/${id}/export/make`, { method: 'POST' });
    toast('Sent to Make.com → Etsy draft being created!', 'success');
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↑ Send to Etsy via Make'; }
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function redo(id) {
  try {
    await apiFetch(`/api/items/${id}/process`, { method: 'POST', body: JSON.stringify({}) });
    scheduleRefreshIfNeeded();
    await loadItems();
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

async function deleteItem(id) {
  if (!confirm('Delete this item and its photos?')) return;
  try {
    await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
    activeItemId = null;
    document.getElementById('detailContent').classList.add('hidden');
    document.getElementById('detailEmpty').classList.remove('hidden');
    toast('Deleted');
    await loadItems();
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

async function reExtract(id) {
  const btn = document.getElementById('btnExtract');
  if (btn) { btn.disabled = true; btn.textContent = 'Extracting…'; }
  try {
    const updated = await apiFetch(`/api/items/${id}/metadata/extract`, { method: 'POST' });
    const item = items.find(i => i.id === id);
    if (item) {
      const photo = (item.photos || [])[0];
      if (photo) photo.metadata = JSON.stringify(updated);
    }
    switchTab('listing');
    toast('Metadata re-extracted');
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '↺ Re-extract'; }
  }
}

async function generateListing(id) {
  const btn = document.getElementById('btnGenerate');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const listing = await apiFetch(`/api/items/${id}/listing/generate`, { method: 'POST' });
    const item = items.find(i => i.id === id);
    if (item) {
      const photo = (item.photos || [])[0];
      if (photo) {
        const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
        photo.metadata = JSON.stringify({ ...meta, ...listing });
      }
    }
    switchTab('listing');
    toast('Listing generated');
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '↺ Regenerate'; }
  }
}

async function saveWeight(id) {
  const weight = document.getElementById('fWeight')?.value?.trim() || '';
  const weight_unit = document.getElementById('fWeightUnit')?.value || 'LB';
  try {
    await apiFetch(`/api/items/${id}/bundle`, { method: 'PUT', body: JSON.stringify({ weight, weight_unit }) });
    const item = items.find(i => i.id === id);
    if (item) { item.weight = weight; item.weight_unit = weight_unit; }
  } catch (e) { toast('🌸 Save failed: ' + e.message, 'error'); }
}

async function saveListing(id) {
  const val = id => document.getElementById(id)?.value;
  const data = {};
  if (val('fTitle') !== undefined) data.title = val('fTitle');
  if (val('fDesc') !== undefined) data.description = val('fDesc');
  if (val('fBrand') !== undefined) data.brand = val('fBrand');
  if (val('fCategory') !== undefined) data.category = val('fCategory');
  if (val('fCondition') !== undefined) data.conditionText = val('fCondition');
  if (val('fPrice') !== undefined) data.suggestedPrice = val('fPrice');
  if (val('fMaterial') !== undefined) data.material = val('fMaterial');
  if (val('fColor') !== undefined) data.color = val('fColor');
  if (val('fNotes') !== undefined) data.conditionNotes = val('fNotes');
  if (val('fSku') !== undefined) data.sku = val('fSku');
  if (val('fSize') !== undefined) data.size = val('fSize');
  if (val('fBox') !== undefined) data.box = val('fBox');
  if (val('fHint') !== undefined) data.hint = val('fHint');

  try {
    await apiFetch(`/api/items/${id}/metadata`, { method: 'PUT', body: JSON.stringify(data) });
    const item = items.find(i => i.id === id);
    if (item) {
      const photo = (item.photos || [])[0];
      if (photo) {
        const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
        photo.metadata = JSON.stringify({ ...meta, ...data });
      }
    }
  } catch (e) {
    toast('🌸 Save failed: ' + e.message, 'error');
  }
}

async function exportCSV(id, platform) {
  try {
    const res = await fetch(`/api/items/${id}/export/${platform}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${platform}-item-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`${platform} CSV downloaded`);
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

async function toggleDraft(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  const newStatus = item.status === 'Draft' ? 'Flip' : 'Draft';
  try {
    await apiFetch(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    item.status = newStatus;
    renderSidebar();
    renderDetail(item);
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

async function removeTag(id, tag) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  const photo = (item.photos || [])[0];
  if (!photo) return;
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
  const tags = (meta.tags || []).filter(t => t !== tag);
  meta.tags = tags;
  photo.metadata = JSON.stringify(meta);
  await apiFetch(`/api/items/${id}/metadata`, { method: 'PUT', body: JSON.stringify({ tags }) });
  switchTab('listing');
}

async function addTag(event, id) {
  if (event.key !== 'Enter') return;
  const tag = event.target.value.trim();
  if (!tag) return;
  const item = items.find(i => i.id === id);
  if (!item) return;
  const photo = (item.photos || [])[0];
  if (!photo) return;
  const meta = photo.metadata ? JSON.parse(photo.metadata) : {};
  const tags = [...(meta.tags || []), tag];
  meta.tags = tags;
  photo.metadata = JSON.stringify(meta);
  await apiFetch(`/api/items/${id}/metadata`, { method: 'PUT', body: JSON.stringify({ tags }) });
  switchTab('listing');
}

function updateCharCount(el, max) {
  const label = el.parentElement.querySelector('.char-count');
  if (label) label.textContent = `${el.value.length}/${max}`;
}

// ── Import Modal ──────────────────────────────────────────────────────────────
function openImport() {
  stagedPhotos = [];
  renderImportStep();
  document.getElementById('importModal').classList.add('open');
}

function closeImport() {
  document.getElementById('importModal').classList.remove('open');
}

function renderImportStep() {
  const body = document.getElementById('importBody');
  const footer = document.getElementById('importFooter');

  body.innerHTML = `
    <div class="drop-zone" id="dropZone">
      <div class="drop-zone-icon">📷</div>
      <h3>Select photos to import</h3>
      <p>Each photo becomes one listing — drag & drop or click to choose</p>
      <input type="file" id="fileInput" multiple accept="image/*" style="display:none">
    </div>
    ${stagedPhotos.length ? `
    <div class="photo-staging" style="margin-top:16px">
      ${stagedPhotos.map(p => `
        <div class="staged-photo selected">
          <img src="${p.url}" alt="${escHtml(p.name)}" loading="lazy">
          <div class="select-check">✓</div>
        </div>`).join('')}
    </div>` : ''}`;

  footer.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex:1">
      <span class="item-date">${stagedPhotos.length} photo${stagedPhotos.length !== 1 ? 's' : ''} selected</span>
      ${stagedPhotos.length ? `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:12px;color:var(--dark);opacity:0.6">Box</label>
          <input id="importBox" type="text" placeholder="BOX-001" style="width:90px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:12px;color:var(--dark);opacity:0.6">Hint</label>
          <input id="importHint" type="text" placeholder="e.g. vintage brooches" style="width:160px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:12px;color:var(--dark);opacity:0.6">Weight</label>
          <input id="importWeight" type="text" inputmode="decimal" placeholder="e.g. 3" style="width:64px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
          <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;font-size:12px">
            <button id="unitLB" onclick="setWeightUnit('LB')" style="padding:4px 10px;border:none;background:var(--purple);color:#fff;cursor:pointer">LB</button>
            <button id="unitOZ" onclick="setWeightUnit('OZ')" style="padding:4px 10px;border:none;background:var(--light);color:var(--dark);cursor:pointer">OZ</button>
          </div>
        </div>
      </div>` : ''}
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" style="background:var(--light);color:var(--dark)" onclick="closeImport()">Cancel</button>
      <button class="btn btn-primary" onclick="saveAll()" ${!stagedPhotos.length ? 'disabled' : ''}>
        Flip ${stagedPhotos.length ? `(${stagedPhotos.length})` : ''} →
      </button>
    </div>`;

  bindDropZone();
}

function bindDropZone() {
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  if (!dz) return;
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); uploadFiles(e.dataTransfer.files); });
  fi.addEventListener('change', () => uploadFiles(fi.files));
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;
  const fd = new FormData();
  for (const f of fileList) fd.append('photos', f);
  try {
    const data = await fetch('/api/photos/upload', { method: 'POST', body: fd }).then(r => r.json());
    stagedPhotos.push(...data.photos);
    renderImportStep();
  } catch (e) {
    toast('🌸 Upload failed: ' + e.message, 'error');
  }
}

let importWeightUnit = 'LB';

function setWeightUnit(unit) {
  importWeightUnit = unit;
  document.getElementById('unitLB').style.background = unit === 'LB' ? 'var(--purple)' : 'var(--light)';
  document.getElementById('unitLB').style.color = unit === 'LB' ? '#fff' : 'var(--dark)';
  document.getElementById('unitOZ').style.background = unit === 'OZ' ? 'var(--purple)' : 'var(--light)';
  document.getElementById('unitOZ').style.color = unit === 'OZ' ? '#fff' : 'var(--dark)';
}

async function saveAll() {
  if (!stagedPhotos.length) return;
  const btn = document.querySelector('#importFooter .btn-primary');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const weight = document.getElementById('importWeight')?.value?.trim() || '';
  const box = document.getElementById('importBox')?.value?.trim() || '';
  const hint = document.getElementById('importHint')?.value?.trim() || '';
  try {
    const today = new Date().toISOString().slice(0, 10);
    for (const photo of stagedPhotos) {
      await apiFetch('/api/items', {
        method: 'POST',
        body: JSON.stringify({ photoIds: [photo.id], purchaseDate: today, weight, weight_unit: importWeightUnit, box, hint }),
      });
    }
    toast(`${stagedPhotos.length} item${stagedPhotos.length !== 1 ? 's' : ''} queued`);
    closeImport();
    loadItems();
  } catch (e) {
    toast('🌸 Save failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = `Flip (${stagedPhotos.length}) →`;
  }
}

// ── Filter / Search ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnImport').addEventListener('click', openImport);
  document.getElementById('importClose').addEventListener('click', closeImport);
  document.getElementById('importModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeImport();
  });

  document.getElementById('sidebarSearch').addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderSidebar();
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSidebar();
    });
  });

  checkMakeStatus();
  loadItems();
  setInterval(loadItems, 10000);
});
