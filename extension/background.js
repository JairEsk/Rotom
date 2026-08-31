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
  var jobs = {};
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_JOB") {
      const jobId = Date.now().toString();
      jobs[jobId] = { status: "running", processed: 0, total: msg.payload.ids?.length || 0, succeeded: [], failed: 0 };
      runJob(jobId, msg.action, msg.payload).catch((err) => {
        console.error("Job failed:", err);
        if (jobs[jobId]) jobs[jobId].error = err.message;
      });
      sendResponse({ jobId });
      return false;
    }
    if (msg.type === "GET_JOB_STATUS") {
      const job = jobs[msg.jobId];
      sendResponse(job || null);
      if (job && (job.status === "done" || job.status === "error")) {
        delete jobs[msg.jobId];
      }
      return false;
    }
    if (msg.type === "EXECUTE_UNSUBSCRIBE") {
      executeUnsubscribe(msg.payload.email, msg.payload.token).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });
  async function runJob(jobId, action, payload) {
    const job = jobs[jobId];
    const { token, ids } = payload;
    try {
      if (action === "TRASH") {
        const total = ids.length;
        job.total = total;
        for (let i = 0; i < total; i += 1e3) {
          const chunk = ids.slice(i, i + 1e3);
          await gmailPost("messages/batchModify", token, { ids: chunk, addLabelIds: ["TRASH"] });
          job.succeeded.push(...chunk);
          job.processed += chunk.length;
        }
      } else if (action === "DELETE_FOREVER") {
        const total = ids.length;
        job.total = total;
        for (let i = 0; i < total; i += 1e3) {
          const chunk = ids.slice(i, i + 1e3);
          await gmailPost("messages/batchDelete", token, { ids: chunk });
          job.succeeded.push(...chunk);
          job.processed += chunk.length;
        }
      } else if (action === "EMPTY_TRASH") {
        let pageToken = void 0;
        let allIds = [];
        do {
          const res = await gmailGet("messages", token, { labelIds: "TRASH", maxResults: 500, pageToken });
          if (res.messages) allIds.push(...res.messages.map((m) => m.id));
          pageToken = res.nextPageToken;
        } while (pageToken);
        job.total = allIds.length;
        if (allIds.length === 0) {
          job.status = "done";
          return;
        }
        for (let i = 0; i < allIds.length; i += 1e3) {
          const chunk = allIds.slice(i, i + 1e3);
          await gmailPost("messages/batchDelete", token, { ids: chunk });
          job.succeeded.push(...chunk);
          job.processed += chunk.length;
        }
      }
      job.status = "done";
    } catch (err) {
      if (err instanceof AuthError) {
        job.error = "AUTH_ERROR";
      } else {
        job.error = err.message;
      }
      job.status = "error";
    }
  }
  async function executeUnsubscribe(email, token) {
    const info = email.unsubscribeInfo;
    if (!info) return;
    if (info.type === "one-click" || info.type === "https") {
      if (!info.url.startsWith("https://")) {
        throw new Error("Unsubscribe URL is not HTTPS.");
      }
      const response = await fetch(info.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        mode: "no-cors"
        // Crucial: bypasses CORS blocks
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
