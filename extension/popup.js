// ─── Gmail API helpers ────────────────────────────────────────────────────────
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailGet(path, token, params = {}) {
  const url = new URL(`${GMAIL}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  });
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
  if (!res.ok && res.status !== 204) {
    const e = await res.json();
    throw new Error(e.error?.message || 'API error');
  }
}

class AuthError extends Error { constructor() { super('auth'); } }

// ─── State ────────────────────────────────────────────────────────────────────
let token         = null;
let emails        = [];
let selectedIds   = new Set();
let nextPageToken = null;
let currentQuery  = '';
let lastPageCount = 0;
let hasMorePages  = false;

const FILTER_KEYS = ['size-filter', 'category-filter', 'date-filter', 'sender-filter'];

// ─── Boot — wire all static listeners once ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sign-in-btn').addEventListener('click', signIn);
  document.getElementById('scan-btn').addEventListener('click', scanEmails);
  document.getElementById('select-all-btn').addEventListener('click', toggleSelectAll);
  document.getElementById('trash-btn').addEventListener('click', openTrashModal);
  document.getElementById('delete-btn').addEventListener('click', openDeleteModal);
  document.getElementById('header-checkbox').addEventListener('change', toggleSelectAll);
  document.getElementById('sign-out-btn').addEventListener('click', signOut);
  document.getElementById('retry-btn').addEventListener('click', scanEmails);
  document.getElementById('load-more-btn').addEventListener('click', loadMore);
  document.getElementById('cancel-trash-btn').addEventListener('click', closeTrashModal);
  document.getElementById('confirm-trash-btn').addEventListener('click', confirmTrash);
  document.getElementById('cancel-delete-btn').addEventListener('click', closeDeleteModal);
  document.getElementById('confirm-delete-btn').addEventListener('click', confirmDeleteForever);

  // Persist filters on change
  FILTER_KEYS.forEach(id => {
    document.getElementById(id).addEventListener('change', saveFilters);
    document.getElementById(id).addEventListener('input', saveFilters);
  });

  init();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await restoreFilters();
  token = await getToken(false);
  if (token) {
    try {
      const profile = await gmailGet('profile', token);
      showApp(profile.emailAddress, profile.messagesTotal);
    } catch (e) {
      if (e instanceof AuthError) {
        token = null;
        showAuth();
      } else {
        // Network/API error — show app but surface the problem clearly
        showApp('', 0);
        showError('Could not load profile: ' + e.message);
        show('error-state');
      }
    }
  } else {
    showAuth();
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function showAuth() {
  show('auth-screen');
  hide('app-screen');
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
    const oldToken = token;
    token = null;
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${oldToken}`, { method: 'POST' });
    } catch {}
    chrome.identity.removeCachedAuthToken({ token: oldToken });
  }
  emails = []; selectedIds.clear(); nextPageToken = null; lastPageCount = 0; hasMorePages = false;
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
      `${Number(totalMessages).toLocaleString()} total messages`;
    show('storage-banner');
  }
}

// ─── Filter persistence ───────────────────────────────────────────────────────
function saveFilters() {
  const data = {};
  FILTER_KEYS.forEach(id => { data[id] = document.getElementById(id).value; });
  chrome.storage.local.set({ filters: data });
}

async function restoreFilters() {
  return new Promise(resolve => {
    chrome.storage.local.get('filters', ({ filters }) => {
      if (!filters) { resolve(); return; }
      FILTER_KEYS.forEach(id => {
        const el = document.getElementById(id);
        if (el && filters[id] !== undefined) el.value = filters[id];
      });
      resolve();
    });
  });
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
  emails = []; selectedIds.clear(); nextPageToken = null; lastPageCount = 0; hasMorePages = false;
  currentQuery = buildQuery();
  hideSection();
  show('loading');
  hide('actions-bar');
  await fetchPage(true);
}

async function loadMore() {
  if (!nextPageToken) return;
  hide('load-more-area');
  show('load-more-loading');
  try {
    await fetchPage(false);
  } finally {
    // Fixed: always hide loading spinner; fetchPage re-shows the button if needed
    hide('load-more-loading');
  }
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

    const items = await fetchMetadataBatch(listRes.messages);
    items.sort((a, b) => b.estimatedSize - a.estimatedSize);

    lastPageCount = items.length;
    emails.push(...items);
    nextPageToken  = listRes.nextPageToken || null;
    hasMorePages   = !!nextPageToken;

    renderEmails(isFirst);
    show('results');
    show('actions-bar');
    updateResultsHeader();

    document.getElementById('load-more-area').style.display = hasMorePages ? 'flex' : 'none';

  } catch (e) {
    if (isFirst) hide('loading');
    if (e instanceof AuthError) { handleSessionExpired(); return; }
    if (isFirst) showError(e.message);
    else {
      // Fixed: re-show load-more button so user can retry
      document.getElementById('load-more-area').style.display = hasMorePages ? 'flex' : 'none';
      showToast('Error loading more: ' + e.message, true);
    }
  }
}

function updateResultsHeader() {
  const count = emails.length;
  const label = hasMorePages ? `${count}+` : `${count}`;
  document.getElementById('email-count').textContent = label;
  document.getElementById('total-size').textContent =
    formatBytes(emails.reduce((s, e) => s + e.estimatedSize, 0));
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
  if (replace) {
    body.innerHTML = '';
    emails.forEach(email => appendEmailRow(body, email));
  } else {
    // Fixed: use lastPageCount to only append the newly fetched items
    emails.slice(emails.length - lastPageCount).forEach(email => appendEmailRow(body, email));
    // Fixed: reconcile header checkbox state after appending new (unchecked) rows
    syncHeaderCheckbox();
  }
}

function appendEmailRow(body, email) {
  const tr = document.createElement('tr');
  tr.dataset.id = email.id;

  // Format date compactly
  const dateStr = email.date ? formatDate(email.date) : '';
  // Gmail web link for this message
  const gmailLink = `https://mail.google.com/mail/u/0/#all/${email.id}`;

  tr.innerHTML = `
    <td><input type="checkbox" class="email-check" data-id="${email.id}" ${selectedIds.has(email.id) ? 'checked' : ''}></td>
    <td class="from-cell" title="${escHtml(email.from)}">${escHtml(email.from)}</td>
    <td class="subject-cell" title="${escHtml(email.subject)}">
      <a class="subject-link" href="${gmailLink}" target="_blank">${escHtml(email.subject) || '<em>no subject</em>'}</a>
    </td>
    <td class="date-cell" title="${escHtml(email.date)}">${escHtml(dateStr)}</td>
    <td class="size-cell">${escHtml(email.readableSize)}</td>
  `;
  tr.querySelector('.email-check').addEventListener('change', e => {
    e.target.checked ? selectedIds.add(email.id) : selectedIds.delete(email.id);
    syncHeaderCheckbox();
    updateSelection();
  });
  body.appendChild(tr);
}

function syncHeaderCheckbox() {
  const hdr = document.getElementById('header-checkbox');
  hdr.checked = emails.length > 0 && selectedIds.size === emails.length;
  hdr.indeterminate = selectedIds.size > 0 && selectedIds.size < emails.length;
}

function toggleSelectAll() {
  const cbs    = document.querySelectorAll('.email-check');
  const allSel = selectedIds.size === emails.length && emails.length > 0;
  if (allSel) {
    selectedIds.clear();
    cbs.forEach(cb => cb.checked = false);
  } else {
    emails.forEach(e => selectedIds.add(e.id));
    cbs.forEach(cb => cb.checked = true);
  }
  syncHeaderCheckbox();
  updateSelection();
}

function updateSelection() {
  const n = selectedIds.size;
  document.getElementById('selection-count').textContent = `${n} selected`;
  document.getElementById('trash-btn').disabled  = n === 0;
  document.getElementById('delete-btn').disabled = n === 0;

  const rec = document.getElementById('storage-recoverable');
  if (n > 0) {
    const total = emails.filter(e => selectedIds.has(e.id))
                        .reduce((s, e) => s + e.estimatedSize, 0);
    document.getElementById('recoverable-size').textContent = formatBytes(total);
    rec.style.display = 'inline';
  } else {
    rec.style.display = 'none';
  }
}

// ─── Trash modal ──────────────────────────────────────────────────────────────
function openTrashModal() {
  if (selectedIds.size === 0) return;
  document.getElementById('trash-count').textContent = selectedIds.size;
  show('trash-modal');
}

function closeTrashModal() { hide('trash-modal'); }

async function confirmTrash() {
  const ids = Array.from(selectedIds);
  closeTrashModal();
  const btn = document.getElementById('trash-btn');
  btn.disabled = true; btn.textContent = 'Trashing…';
  try {
    const results = await Promise.allSettled(
      ids.map(id => gmailPost(`messages/${id}/trash`, token, {}))
    );
    const succeeded = ids.filter((_, i) => results[i].status === 'fulfilled');
    const failed    = ids.length - succeeded.length;

    if (succeeded.length) removeFromList(succeeded);
    if (succeeded.length && !failed) showToast(`${succeeded.length} email(s) moved to Trash ✓`);
    else if (succeeded.length && failed) showToast(`${succeeded.length} trashed, ${failed} failed.`, true);
    else if (results[0]?.reason instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + (results[0]?.reason?.message || 'Unknown error'), true);
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
    const results = await Promise.allSettled(
      ids.map(id => gmailDelete(`messages/${id}`, token))
    );
    const succeeded = ids.filter((_, i) => results[i].status === 'fulfilled');
    const failed    = ids.length - succeeded.length;

    if (succeeded.length) removeFromList(succeeded);
    if (succeeded.length && !failed) showToast(`${succeeded.length} email(s) permanently deleted.`);
    else if (succeeded.length && failed) showToast(`${succeeded.length} deleted, ${failed} failed.`, true);
    else if (results[0]?.reason instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + (results[0]?.reason?.message || 'Unknown error'), true);
  } finally {
    btn.disabled = false; btn.textContent = 'Delete Forever';
  }
}

// ─── Session expiry ───────────────────────────────────────────────────────────
function handleSessionExpired() {
  showToast('Session expired. Please sign in again.', true);
  const oldToken = token;
  token = null;
  chrome.identity.removeCachedAuthToken({ token: oldToken });
  setTimeout(showAuth, 2200);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function removeFromList(ids) {
  const s = new Set(ids);
  emails = emails.filter(e => !s.has(e.id));
  ids.forEach(id => {
    selectedIds.delete(id);
    document.querySelector(`tr[data-id="${id}"]`)?.remove();
  });
  if (emails.length === 0) {
    hideSection(); show('empty-state');
    hide('actions-bar'); hide('load-more-area');
  } else {
    updateResultsHeader();
  }
  syncHeaderCheckbox();
  updateSelection();
}

function hideSection() {
  ['loading', 'results', 'empty-state', 'error-state'].forEach(hide);
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

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function showEl(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.style.display = 'block';
}

function formatBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function formatDate(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 365) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function escHtml(t) {
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}
