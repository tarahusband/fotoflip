// FotoFlip — Frontend App

const API = '';

// ── State ─────────────────────────────────────────────────────────────────────
let items = [];
let stagedPhotos = [];
let pollTimer = null;
let lastItemsHash = '';
let activeItemId = null;
let activeTab = 'photo';
let activeFilter = 'all';
let searchQuery = '';
let selectedIds = new Set();

// Inventory state
let activeView = 'home';
let invItems = [];
let invStats = {};
let invActiveFilter = 'all';
let invSearchQuery = '';
let invSelectedIds = new Set();

// ── View switching ─────────────────────────────────────────────────────────────
function switchView(view) {
  activeView = view;
  document.getElementById('viewHome').classList.toggle('hidden', view !== 'home');
  document.getElementById('viewPhotos').classList.toggle('hidden', view !== 'photos');
  document.getElementById('viewInventory').classList.toggle('hidden', view !== 'inventory');
  document.getElementById('viewMarkets').classList.toggle('hidden', view !== 'markets');
  document.getElementById('viewSettings').classList.toggle('hidden', view !== 'settings');
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === view)
  );
  if (view === 'inventory') loadInventory();
  if (view === 'home') loadDashboard();
  if (view === 'markets') loadMarkets();
  if (view === 'settings') loadSettings();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function loadCurrentUser() {
  try {
    const user = await apiFetch('/auth/me');
    const el = document.getElementById('navUser');
    if (el) {
      const initials = (user.name || user.email || '?')[0].toUpperCase();
      el.innerHTML = `
        <div class="nav-profile">
          ${user.picture
            ? `<img class="nav-avatar" src="${user.picture}" referrerpolicy="no-referrer">`
            : `<div class="nav-avatar nav-avatar-init">${initials}</div>`}
          <div class="nav-profile-info">
            <div class="nav-profile-name">${escHtml(user.name || user.email)}</div>
            <div class="nav-profile-email">${escHtml(user.email)}</div>
          </div>
        </div>
        <a href="/auth/logout" class="nav-menu-row">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign out
          <span class="nav-menu-arrow">›</span>
        </a>
        <div class="nav-menu-label">SUPPORT</div>
        <a href="/support" target="_blank" class="nav-menu-row">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Customer Support <span class="nav-menu-sub">Get help, report issues, or send feedback</span></span>
          <span class="nav-menu-arrow">›</span>
        </a>
        <div class="nav-menu-label">LEGAL</div>
        <a href="/privacy" target="_blank" class="nav-menu-row nav-menu-row-sm">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Privacy Policy
          <span class="nav-menu-arrow">›</span>
        </a>
        <a href="/terms" target="_blank" class="nav-menu-row nav-menu-row-sm">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Terms of Use
          <span class="nav-menu-arrow">›</span>
        </a>
        <a href="/do-not-sell" target="_blank" class="nav-menu-row nav-menu-row-sm">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          Do Not Sell or Share
          <span class="nav-menu-arrow">›</span>
        </a>
        <div class="nav-menu-note">Your data is private and secure.</div>`;
    }
    if (user.role === 'admin') {
      const adminLink = document.getElementById('navAdminLink');
      if (adminLink) adminLink.style.display = '';
    }
    if (user.impersonating) {
      showImpersonationBanner(user.impersonating);
    }
  } catch (e) {
    if (e.message.includes('authenticated')) location.href = '/login';
  }
}

function showImpersonationBanner(target) {
  if (document.getElementById('impersonationBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'impersonationBanner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7C3AED;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2)';
  banner.innerHTML = `
    <span>👁 Support view — viewing as <strong>${escHtml(target.email)}</strong> · Read-only</span>
    <button onclick="exitImpersonation()" style="background:#fff;color:#7C3AED;border:none;border-radius:6px;padding:5px 14px;font-size:12px;font-weight:700;cursor:pointer;">Exit Support View</button>`;
  document.body.prepend(banner);
  document.body.style.paddingTop = '42px';
}

async function exitImpersonation() {
  try {
    await apiFetch('/api/admin/impersonate/exit', { method: 'POST' });
    window.location.href = '/admin';
  } catch (e) {
    alert('🌸 Could not exit support view: ' + e.message);
  }
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (res.status === 401) { location.href = '/login'; return; }
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
  switchView('markets');
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
    // Check how many batches are needed (Poshmark limit: 39 rows per file)
    const info = await apiFetch('/api/export/poshmark?info=1');
    if (!info || info.error) { toast('🌸 Export failed', 'error'); return; }

    const today = new Date().toISOString().slice(0, 10);
    const allExportedIds = [];

    for (let batch = 1; batch <= info.totalBatches; batch++) {
      if (info.totalBatches > 1) toast(`Downloading part ${batch} of ${info.totalBatches}…`, 'info');
      const res = await fetch(`/api/export/poshmark?batch=${batch}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast('🌸 ' + (j.error || `Batch ${batch} failed`), 'error');
        return;
      }
      const exportedIds = JSON.parse(res.headers.get('X-Export-Item-Ids') || '[]');
      allExportedIds.push(...exportedIds);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const suffix = info.totalBatches > 1 ? `-part${batch}of${info.totalBatches}` : '';
      a.href = url; a.download = `poshmark-bulk-${today}${suffix}.csv`; a.click();
      URL.revokeObjectURL(url);
      if (batch < info.totalBatches) await new Promise(r => setTimeout(r, 600));
    }

    const msg = info.totalBatches > 1
      ? `Poshmark: ${info.totalBatches} CSV files downloaded (${allExportedIds.length} items total)`
      : `Poshmark CSV downloaded (${allExportedIds.length} items)`;
    toast(msg, 'success');

    if (allExportedIds.length && confirm(`Mark ${allExportedIds.length} item${allExportedIds.length !== 1 ? 's' : ''} as Listed on Poshmark?`)) {
      await apiFetch('/api/inventory/bulk', {
        method: 'PUT',
        body: JSON.stringify({ ids: allExportedIds, poshmark_exported: 1, inv_status: 'listed', date_listed: today }),
      });
      toast('Items marked as Listed', 'success');
      if (activeView === 'inventory') loadInventory();
    }
  } catch (e) {
    toast('🌸 Export failed: ' + e.message, 'error');
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
      toast('🌸 ' + (j.error || 'Export failed'), 'error');
      return;
    }
    const exportedIds = JSON.parse(res.headers.get('X-Export-Item-Ids') || '[]');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `whatnot-bulk-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Whatnot CSV downloaded (${exportedIds.length} items)`, 'success');
    if (exportedIds.length && confirm(`Mark ${exportedIds.length} item${exportedIds.length !== 1 ? 's' : ''} as Listed on Whatnot?`)) {
      await apiFetch('/api/inventory/bulk', {
        method: 'PUT',
        body: JSON.stringify({ ids: exportedIds, whatnot_exported: 1, inv_status: 'listed', date_listed: today }),
      });
      toast('Items marked as Listed', 'success');
      if (activeView === 'inventory') loadInventory();
    }
  } catch (e) {
    toast('🌸 Export failed: ' + e.message, 'error');
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
  return photo?.url || null;
}

function originalUrl(photo) {
  return photo?.url || null;
}

function processedUrl(photo) {
  return photo?.url || null;
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
    const hash = items.map(i => `${i.id}:${i.processing_status}:${i.inv_status}`).join('|');
    if (hash !== lastItemsHash) {
      lastItemsHash = hash;
      renderSidebar();
      if (activeItemId) {
        const item = items.find(i => i.id === activeItemId);
        if (item) renderDetail(item);
      }
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
      if (item.processing_status === 'done') {
        const meta = item.photos?.[0]?.metadata;
        const parsed = typeof meta === 'string' ? JSON.parse(meta || '{}') : (meta || {});
        if (parsed.ai_unavailable) toast('🌸 AI processing unavailable — item saved. Fill in details manually.', 'error');
        return item;
      }
      if (item.processing_status === 'failed') return item;
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
  }
  setBulkProgress('');
  await loadItems();
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
  }
  setBulkProgress('');
  await loadItems();
  toast(`${ids.length} description${ids.length > 1 ? 's' : ''} updated`, 'success');
}

async function bulkMarkReady() {
  const ids = [...selectedIds];
  let done = 0;
  for (const id of ids) {
    setBulkProgress(`Marking ${++done} of ${ids.length}…`);
    await apiFetch(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify({ processing_status: 'done' }) }).catch(() => {});
  }
  setBulkProgress('');
  await loadItems();
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

  const labeledUrl = (isBundle && item.bundle_label_url) ? item.bundle_label_url : null;
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
    const data = await apiFetch(`/api/items/${id}/bundle`, {
      method: 'PUT',
      body: JSON.stringify({ is_bundle: isBundle, bundle_type: bundleType, bundle_count: bundleCount }),
    });
    const item = items.find(i => i.id === id);
    if (item) {
      item.is_bundle = isBundle ? 1 : 0;
      item.bundle_type = bundleType;
      item.bundle_count = bundleCount;
      if (data?.bundle_label_url) item.bundle_label_url = data.bundle_label_url;
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
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  if (dz) {
    dz.style.pointerEvents = 'none';
    dz.style.opacity = '0.7';
    dz.innerHTML = `<div class="drop-zone-icon">⏳</div><h3>Uploading…</h3><p>${fileList.length} photo${fileList.length !== 1 ? 's' : ''}</p>`;
  }
  if (fi) fi.disabled = true;
  const fd = new FormData();
  for (const f of fileList) fd.append('photos', f);
  try {
    const data = await fetch('/api/photos/upload', { method: 'POST', body: fd }).then(r => r.json());
    stagedPhotos.push(...data.photos);
    renderImportStep();
  } catch (e) {
    toast('🌸 Upload failed: ' + e.message, 'error');
    renderImportStep();
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

  document.getElementById('invSearch').addEventListener('input', e => {
    invSearchQuery = e.target.value.trim().toLowerCase();
    renderInventoryTable();
  });

  loadCurrentUser();
  checkMakeStatus();
  loadItems();
  switchView('home');
});

// ── Inventory ─────────────────────────────────────────────────────────────────

async function loadInventory() {
  try {
    const [fetchedItems, fetchedStats] = await Promise.all([
      apiFetch('/api/inventory'),
      apiFetch('/api/inventory/stats'),
    ]);
    invItems = fetchedItems;
    invStats = fetchedStats;
    renderInventoryStats();
    renderInventoryFilters();
    renderInventoryTable();
  } catch (e) {
    toast('🌸 Failed to load inventory: ' + e.message, 'error');
  }
}

function renderInventoryStats() {
  const s = invStats;
  document.getElementById('invStats').innerHTML = `
    <div class="inv-stat"><div class="inv-stat-value">${s.total ?? '—'}</div><div class="inv-stat-label">Total</div></div>
    <div class="inv-stat"><div class="inv-stat-value">${s.ready ?? '—'}</div><div class="inv-stat-label">Ready</div></div>
    <div class="inv-stat"><div class="inv-stat-value">${s.listed ?? '—'}</div><div class="inv-stat-label">Listed</div></div>
    <div class="inv-stat"><div class="inv-stat-value">${s.sold ?? '—'}</div><div class="inv-stat-label">Sold</div></div>
    <div class="inv-stat"><div class="inv-stat-value">${s.shipped ?? '—'}</div><div class="inv-stat-label">Shipped</div></div>
  `;
}

const INV_FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'ready',    label: 'Ready' },
  { key: 'listed',   label: 'Listed' },
  { key: 'sold',     label: 'Sold' },
  { key: 'shipped',  label: 'Shipped' },
  { key: 'review',   label: 'Review' },
  { key: 'draft',    label: 'Draft' },
  { key: 'archived', label: 'Archived' },
];

function renderInventoryFilters() {
  const s = invStats;
  const counts = { all: s.total, ready: s.ready, listed: s.listed, sold: s.sold, shipped: s.shipped, review: s.review, draft: s.draft, archived: s.archived };
  document.getElementById('invFilters').innerHTML = INV_FILTERS.map(f =>
    `<button class="inv-filter-btn ${invActiveFilter === f.key ? 'active' : ''}" onclick="invSetFilter('${f.key}')">
      ${f.label}<span class="inv-filter-count">${counts[f.key] ?? 0}</span>
    </button>`
  ).join('');
}

function invSetFilter(key) {
  invActiveFilter = key;
  invSelectedIds.clear();
  renderInventoryFilters();
  renderInventoryTable();
  renderInvBulkBar();
}

function filteredInvItems() {
  let list = invActiveFilter === 'all' ? invItems : invItems.filter(i => i.inv_status === invActiveFilter);
  if (invSearchQuery) {
    const q = invSearchQuery;
    list = list.filter(i =>
      (i.meta?.title || '').toLowerCase().includes(q) ||
      generateSku(i, i.meta || {}).toLowerCase().includes(q) ||
      (i.location || '').toLowerCase().includes(q)
    );
  }
  return list;
}

function renderInventoryTable() {
  const list = filteredInvItems();
  const body = document.getElementById('invBody');
  const empty = document.getElementById('invEmpty');

  if (!list.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  body.innerHTML = list.map(item => {
    const meta = item.meta || {};
    const sku = generateSku(item, meta);
    const title = meta.title || (meta.brand ? `${meta.brand} ${meta.category || ''}`.trim() : 'Untitled');
    const thumb = item.thumbPath ? invThumbUrl(item.thumbPath) : null;
    const isSelected = invSelectedIds.has(item.id);
    const added = (item.created_at || '').slice(0, 10);
    const sold = item.date_sold || '';
    const loc = item.location || '';
    const status = item.inv_status || 'ready';

    return `<tr class="${isSelected ? 'inv-selected' : ''}" onclick="invRowClick(event,${item.id})">
      <td onclick="event.stopPropagation()"><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="invToggleRow(${item.id},this)"></td>
      <td><div class="inv-thumb">${thumb ? `<img src="${thumb}" alt="" onerror="this.style.display='none'">` : ''}</div></td>
      <td><div class="inv-item-title" title="${escHtml(title)}">${escHtml(title)}</div><div class="inv-item-sku">${escHtml(sku)}</div></td>
      <td>${escHtml(sku)}</td>
      <td>${loc ? `<span class="inv-location-pill">${escHtml(loc)}</span>` : `<span class="inv-location-pill empty">—</span>`}</td>
      <td><span class="inv-status ${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</span></td>
      <td class="inv-mp-badge ${item.poshmark_exported ? 'inv-mp-yes' : 'inv-mp-no'}">${item.poshmark_exported ? '✓' : '—'}</td>
      <td class="inv-mp-badge ${item.whatnot_exported ? 'inv-mp-yes' : 'inv-mp-no'}">${item.whatnot_exported ? '✓' : '—'}</td>
      <td class="inv-mp-badge ${item.etsy_exported ? 'inv-mp-yes' : 'inv-mp-no'}">${item.etsy_exported ? '✓' : '—'}</td>
      <td class="inv-date">${added}</td>
      <td class="inv-date">${sold || '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('invSelectAll').checked = list.length > 0 && list.every(i => invSelectedIds.has(i.id));
}

function invThumbUrl(url) {
  return url || null;
}

function invRowClick(e, id) {
  if (e.target.tagName === 'INPUT') return;
  invToggleRow(id, null);
}

function invToggleRow(id, checkbox) {
  if (invSelectedIds.has(id)) invSelectedIds.delete(id);
  else invSelectedIds.add(id);
  if (checkbox) checkbox.checked = invSelectedIds.has(id);
  const row = checkbox?.closest('tr') || document.querySelector(`tr[onclick*="${id}"]`);
  if (row) row.classList.toggle('inv-selected', invSelectedIds.has(id));
  document.getElementById('invSelectAll').checked =
    filteredInvItems().length > 0 && filteredInvItems().every(i => invSelectedIds.has(i.id));
  renderInvBulkBar();
}

function invToggleAll(masterCheckbox) {
  const list = filteredInvItems();
  if (masterCheckbox.checked) list.forEach(i => invSelectedIds.add(i.id));
  else list.forEach(i => invSelectedIds.delete(i.id));
  renderInventoryTable();
  renderInvBulkBar();
}

function renderInvBulkBar() {
  const bar = document.getElementById('invBulkBar');
  const count = invSelectedIds.size;
  if (!count) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <span class="inv-bulk-count">${count} item${count !== 1 ? 's' : ''} selected</span>
    <input class="inv-bulk-location" id="invLocInput" placeholder="BOX-001" title="Assign location">
    <button class="btn btn-sm btn-secondary" onclick="invBulkSetLocation()">Assign Location</button>
    <select class="inv-status-select" id="invStatusSelect">
      <option value="">— Change Status —</option>
      ${['ready','review','draft','listed','sold','shipped','archived'].map(s =>
        `<option value="${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
      ).join('')}
    </select>
    <button class="btn btn-sm btn-secondary" onclick="invBulkSetStatus()">Apply</button>
    <button class="btn btn-sm btn-danger" onclick="invBulkArchive()">Archive</button>
    <button class="btn btn-sm btn-outline" onclick="invSelectedIds.clear();renderInventoryTable();renderInvBulkBar()">✕ Clear</button>
  `;
}

async function invBulkSetLocation() {
  const loc = document.getElementById('invLocInput')?.value?.trim();
  if (!loc) { toast('🌸 Enter a location first', 'error'); return; }
  try {
    await apiFetch('/api/inventory/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: [...invSelectedIds], location: loc }),
    });
    toast(`Location set to ${loc}`, 'success');
    await loadInventory();
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

async function invBulkSetStatus() {
  const status = document.getElementById('invStatusSelect')?.value;
  if (!status) { toast('🌸 Choose a status first', 'error'); return; }
  const body = { ids: [...invSelectedIds], inv_status: status };
  if (status === 'sold') body.date_sold = new Date().toISOString().slice(0, 10);
  if (status === 'shipped') body.date_shipped = new Date().toISOString().slice(0, 10);
  try {
    await apiFetch('/api/inventory/bulk', { method: 'PUT', body: JSON.stringify(body) });
    toast(`Status updated to ${status}`, 'success');
    await loadInventory();
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

async function invBulkArchive() {
  const count = invSelectedIds.size;
  if (!confirm(`Archive ${count} item${count !== 1 ? 's' : ''}?`)) return;
  try {
    await apiFetch('/api/inventory/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: [...invSelectedIds], inv_status: 'archived' }),
    });
    toast(`${count} item${count !== 1 ? 's' : ''} archived`, 'success');
    await loadInventory();
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const data = await apiFetch('/api/dashboard');
    if (data.isEmpty) {
      renderOnboarding();
      return;
    }
    renderDashboardKpi(data.stats);
    renderDashboardActions(data.stats);
    renderDashboardImports(data.recentImports);
    renderDashboardActivity(data.recentActivity);
    renderDashboardDraftQueue(data.draftQueue || []);
    renderDashboardPlatforms(data.platforms || {});
  } catch (e) {
    document.getElementById('dashKpi').innerHTML =
      `<p style="color:var(--red)">🌸 Failed to load dashboard: ${e.message}</p>`;
  }
}

function renderOnboarding() {
  const el = document.getElementById('dashContainer');
  el.innerHTML = `
    <div class="onboarding">
      <div class="onboarding-icon">📦</div>
      <h1 class="onboarding-title">Welcome to FotoFlip</h1>
      <p class="onboarding-sub">You're all set. Let's get your first items in.</p>
      <div class="onboarding-steps">
        <div class="onboarding-step" onclick="openImport()">
          <div class="onboarding-step-icon">📥</div>
          <div class="onboarding-step-title">Import Photos</div>
          <div class="onboarding-step-desc">Add your first batch of items to get started</div>
          <button class="btn btn-primary onboarding-step-btn">Start Importing</button>
        </div>
        <div class="onboarding-step" onclick="switchView('settings')">
          <div class="onboarding-step-icon">👤</div>
          <div class="onboarding-step-title">Complete Profile</div>
          <div class="onboarding-step-desc">Add your seller handle and shipping details</div>
          <button class="btn btn-secondary onboarding-step-btn">Set Up Profile</button>
        </div>
        <div class="onboarding-step" onclick="switchView('markets')">
          <div class="onboarding-step-icon">🛍</div>
          <div class="onboarding-step-title">Connect a Platform</div>
          <div class="onboarding-step-desc">Export to Poshmark, Whatnot, or Etsy</div>
          <button class="btn btn-secondary onboarding-step-btn">View Markets</button>
        </div>
      </div>
    </div>`;
}

function renderDashboardDraftQueue(drafts) {
  const lower = document.getElementById('dashBodyLower');
  const el = document.getElementById('dashDraftQueue');
  if (!drafts.length) { el.style.display = 'none'; return; }
  lower.classList.remove('hidden');
  el.innerHTML = `
    <div class="dash-card-title">Draft Queue <span class="dash-badge">${drafts.length}</span></div>
    <div class="dash-draft-list">
      ${drafts.map(d => `
        <div class="dash-draft-item" onclick="switchView('photos')">
          ${d.thumb ? `<img class="dash-draft-thumb" src="${d.thumb}" loading="lazy">` : `<div class="dash-draft-thumb dash-draft-thumb-empty"></div>`}
          <div class="dash-draft-meta">
            <div class="dash-draft-title">${d.title}</div>
            <div class="dash-draft-sku">${d.sku || `Item #${d.id}`}</div>
          </div>
          <span class="status-pill status-review">Draft</span>
        </div>`).join('')}
    </div>
    <button class="btn btn-sm btn-outline" style="margin-top:10px;width:100%" onclick="switchView('inventory')">View all in Inventory →</button>`;
}

function renderDashboardPlatforms(platforms) {
  const lower = document.getElementById('dashBodyLower');
  const el = document.getElementById('dashPlatforms');
  if (!platforms.poshmark) { el.innerHTML = ''; return; }
  lower.classList.remove('hidden');
  const rows = [
    { key: 'poshmark', label: 'Poshmark',      cls: 'mp-poshmark', letter: 'P', count: platforms.poshmark?.count ?? 0, connected: true },
    { key: 'whatnot',  label: 'Whatnot',        cls: 'mp-whatnot',  letter: 'W', count: platforms.whatnot?.count  ?? 0, connected: true },
    { key: 'etsy',     label: 'Etsy via Make',  cls: 'mp-etsy',     letter: 'E', count: null,                           connected: platforms.etsy?.connected },
  ];
  el.innerHTML = `
    <div class="dash-card-title">Connected Platforms</div>
    <div class="dash-platforms">
      ${rows.map(r => `
        <div class="dash-platform-row">
          <div class="dash-platform-logo ${r.cls}">${r.letter}</div>
          <div class="dash-platform-name">${r.label}</div>
          ${r.count !== null ? `<div class="dash-platform-count">${r.count} listed</div>` : ''}
          <span class="status-pill ${r.connected ? 'status-done' : 'status-pending'}">${r.connected ? 'Ready' : 'Setup'}</span>
        </div>`).join('')}
    </div>
    <button class="btn btn-sm btn-outline" style="margin-top:12px;width:100%" onclick="switchView('markets')">Manage in Markets →</button>`;
}

function renderDashboardKpi(stats) {
  const kpis = [
    { label: 'Total Items', value: stats.total,    icon: '📦', cls: 'kpi-total'   },
    { label: 'Ready',       value: stats.ready,    icon: '✅', cls: 'kpi-ready'   },
    { label: 'Listed',      value: stats.listed,   icon: '🏷',  cls: 'kpi-listed'  },
    { label: 'Sold',        value: stats.sold,     icon: '💰', cls: 'kpi-sold'    },
    { label: 'Shipped',     value: stats.shipped,  icon: '📬', cls: 'kpi-shipped' },
  ];
  document.getElementById('dashKpi').innerHTML = kpis.map(k => `
    <div class="dash-kpi-card">
      <div class="dash-kpi-icon ${k.cls}">${k.icon}</div>
      <div>
        <div class="dash-kpi-value">${k.value}</div>
        <div class="dash-kpi-label">${k.label}</div>
      </div>
    </div>`).join('');
}

function renderDashboardActions(stats) {
  const readyCount = stats.ready || 0;
  const actions = [
    { icon: '📥', cls: 'da-import',  name: 'Import',   desc: 'Add new photos',       fn: 'openImport()' },
    { icon: '📋', cls: 'da-inv',     name: 'Inventory', desc: 'Manage all items',     fn: "switchView('inventory')" },
    { icon: 'P',  cls: 'da-posh',    name: 'Poshmark',  desc: `${readyCount} ready`,  fn: 'exportAllPoshmark(null)' },
    { icon: 'W',  cls: 'da-whatnot', name: 'Whatnot',   desc: `${readyCount} ready`,  fn: 'exportAllWhatnot(null)' },
    { icon: 'E',  cls: 'da-etsy',    name: 'Etsy',      desc: 'via Make.com',         fn: "switchView('markets')" },
    { icon: '🛍', cls: 'da-markets', name: 'Markets',   desc: 'All channels',         fn: "switchView('markets')" },
  ];
  const nudge = readyCount > 0
    ? `<div class="dash-nudge" onclick="exportAllPoshmark(null)">
        <span>🚀 ${readyCount} item${readyCount !== 1 ? 's' : ''} ready to export</span>
        <span>Export →</span>
       </div>`
    : '';
  document.getElementById('dashActions').innerHTML = `
    <div class="dash-card-title">Quick Actions</div>
    <div class="dash-actions-grid">
      ${actions.map(a => `
        <button class="dash-action-btn" onclick="${a.fn}">
          <div class="dash-action-icon ${a.cls}">${a.icon}</div>
          <div class="dash-action-name">${a.name}</div>
          <div class="dash-action-desc">${a.desc}</div>
        </button>`).join('')}
    </div>
    ${nudge}`;
}

function renderDashboardImports(imports) {
  const el = document.getElementById('dashImports');
  if (!imports.length) {
    el.innerHTML = `<div class="dash-card-title">Recent Imports</div><div class="dash-empty">No imports yet</div>`;
    return;
  }
  const rows = imports.map(imp => {
    const thumbs = imp.thumbs.slice(0, 4);
    const grid = thumbs.map(t =>
      t ? `<img src="${t}" loading="lazy" onerror="this.style.display='none'">` : ''
    ).join('');
    return `<div class="dash-import-row">
      <div class="dash-import-thumbs">${grid}</div>
      <div class="dash-import-info">
        <div class="dash-import-box">${imp.box || 'Untitled box'}</div>
        <div class="dash-import-meta">${imp.count} item${imp.count !== 1 ? 's' : ''} · ${imp.latestDate ? timeAgo(imp.latestDate) : ''}</div>
      </div>
      <span class="dash-import-badge">${imp.count}</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="dash-card-title">Recent Imports</div>${rows}`;
}

function renderDashboardActivity(activity) {
  const el = document.getElementById('dashActivity');
  if (!activity.length) {
    el.innerHTML = `<div class="dash-card-title">Recent Activity</div><div class="dash-empty">No activity yet</div>`;
    return;
  }
  const dotCls = { import: 'da-dot-import', poshmark: 'da-dot-poshmark', whatnot: 'da-dot-whatnot' };
  const dotIcon = { import: '📦', poshmark: 'P', whatnot: 'W' };
  const rows = activity.map(a => `
    <div class="dash-activity-row">
      <div class="dash-activity-dot ${dotCls[a.type] || 'da-dot-import'}">${dotIcon[a.type] || '📦'}</div>
      <div class="dash-activity-label">${a.label}</div>
      <div class="dash-activity-time">${timeAgo(a.date)}</div>
    </div>`).join('');
  el.innerHTML = `<div class="dash-card-title">Recent Activity</div>${rows}`;
}

function timeAgo(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5)  return `${w}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Markets ───────────────────────────────────────────────────────────────────

async function loadMarkets() {
  try {
    const data = await apiFetch('/api/markets');
    renderMarketsSummary(data.summary);
    renderMarketsCards(data.platforms, data.summary.ready);
    renderMarketsHistory(data.exportHistory);
    renderMarketsErrors(data.errorItems);
    const saved = localStorage.getItem('mkt_coupon_note') || '';
    document.getElementById('mktCouponText').value = saved;
  } catch (e) {
    document.getElementById('mktSummary').innerHTML =
      `<p style="color:var(--red)">🌸 Failed to load markets: ${e.message}</p>`;
  }
}

function renderMarketsSummary(s) {
  const lastExportStr = s.lastExport
    ? `Last export ${timeAgo(s.lastExport)}`
    : 'No exports yet';
  document.getElementById('mktSummary').innerHTML = `
    <div class="mkt-stat">
      <div class="mkt-stat-value">${s.ready}</div>
      <div class="mkt-stat-label">Ready to Export</div>
    </div>
    <div class="mkt-stat">
      <div class="mkt-stat-value">${lastExportStr}</div>
      <div class="mkt-stat-label">Last Export</div>
    </div>
    <div class="mkt-stat">
      <div class="mkt-stat-value">${s.connectedCount}</div>
      <div class="mkt-stat-label">Connected Channels</div>
    </div>
    <div class="mkt-stat">
      <div class="mkt-stat-value ${s.errors > 0 ? 'mkt-stat-error' : ''}">${s.errors}</div>
      <div class="mkt-stat-label">Errors Needing Review</div>
    </div>`;
}

function renderMarketsCards(platforms, ready) {
  const p = platforms.poshmark;
  const w = platforms.whatnot;
  const e = platforms.etsy;

  const poshCard = `
    <div class="mkt-platform-card">
      <div class="mkt-platform-head">
        <div class="mkt-platform-logo mp-poshmark">P</div>
        <div>
          <div class="mkt-platform-name">Poshmark</div>
          <div class="mkt-platform-meta">CSV upload · manual listing</div>
        </div>
        <span class="status-pill status-done" style="margin-left:auto">Ready</span>
      </div>
      <div class="mkt-platform-stats">
        <div class="mkt-pstat"><div class="mkt-pstat-val">${p.ready}</div><div class="mkt-pstat-lbl">Ready</div></div>
        <div class="mkt-pstat"><div class="mkt-pstat-val">${p.exported}</div><div class="mkt-pstat-lbl">Exported</div></div>
      </div>
      <div class="mkt-fields">${p.fields.map(f => `<span class="mkt-field-tag">${f}</span>`).join('')}</div>
      <div class="mkt-platform-actions">
        <button class="btn btn-sm btn-primary" onclick="exportAllPoshmark(this)" ${ready === 0 ? 'disabled' : ''}>⬇ Generate CSV</button>
      </div>
      ${p.lastExport ? `<div class="mkt-last-export">Last export ${timeAgo(p.lastExport)}</div>` : ''}
    </div>`;

  const whatnotCard = `
    <div class="mkt-platform-card">
      <div class="mkt-platform-head">
        <div class="mkt-platform-logo mp-whatnot">W</div>
        <div>
          <div class="mkt-platform-name">Whatnot</div>
          <div class="mkt-platform-meta">CSV upload · images via ImgBB</div>
        </div>
        <span class="status-pill status-done" style="margin-left:auto">Ready</span>
      </div>
      <div class="mkt-platform-stats">
        <div class="mkt-pstat"><div class="mkt-pstat-val">${w.ready}</div><div class="mkt-pstat-lbl">Ready</div></div>
        <div class="mkt-pstat"><div class="mkt-pstat-val">${w.exported}</div><div class="mkt-pstat-lbl">Exported</div></div>
      </div>
      <div class="mkt-fields">${w.fields.map(f => `<span class="mkt-field-tag">${f}</span>`).join('')}</div>
      <div class="mkt-platform-actions">
        <button class="btn btn-sm btn-primary" onclick="exportAllWhatnot(this)" ${ready === 0 ? 'disabled' : ''}>⬇ Generate CSV</button>
      </div>
      ${w.lastExport ? `<div class="mkt-last-export">Last export ${timeAgo(w.lastExport)}</div>` : ''}
    </div>`;

  const etsyConnected = e.connected;
  const etsyCard = `
    <div class="mkt-platform-card">
      <div class="mkt-platform-head">
        <div class="mkt-platform-logo mp-etsy">E</div>
        <div>
          <div class="mkt-platform-name">Etsy via Make.com</div>
          <div class="mkt-platform-meta">Webhook → Etsy draft</div>
        </div>
        <span class="status-pill ${etsyConnected ? 'status-done' : 'status-pending'}" style="margin-left:auto">
          ${etsyConnected ? 'Connected' : 'Not Connected'}
        </span>
      </div>
      <div class="mkt-fields">${e.fields.map(f => `<span class="mkt-field-tag">${f}</span>`).join('')}</div>
      <div class="mkt-platform-actions">
        ${etsyConnected
          ? `<button class="btn btn-sm btn-primary" onclick="showMakeSetup()">⚙ Reconfigure</button>`
          : `<button class="btn btn-sm btn-secondary" onclick="showMakeSetup()">⚙ Configure Make.com</button>`}
      </div>
    </div>`;

  document.getElementById('mktCards').innerHTML = poshCard + whatnotCard + etsyCard;
}

function renderMarketsHistory(rows) {
  const el = document.getElementById('mktHistoryBody');
  if (!rows.length) {
    el.innerHTML = `<div class="mkt-empty">No exports recorded yet.</div>`;
    return;
  }
  const tableRows = rows.map(r => `
    <tr>
      <td>${r.date_listed}</td>
      <td>${r.posh > 0 ? `✓ ${r.posh}` : '—'}</td>
      <td>${r.whatnot > 0 ? `✓ ${r.whatnot}` : '—'}</td>
    </tr>`).join('');
  el.innerHTML = `
    <table class="mkt-history-table">
      <thead><tr><th>Date</th><th>Poshmark</th><th>Whatnot</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

function renderMarketsErrors(errorItems) {
  const el = document.getElementById('mktErrorBody');
  if (!errorItems.length) {
    el.innerHTML = `<div class="mkt-empty">No errors — all clear.</div>`;
    return;
  }
  el.innerHTML = errorItems.map(item => `
    <div class="mkt-error-row">
      <span class="mkt-error-id">#${item.id}</span>
      <span class="mkt-error-title">${item.title || 'Untitled'}</span>
      <span class="mkt-error-link" onclick="switchView('photos')">View →</span>
    </div>`).join('');
}

function saveCouponNote() {
  const note = document.getElementById('mktCouponText').value.trim();
  localStorage.setItem('mkt_coupon_note', note);
  toast('Coupon note saved', 'success');
}

// ── Settings / Profile ────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const [profile, health] = await Promise.all([
      apiFetch('/api/profile'),
      apiFetch('/api/admin/health').catch(() => null),
    ]);
    renderProfileForm(profile, health);
  } catch (e) {
    document.getElementById('settingsForm').innerHTML =
      `<p style="color:var(--red)">🌸 Failed to load profile: ${e.message}</p>`;
  }
}

function renderHealthSection(h) {
  const dot = ok => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${ok ? '#2ecc71' : '#e74c3c'};margin-right:7px;"></span>`;
  const row = (label, ok, note) => `<div class="health-row">${dot(ok)}<span class="health-label">${label}</span><span class="health-value">${note}</span></div>`;
  return `
    <div class="settings-section">
      <div class="settings-section-title">System Health</div>
      ${row('Database', h.db_connected, h.db_connected ? 'Connected' : 'Error')}
      ${row('Cloudinary', h.cloudinary_configured, h.cloudinary_configured ? 'Configured' : 'Missing keys')}
      ${row('Anthropic', h.anthropic_configured, h.anthropic_configured ? 'Configured' : 'Missing key')}
      ${row('Items', true, h.items)}
      ${row('Photos', true, h.photos)}
      ${row('Missing thumbnails', h.missing_thumbnails === 0, h.missing_thumbnails === 0 ? 'None' : h.missing_thumbnails)}
      <div style="margin-top:14px;">
        <a href="/api/admin/backup" class="btn btn-outline" style="font-size:13px;">Download DB Backup</a>
      </div>
    </div>`;
}

function renderProfileForm(p, health) {
  document.getElementById('settingsForm').innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Seller Profile</div>
      <div class="settings-field">
        <label>Business Name</label>
        <input id="sfBusinessName" type="text" value="${p.business_name || ''}" placeholder="e.g. Boca Closet">
      </div>
      <div class="settings-field">
        <label>Seller Handle</label>
        <input id="sfSellerHandle" type="text" value="${p.seller_handle || ''}" placeholder="e.g. @bocabelle">
      </div>
      <div class="settings-field">
        <label>Shipping ZIP</label>
        <input id="sfShippingZip" type="text" value="${p.shipping_zip || ''}" placeholder="e.g. 10001" maxlength="10">
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Listing Defaults</div>
      <div class="settings-field">
        <label>Default Listing Style</label>
        <select id="sfListingStyle">
          <option value="studio" ${(p.default_listing_style||'studio')==='studio' ? 'selected' : ''}>Studio</option>
          <option value="lifestyle" ${p.default_listing_style==='lifestyle' ? 'selected' : ''}>Lifestyle</option>
          <option value="flat" ${p.default_listing_style==='flat' ? 'selected' : ''}>Flat Lay</option>
        </select>
      </div>
      <div class="settings-field">
        <label>Default Condition Notes</label>
        <input id="sfConditionNotes" type="text" value="${p.default_condition_notes || ''}" placeholder="e.g. All items cleaned and inspected">
      </div>
      <div class="settings-field">
        <label>Timezone</label>
        <select id="sfTimezone">
          <option value="America/New_York"    ${(p.timezone||'America/New_York')==='America/New_York'    ? 'selected' : ''}>Eastern (ET)</option>
          <option value="America/Chicago"     ${p.timezone==='America/Chicago'    ? 'selected' : ''}>Central (CT)</option>
          <option value="America/Denver"      ${p.timezone==='America/Denver'     ? 'selected' : ''}>Mountain (MT)</option>
          <option value="America/Los_Angeles" ${p.timezone==='America/Los_Angeles'? 'selected' : ''}>Pacific (PT)</option>
        </select>
      </div>
    </div>
    <div class="settings-actions">
      <button class="btn btn-primary" onclick="saveProfile()">Save Changes</button>
      <button class="btn btn-outline" onclick="switchView('home')">Cancel</button>
    </div>
    ${health ? renderHealthSection(health) : ''}`;
}

async function saveProfile() {
  const body = {
    business_name:           document.getElementById('sfBusinessName').value.trim(),
    seller_handle:           document.getElementById('sfSellerHandle').value.trim(),
    shipping_zip:            document.getElementById('sfShippingZip').value.trim(),
    default_listing_style:   document.getElementById('sfListingStyle').value,
    default_condition_notes: document.getElementById('sfConditionNotes').value.trim(),
    timezone:                document.getElementById('sfTimezone').value,
  };
  try {
    await apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(body) });
    toast('Profile saved', 'success');
  } catch (e) {
    toast('🌸 ' + e.message, 'error');
  }
}
