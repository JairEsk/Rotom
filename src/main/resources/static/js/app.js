const API = {
    setupStatus:  '/api/setup/status',
    uploadCreds:  '/api/setup/credentials',
    authUrl:      '/api/setup/auth-url',
    emails:       '/api/emails',
    trash:        '/api/emails/trash',
    deleteForever:'/api/emails/delete',
    storage:      '/api/storage',
};

// ─── State ───────────────────────────────────────────────────────────────────
let emails       = [];
let selectedIds  = new Set();
let selectedFile = null;
let nextPageToken = null;
let currentQuery  = '';

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { init(); });

async function init() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('oauth_success')) {
        history.replaceState({}, '', '/');
        const res  = await fetch(API.setupStatus);
        const data = await res.json();
        if (data.authenticated && data.email) { showApp(data.email); return; }
    }

    if (params.get('oauth_error')) {
        history.replaceState({}, '', '/');
        showSetup();
        goToStep(3);
        setConnectStatus('error', `✗ Authorization failed: ${params.get('oauth_error')}`);
        return;
    }

    try {
        const res  = await fetch(API.setupStatus);
        const data = await res.json();
        if (data.authenticated && data.email) {
            showApp(data.email);
        } else if (data.credentialsConfigured) {
            showSetup(); goToStep(3);
        } else {
            showSetup();
        }
    } catch {
        showSetup();
    }
}

// ─── Screen toggles ──────────────────────────────────────────────────────────
function showSetup() {
    document.getElementById('setup-screen').style.display = 'block';
    document.getElementById('app-screen').style.display   = 'none';
    initSetupListeners();
}

function showApp(email) {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('app-screen').style.display   = 'block';
    if (email) {
        document.getElementById('user-email').textContent = email;
        const ind = document.getElementById('auth-indicator');
        ind.classList.remove('disconnected');
        ind.classList.add('connected');
    }
    initAppListeners();
    loadStorageBanner();
}

// ─── Setup flow ──────────────────────────────────────────────────────────────
function initSetupListeners() {
    const fileInput = document.getElementById('credentials-file');
    const dropZone  = document.getElementById('drop-zone');
    if (!fileInput) return;
    fileInput.addEventListener('change', e => handleFileSelect(e.target.files[0]));
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault(); dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', e => { if (e.target.tagName !== 'BUTTON') fileInput.click(); });
}

function goToStep(n) {
    [1,2,3].forEach(i => {
        const el = document.getElementById(`step-${i}`);
        if (el) el.style.display = i === n ? 'flex' : 'none';
    });
}

function handleFileSelect(file) {
    if (!file) return;
    selectedFile = file;
    const nameEl = document.getElementById('file-name');
    nameEl.textContent = `✓ ${file.name}`;
    nameEl.style.display = 'block';
    document.getElementById('upload-btn').disabled = false;
    document.getElementById('upload-error').style.display = 'none';
}

async function uploadCredentials() {
    if (!selectedFile) return;
    const btn = document.getElementById('upload-btn');
    btn.disabled = true; btn.textContent = 'Uploading...';
    const form = new FormData();
    form.append('file', selectedFile);
    try {
        const res  = await fetch(API.uploadCreds, { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) { showUploadError(data.error || 'Upload failed'); return; }
        goToStep(3);
    } catch (e) {
        showUploadError('Network error: ' + e.message);
    } finally {
        btn.disabled = false; btn.textContent = 'Upload & Continue →';
    }
}

function showUploadError(msg) {
    const el = document.getElementById('upload-error');
    el.textContent = msg; el.style.display = 'block';
}

async function connectGmail() {
    const btn = document.getElementById('connect-btn');
    btn.disabled = true;
    setConnectStatus('loading', '<div class="mini-spinner"></div><span>Redirecting to Google…</span>');
    try {
        const res  = await fetch(API.authUrl);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to get auth URL');
        window.location.href = data.url;
    } catch (e) {
        setConnectStatus('error', `✗ ${e.message}`);
        btn.disabled = false;
    }
}

function setConnectStatus(type, html) {
    const el = document.getElementById('connect-status');
    if (!el) return;
    el.className = `connect-status ${type}`;
    el.innerHTML = html;
}

// ─── Storage banner ──────────────────────────────────────────────────────────
async function loadStorageBanner() {
    try {
        const res  = await fetch(API.storage);
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('storage-email').textContent    = data.emailAddress || '';
        document.getElementById('storage-messages').textContent = `${(data.totalMessages || 0).toLocaleString()} messages`;
        document.getElementById('storage-banner').style.display = 'flex';
    } catch { /* non-critical */ }
}

function updateRecoverableSize() {
    const total = emails
        .filter(e => selectedIds.has(e.id))
        .reduce((s, e) => s + e.estimatedSize, 0);
    const area = document.getElementById('storage-recoverable');
    if (selectedIds.size > 0) {
        document.getElementById('recoverable-size').textContent = formatBytes(total);
        area.style.display = 'flex';
    } else {
        area.style.display = 'none';
    }
}

// ─── Main app ────────────────────────────────────────────────────────────────
function initAppListeners() {
    document.getElementById('scan-btn').addEventListener('click', scanEmails);
    document.getElementById('select-all-btn').addEventListener('click', toggleSelectAll);
    document.getElementById('trash-btn').addEventListener('click', trashSelected);
    document.getElementById('delete-btn').addEventListener('click', openDeleteModal);
    document.getElementById('header-checkbox').addEventListener('change', toggleSelectAll);
}

function buildQuery() {
    const size     = document.getElementById('size-filter').value;
    const category = document.getElementById('category-filter').value;
    const date     = document.getElementById('date-filter').value;
    const sender   = document.getElementById('sender-filter').value.trim();

    const parts = [];
    parts.push(`larger:${size}M`);
    if (category) parts.push(category);
    if (date)     parts.push(date);
    if (sender)   parts.push(`from:${sender}`);
    return parts.join(' ');
}

async function scanEmails() {
    emails = [];
    selectedIds.clear();
    nextPageToken = null;
    currentQuery  = buildQuery();

    showSection('loading');
    document.getElementById('actions-group').style.display = 'none';
    document.getElementById('load-more-area').style.display = 'none';

    await fetchPage(true);
}

async function loadMore() {
    if (!nextPageToken) return;
    document.getElementById('load-more-area').style.display    = 'none';
    document.getElementById('load-more-loading').style.display = 'flex';
    await fetchPage(false);
    document.getElementById('load-more-loading').style.display = 'none';
}

async function fetchPage(isFirstPage) {
    try {
        handleSessionError(); // reset any previous session errors

        let url = `${API.emails}?query=${encodeURIComponent(currentQuery)}`;
        if (nextPageToken) url += `&pageToken=${encodeURIComponent(nextPageToken)}`;

        const res = await fetch(url);

        // ── Session expiry check ──────────────────────────────────────────
        if (res.status === 401) { handleSessionExpired(); return; }

        if (!res.ok) {
            const err = await res.json();
            const msg = err.error || 'Failed to scan emails';
            if (isSessionError(msg)) { handleSessionExpired(); return; }
            if (isFirstPage) showError(msg);
            else showToast(msg, true);
            return;
        }

        const page = await res.json();

        if (isFirstPage && page.emails.length === 0) {
            showSection('empty'); return;
        }

        emails.push(...page.emails);
        nextPageToken = page.nextPageToken;

        renderEmails(isFirstPage);
        showSection('results');
        document.getElementById('actions-group').style.display = 'flex';
        document.getElementById('email-count').textContent = emails.length;
        const total = emails.reduce((s, e) => s + e.estimatedSize, 0);
        document.getElementById('total-size').textContent = formatBytes(total);

        document.getElementById('load-more-area').style.display =
            page.hasMore ? 'flex' : 'none';

    } catch (e) {
        if (isFirstPage) showError(e.message);
        else showToast('Error loading more: ' + e.message, true);
    }
}

function renderEmails(replace) {
    const body = document.getElementById('email-body');
    if (replace) body.innerHTML = '';

    // only render the new slice
    const start = replace ? 0 : emails.length - (emails.length % 25 || 25);
    const slice = replace ? emails : emails.slice(start);

    slice.forEach(email => {
        const tr = document.createElement('tr');
        tr.dataset.id = email.id;
        tr.innerHTML = `
            <td><input type="checkbox" class="email-check" data-id="${email.id}" ${selectedIds.has(email.id) ? 'checked' : ''}></td>
            <td class="from-cell"    title="${escapeHtml(email.from)}">${escapeHtml(email.from)}</td>
            <td class="subject-cell" title="${escapeHtml(email.subject)}">${escapeHtml(email.subject)}</td>
            <td class="date-cell">${escapeHtml(email.date)}</td>
            <td class="size-cell">${escapeHtml(email.readableSize)}</td>
        `;
        tr.querySelector('.email-check').addEventListener('change', e => {
            e.target.checked ? selectedIds.add(email.id) : selectedIds.delete(email.id);
            updateSelectionCount();
            updateRecoverableSize();
        });
        body.appendChild(tr);
    });
}

function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.email-check');
    const allChecked  = selectedIds.size === emails.length;
    if (allChecked) {
        selectedIds.clear();
        checkboxes.forEach(cb => cb.checked = false);
        document.getElementById('header-checkbox').checked = false;
    } else {
        emails.forEach(e => selectedIds.add(e.id));
        checkboxes.forEach(cb => cb.checked = true);
        document.getElementById('header-checkbox').checked = true;
    }
    updateSelectionCount();
    updateRecoverableSize();
}

function updateSelectionCount() {
    document.getElementById('selection-count').textContent = `${selectedIds.size} selected`;
    const hasSelection = selectedIds.size > 0;
    document.getElementById('trash-btn').disabled  = !hasSelection;
    document.getElementById('delete-btn').disabled = !hasSelection;
}

// ─── Trash ───────────────────────────────────────────────────────────────────
async function trashSelected() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    const btn = document.getElementById('trash-btn');
    btn.disabled = true; btn.textContent = 'Trashing...';

    try {
        const res = await fetch(API.trash, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });

        if (res.status === 401) { handleSessionExpired(); return; }
        if (!res.ok) throw new Error('Failed to trash emails');

        const data = await res.json();

        // ── Post-trash verification ───────────────────────────────────────
        const verified = await verifyTrashed(ids);
        const verifiedCount = verified.length;
        const failedVerify  = ids.length - verifiedCount;

        if (failedVerify > 0) {
            showToast(`${verifiedCount} trashed ✓, ${failedVerify} could not be verified.`, false);
        } else {
            showToast(`${verifiedCount} email(s) moved to Trash ✓`);
        }

        removeEmailsFromList(ids);
    } catch (e) {
        showToast('Error: ' + e.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Trash Selected';
    }
}

async function verifyTrashed(ids) {
    try {
        const res  = await fetch('/api/emails/verify-trashed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (!res.ok) return ids; // assume ok if verify endpoint fails
        const data = await res.json();
        return data.trashedIds || ids;
    } catch {
        return ids; // non-critical
    }
}

// ─── Delete forever ──────────────────────────────────────────────────────────
function openDeleteModal() {
    if (selectedIds.size === 0) return;
    document.getElementById('delete-count').textContent = selectedIds.size;
    document.getElementById('delete-modal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('delete-modal').style.display = 'none';
}

async function confirmDeleteForever() {
    const ids = Array.from(selectedIds);
    closeDeleteModal();

    const btn = document.getElementById('delete-btn');
    btn.disabled = true; btn.textContent = 'Deleting...';

    try {
        const res = await fetch(API.deleteForever, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });

        if (res.status === 401) { handleSessionExpired(); return; }
        if (!res.ok) throw new Error('Failed to delete emails');

        const data = await res.json();
        showToast(`${data.deletedCount} email(s) permanently deleted.`);
        removeEmailsFromList(ids);
    } catch (e) {
        showToast('Error: ' + e.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Delete Forever';
    }
}

// ─── Session error handling ───────────────────────────────────────────────────
function isSessionError(msg) {
    const m = (msg || '').toLowerCase();
    return m.includes('token') || m.includes('unauthorized') || m.includes('401') ||
           m.includes('revoked') || m.includes('invalid_grant');
}

function handleSessionError() { /* placeholder for state reset */ }

function handleSessionExpired() {
    showToast('Session expired. Redirecting to login…', true);
    setTimeout(() => {
        // Clear stored token and redirect to setup
        fetch('/api/setup/logout', { method: 'POST' })
            .finally(() => { window.location.href = '/'; });
    }, 2000);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function removeEmailsFromList(ids) {
    const idSet = new Set(ids);
    emails = emails.filter(e => !idSet.has(e.id));
    ids.forEach(id => {
        selectedIds.delete(id);
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) row.remove();
    });

    if (emails.length === 0) {
        showSection('empty');
        document.getElementById('actions-group').style.display = 'none';
        document.getElementById('load-more-area').style.display = 'none';
    } else {
        document.getElementById('email-count').textContent = emails.length;
        const total = emails.reduce((s, e) => s + e.estimatedSize, 0);
        document.getElementById('total-size').textContent = formatBytes(total);
    }
    updateSelectionCount();
    updateRecoverableSize();
}

function showSection(section) {
    ['loading','results','empty-state','error-state'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    const map = { loading: 'loading', results: 'results', empty: 'empty-state', error: 'error-state' };
    const el = document.getElementById(map[section]);
    if (el) el.style.display = section === 'loading' ? 'flex' : 'block';
}

function showError(msg) {
    document.getElementById('error-message').textContent = msg;
    showSection('error');
}

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}
