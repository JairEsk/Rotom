// API endpoints
const API = {
    authStatus: '/api/auth/status',
    emails: '/api/emails',
    trash: '/api/emails/trash',
    storage: '/api/storage'
};

// State
let emails = [];
let selectedIds = new Set();

// DOM Elements - cache them on load
document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM elements
    const scanBtn = document.getElementById('scan-btn');
    const sizeFilter = document.getElementById('size-filter');
    const selectAllBtn = document.getElementById('select-all-btn');
    const trashBtn = document.getElementById('trash-btn');
    const headerCheckbox = document.getElementById('header-checkbox');
    const emailBody = document.getElementById('email-body');
    const loadingSection = document.getElementById('loading');
    const resultsSection = document.getElementById('results');
    const emptyState = document.getElementById('empty-state');
    const errorState = document.getElementById('error-state');
    const actionsGroup = document.getElementById('actions-group');
    const selectionCount = document.getElementById('selection-count');
    const emailCount = document.getElementById('email-count');
    const totalSize = document.getElementById('total-size');

    // Check auth on load
    checkAuth();

    // Event listeners
    scanBtn.addEventListener('click', scanEmails);
    selectAllBtn.addEventListener('click', toggleSelectAll);
    trashBtn.addEventListener('click', trashSelected);
    headerCheckbox.addEventListener('change', toggleSelectAll);

    async function checkAuth() {
        try {
            const res = await fetch(API.authStatus);
            const data = await res.json();
            const emailEl = document.getElementById('user-email');
            const indicator = document.getElementById('auth-indicator');
            if (data.authenticated && data.email) {
                emailEl.textContent = data.email;
                indicator.classList.remove('disconnected');
                indicator.classList.add('connected');
            }
        } catch (e) {
            console.error('Auth check failed:', e);
        }
    }

    async function scanEmails() {
        const size = sizeFilter.value;
        showSection('loading');
        actionsGroup.style.display = 'none';
        selectedIds.clear();
        updateSelectionCount();

        try {
            const res = await fetch(`${API.emails}?size=${size}`);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to scan emails');
            }
            emails = await res.json();

            if (emails.length === 0) {
                showSection('empty');
                return;
            }

            renderEmails();
            showSection('results');
            actionsGroup.style.display = 'flex';
            emailCount.textContent = emails.length;
            
            // Calculate total size
            const total = emails.reduce((sum, e) => sum + e.estimatedSize, 0);
            totalSize.textContent = formatBytes(total);
        } catch (e) {
            showError(e.message);
        }
    }

    function renderEmails() {
        emailBody.innerHTML = '';
        emails.forEach(email => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="checkbox" class="email-check" data-id="${email.id}" ${selectedIds.has(email.id) ? 'checked' : ''}></td>
                <td class="from-cell" title="${escapeHtml(email.from)}">${escapeHtml(email.from)}</td>
                <td class="subject-cell" title="${escapeHtml(email.subject)}">${escapeHtml(email.subject)}</td>
                <td class="date-cell">${escapeHtml(email.date)}</td>
                <td class="size-cell">${escapeHtml(email.readableSize)}</td>
            `;
            tr.querySelector('.email-check').addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedIds.add(email.id);
                } else {
                    selectedIds.delete(email.id);
                }
                updateSelectionCount();
            });
            emailBody.appendChild(tr);
        });
    }

    function toggleSelectAll() {
        const checkboxes = document.querySelectorAll('.email-check');
        const allChecked = selectedIds.size === emails.length;
        
        if (allChecked) {
            selectedIds.clear();
            checkboxes.forEach(cb => cb.checked = false);
            headerCheckbox.checked = false;
        } else {
            emails.forEach(e => selectedIds.add(e.id));
            checkboxes.forEach(cb => cb.checked = true);
            headerCheckbox.checked = true;
        }
        updateSelectionCount();
    }

    function updateSelectionCount() {
        selectionCount.textContent = `${selectedIds.size} selected`;
        trashBtn.disabled = selectedIds.size === 0;
    }

    async function trashSelected() {
        if (selectedIds.size === 0) return;
        
        const count = selectedIds.size;
        if (!confirm(`Are you sure you want to trash ${count} email(s)? They will be moved to Gmail's Trash folder.`)) {
            return;
        }

        trashBtn.disabled = true;
        trashBtn.textContent = 'Trashing...';

        try {
            const res = await fetch(API.trash, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });
            
            if (!res.ok) throw new Error('Failed to trash emails');
            
            const data = await res.json();
            showToast(`${data.trashedCount} email(s) moved to trash successfully!`);
            
            // Remove trashed emails from the list
            emails = emails.filter(e => !selectedIds.has(e.id));
            selectedIds.clear();
            
            if (emails.length === 0) {
                showSection('empty');
                actionsGroup.style.display = 'none';
            } else {
                renderEmails();
                emailCount.textContent = emails.length;
                const total = emails.reduce((sum, e) => sum + e.estimatedSize, 0);
                totalSize.textContent = formatBytes(total);
            }
            updateSelectionCount();
        } catch (e) {
            showToast('Error: ' + e.message, true);
        } finally {
            trashBtn.disabled = false;
            trashBtn.textContent = 'Trash Selected';
        }
    }

    function showSection(section) {
        loadingSection.style.display = 'none';
        resultsSection.style.display = 'none';
        emptyState.style.display = 'none';
        errorState.style.display = 'none';
        
        switch(section) {
            case 'loading': loadingSection.style.display = 'flex'; break;
            case 'results': resultsSection.style.display = 'block'; break;
            case 'empty': emptyState.style.display = 'block'; break;
            case 'error': errorState.style.display = 'block'; break;
        }
    }

    function showError(message) {
        document.getElementById('error-message').textContent = message;
        showSection('error');
    }

    function showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
        toast.style.display = 'block';
        
        setTimeout(() => {
            toast.style.display = 'none';
        }, 4000);
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
