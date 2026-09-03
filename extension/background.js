(() => {
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
  async function gmailGet(path, token, params = {}) {
    const url = new URL(`${GMAIL}/${path}`);
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, val));
      } else if (v !== void 0 && v !== "") {
        url.searchParams.set(k, v);
      }
    });
    const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error?.message || "API error");
    }
    return res.json();
  }
  async function gmailPost(path, token, body) {
    const res = await fetchWithBackoff(`${GMAIL}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error?.message || "API error");
    }
    return res.json();
  }

  // src/background.js
  chrome.runtime.onInstalled.addListener(() => {
    console.log("R.O.T.O.M. installed.");
  });
  var STALE_JOB_TIMEOUT_MS = 6e4;
  async function getJob(jobId) {
    const data = await chrome.storage.session.get(jobId);
    const job = data[jobId] || null;
    if (job && job.status === "running" && Date.now() - (job.updatedAt || 0) > STALE_JOB_TIMEOUT_MS) {
      job.status = "error";
      job.error = "Service worker suspended unexpectedly";
      await saveJob(jobId, job);
    }
    return job;
  }
  async function saveJob(jobId, job) {
    await chrome.storage.session.set({ [jobId]: job });
  }
  async function deleteJob(jobId) {
    await chrome.storage.session.remove(jobId);
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_JOB") {
      const jobId = Date.now().toString();
      const initialJob = {
        status: "running",
        processed: 0,
        total: msg.payload.ids?.length || 0,
        succeeded: [],
        failed: 0,
        updatedAt: Date.now()
      };
      saveJob(jobId, initialJob).then(() => {
        sendResponse({ jobId });
        runJob(jobId, msg.action, msg.payload).catch(async (err) => {
          console.error("Job failed:", err);
          const job = await getJob(jobId);
          if (job) {
            job.status = "error";
            job.error = err instanceof AuthError ? "AUTH_ERROR" : err.message;
            job.updatedAt = Date.now();
            await saveJob(jobId, job);
          }
        });
      });
      return true;
    }
    if (msg.type === "GET_JOB_STATUS") {
      getJob(msg.jobId).then((job) => {
        sendResponse(job || null);
        if (job && (job.status === "done" || job.status === "error")) {
          deleteJob(msg.jobId);
        }
      });
      return true;
    }
    if (msg.type === "EXECUTE_UNSUBSCRIBE") {
      executeUnsubscribe(msg.payload.email, msg.payload.token).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });
  async function processInBatches(ids, jobId, processChunk) {
    const job = await getJob(jobId);
    if (!job) return;
    job.total = ids.length;
    job.updatedAt = Date.now();
    await saveJob(jobId, job);
    for (let i = 0; i < ids.length; i += 1e3) {
      const chunk = ids.slice(i, i + 1e3);
      try {
        await processChunk(chunk);
        job.succeeded.push(...chunk);
      } catch (err) {
        console.error("Batch chunk error:", err);
        job.failed += chunk.length;
        if (err instanceof AuthError) throw err;
      }
      job.processed += chunk.length;
      job.updatedAt = Date.now();
      await saveJob(jobId, job);
    }
  }
  async function runJob(jobId, action, payload) {
    const { token, ids } = payload;
    try {
      if (action === "TRASH") {
        await processInBatches(
          ids,
          jobId,
          (chunk) => gmailPost("messages/batchModify", token, { ids: chunk, addLabelIds: ["TRASH"] })
        );
      } else if (action === "DELETE_FOREVER") {
        await processInBatches(
          ids,
          jobId,
          (chunk) => gmailPost("messages/batchDelete", token, { ids: chunk })
        );
      } else if (action === "EMPTY_TRASH") {
        let pageToken = void 0;
        let allIds = [];
        do {
          const res = await gmailGet("messages", token, { labelIds: "TRASH", maxResults: 500, pageToken, includeSpamTrash: true });
          if (res.messages) allIds.push(...res.messages.map((m) => m.id));
          pageToken = res.nextPageToken;
          const currentJob = await getJob(jobId);
          if (currentJob) {
            currentJob.updatedAt = Date.now();
            await saveJob(jobId, currentJob);
          }
        } while (pageToken);
        await processInBatches(
          allIds,
          jobId,
          (chunk) => gmailPost("messages/batchDelete", token, { ids: chunk })
        );
      }
      const finalJob = await getJob(jobId);
      if (finalJob) {
        finalJob.status = finalJob.failed > 0 && finalJob.succeeded.length === 0 ? "error" : "done";
        if (finalJob.status === "error" && !finalJob.error) {
          finalJob.error = "All batch operations failed";
        }
        finalJob.updatedAt = Date.now();
        await saveJob(jobId, finalJob);
      }
    } catch (err) {
      const errorJob = await getJob(jobId);
      if (errorJob) {
        errorJob.status = "error";
        errorJob.error = err instanceof AuthError ? "AUTH_ERROR" : err.message || "Unknown error";
        errorJob.updatedAt = Date.now();
        await saveJob(jobId, errorJob);
      }
    }
  }
  async function executeUnsubscribe(email, token) {
    const info = email.unsubscribeInfo;
    if (!info) return;
    if (info.type === "one-click" || info.type === "https") {
      if (!info.url.startsWith("https://")) {
        throw new Error("Unsubscribe URL is not HTTPS.");
      }
      await fetch(info.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        mode: "no-cors"
      });
      return;
    }
    if (info.type === "mailto") {
      const parsed = new URL(info.url);
      const to = parsed.pathname;
      const subject = parsed.searchParams.get("subject") || "unsubscribe";
      const rawMsg = [`To: ${to}`, `Subject: ${subject}`, ``, ``].join("\r\n");
      const encoded = btoa(unescape(encodeURIComponent(rawMsg))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await gmailPost("messages/send", token, { raw: encoded });
    }
  }
})();
