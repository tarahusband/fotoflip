// FotoFlip — Frontend App

const API = '';

// ── State ────────────────────────────────────────────────────────────────────
let items = [];
let stagedPhotos = []; // { id, name, url, uploadName }
let groups = [];       // { id, photoIndices[], status }
let selectedIndices = new Set();
let activeTab = 'all';
let pollTimer = null;

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

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await apiFetch('/api/stats');
    document.getElementById('statTotal').textContent = s.total;
    document.getElementById('statPurchased').textContent = s.purchased;
    document.getElementById('statBacklog').textContent = s.backlog;
    document.getElementById('statProcessed').textContent = s.processed;
  } catch {}
}

// ── Items ─────────────────────────────────────────────────────────────────────
async function loadItems() {
  try {
    items = await apiFetch('/api/items');
    renderItems();
    loadStats();
    scheduleRefreshIfNeeded();
  } catch (e) {
    toast('Failed to load items', 'error');
  }
}

function scheduleRefreshIfNeeded() {
  const hasPending = items.some(
    (i) => i.status === 'Purchased' && i.processing_status === 'processing',
  );
  clearTimeout(pollTimer);
  if (hasPending) {
    pollTimer = setTimeout(loadItems, 2500);
  }
}

function filteredItems() {
  if (activeTab === 'all') return items;
  if (activeTab === 'purchased') return items.filter((i) => i.status === 'Purchased');
  if (activeTab === 'backlog') return items.filter((i) => ['Needs Cleaning', 'Needs Sorting'].includes(i.status));
  if (activeTab === 'passed') return items.filter((i) => i.status === 'Passed');
  return items;
}

function renderItems() {
  const grid = document.getElementById('itemsGrid');
  const list = filteredItems();

  // Update tab counts
  document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
    const t = tab.dataset.tab;
    let n = 0;
    if (t === 'all') n = items.length;
    else if (t === 'purchased') n = items.filter((i) => i.status === 'Purchased').length;
    else if (t === 'backlog') n = items.filter((i) => ['Needs Cleaning', 'Needs Sorting'].includes(i.status)).length;
    else if (t === 'passed') n = items.filter((i) => i.status === 'Passed').length;
    tab.textContent = `${tab.dataset.label} (${n})`;
  });

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No items yet</h3>
        <p>Click <strong>+ Import Photos</strong> to start a new batch.</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map((item) => renderItemCard(item)).join('');
}

function photoUrl(photo) {
  if (!photo) return null;
  const name = photo.uploadName || photo.name;
  if (photo.processed_path) {
    // served from /processed/...
    const parts = photo.processed_path.split('/processed/');
    if (parts[1]) return `/processed/${parts[1]}`;
  }
  return `/uploads/${name.includes('-') ? name : ''}${encodeURIComponent(photo.name)}`;
}

function photoThumbUrl(photo) {
  // prefer upload path for thumbnails (faster, smaller)
  if (!photo) return null;
  const path = photo.path || '';
  const uploadName = path.split('/uploads/').pop() || photo.name;
  return `/uploads/${uploadName}`;
}

function renderItemCard(item) {
  const statusClass = item.status.toLowerCase().replace(' ', '-');
  const procBadge = renderProcBadge(item);
  const dateStr = item.purchase_date || item.created_at?.slice(0, 10) || '';

  const thumbs = (item.photos || []).slice(0, 4).map((p) => {
    const url = photoThumbUrl(p);
    return url
      ? `<img class="item-photo-thumb" src="${url}" alt="${p.name}" onerror="this.style.display='none'">`
      : `<div class="item-photo-thumb placeholder">📷</div>`;
  }).join('');

  const noPhotos = !item.photos?.length
    ? `<div class="item-photo-thumb placeholder" style="width:100%;height:160px">📷</div>`
    : '';

  return `
    <div class="item-card" data-id="${item.id}">
      <div class="item-photos">${thumbs || noPhotos}</div>
      <div class="item-body">
        <div class="item-meta">
          <span class="item-id">#${String(item.id).padStart(3,'0')}</span>
          <span class="item-date">${dateStr}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
          <span class="status-badge status-${statusClass}">${item.status}</span>
          ${procBadge}
        </div>
        <div class="item-photo-count">${item.photoIds?.length || 0} photo${item.photoIds?.length !== 1 ? 's' : ''}</div>
        <div class="item-actions">
          ${renderItemActions(item)}
        </div>
      </div>
    </div>`;
}

function renderProcBadge(item) {
  if (item.status !== 'Purchased') return '';
  const s = item.processing_status;
  if (s === 'processing') return `<span class="processing-badge"><span class="spinner"></span>Processing</span>`;
  if (s === 'done') return `<span class="processing-badge done">✓ Ready</span>`;
  if (s === 'failed') return `<span class="processing-badge failed">✗ Failed</span>`;
  if (s === 'pending') return `<span class="processing-badge">Queued</span>`;
  return '';
}

function renderItemActions(item) {
  const can = (statuses) => !statuses.includes(item.status);

  const statusBtns = [
    ['Purchased', 'purchased'],
    ['Passed', 'passed'],
    ['Needs Cleaning', 'cleaning'],
    ['Needs Sorting', 'sorting'],
  ]
    .filter(([s]) => s !== item.status)
    .map(([s]) => `<button class="btn btn-sm btn-ghost" style="background:var(--light);color:var(--dark)" onclick="setStatus(${item.id},'${s}')">${s}</button>`)
    .join('');

  const reprocess = item.status === 'Purchased' && item.processing_status !== 'processing'
    ? `<button class="btn btn-sm btn-purple" onclick="reprocess(${item.id})">↻ Reprocess</button>`
    : '';

  return statusBtns + reprocess;
}

// ── Item Actions ──────────────────────────────────────────────────────────────
async function setStatus(id, status) {
  try {
    await apiFetch(`/api/items/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    toast(`Moved to ${status}`);
    loadItems();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reprocess(id) {
  try {
    await apiFetch(`/api/items/${id}/process`, { method: 'POST' });
    toast('Processing started…', 'info');
    loadItems();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    renderItems();
  });
});

// ── Import Modal ──────────────────────────────────────────────────────────────
let importStep = 1; // 1=select, 2=group, 3=confirm

function openImport() {
  stagedPhotos = [];
  groups = [];
  selectedIndices = new Set();
  importStep = 1;
  renderImportStep();
  document.getElementById('importModal').classList.add('open');
}

function closeImport() {
  document.getElementById('importModal').classList.remove('open');
}

document.getElementById('btnImport').addEventListener('click', openImport);
document.getElementById('importClose').addEventListener('click', closeImport);
document.getElementById('importModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeImport();
});

function renderImportStep() {
  // Steps indicator
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById(`step${i}`);
    el.classList.toggle('active', i === importStep);
    el.classList.toggle('done', i < importStep);
  }

  const body = document.getElementById('importBody');
  const footer = document.getElementById('importFooter');

  if (importStep === 1) {
    body.innerHTML = renderStep1();
    footer.innerHTML = `
      <span class="item-date">${stagedPhotos.length} photos selected</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" style="background:var(--light);color:var(--dark)" onclick="closeImport()">Cancel</button>
        <button class="btn btn-primary" id="btnStep2" onclick="goStep2()" ${!stagedPhotos.length ? 'disabled' : ''}>
          Group Photos →
        </button>
      </div>`;
    bindStep1Events();
  } else if (importStep === 2) {
    body.innerHTML = renderStep2();
    footer.innerHTML = `
      <button class="btn btn-ghost" style="background:var(--light);color:var(--dark)" onclick="importStep=1;renderImportStep()">← Back</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" style="background:var(--light);color:var(--dark)" onclick="addAllAsOneGroup()">All as 1 item</button>
        <button class="btn btn-primary" onclick="goStep3()" ${!groups.length ? 'disabled' : ''}>
          Set Status →
        </button>
      </div>`;
    bindStep2Events();
  } else if (importStep === 3) {
    body.innerHTML = renderStep3();
    footer.innerHTML = `
      <button class="btn btn-ghost" style="background:var(--light);color:var(--dark)" onclick="importStep=2;renderImportStep()">← Back</button>
      <button class="btn btn-primary" id="btnSave" onclick="saveGroups()">Save & Process</button>`;
  }
}

// Step 1 — Select Photos
function renderStep1() {
  const uploadArea = `
    <div class="drop-zone" id="dropZone">
      <div class="drop-zone-icon">📷</div>
      <h3>Select photos to import</h3>
      <p>Click to choose files, or drag & drop<br>Phone photos, screenshots — anything works</p>
      <input type="file" id="fileInput" multiple accept="image/*" style="display:none">
    </div>`;

  const staged = stagedPhotos.length ? `
    <div class="photo-staging" id="stagingGrid">
      ${stagedPhotos.map((p, i) => `
        <div class="staged-photo" data-idx="${i}">
          <img src="${p.url}" alt="${p.name}" loading="lazy">
          <div class="select-check">✓</div>
        </div>`).join('')}
    </div>` : '';

  return uploadArea + staged;
}

function bindStep1Events() {
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');

  dz.addEventListener('click', () => fi.click());

  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });

  fi.addEventListener('change', () => uploadFiles(fi.files));
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;

  const fd = new FormData();
  for (const f of fileList) fd.append('photos', f);

  try {
    const data = await fetch('/api/photos/upload', { method: 'POST', body: fd }).then((r) => r.json());
    stagedPhotos.push(...data.photos);
    renderImportStep();
  } catch (e) {
    toast('Upload failed: ' + e.message, 'error');
  }
}

// Step 2 — Group Photos
function renderStep2() {
  const ungrouped = stagedPhotos.map((_, i) => i).filter(
    (i) => !groups.some((g) => g.photoIndices.includes(i)),
  );

  const hint = `<div class="select-hint">
    Select photos that belong to <strong>one item</strong>, then click <strong>+ Create Group</strong>.
    Repeat for each item. Photos with no group will be saved individually.
  </div>`;

  const photoGrid = `
    <div class="section-header">
      <span class="section-title">Photos <span class="count-badge">${stagedPhotos.length}</span></span>
      <button class="btn btn-sm btn-primary" id="btnAddGroup" onclick="addSelectedAsGroup()" ${!selectedIndices.size ? 'disabled' : ''}>
        + Create Group (${selectedIndices.size})
      </button>
    </div>
    <div class="photo-staging">
      ${stagedPhotos.map((p, i) => {
        const inGroup = groups.some((g) => g.photoIndices.includes(i));
        const sel = selectedIndices.has(i);
        return `
          <div class="staged-photo ${sel ? 'selected' : ''} ${inGroup ? 'assigned' : ''}"
               data-idx="${i}" onclick="toggleSelect(${i})">
            <img src="${p.url}" alt="${p.name}" loading="lazy">
            <div class="select-check">${inGroup ? '✓' : sel ? '✓' : ''}</div>
          </div>`;
      }).join('')}
    </div>`;

  const groupsList = groups.length ? `
    <div style="margin-top:20px">
      <div class="section-header">
        <span class="section-title">Groups <span class="count-badge">${groups.length}</span></span>
      </div>
      <div class="groups-list">
        ${groups.map((g, gi) => `
          <div class="group-card">
            <div class="group-header">
              <span class="group-title">Item ${gi + 1} · ${g.photoIndices.length} photo${g.photoIndices.length !== 1 ? 's' : ''}</span>
              <button class="btn btn-sm btn-danger" onclick="removeGroup(${gi})">Remove</button>
            </div>
            <div class="group-photos-row">
              ${g.photoIndices.map((i) => `<img class="group-photo-thumb" src="${stagedPhotos[i].url}" alt="">`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  return hint + photoGrid + groupsList;
}

function bindStep2Events() {}

function toggleSelect(idx) {
  const photo = document.querySelector(`.staged-photo[data-idx="${idx}"]`);
  if (!photo) return;
  if (groups.some((g) => g.photoIndices.includes(idx))) return; // already grouped

  if (selectedIndices.has(idx)) {
    selectedIndices.delete(idx);
    photo.classList.remove('selected');
  } else {
    selectedIndices.add(idx);
    photo.classList.add('selected');
  }

  const btn = document.getElementById('btnAddGroup');
  if (btn) {
    btn.disabled = !selectedIndices.size;
    btn.textContent = `+ Create Group (${selectedIndices.size})`;
  }
}

function addSelectedAsGroup() {
  if (!selectedIndices.size) return;
  groups.push({ photoIndices: [...selectedIndices], status: 'Purchased' });
  selectedIndices = new Set();
  renderImportStep();
}

function addAllAsOneGroup() {
  groups = [{ photoIndices: stagedPhotos.map((_, i) => i), status: 'Purchased' }];
  selectedIndices = new Set();
  renderImportStep();
}

function removeGroup(gi) {
  groups.splice(gi, 1);
  renderImportStep();
}

function goStep2() {
  if (!stagedPhotos.length) return;
  importStep = 2;
  renderImportStep();
}

function goStep3() {
  // Auto-group remaining ungrouped photos as individual items
  const assigned = new Set(groups.flatMap((g) => g.photoIndices));
  stagedPhotos.forEach((_, i) => {
    if (!assigned.has(i)) groups.push({ photoIndices: [i], status: 'Purchased' });
  });
  importStep = 3;
  renderImportStep();
}

// Step 3 — Set Status
function renderStep3() {
  return `
    <div style="margin-bottom:14px">
      <p style="color:var(--text-muted);font-size:13px">
        Set the workflow status for each item. <strong>Purchased</strong> items process immediately.
      </p>
    </div>
    <div class="groups-list">
      ${groups.map((g, gi) => `
        <div class="group-card">
          <div class="group-header">
            <span class="group-title">Item ${gi + 1}</span>
          </div>
          <div class="group-photos-row">
            ${g.photoIndices.map((i) => `<img class="group-photo-thumb" src="${stagedPhotos[i].url}" alt="">`).join('')}
          </div>
          <div class="status-selector">
            ${['Purchased', 'Passed', 'Needs Cleaning', 'Needs Sorting'].map((s) => {
              const cls = s.toLowerCase().replace(' ', '-');
              const sel = g.status === s ? `sel-${cls}` : '';
              return `<button class="status-btn ${sel}" onclick="setGroupStatus(${gi},'${s}',this)">${s}</button>`;
            }).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function setGroupStatus(gi, status, btn) {
  groups[gi].status = status;
  const card = btn.closest('.group-card');
  card.querySelectorAll('.status-btn').forEach((b) => {
    b.className = 'status-btn';
  });
  const cls = status.toLowerCase().replace(' ', '-');
  btn.classList.add(`sel-${cls}`);
}

async function saveGroups() {
  const btn = document.getElementById('btnSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const today = new Date().toISOString().slice(0, 10);
    for (const g of groups) {
      if (!g.photoIndices.length) continue;
      const photoIds = g.photoIndices.map((i) => stagedPhotos[i].id);
      await apiFetch('/api/items', {
        method: 'POST',
        body: JSON.stringify({ photoIds, status: g.status, purchaseDate: today }),
      });
    }
    toast(`${groups.length} item${groups.length !== 1 ? 's' : ''} saved`, 'success');
    closeImport();
    loadItems();
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Save & Process';
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadItems();
setInterval(loadItems, 10000); // background refresh
