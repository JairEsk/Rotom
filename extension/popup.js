// ─── Gmail API helpers ────────────────────────────────────────────────────────
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailGet(path, token, params = {}) {
  const url = new URL(`${GMAIL}/${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v); });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'API error'); }
  return res.json();
}

async function gmailPost(path, token, body) {
  const res = await fetch(`${GMAIL}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'API error'); }
  return res.json();
}

async function gmailDelete(path, token) {
  const res = await fetch(`${GMAIL}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok && res.status !== 204) { const e = await res.json(); throw new Error(e.error?.message || 'API error'); }
}

class AuthError extends Error { constructor() { super('auth'); } }

// ─── State ────────────────────────────────────────────────────────────────────
let token         = null;
let emails        = [];
let selectedIds   = new Set();
let nextPageToken = null;
let currentQuery  = '';

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Try to restore a cached token (non-interactive)
  token = await getToken(false);
  if (token) {
    try {
      const profile = await gmailGet('profile', token);
      showApp(profile.emailAddress, profile.messagesTotal);
    } catch (e) {
      if (e instanceof AuthError) { token = null; showAuth(); }
      else showApp('', 0);
    }
  } else {
    showAuth();
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function showAuth() {
  show('auth-screen');
  hide('app-screen');
  document.getElementById('sign-in-btn').addEventListener('click', signIn);
}

async function signIn() {
  const btn = document.getElementById('sign-in-btn');
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    token = await getToken(true);
    const profile = await gmailGet('profile', token);
    showApp(profile.emailAddress, profile.messagesTotal);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Connect Gmail';
    showEl('auth-error', e.message || 'Authorization failed.');
  }
}

async function signOut() {
  if (token) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }); } catch {}
    chrome.identity.removeCachedAuthToken({ token });
    token = null;
  }
  emails = []; selectedIds.clear(); nextPageToken = null;
  showAuth();
}

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (t) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(t);
    });
  });
}

// ─── App screen ───────────────────────────────────────────────────────────────
function showApp(email, totalMessages) {
  hide('auth-screen');
  show('app-screen');

  if (email) document.getElementById('user-email').textContent = email;

  if (totalMessages) {
    document.getElementById('storage-messages').textContent =
      `${Number(totalMessages).toLocaleString()} messages`;
    show('storage-banner');
  }

  document.getElementById('sign-out-btn').addEventListener('click', signOut);
  document.getElementById('scan-btn').addEventListener('click', scanEmails);
  document.getElementById('select-all-btn').addEventListener('click', toggleSelectAll);
  document.getElementById('trash-btn').addEventListener('click', trashSelected);
  document.getElementById('delete-btn').addEventListener('click', openDeleteModal);
  document.getElementById('header-checkbox').addEventListener('change', toggleSelectAll);
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function buildQuery() {
  const size     = document.getElementById('size-filter').value;
  const category = document.getElementById('category-filter').value;
  const date     = document.getElementById('date-filter').value;
  const sender   = document.getElementById('sender-filter').value.trim();
  const parts    = [`larger:${size}M`];
  if (category) parts.push(category);
  if (date)     parts.push(date);
  if (sender)   parts.push(`from:${sender}`);
  return parts.join(' ');
}

// ─── Scan ─────────────────────────────────────────────────────────────────────
async function scanEmails() {
  emails = []; selectedIds.clear(); nextPageToken = null;
  currentQuery = buildQuery();
  hideSection();
  show('loading');
  hide('actions-bar');
  hide('load-more-area');
  await fetchPage(true);
}

async function loadMore() {
  if (!nextPageToken) return;
  hide('load-more-area');
  show('load-more-loading');
  await fetchPage(false);
  hide('load-more-loading');
}

async function fetchPage(isFirst) {
  try {
    const params = { q: currentQuery, maxResults: 25 };
    if (nextPageToken) params.pageToken = nextPageToken;
    const listRes = await gmailGet('messages', token, params);

    if (isFirst) hide('loading');

    if (!listRes.messages || listRes.messages.length === 0) {
      if (isFirst) show('empty-state');
      return;
    }

    // Fetch metadata for each message in parallel (batched 5 at a time to avoid rate limits)
    const batch = listRes.messages;
    const items = await fetchMetadataBatch(batch);

    items.sort((a, b) => b.estimatedSize - a.estimatedSize);
    emails.push(...items);
    nextPageToken = listRes.nextPageToken || null;

    renderEmails(isFirst);
    show('results');
    show('actions-bar');
    document.getElementById('email-count').textContent = emails.length;
    document.getElementById('total-size').textContent =
      formatBytes(emails.reduce((s, e) => s + e.estimatedSize, 0));

    document.getElementById('load-more-area').style.display =
      nextPageToken ? 'flex' : 'none';

  } catch (e) {
    if (isFirst) hide('loading');
    if (e instanceof AuthError) { handleSessionExpired(); return; }
    if (isFirst) showError(e.message);
    else showToast('Error loading more: ' + e.message, true);
  }
}

async function fetchMetadataBatch(msgs) {
  const CHUNK = 5;
  const results = [];
  for (let i = 0; i < msgs.length; i += CHUNK) {
    const chunk = msgs.slice(i, i + CHUNK);
    const fetched = await Promise.all(chunk.map(m => fetchEmailItem(m.id)));
    results.push(...fetched);
  }
  return results;
}

async function fetchEmailItem(id) {
  const msg = await gmailGet(`messages/${id}`, token, {
    format: 'metadata',
    metadataHeaders: 'Subject,From,Date'
  });
  let subject = '', from = '', date = '';
  (msg.payload?.headers || []).forEach(h => {
    if (h.name === 'Subject') subject = h.value;
    if (h.name === 'From')    from    = h.value;
    if (h.name === 'Date')    date    = h.value;
  });
  const size = msg.sizeEstimate || 0;
  return { id: msg.id, subject, from, date, estimatedSize: size, readableSize: formatBytes(size) };
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderEmails(replace) {
  const body = document.getElementById('email-body');
  if (replace) body.innerHTML = '';

  const slice = replace ? emails : emails.slice(-25);
  slice.forEach(email => {
    const tr = document.createElement('tr');
    tr.dataset.id = email.id;
    tr.innerHTML = `
      <td><input type="checkbox" class="email-check" data-id="${email.id}" ${selectedIds.has(email.id) ? 'checked' : ''}></td>
      <td class="from-cell"    title="${escHtml(email.from)}">${escHtml(email.from)}</td>
      <td class="subject-cell" title="${escHtml(email.subject)}">${escHtml(email.subject)}</td>
      <td class="size-cell">${escHtml(email.readableSize)}</td>
    `;
    tr.querySelector('.email-check').addEventListener('change', e => {
      e.target.checked ? selectedIds.add(email.id) : selectedIds.delete(email.id);
      updateSelection();
    });
    body.appendChild(tr);
  });
}

function toggleSelectAll() {
  const cbs     = document.querySelectorAll('.email-check');
  const allDone = selectedIds.size === emails.length;
  if (allDone) {
    selectedIds.clear();
    cbs.forEach(cb => cb.checked = false);
    document.getElementById('header-checkbox').checked = false;
  } else {
    emails.forEach(e => selectedIds.add(e.id));
    cbs.forEach(cb => cb.checked = true);
    document.getElementById('header-checkbox').checked = true;
  }
  updateSelection();
}

function updateSelection() {
  const n = selectedIds.size;
  document.getElementById('selection-count').textContent = `${n} selected`;
  document.getElementById('trash-btn').disabled  = n === 0;
  document.getElementById('delete-btn').disabled = n === 0;

  // Recoverable size
  const total = emails.filter(e => selectedIds.has(e.id)).reduce((s, e) => s + e.estimatedSize, 0);
  const rec   = document.getElementById('storage-recoverable');
  if (n > 0) {
    document.getElementById('recoverable-size').textContent = formatBytes(total);
    rec.style.display = 'inline';
  } else {
    rec.style.display = 'none';
  }
}

// ─── Trash ────────────────────────────────────────────────────────────────────
async function trashSelected() {
  if (selectedIds.size === 0) return;
  const ids = Array.from(selectedIds);
  const btn = document.getElementById('trash-btn');
  btn.disabled = true; btn.textContent = 'Trashing…';
  try {
    await Promise.all(ids.map(id => gmailPost(`messages/${id}/trash`, token, {})));
    showToast(`${ids.length} email(s) moved to Trash ✓`);
    removeFromList(ids);
  } catch (e) {
    if (e instanceof AuthError) { handleSessionExpired(); return; }
    showToast('Error: ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Trash';
  }
}

// ─── Delete forever ───────────────────────────────────────────────────────────
function openDeleteModal() {
  if (selectedIds.size === 0) return;
  document.getElementById('delete-count').textContent = selectedIds.size;
  show('delete-modal');
}

function closeDeleteModal() { hide('delete-modal'); }

async function confirmDeleteForever() {
  const ids = Array.from(selectedIds);
  closeDeleteModal();
  const btn = document.getElementById('delete-btn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await Promise.all(ids.map(id => gmailDelete(`messages/${id}`, token)));
    showToast(`${ids.length} email(s) permanently deleted.`);
    removeFromList(ids);
  } catch (e) {
    if (e instanceof AuthError) { handleSessionExpired(); return; }
    showToast('Error: ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Delete Forever';
  }
}

// ─── Session expiry ───────────────────────────────────────────────────────────
function handleSessionExpired() {
  showToast('Session expired. Please sign in again.', true);
  token = null;
  chrome.identity.removeCachedAuthToken({ token });
  setTimeout(() => { showAuth(); }, 2200);
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function removeFromList(ids) {
  const s = new Set(ids);
  emails = emails.filter(e => !s.has(e.id));
  ids.forEach(id => {
    selectedIds.delete(id);
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) row.remove();
  });
  if (emails.length === 0) {
    hideSection(); show('empty-state');
    hide('actions-bar'); hide('load-more-area');
  } else {
    document.getElementById('email-count').textContent = emails.length;
    document.getElementById('total-size').textContent =
      formatBytes(emails.reduce((s, e) => s + e.estimatedSize, 0));
  }
  updateSelection();
}

function hideSection() {
  ['loading','results','empty-state','error-state'].forEach(hide);
}

function showError(msg) {
  document.getElementById('error-message').textContent = msg;
  show('error-state');
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 4000);
}

function show(id)    { document.getElementById(id).style.display = ''; }
function hide(id)    { document.getElementById(id).style.display = 'none'; }
function showEl(id, text) { const el = document.getElementById(id); el.textContent = text; el.style.display = 'block'; }

function formatBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function escHtml(t) {
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}
