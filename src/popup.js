import { formatBytes, formatDate, escHtml } from "./utils.js";
import { gmailGet, gmailPost, gmailBatchGet, AuthError } from './api.js';

// --- State ---
let token         = null;
let emails        = [];
let selectedIds   = new Set();
let nextPageToken = null;
let currentQuery  = '';
let hasMorePages  = false;

const FILTER_KEYS = ['size-filter', 'category-filter', 'date-filter', 'sender-filter'];


// --- Job Polling ---
async function startJob(action, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'START_JOB', action, payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(res.jobId);
    });
  });
}

async function pollJob(jobId, onProgress) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS', jobId }, (job) => {
        if (!job) {
          clearInterval(interval);
          reject(new Error('Job not found'));
          return;
        }
        if (onProgress) onProgress(job);
        
        if (job.status === 'done') {
          clearInterval(interval);
          resolve(job);
        } else if (job.status === 'error') {
          clearInterval(interval);
          if (job.error === 'AUTH_ERROR') reject(new AuthError());
          else reject(new Error(job.error));
        }
      });
    }, 500);
  });
}

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
  const oldToken = token;
  token = null;
  if (oldToken) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${oldToken}`, { method: 'POST' }); } catch {}
  }
  if (chrome.identity.clearAllCachedAuthTokens) {
    try {
      await new Promise(resolve => {
        const p = chrome.identity.clearAllCachedAuthTokens();
        if (p && p.then) p.then(resolve).catch(resolve);
        else resolve();
      });
    } catch {}
  } else if (oldToken) {
    chrome.identity.removeCachedAuthToken({ token: oldToken });
  }
  btn.disabled = false; btn.textContent = 'Use a different account';
  signIn();
}

async function signOut() {
  const oldToken = token;
  token = null;
  if (oldToken) {
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
  } else if (oldToken) {
    chrome.identity.removeCachedAuthToken({ token: oldToken });
  }
  emails = []; selectedIds.clear(); nextPageToken = null; hasMorePages = false;
  hideSection();
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
  emails = []; selectedIds.clear(); nextPageToken = null; hasMorePages = false;
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
      hide('load-more-area');
      return;
    }

    const items = await fetchMetadataBatch(listRes.messages);
    emails.push(...items);
    emails.sort((a, b) => b.estimatedSize - a.estimatedSize);

    nextPageToken  = listRes.nextPageToken || null;
    hasMorePages   = !!nextPageToken;

    renderEmails();
    show('results');
    show('actions-bar');
    updateResultsHeader();
    updateSelection();

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

function parseEmailItem(msg) {
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

async function fetchMetadataBatch(msgs) {
  const ids = msgs.map(m => m.id);
  // We can do them all in a single batch request!
  const batchRes = await gmailBatchGet(ids, token);
  return batchRes.map(parseEmailItem);
}

async function fetchEmailItem(id) {
  const msg = await gmailGet(`messages/${id}`, token, {
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Date', 'List-Unsubscribe', 'List-Unsubscribe-Post']
  });
  return parseEmailItem(msg);
}

// --- Render ---
function renderEmails() {
  const body = document.getElementById('email-body');
  body.innerHTML = '';
  emails.forEach(email => appendEmailRow(body, email));
  syncHeaderCheckbox();
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
    <td class="from-cell" title="${escHtml(email.from)}">
      <a href="#" class="sender-filter-link" title="Click to filter by this sender">${escHtml(email.from)}</a>
    </td>
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
  
  tr.querySelector('.sender-filter-link').addEventListener('click', e => {
    e.preventDefault();
    // Extract email from formats like "Name <email@domain.com>"
    const match = email.from.match(/<([^>]+)>/);
    const exactEmail = match ? match[1] : email.from;
    
    document.getElementById('sender-filter').value = exactEmail;
    saveFilters();
    scanEmails(); // Auto-trigger scan
  });

  body.appendChild(tr);
  if (email.unsubscribeInfo) {
    const unsubBtnEl = tr.querySelector('.unsub-btn');
    if (unsubBtnEl) unsubBtnEl.addEventListener('click', () => openUnsubscribeModal(email));
    if (email.unsubscribeInfo.status) {
      setRowUnsubState(email.id, email.unsubscribeInfo.status);
    }
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
  
  try {
    const jobId = await startJob('TRASH', { token, ids });
    const jobResult = await pollJob(jobId, (job) => {
      btn.textContent = `Trashing (${job.processed}/${job.total})...`;
    });
    
    if (jobResult.succeeded.length) removeFromList(jobResult.succeeded);
    if (jobResult.succeeded.length && !jobResult.failed) showToast(`${jobResult.succeeded.length} email(s) moved to Trash ✓`);
    else if (jobResult.succeeded.length && jobResult.failed) showToast(`${jobResult.succeeded.length} trashed, ${jobResult.failed} failed.`, true);
  } catch (err) {
    if (err instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + err.message, true);
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

  try {
    if (chrome.identity.clearAllCachedAuthTokens) chrome.identity.clearAllCachedAuthTokens(() => {}); else chrome.identity.removeCachedAuthToken({ token });
    token = await getToken(true);
  } catch (e) {
    showToast('Could not refresh auth. Please sign in again.', true);
    btn.disabled = false; btn.textContent = 'Delete Forever';
    return;
  }

  try {
    const jobId = await startJob('DELETE_FOREVER', { token, ids });
    const jobResult = await pollJob(jobId, (job) => {
      btn.textContent = `Deleting (${job.processed}/${job.total})...`;
    });
    
    if (jobResult.succeeded.length) removeFromList(jobResult.succeeded);
    if (jobResult.succeeded.length && !jobResult.failed) showToast(`${jobResult.succeeded.length} email(s) permanently deleted.`);
    else if (jobResult.succeeded.length && jobResult.failed) showToast(`${jobResult.succeeded.length} deleted, ${jobResult.failed} failed.`, true);
  } catch (err) {
    if (err instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + err.message, true);
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
  ['loading', 'results', 'empty-state', 'error-state', 'load-more-area', 'load-more-loading'].forEach(hide);
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





// --- Empty Trash ---
function openEmptyTrashModal() { show('empty-trash-modal'); }
function closeEmptyTrashModal() { hide('empty-trash-modal'); }

async function confirmEmptyTrash() {
  closeEmptyTrashModal();
  const btn = document.getElementById('empty-trash-btn');
  btn.disabled = true;
  btn.textContent = 'Emptying...';
  
  try {
    const jobId = await startJob('EMPTY_TRASH', { token });
    const jobResult = await pollJob(jobId, (job) => {
      btn.textContent = `Emptying (${job.processed}/${job.total})...`;
    });
    
    if (jobResult.total === 0) {
      showToast('Trash is already empty.');
      return;
    }
    
    const deleted = jobResult.succeeded.length;
    const failed = jobResult.total - deleted;
    if (deleted && !failed) showToast('Trash emptied — ' + deleted + ' email(s) permanently deleted.');
    else if (deleted && failed) showToast(deleted + ' deleted, ' + failed + ' failed.', true);
  } catch (err) {
    if (err instanceof AuthError) { handleSessionExpired(); return; }
    else showToast('Error: ' + err.message, true);
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
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'EXECUTE_UNSUBSCRIBE', payload: { email, token } }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res.success) return reject(new Error(res.error));
      resolve();
    });
  });
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
      await gmailPost('messages/batchModify', token, { ids: [emailId], addLabelIds: ['TRASH'] });
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
    for (let i = 0; i < succeeded.length; i += 1000) {
      await gmailPost('messages/batchModify', token, { ids: succeeded.slice(i, i + 1000), addLabelIds: ['TRASH'] }).catch(() => {});
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





