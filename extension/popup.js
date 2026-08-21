// --- Gmail API helpers ---
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

// --- State ---
let token         = null;
let emails        = [];
let selectedIds   = new Set();
let nextPageToken = null;
let currentQuery  = '';
let lastPageCount = 0;
let hasMorePages  = false;

const FILTER_KEYS = ['size-filter', 'category-filter', 'date-filter', 'sender-filter'];

// --- Boot: wire all static listeners once ---
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sign-in-btn').addEventListener('click', signIn);
  document.getElementById('switch-account-btn').addEventListener('click', switchAccount);
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
  document.getElementById('cancel-unsub-btn').addEventListener('click', closeUnsubscribeModal);
  document.getElementById('confirm-unsub-btn').addEventListener('click', confirmUnsubscribe);
  document.getElementById('unsub-bulk-btn').addEventListener('click', openBulkUnsubscribeModal);
  document.getElementById('cancel-bulk-unsub-btn').addEventListener('click', closeBulkUnsubscribeModal);
  document.getElementById('confirm-bulk-unsub-btn').addEventListener('click', confirmBulkUnsubscribe);
  document.getElementById('unsub-callout-dismiss').addEventListener('click', () => {
    hide('unsub-callout');
    chrome.storage.local.set({ unsubCalloutDismissed: true });
  });

  // Persist filters on change
  FILTER_KEYS.forEach(id => {
    document.getElementById(id).addEventListener('change', saveFilters);
    document.getElementById(id).addEventListener('input', saveFilters);
  });

  init();
});

// --- Init ---
async function init() {
  await restoreFilters();
  initUnsubscribeCallout();
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

// --- Auth ---
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

async function switchAccount() {
  const btn = document.getElementById('switch-account-btn');
  btn.disabled = true; btn.textContent = 'Switching...';
  if (token) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }); } catch {}
    token = null;
  }
  if (chrome.identity.clearAllCachedAuthTokens) {
    try {
      await new Promise(resolve => {
        const p = chrome.identity.clearAllCachedAuthTokens();
        if (p && p.then) p.then(resolve).catch(resolve);
        else resolve();
      });
    } catch {}
  }
  btn.disabled = false; btn.textContent = 'Use a different account';
  signIn();
}

async function signOut() {
  if (token) {
    const oldToken = token;
    token = null;
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${oldToken}`, { method: 'POST' });
    } catch {}
  }
  if (chrome.identity.clearAllCachedAuthTokens) {
    try {
      await new Promise(resolve => {
        const p = chrome.identity.clearAllCachedAuthTokens();
        if (p && p.then) p.then(resolve).catch(resolve);
        else resolve();
      });
    } catch {}
  } else {
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

// --- App screen ---
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

// --- Filter persistence ---
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

// --- Filters ---
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

// --- Scan ---
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
    metadataHeaders: ['Subject', 'From', 'Date', 'List-Unsubscribe', 'List-Unsubscribe-Post']
  });
  let subject = '', sender = '', date = '';
  (msg.payload?.headers || []).forEach(header => {
    const name = header.name.toLowerCase();
    if (name === 'subject') subject = header.value;
    if (name === 'from') sender = header.value;
    if (name === 'date') date = header.value;
  });
  const size = msg.sizeEstimate || 0;
  const unsubscribeInfo = parseUnsubscribeHeader(msg.payload?.headers || []);
  return { id: msg.id, subject, from: sender, date, estimatedSize: size, readableSize: formatBytes(size), unsubscribeInfo };
}

// --- Render ---
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

  if (email.unsubscribeInfo) tr.classList.add('has-unsub');
  tr.innerHTML = `
    <td><input type="checkbox" class="email-check" data-id="${email.id}" ${selectedIds.has(email.id) ? 'checked' : ''}></td>
    <td class="from-cell" title="${escHtml(email.from)}">${escHtml(email.from)}</td>
    <td class="subject-cell" title="${escHtml(email.subject)}">
      <a class="subject-link" href="${gmailLink}" target="_blank">${escHtml(email.subject) || '<em>no subject</em>'}</a>
    </td>
    <td class="date-cell" title="${escHtml(email.date)}">${escHtml(dateStr)}</td>
    <td class="size-cell">${escHtml(email.readableSize)}</td>
    <td class="actions-cell">
      ${email.unsubscribeInfo ? '<button class="unsub-btn" title="Unsubscribe from this sender">&#x1F6AB;</button>' : ''}
    </td>
  `;
  tr.querySelector('.email-check').addEventListener('change', e => {
    e.target.checked ? selectedIds.add(email.id) : selectedIds.delete(email.id);
    syncHeaderCheckbox();
    updateSelection();
  });
  body.appendChild(tr);
  if (email.unsubscribeInfo) {
    const unsubBtnEl = tr.querySelector('.unsub-btn');
    if (unsubBtnEl) unsubBtnEl.addEventListener('click', () => openUnsubscribeModal(email));
  }
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
  const unsubCapable = emails.filter(e => selectedIds.has(e.id) && e.unsubscribeInfo).length;
  const bulkUnsubBtn = document.getElementById('unsub-bulk-btn');
  bulkUnsubBtn.disabled = unsubCapable === 0;
  bulkUnsubBtn.textContent = unsubCapable > 0 ? `🚫 Unsubscribe (${unsubCapable})` : '🚫 Unsubscribe';
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

// --- Trash modal ---
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

// --- Delete forever ---
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
    if (chrome.identity.clearAllCachedAuthTokens) chrome.identity.clearAllCachedAuthTokens(() => {}); else chrome.identity.removeCachedAuthToken({ token });
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

// --- Session expiry ---
function handleSessionExpired() {
  showToast('Session expired. Please sign in again.', true);
  const oldToken = token;
  token = null;
  if (chrome.identity.clearAllCachedAuthTokens) {
    chrome.identity.clearAllCachedAuthTokens(() => {});
  } else {
    chrome.identity.removeCachedAuthToken({ token: oldToken });
  }
  setTimeout(showAuth, 2200);
}

// --- Helpers ---
function removeFromList(ids) {
  const idsSet = new Set(ids);
  emails = emails.filter(email => !idsSet.has(email.id));
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
  const toastEl = document.getElementById('toast');
  toastEl.textContent = msg;
  toastEl.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  toastEl.style.display = 'block';
  setTimeout(() => { toastEl.style.display = 'none'; }, 4000);
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
  const kb = 1024, units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.floor(Math.log(b) / Math.log(kb));
  return parseFloat((b / Math.pow(kb, unitIndex)).toFixed(1)) + ' ' + units[unitIndex];
}

function formatDate(raw) {
  if (!raw) return '';
  try {
    const date = new Date(raw);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 365) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

// --- Empty Trash ---
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


// --- Unsubscribe: parse List-Unsubscribe header ----------------------------
function parseUnsubscribeHeader(headers) {
  let rawValue = '';
  let hasOneClick = false;
  headers.forEach(header => {
    const name = header.name.toLowerCase();
    if (name === 'list-unsubscribe') rawValue = header.value;
    if (name === 'list-unsubscribe-post' && header.value.includes('One-Click')) hasOneClick = true;
  });
  if (!rawValue) return null;

  const urls = rawValue.match(/<([^>]+)>/g)?.map(m => m.slice(1, -1)) || [];
  const httpsUrl = urls.find(u => u.startsWith('https://'));
  const mailtoUrl = urls.find(u => u.startsWith('mailto:'));

  if (httpsUrl && hasOneClick) return { type: 'one-click', url: httpsUrl };
  if (httpsUrl) return { type: 'https', url: httpsUrl };
  if (mailtoUrl) return { type: 'mailto', url: mailtoUrl };
  return null;
}

// --- Unsubscribe: execute for a single email -------------------------------
async function executeUnsubscribe(email) {
  const info = email.unsubscribeInfo;
  if (!info) return;

  if (info.type === 'one-click' || info.type === 'https') {
    if (!info.url.startsWith('https://')) {
      throw new Error('Unsubscribe URL is not HTTPS — skipped for security.');
    }
    const response = await fetch(info.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click'
    });
    if (!response.ok) {
      throw new Error(`Unsubscribe POST failed: HTTP ${response.status}`);
    }
    return;
  }

  if (info.type === 'mailto') {
    const parsed = new URL(info.url);
    const to = parsed.pathname;
    const subject = parsed.searchParams.get('subject') || 'unsubscribe';
    const rawMsg = [`To: ${to}`, `Subject: ${subject}`, ``, ``].join('\r\n');
    const encoded = btoa(unescape(encodeURIComponent(rawMsg)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmailPost('messages/send', token, { raw: encoded });
  }
}

// --- Unsubscribe: open modal for a single email ----------------------------
function openUnsubscribeModal(email) {
  const senderName = (email.from || '').replace(/<[^>]+>/, '').trim() || email.from;
  document.getElementById('unsub-sender-name').textContent = senderName;
  document.getElementById('unsub-also-trash').checked = false;

  const modal = document.getElementById('unsub-modal');
  modal.dataset.emailId = email.id;
  show('unsub-modal');
}

function closeUnsubscribeModal() { hide('unsub-modal'); }

async function confirmUnsubscribe() {
  const modal = document.getElementById('unsub-modal');
  const emailId = modal.dataset.emailId;
  const email = emails.find(e => e.id === emailId);
  if (!email) { closeUnsubscribeModal(); return; }

  const alsoTrash = document.getElementById('unsub-also-trash').checked;
  closeUnsubscribeModal();

  setRowUnsubState(emailId, 'pending');
  try {
    await executeUnsubscribe(email);
    setRowUnsubState(emailId, 'done');
    email.unsubscribeInfo = { ...email.unsubscribeInfo, status: 'done' };
    const senderName = (email.from || '').replace(/<[^>]+>/, '').trim() || email.from;
    showToast(`Unsubscribe request sent to ${senderName}`);

    if (alsoTrash) {
      await gmailPost(`messages/${emailId}/trash`, token, {});
      removeFromList([emailId]);
    }
  } catch (err) {
    setRowUnsubState(emailId, 'failed');
    email.unsubscribeInfo = { ...email.unsubscribeInfo, status: 'failed' };
    if (err instanceof AuthError) { handleSessionExpired(); return; }
    showToast('Unsubscribe failed: ' + err.message, true);
  }
}

// --- Unsubscribe: bulk unsubscribe for selected emails ---------------------
function openBulkUnsubscribeModal() {
  const capable = emails.filter(e => selectedIds.has(e.id) && e.unsubscribeInfo);
  if (capable.length === 0) { showToast('None of the selected emails support unsubscribe.', true); return; }
  document.getElementById('bulk-unsub-count').textContent = capable.length;
  document.getElementById('bulk-unsub-also-trash').checked = false;
  show('bulk-unsub-modal');
}

function closeBulkUnsubscribeModal() { hide('bulk-unsub-modal'); }

async function confirmBulkUnsubscribe() {
  const capable = emails.filter(e => selectedIds.has(e.id) && e.unsubscribeInfo);
  const alsoTrash = document.getElementById('bulk-unsub-also-trash').checked;
  closeBulkUnsubscribeModal();

  let succeeded = [];
  let failed = 0;
  for (const email of capable) {
    setRowUnsubState(email.id, 'pending');
    try {
      await executeUnsubscribe(email);
      setRowUnsubState(email.id, 'done');
      email.unsubscribeInfo = { ...email.unsubscribeInfo, status: 'done' };
      succeeded.push(email.id);
    } catch {
      setRowUnsubState(email.id, 'failed');
      email.unsubscribeInfo = { ...email.unsubscribeInfo, status: 'failed' };
      failed++;
    }
  }

  if (succeeded.length) showToast(`Unsubscribed from ${succeeded.length} sender(s)${failed ? `, ${failed} failed` : ''}.`, failed > 0);
  else showToast('All unsubscribe requests failed.', true);

  if (alsoTrash && succeeded.length) {
    for (let i = 0; i < succeeded.length; i += 5) {
      await Promise.allSettled(succeeded.slice(i, i + 5).map(id => gmailPost(`messages/${id}/trash`, token, {})));
    }
    removeFromList(succeeded);
  }
}

// --- Unsubscribe: update row visual state ----------------------------------
function setRowUnsubState(emailId, state) {
  const tr = document.querySelector(`tr[data-id="${emailId}"]`);
  if (!tr) return;
  tr.dataset.unsubState = state;
  const btn = tr.querySelector('.unsub-btn');
  if (!btn) return;
  if (state === 'pending') { btn.textContent = '⏳'; btn.disabled = true; btn.title = 'Sending unsubscribe request...'; }
  else if (state === 'done') { btn.textContent = '✓'; btn.disabled = true; btn.title = 'Unsubscribe request sent'; }
  else if (state === 'failed') { btn.textContent = '⚠'; btn.disabled = false; btn.title = 'Unsubscribe failed — click to retry'; }
}

// --- First-use callout -----------------------------------------------------
function initUnsubscribeCallout() {
  chrome.storage.local.get('unsubCalloutDismissed', ({ unsubCalloutDismissed }) => {
    if (unsubCalloutDismissed) return;
    show('unsub-callout');
  });
}
function escHtml(t) {
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}




