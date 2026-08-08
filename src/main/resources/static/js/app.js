const API = {
    setupStatus:  '/api/setup/status',
    uploadCreds:  '/api/setup/credentials',
    connectGmail: '/api/setup/connect',
    authStatus:   '/api/auth/status',
    emails:       '/api/emails',
    trash:        '/api/emails/trash',
};

let emails = [];
let selectedIds = new Set();
let selectedFile = null;

document.addEventListener('DOMContentLoaded', () => {
    init();
});

// ─── Boot ────────────────────────────────────────────────────────────────────

async function init() {
    try {
        const res  = await fetch(API.setupStatus);
        const data = await res.json();

        if (data.authenticated) {
            // Both credentials.json and token exist — connect silently (no browser pop-up)
            const connRes  = await fetch(API.connectGmail, { method: 'POST' });
            const connData = await connRes.json();
            if (connRes.ok && connData.success) {
                showApp(connData.email);
                return;
            }
        }

        if (data.credentialsConfigured) {
            // credentials.json exists but no token yet → show step 3
            showSetup();
            goToStep(3);
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
    document.getElementById('app-screen').style.display  = 'none';
    initSetupListeners();
}

function showApp(email) {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('app-screen').style.display  = 'block';
    if (email) {
        document.getElementById('user-email').textContent = email;
        document.getElementById('auth-indicator').classList.replace('disconnected', 'connected');
    }
    initAppListeners();
}

// ─── Setup flow ──────────────────────────────────────────────────────────────

function initSetupListeners() {
    const fileInput = document.getElementById('credentials-file');
    const dropZone  = document.getElementById('drop-zone');
    if (!fileInput) return;

    fileInput.addEventListener('change', e => handleFileSelect(e.target.files[0]));

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', e => {
        if (e.target.tagName !== 'BUTTON') fileInput.click();
    });
}

function goToStep(n) {
    [1, 2, 3].forEach(i => {
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
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    const form = new FormData();
    form.append('file', selectedFile);

    try {
        const res  = await fetch(API.uploadCreds, { method: 'POST', body: form });
        const data = await res.json();

        if (!res.ok) {
            showUploadError(data.error || 'Upload failed');
            return;
        }

        goToStep(3);
    } catch (e) {
        showUploadError('Network error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Upload & Continue →';
    }
}

function showUploadError(msg) {
    const el = document.getElementById('upload-error');
    el.textContent = msg;
    el.style.display = 'block';
}

async function connectGmail() {
    const btn        = document.getElementById('connect-btn');
    const statusEl   = document.getElementById('connect-status');

    btn.disabled = true;
    statusEl.className = 'connect-status loading';
    statusEl.innerHTML = '<div class="mini-spinner"></div><span>Waiting for browser authorization… check the window that just opened.</span>';

    try {
        const res  = await fetch(API.connectGmail, { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success) {
            statusEl.className = 'connect-status success';
            statusEl.innerHTML = `✓ Connected as <strong>${data.email}</strong>`;
            setTimeout(() => showApp(data.email), 1200);
        } else {
            statusEl.className = 'connect-status error';
            statusEl.innerHTML = `✗ ${data.error || 'Authorization failed. Try again.'}`;
            btn.disabled = false;
        }
    } catch (e) {
        statusEl.className = 'connect-status error';
        statusEl.innerHTML = `✗ Network error: ${e.message}`;
        btn.disabled = false;
    }
}

// ─── Main app ────────────────────────────────────────────────────────────────

function initAppListeners() {
    document.getElementById('scan-btn').addEventListener('click', scanEmails);
    document.getElementById('select-all-btn').addEventListener('click', toggleSelectAll);
    document.getElementById('trash-btn').addEventListener('click', trashSelected);
    document.getElementById('header-checkbox').addEventListener('change', toggleSelectAll);
}

async function scanEmails() {
    const size = document.getElementById('size-filter').value;
    showSection('loading');
    document.getElementById('actions-group').style.display = 'none';
    selectedIds.clear();
    updateSelectionCount();

    try {
        const res = await fetch(`${API.emails}?size=${size}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to scan emails');
        }
        emails = await res.json();

        if (emails.length === 0) { showSection('empty'); return; }

        renderEmails();
        showSection('results');
        document.getElementById('actions-group').style.display = 'flex';
        document.getElementById('email-count').textContent = emails.length;
        const total = emails.reduce((s, e) => s + e.estimatedSize, 0);
        document.getElementById('total-size').textContent = formatBytes(total);
    } catch (e) {
        showError(e.message);
    }
}

function renderEmails() {
    const body = document.getElementById('email-body');
    body.innerHTML = '';
    emails.forEach(email => {
        const tr = document.createElement('tr');
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
        });
        body.appendChild(tr);
    });
}

function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.email-check');
    const allChecked = selectedIds.size === emails.length;
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
}

function updateSelectionCount() {
    document.getElementById('selection-count').textContent = `${selectedIds.size} selected`;
    document.getElementById('trash-btn').disabled = selectedIds.size === 0;
}

async function trashSelected() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Move ${count} email(s) to Gmail Trash? You can recover them within 30 days.`)) return;

    const btn = document.getElementById('trash-btn');
    btn.disabled = true;
    btn.textContent = 'Trashing...';

    try {
        const res = await fetch(API.trash, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        if (!res.ok) throw new Error('Failed to trash emails');
        const data = await res.json();

        showToast(`${data.trashedCount} email(s) moved to Trash.`);
        emails = emails.filter(e => !selectedIds.has(e.id));
        selectedIds.clear();

        if (emails.length === 0) {
            showSection('empty');
            document.getElementById('actions-group').style.display = 'none';
        } else {
            renderEmails();
            document.getElementById('email-count').textContent = emails.length;
            const total = emails.reduce((s, e) => s + e.estimatedSize, 0);
            document.getElementById('total-size').textContent = formatBytes(total);
        }
        updateSelectionCount();
    } catch (e) {
        showToast('Error: ' + e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Trash Selected';
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
