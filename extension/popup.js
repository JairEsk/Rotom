(() => {
  // src/utils.js
  function formatBytes(b) {
    if (!b) return "0 B";
    const kb = 1024, units = ["B", "KB", "MB", "GB"];
    const unitIndex = Math.floor(Math.log(b) / Math.log(kb));
    return parseFloat((b / Math.pow(kb, unitIndex)).toFixed(1)) + " " + units[unitIndex];
  }
  function formatDate(raw) {
    if (!raw) return "";
    try {
      const date = new Date(raw);
      const now = /* @__PURE__ */ new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const emailDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const diffTime = today - emailDay;
      const diffDays = Math.round(diffTime / 864e5);
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 365) return date.toLocaleDateString(void 0, { month: "short", day: "numeric" });
      return date.toLocaleDateString(void 0, { year: "numeric", month: "short" });
    } catch {
      return "";
    }
  }
  function escHtml(t) {
    if (!t) return "";
    const d = document.createElement("div");
    d.textContent = t;
    return d.innerHTML;
  }

  // src/api.js
  var GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
  var AuthError = class extends Error {
    constructor() {
      super("auth");
    }
  };
  async function fetchWithBackoff(url, options, retries = 4, delay = 1e3) {
    for (let i = 0; i < retries; i++) {
      const res = await fetch(url, options);
      if (res.status === 429 && i < retries - 1) {
        const waitTime = delay * Math.pow(2, i) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }
      return res;
    }
    return fetch(url, options);
  }
  async function gmailGet(path, token2, params = {}) {
    const url = new URL(`${GMAIL}/${path}`);
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, val));
      } else if (v !== void 0 && v !== "") {
        url.searchParams.set(k, v);
      }
    });
    const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token2}` } });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error?.message || "API error");
    }
    return res.json();
  }
  async function gmailPost(path, token2, body) {
    const res = await fetchWithBackoff(`${GMAIL}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token2}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error?.message || "API error");
    }
    return res.json();
  }
  async function gmailBatchGet(ids, token2) {
    if (ids.length === 0) return [];
    const boundary = "batch_gmail_req_boundary";
    let body = "";
    ids.forEach((id, index) => {
      body += `--${boundary}\r
`;
      body += `Content-Type: application/http\r
`;
      body += `Content-ID: <item-${index}>\r
\r
`;
      body += `GET /gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post HTTP/1.1\r
\r
`;
    });
    body += `--${boundary}--\r
`;
    const res = await fetchWithBackoff("https://gmail.googleapis.com/batch/gmail/v1", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token2}`,
        "Content-Type": `multipart/mixed; boundary="${boundary}"`
      },
      body
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      throw new Error(`Batch API error: ${res.status}`);
    }
    const text = await res.text();
    const matchBoundary = res.headers.get("content-type")?.match(/boundary=([^;]+)/);
    const resBoundary = matchBoundary ? `--${matchBoundary[1].replace(/["']/g, "")}` : `--${boundary}`;
    const parts = text.split(resBoundary);
    const messages = [];
    parts.forEach((part) => {
      if (part.includes("HTTP/1.1 200 OK")) {
        const match = part.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const msg = JSON.parse(match[0]);
            if (msg.id) messages.push(msg);
          } catch (e) {
          }
        }
      }
    });
    return messages;
  }

  // src/popup.js
  var token = null;
  var emails = [];
  var selectedIds = /* @__PURE__ */ new Set();
  var nextPageToken = null;
  var currentQuery = "";
  var hasMorePages = false;
  var FILTER_KEYS = ["size-filter", "category-filter", "date-filter", "sender-filter"];
  async function startJob(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "START_JOB", action, payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(res.jobId);
      });
    });
  }
  async function pollJob(jobId, onProgress) {
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        chrome.runtime.sendMessage({ type: "GET_JOB_STATUS", jobId }, (job) => {
          if (!job) {
            clearInterval(interval);
            reject(new Error("Job not found"));
            return;
          }
          if (onProgress) onProgress(job);
          if (job.status === "done") {
            clearInterval(interval);
            resolve(job);
          } else if (job.status === "error") {
            clearInterval(interval);
            if (job.error === "AUTH_ERROR") reject(new AuthError());
            else reject(new Error(job.error));
          }
        });
      }, 500);
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("sign-in-btn").addEventListener("click", signIn);
    document.getElementById("switch-account-btn").addEventListener("click", switchAccount);
    document.getElementById("scan-btn").addEventListener("click", scanEmails);
    document.getElementById("select-all-btn").addEventListener("click", toggleSelectAll);
    document.getElementById("trash-btn").addEventListener("click", openTrashModal);
    document.getElementById("delete-btn").addEventListener("click", openDeleteModal);
    document.getElementById("header-checkbox").addEventListener("change", toggleSelectAll);
    document.getElementById("sign-out-btn").addEventListener("click", signOut);
    document.getElementById("retry-btn").addEventListener("click", scanEmails);
    document.getElementById("load-more-btn").addEventListener("click", loadMore);
    document.getElementById("cancel-trash-btn").addEventListener("click", closeTrashModal);
    document.getElementById("confirm-trash-btn").addEventListener("click", confirmTrash);
    document.getElementById("cancel-delete-btn").addEventListener("click", closeDeleteModal);
    document.getElementById("confirm-delete-btn").addEventListener("click", confirmDeleteForever);
    document.getElementById("empty-trash-btn").addEventListener("click", openEmptyTrashModal);
    document.getElementById("cancel-empty-trash-btn").addEventListener("click", closeEmptyTrashModal);
    document.getElementById("confirm-empty-trash-btn").addEventListener("click", confirmEmptyTrash);
    document.getElementById("cancel-unsub-btn").addEventListener("click", closeUnsubscribeModal);
    document.getElementById("confirm-unsub-btn").addEventListener("click", confirmUnsubscribe);
    document.getElementById("unsub-bulk-btn").addEventListener("click", openBulkUnsubscribeModal);
    document.getElementById("cancel-bulk-unsub-btn").addEventListener("click", closeBulkUnsubscribeModal);
    document.getElementById("confirm-bulk-unsub-btn").addEventListener("click", confirmBulkUnsubscribe);
    document.getElementById("unsub-callout-dismiss").addEventListener("click", () => {
      hide("unsub-callout");
      chrome.storage.local.set({ unsubCalloutDismissed: true });
    });
    FILTER_KEYS.forEach((id) => {
      document.getElementById(id).addEventListener("change", saveFilters);
      document.getElementById(id).addEventListener("input", saveFilters);
    });
    init();
  });
  async function init() {
    await restoreFilters();
    initUnsubscribeCallout();
    token = await getToken(false);
    if (token) {
      try {
        const profile = await gmailGet("profile", token);
        showApp(profile.emailAddress, profile.messagesTotal);
      } catch (e) {
        if (e instanceof AuthError) {
          token = null;
          showAuth();
        } else {
          showApp("", 0);
          showError("Could not load profile: " + e.message);
          show("error-state");
        }
      }
    } else {
      showAuth();
    }
  }
  function showAuth() {
    show("auth-screen");
    hide("app-screen");
  }
  async function signIn() {
    const btn = document.getElementById("sign-in-btn");
    btn.disabled = true;
    btn.textContent = "Connecting...";
    try {
      token = await getToken(true);
      const profile = await gmailGet("profile", token);
      showApp(profile.emailAddress, profile.messagesTotal);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Connect Gmail";
      showEl("auth-error", e.message || "Authorization failed.");
    }
  }
  async function switchAccount() {
    const btn = document.getElementById("switch-account-btn");
    btn.disabled = true;
    btn.textContent = "Switching...";
    const oldToken = token;
    token = null;
    if (oldToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${oldToken}`, { method: "POST" });
      } catch {
      }
    }
    if (chrome.identity.clearAllCachedAuthTokens) {
      try {
        await new Promise((resolve) => {
          const p = chrome.identity.clearAllCachedAuthTokens();
          if (p && p.then) p.then(resolve).catch(resolve);
          else resolve();
        });
      } catch {
      }
    } else if (oldToken) {
      chrome.identity.removeCachedAuthToken({ token: oldToken });
    }
    btn.disabled = false;
    btn.textContent = "Use a different account";
    signIn();
  }
  async function signOut() {
    const oldToken = token;
    token = null;
    if (oldToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${oldToken}`, { method: "POST" });
      } catch {
      }
    }
    if (chrome.identity.clearAllCachedAuthTokens) {
      try {
        await new Promise((resolve) => {
          const p = chrome.identity.clearAllCachedAuthTokens();
          if (p && p.then) p.then(resolve).catch(resolve);
          else resolve();
        });
      } catch {
      }
    } else if (oldToken) {
      chrome.identity.removeCachedAuthToken({ token: oldToken });
    }
    emails = [];
    selectedIds.clear();
    nextPageToken = null;
    hasMorePages = false;
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
  function showApp(email, totalMessages) {
    hide("auth-screen");
    show("app-screen");
    if (email) document.getElementById("user-email").textContent = email;
    if (totalMessages) {
      document.getElementById("storage-messages").textContent = `${Number(totalMessages).toLocaleString()} total messages`;
      show("storage-banner");
    }
  }
  function saveFilters() {
    const data = {};
    FILTER_KEYS.forEach((id) => {
      data[id] = document.getElementById(id).value;
    });
    chrome.storage.local.set({ filters: data });
  }
  async function restoreFilters() {
    return new Promise((resolve) => {
      chrome.storage.local.get("filters", ({ filters }) => {
        if (!filters) {
          resolve();
          return;
        }
        FILTER_KEYS.forEach((id) => {
          const el = document.getElementById(id);
          if (el && filters[id] !== void 0) el.value = filters[id];
        });
        resolve();
      });
    });
  }
  function buildQuery() {
    const size = document.getElementById("size-filter").value;
    const category = document.getElementById("category-filter").value;
    const date = document.getElementById("date-filter").value;
    const sender = document.getElementById("sender-filter").value.trim();
    const parts = [];
    if (size) parts.push(`larger:${size}M`);
    if (category) parts.push(category);
    if (date) parts.push(date);
    if (sender) parts.push(`from:${sender}`);
    return parts.join(" ");
  }
  async function scanEmails() {
    emails = [];
    selectedIds.clear();
    nextPageToken = null;
    hasMorePages = false;
    currentQuery = buildQuery();
    hideSection();
    show("loading");
    hide("actions-bar");
    await fetchPage(true);
  }
  async function loadMore() {
    if (!nextPageToken) return;
    hide("load-more-area");
    show("load-more-loading");
    try {
      await fetchPage(false);
    } finally {
      hide("load-more-loading");
    }
  }
  async function fetchPage(isFirst) {
    try {
      const params = { q: currentQuery, maxResults: 25 };
      if (nextPageToken) params.pageToken = nextPageToken;
      const listRes = await gmailGet("messages", token, params);
      if (isFirst) hide("loading");
      if (!listRes.messages || listRes.messages.length === 0) {
        if (isFirst) show("empty-state");
        hide("load-more-area");
        return;
      }
      const items = await fetchMetadataBatch(listRes.messages);
      emails.push(...items);
      emails.sort((a, b) => b.estimatedSize - a.estimatedSize);
      nextPageToken = listRes.nextPageToken || null;
      hasMorePages = !!nextPageToken;
      renderEmails();
      show("results");
      show("actions-bar");
      updateResultsHeader();
      updateSelection();
      document.getElementById("load-more-area").style.display = hasMorePages ? "flex" : "none";
    } catch (e) {
      if (isFirst) hide("loading");
      if (e instanceof AuthError) {
        handleSessionExpired();
        return;
      }
      if (isFirst) showError(e.message);
      else {
        document.getElementById("load-more-area").style.display = hasMorePages ? "flex" : "none";
        showToast("Error loading more: " + e.message, true);
      }
    }
  }
  function updateResultsHeader() {
    const count = emails.length;
    const label = hasMorePages ? `${count}+` : `${count}`;
    document.getElementById("email-count").textContent = label;
    document.getElementById("total-size").textContent = formatBytes(emails.reduce((s, e) => s + e.estimatedSize, 0));
  }
  function parseEmailItem(msg) {
    let subject = "", sender = "", date = "";
    (msg.payload?.headers || []).forEach((header) => {
      const name = header.name.toLowerCase();
      if (name === "subject") subject = header.value;
      if (name === "from") sender = header.value;
      if (name === "date") date = header.value;
    });
    const size = msg.sizeEstimate || 0;
    const unsubscribeInfo = parseUnsubscribeHeader(msg.payload?.headers || []);
    return { id: msg.id, subject, from: sender, date, estimatedSize: size, readableSize: formatBytes(size), unsubscribeInfo };
  }
  async function fetchMetadataBatch(msgs) {
    const ids = msgs.map((m) => m.id);
    const batchRes = await gmailBatchGet(ids, token);
    return batchRes.map(parseEmailItem);
  }
  function renderEmails() {
    const body = document.getElementById("email-body");
    body.innerHTML = "";
    emails.forEach((email) => appendEmailRow(body, email));
    syncHeaderCheckbox();
  }
  function appendEmailRow(body, email) {
    const tr = document.createElement("tr");
    tr.dataset.id = email.id;
    const dateStr = email.date ? formatDate(email.date) : "";
    const gmailLink = `https://mail.google.com/mail/u/0/#all/${email.id}`;
    if (email.unsubscribeInfo) tr.classList.add("has-unsub");
    tr.innerHTML = `
    <td><input type="checkbox" class="email-check" data-id="${email.id}" ${selectedIds.has(email.id) ? "checked" : ""}></td>
    <td class="from-cell" title="${escHtml(email.from)}">
      <a href="#" class="sender-filter-link" title="Click to filter by this sender">${escHtml(email.from)}</a>
    </td>
    <td class="subject-cell" title="${escHtml(email.subject)}">
      <a class="subject-link" href="${gmailLink}" target="_blank">${escHtml(email.subject) || "<em>no subject</em>"}</a>
    </td>
    <td class="date-cell" title="${escHtml(email.date)}">${escHtml(dateStr)}</td>
    <td class="size-cell">${escHtml(email.readableSize)}</td>
    <td class="actions-cell">
      ${email.unsubscribeInfo ? '<button class="unsub-btn" title="Unsubscribe from this sender">&#x1F6AB;</button>' : ""}
    </td>
  `;
    tr.querySelector(".email-check").addEventListener("change", (e) => {
      e.target.checked ? selectedIds.add(email.id) : selectedIds.delete(email.id);
      syncHeaderCheckbox();
      updateSelection();
    });
    tr.querySelector(".sender-filter-link").addEventListener("click", (e) => {
      e.preventDefault();
      const match = email.from.match(/<([^>]+)>/);
      const exactEmail = match ? match[1] : email.from;
      document.getElementById("sender-filter").value = exactEmail;
      saveFilters();
      scanEmails();
    });
    body.appendChild(tr);
    if (email.unsubscribeInfo) {
      const unsubBtnEl = tr.querySelector(".unsub-btn");
      if (unsubBtnEl) unsubBtnEl.addEventListener("click", () => openUnsubscribeModal(email));
      if (email.unsubscribeInfo.status) {
        setRowUnsubState(email.id, email.unsubscribeInfo.status);
      }
    }
  }
  function syncHeaderCheckbox() {
    const hdr = document.getElementById("header-checkbox");
    hdr.checked = emails.length > 0 && selectedIds.size === emails.length;
    hdr.indeterminate = selectedIds.size > 0 && selectedIds.size < emails.length;
  }
  function toggleSelectAll() {
    const cbs = document.querySelectorAll(".email-check");
    const allSel = selectedIds.size === emails.length && emails.length > 0;
    if (allSel) {
      selectedIds.clear();
      cbs.forEach((cb) => cb.checked = false);
    } else {
      emails.forEach((e) => selectedIds.add(e.id));
      cbs.forEach((cb) => cb.checked = true);
    }
    syncHeaderCheckbox();
    updateSelection();
  }
  function updateSelection() {
    const n = selectedIds.size;
    document.getElementById("selection-count").textContent = `${n} selected`;
    document.getElementById("trash-btn").disabled = n === 0;
    const unsubCapable = emails.filter((e) => selectedIds.has(e.id) && e.unsubscribeInfo).length;
    const bulkUnsubBtn = document.getElementById("unsub-bulk-btn");
    bulkUnsubBtn.disabled = unsubCapable === 0;
    bulkUnsubBtn.textContent = unsubCapable > 0 ? `\u{1F6AB} Unsubscribe (${unsubCapable})` : "\u{1F6AB} Unsubscribe";
    document.getElementById("delete-btn").disabled = n === 0;
    const rec = document.getElementById("storage-recoverable");
    if (n > 0) {
      const total = emails.filter((e) => selectedIds.has(e.id)).reduce((s, e) => s + e.estimatedSize, 0);
      document.getElementById("recoverable-size").textContent = formatBytes(total);
      rec.style.display = "inline";
    } else {
      rec.style.display = "none";
    }
  }
  function openTrashModal() {
    if (selectedIds.size === 0) return;
    document.getElementById("trash-count").textContent = selectedIds.size;
    show("trash-modal");
  }
  function closeTrashModal() {
    hide("trash-modal");
  }
  async function confirmTrash() {
    const ids = Array.from(selectedIds);
    closeTrashModal();
    const btn = document.getElementById("trash-btn");
    btn.disabled = true;
    try {
      const jobId = await startJob("TRASH", { token, ids });
      const jobResult = await pollJob(jobId, (job) => {
        btn.textContent = `Trashing (${job.processed}/${job.total})...`;
      });
      if (jobResult.succeeded.length) removeFromList(jobResult.succeeded);
      if (jobResult.succeeded.length && !jobResult.failed) showToast(`${jobResult.succeeded.length} email(s) moved to Trash \u2713`);
      else if (jobResult.succeeded.length && jobResult.failed) showToast(`${jobResult.succeeded.length} trashed, ${jobResult.failed} failed.`, true);
    } catch (err) {
      if (err instanceof AuthError) {
        handleSessionExpired();
        return;
      } else showToast("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Trash";
    }
  }
  function openDeleteModal() {
    if (selectedIds.size === 0) return;
    document.getElementById("delete-count").textContent = selectedIds.size;
    show("delete-modal");
  }
  function closeDeleteModal() {
    hide("delete-modal");
  }
  async function confirmDeleteForever() {
    const ids = Array.from(selectedIds);
    closeDeleteModal();
    const btn = document.getElementById("delete-btn");
    btn.disabled = true;
    try {
      if (chrome.identity.clearAllCachedAuthTokens) chrome.identity.clearAllCachedAuthTokens(() => {
      });
      else chrome.identity.removeCachedAuthToken({ token });
      token = await getToken(true);
    } catch (e) {
      showToast("Could not refresh auth. Please sign in again.", true);
      btn.disabled = false;
      btn.textContent = "Delete Forever";
      return;
    }
    try {
      const jobId = await startJob("DELETE_FOREVER", { token, ids });
      const jobResult = await pollJob(jobId, (job) => {
        btn.textContent = `Deleting (${job.processed}/${job.total})...`;
      });
      if (jobResult.succeeded.length) removeFromList(jobResult.succeeded);
      if (jobResult.succeeded.length && !jobResult.failed) showToast(`${jobResult.succeeded.length} email(s) permanently deleted.`);
      else if (jobResult.succeeded.length && jobResult.failed) showToast(`${jobResult.succeeded.length} deleted, ${jobResult.failed} failed.`, true);
    } catch (err) {
      if (err instanceof AuthError) {
        handleSessionExpired();
        return;
      } else showToast("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Delete Forever";
    }
  }
  function handleSessionExpired() {
    showToast("Session expired. Please sign in again.", true);
    const oldToken = token;
    token = null;
    if (chrome.identity.clearAllCachedAuthTokens) {
      chrome.identity.clearAllCachedAuthTokens(() => {
      });
    } else {
      chrome.identity.removeCachedAuthToken({ token: oldToken });
    }
    setTimeout(showAuth, 2200);
  }
  function removeFromList(ids) {
    const idsSet = new Set(ids);
    emails = emails.filter((email) => !idsSet.has(email.id));
    ids.forEach((id) => {
      selectedIds.delete(id);
      document.querySelector(`tr[data-id="${id}"]`)?.remove();
    });
    if (emails.length === 0) {
      hideSection();
      show("empty-state");
      hide("actions-bar");
      hide("load-more-area");
    } else {
      updateResultsHeader();
    }
    syncHeaderCheckbox();
    updateSelection();
  }
  function hideSection() {
    ["loading", "results", "empty-state", "error-state", "load-more-area", "load-more-loading"].forEach(hide);
  }
  function showError(msg) {
    document.getElementById("error-message").textContent = msg;
    show("error-state");
  }
  function showToast(msg, isError = false) {
    const toastEl = document.getElementById("toast");
    toastEl.textContent = msg;
    toastEl.className = `toast ${isError ? "toast-error" : "toast-success"}`;
    toastEl.style.display = "block";
    setTimeout(() => {
      toastEl.style.display = "none";
    }, 4e3);
  }
  function show(id) {
    document.getElementById(id).style.display = "";
  }
  function hide(id) {
    document.getElementById(id).style.display = "none";
  }
  function showEl(id, text) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.style.display = "block";
  }
  function openEmptyTrashModal() {
    show("empty-trash-modal");
  }
  function closeEmptyTrashModal() {
    hide("empty-trash-modal");
  }
  async function confirmEmptyTrash() {
    closeEmptyTrashModal();
    const btn = document.getElementById("empty-trash-btn");
    btn.disabled = true;
    btn.textContent = "Emptying...";
    try {
      const jobId = await startJob("EMPTY_TRASH", { token });
      const jobResult = await pollJob(jobId, (job) => {
        btn.textContent = `Emptying (${job.processed}/${job.total})...`;
      });
      if (jobResult.total === 0) {
        showToast("Trash is already empty.");
        return;
      }
      const deleted = jobResult.succeeded.length;
      const failed = jobResult.total - deleted;
      if (deleted && !failed) showToast("Trash emptied \u2014 " + deleted + " email(s) permanently deleted.");
      else if (deleted && failed) showToast(deleted + " deleted, " + failed + " failed.", true);
    } catch (err) {
      if (err instanceof AuthError) {
        handleSessionExpired();
        return;
      } else showToast("Error: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Empty Trash";
    }
  }
  function parseUnsubscribeHeader(headers) {
    let rawValue = "";
    let hasOneClick = false;
    headers.forEach((header) => {
      const name = header.name.toLowerCase();
      if (name === "list-unsubscribe") rawValue = header.value;
      if (name === "list-unsubscribe-post" && header.value.includes("One-Click")) hasOneClick = true;
    });
    if (!rawValue) return null;
    const urls = rawValue.match(/<([^>]+)>/g)?.map((m) => m.slice(1, -1)) || [];
    const httpsUrl = urls.find((u) => u.startsWith("https://"));
    const mailtoUrl = urls.find((u) => u.startsWith("mailto:"));
    if (httpsUrl && hasOneClick) return { type: "one-click", url: httpsUrl };
    if (httpsUrl) return { type: "https", url: httpsUrl };
    if (mailtoUrl) return { type: "mailto", url: mailtoUrl };
    return null;
  }
  async function executeUnsubscribe(email) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "EXECUTE_UNSUBSCRIBE", payload: { email, token } }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res.success) return reject(new Error(res.error));
        resolve();
      });
    });
  }
  function openUnsubscribeModal(email) {
    const senderName = (email.from || "").replace(/<[^>]+>/, "").trim() || email.from;
    document.getElementById("unsub-sender-name").textContent = senderName;
    document.getElementById("unsub-also-trash").checked = false;
    const modal = document.getElementById("unsub-modal");
    modal.dataset.emailId = email.id;
    show("unsub-modal");
  }
  function closeUnsubscribeModal() {
    hide("unsub-modal");
  }
  async function confirmUnsubscribe() {
    const modal = document.getElementById("unsub-modal");
    const emailId = modal.dataset.emailId;
    const email = emails.find((e) => e.id === emailId);
    if (!email) {
      closeUnsubscribeModal();
      return;
    }
    const alsoTrash = document.getElementById("unsub-also-trash").checked;
    closeUnsubscribeModal();
    setRowUnsubState(emailId, "pending");
    try {
      await executeUnsubscribe(email);
      setRowUnsubState(emailId, "done");
      email.unsubscribeInfo = { ...email.unsubscribeInfo, status: "done" };
      const senderName = (email.from || "").replace(/<[^>]+>/, "").trim() || email.from;
      showToast(`Unsubscribe request sent to ${senderName}`);
      if (alsoTrash) {
        await gmailPost("messages/batchModify", token, { ids: [emailId], addLabelIds: ["TRASH"] });
        removeFromList([emailId]);
      }
    } catch (err) {
      setRowUnsubState(emailId, "failed");
      email.unsubscribeInfo = { ...email.unsubscribeInfo, status: "failed" };
      if (err instanceof AuthError) {
        handleSessionExpired();
        return;
      }
      showToast("Unsubscribe failed: " + err.message, true);
    }
  }
  function openBulkUnsubscribeModal() {
    const capable = emails.filter((e) => selectedIds.has(e.id) && e.unsubscribeInfo);
    if (capable.length === 0) {
      showToast("None of the selected emails support unsubscribe.", true);
      return;
    }
    document.getElementById("bulk-unsub-count").textContent = capable.length;
    document.getElementById("bulk-unsub-also-trash").checked = false;
    show("bulk-unsub-modal");
  }
  function closeBulkUnsubscribeModal() {
    hide("bulk-unsub-modal");
  }
  async function confirmBulkUnsubscribe() {
    const capable = emails.filter((e) => selectedIds.has(e.id) && e.unsubscribeInfo);
    const alsoTrash = document.getElementById("bulk-unsub-also-trash").checked;
    closeBulkUnsubscribeModal();
    let succeeded = [];
    let failed = 0;
    for (const email of capable) {
      setRowUnsubState(email.id, "pending");
      try {
        await executeUnsubscribe(email);
        setRowUnsubState(email.id, "done");
        email.unsubscribeInfo = { ...email.unsubscribeInfo, status: "done" };
        succeeded.push(email.id);
      } catch {
        setRowUnsubState(email.id, "failed");
        email.unsubscribeInfo = { ...email.unsubscribeInfo, status: "failed" };
        failed++;
      }
    }
    if (succeeded.length) showToast(`Unsubscribed from ${succeeded.length} sender(s)${failed ? `, ${failed} failed` : ""}.`, failed > 0);
    else showToast("All unsubscribe requests failed.", true);
    if (alsoTrash && succeeded.length) {
      for (let i = 0; i < succeeded.length; i += 1e3) {
        await gmailPost("messages/batchModify", token, { ids: succeeded.slice(i, i + 1e3), addLabelIds: ["TRASH"] }).catch(() => {
        });
      }
      removeFromList(succeeded);
    }
  }
  function setRowUnsubState(emailId, state) {
    const tr = document.querySelector(`tr[data-id="${emailId}"]`);
    if (!tr) return;
    tr.dataset.unsubState = state;
    const btn = tr.querySelector(".unsub-btn");
    if (!btn) return;
    if (state === "pending") {
      btn.textContent = "\u23F3";
      btn.disabled = true;
      btn.title = "Sending unsubscribe request...";
    } else if (state === "done") {
      btn.textContent = "\u2713";
      btn.disabled = true;
      btn.title = "Unsubscribe request sent";
    } else if (state === "failed") {
      btn.textContent = "\u26A0";
      btn.disabled = false;
      btn.title = "Unsubscribe failed \u2014 click to retry";
    }
  }
  function initUnsubscribeCallout() {
    chrome.storage.local.get("unsubCalloutDismissed", ({ unsubCalloutDismissed }) => {
      if (unsubCalloutDismissed) return;
      show("unsub-callout");
    });
  }
})();
