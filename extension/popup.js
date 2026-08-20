// â”€â”€â”€ Gmail API helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailGet(path, token, params = {}) {
  const url = new URL(`${GMAIL}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) { v.forEach(val => url.searchParams.append(k, val)); } else if (v !== undefined && v !== '') { url.searchParams.set(k, v); }
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

// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let token         = null;
let emails        = [];
let selectedIds   = new Set();
let nextPageToken = null;
let currentQuery  = '';
let lastPageCount = 0;
let hasMorePages  = false;

const FILTER_KEYS = ['size-filter', 'category-filter', 'date-filter', 'sender-filter'];

// â”€â”€â”€ Boot â€” wire all static listeners once â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  document.getElementById('empty-trash-btn').addEventListener('click', openEmptyTrashModal);
  document.getElementById('cancel-empty-trash-btn').addEventListener('click', closeEmptyTrashModal);
  document.getElementById('confirm-empty-trash-btn').addEventListener('click', confirmEmptyTrash);

  // Persist filters on change
  FILTER_KEYS.forEach(id => {
    document.getElementById(id).addEventListener('change', saveFilters);
    document.getElementById(id).addEventListener('input', saveFilters);
  });

  init();
});

// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // Network/API error â€” show app but surface the problem clearly
        showApp('', 0);
        showError('Could not load profile: ' + e.message);
        show('error-state');
      }
    }
  } else {
    showAuth();
  }
}

// â”€â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showAuth() {
  show('auth-screen');
  hide('app-screen');
}

async function signIn() {
  const btn = document.getElementById('sign-in-btn');
  btn.disabled = true; btn.textContent = 'Connecting...';
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

// â”€â”€â”€ App screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Filter persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildQuery() {
  const size     = document.getElementById('size-filter').value;
  const category = document.getElementById('category-filter').value;
  const date     = document.getElementById('date-filter').value;
  const sender   = document.getElementById('sender-filter').value.trim();
  const parts    = [];
  if (size)     parts.push(`larger:${size}M`);
  if (category) parts.push(category);
  if (date)     parts.push(date);
  if (sender)   parts.push(`from:${sender}`);
  return parts.join(' ');
}

// â”€â”€â”€ Scan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    metadataHeaders: ['Subject', 'From', 'Date']
  });
  let subject = '', from = '', date = '';
  (msg.payload?.headers || []).forEach(h => {
    const name = h.name.toLowerCase();
    if (name === 'subject') subject = h.value;
    if (name === 'from') from = h.value;
    if (name === 'date') date = h.value;
  });
  const size = msg.sizeEstimate || 0;
  return { id: msg.id, subject, from, date, estimatedSize: size, readableSize: formatBytes(size) };
}

// â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Trash modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  btn.disabled = true;
  
  const total = ids.length;
  let processed = 0;
  let succeeded = [];
  let firstError = null;

  try {
    for (let i = 0; i < total; i += 5) {
      const chunk = ids.slice(i, i + 5);
      btn.textContent = `Trashing (${processed}/${total})...`;
      
      const results = await Promise.allSettled(
        chunk.map(id => gmailPost(`messages/${id}/trash`, token, {}))
      );
      
      chunk.forEach((id, idx) => {
        if (results[idx].status === 'fulfilled') {
          succeeded.push(id);
        } else if (!firstError) {
          firstError = results[idx].reason;
        }
      });
      
      processed += chunk.length;
    }
    
    btn.textContent = `Trashing (${processed}/${total})...`;

    const failed = total - succeeded.length;

    if (succeeded.length) removeFromList(succeeded);
    if (succeeded.length && !failed) showToast(`${succeeded.length} email(s) moved to Trash ✓`);
    else if (succeeded.length && failed) showToast(`${succeeded.length} trashed, ${failed} failed.`, true);
    else if (firstError instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + (firstError?.message || 'Unknown error'), true);
  } finally {
    btn.disabled = false; btn.textContent = 'Trash';
  }
}

// â”€â”€â”€ Delete forever â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  btn.disabled = true;

  // Force a fresh token -- the cached one may lack https://mail.google.com/ scope.
  try {
    chrome.identity.removeCachedAuthToken({ token });
    token = await getToken(true);
  } catch (e) {
    showToast('Could not refresh auth. Please sign in again.', true);
    btn.disabled = false; btn.textContent = 'Delete Forever';
    return;
  }

  const total = ids.length;
  let processed = 0;
  let succeeded = [];
  let firstError = null;

  try {
    for (let i = 0; i < total; i += 5) {
      const chunk = ids.slice(i, i + 5);
      btn.textContent = `Deleting (${processed}/${total})...`;
      
      const results = await Promise.allSettled(
        chunk.map(id => gmailDelete(`messages/${id}`, token))
      );
      
      chunk.forEach((id, idx) => {
        if (results[idx].status === 'fulfilled') {
          succeeded.push(id);
        } else if (!firstError) {
          firstError = results[idx].reason;
        }
      });
      
      processed += chunk.length;
    }
    
    btn.textContent = `Deleting (${processed}/${total})...`;

    const failed = total - succeeded.length;

    if (succeeded.length) removeFromList(succeeded);
    if (succeeded.length && !failed) showToast(`${succeeded.length} email(s) permanently deleted.`);
    else if (succeeded.length && failed) showToast(`${succeeded.length} deleted, ${failed} failed.`, true);
    else if (firstError instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + (firstError?.message || 'Unknown error'), true);
  } finally {
    btn.disabled = false; btn.textContent = 'Delete Forever';
  }
}

// â”€â”€â”€ Session expiry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleSessionExpired() {
  showToast('Session expired. Please sign in again.', true);
  const oldToken = token;
  token = null;
  chrome.identity.removeCachedAuthToken({ token: oldToken });
  setTimeout(showAuth, 2200);
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// --- Empty Trash -----------------------------------------------------------
function openEmptyTrashModal() { show('empty-trash-modal'); }
function closeEmptyTrashModal() { hide('empty-trash-modal'); }

async function confirmEmptyTrash() {
  closeEmptyTrashModal();
  const btn = document.getElementById('empty-trash-btn');
  btn.disabled = true;
  btn.textContent = 'Emptying...';
  try {
    let pageToken = undefined;
    let allIds = [];
    do {
      const params = { labelIds: 'TRASH', maxResults: 500 };
      if (pageToken) params.pageToken = pageToken;
      const res = await gmailGet('messages', token, params);
      if (res.messages) allIds.push(...res.messages.map(m => m.id));
      pageToken = res.nextPageToken;
    } while (pageToken);

    if (allIds.length === 0) {
      showToast('Trash is already empty.');
      return;
    }

    let deleted = 0;
    let firstError = null;
    for (let i = 0; i < allIds.length; i += 5) {
      const chunk = allIds.slice(i, i + 5);
      btn.textContent = 'Emptying (' + deleted + '/' + allIds.length + ')...';
      const results = await Promise.allSettled(chunk.map(id => gmailDelete('messages/' + id, token)));
      results.forEach((r) => {
        if (r.status === 'fulfilled') { deleted++; }
        else if (!firstError) { firstError = r.reason; }
      });
    }

    const failed = allIds.length - deleted;
    if (deleted && !failed) showToast('Trash emptied \u2014 ' + deleted + ' email(s) permanently deleted.');
    else if (deleted && failed) showToast(deleted + ' deleted, ' + failed + ' failed.', true);
    else if (firstError instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + (firstError?.message || 'Unknown error'), true);
  } catch (e) {
    if (e instanceof AuthError) { handleSessionExpired(); return; }
    showToast('Error: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Empty Trash';
  }
}

function escHtml(t) {
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

