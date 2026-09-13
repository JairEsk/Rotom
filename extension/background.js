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

  // src/utils.js
  function isValidPublicHttpsUrl(urlString) {
    if (typeof urlString !== "string") return false;
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    let hostname = parsed.hostname.toLowerCase();
    if (!hostname) return false;
    hostname = hostname.replace(/\.$/, "");
    const reservedSuffixes = [
      "localhost",
      "local",
      "internal",
      "lan",
      "home.arpa",
      "test",
      "example",
      "invalid",
      "onion",
      "alt",
      "nip.io",
      "sslip.io",
      "xip.io",
      "localtest.me"
    ];
    if (reservedSuffixes.some((s) => hostname === s || hostname.endsWith("." + s))) {
      return false;
    }
    if (hostname.startsWith("[") || hostname.includes(":")) {
      return false;
    }
    const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (ipv4Match) {
      const octets = ipv4Match.slice(1, 5).map(Number);
      if (octets.some((o) => o < 0 || o > 255)) return false;
      const [o0, o1] = octets;
      if (o0 === 0 || o0 === 10 || o0 === 127 || o0 >= 224) return false;
      if (o0 === 169 && o1 === 254) return false;
      if (o0 === 172 && o1 >= 16 && o1 <= 31) return false;
      if (o0 === 192 && o1 === 168) return false;
      if (o0 === 100 && o1 >= 64 && o1 <= 127) return false;
      if (o0 === 192 && o1 === 0) return false;
      if (o0 === 198 && (o1 === 18 || o1 === 19 || o1 === 51)) return false;
      if (o0 === 203 && o1 === 0) return false;
      return true;
    }
    if (!hostname.includes(".")) return false;
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(hostname);
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
        failed: 0,
        updatedAt: Date.now()
      };
      saveJob(jobId, initialJob).then(() => {
        sendResponse({ jobId });
        runJob(jobId, msg.action, msg.payload);
      });
      return true;
    }
    if (msg.type === "GET_JOB_STATUS") {
      getJob(msg.jobId).then((job) => {
        sendResponse(job || null);
      });
      return true;
    }
    if (msg.type === "CLEAR_JOB") {
      deleteJob(msg.jobId).then(() => sendResponse({ success: true }));
      return true;
    }
    if (msg.type === "EXECUTE_UNSUBSCRIBE") {
      executeUnsubscribe(msg.payload.email, msg.payload.token).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });
  async function processInBatches(ids, jobId, processChunk, succeededOut = []) {
    const job = await getJob(jobId);
    if (!job) return succeededOut;
    job.total = ids.length;
    job.updatedAt = Date.now();
    await saveJob(jobId, job);
    for (let i = 0; i < ids.length; i += 1e3) {
      const chunk = ids.slice(i, i + 1e3);
      try {
        await processChunk(chunk);
        succeededOut.push(...chunk);
      } catch (err) {
        console.error("Batch chunk error:", err);
        job.failed += chunk.length;
        if (err instanceof AuthError) throw err;
      }
      job.processed += chunk.length;
      job.updatedAt = Date.now();
      await saveJob(jobId, job);
    }
    return succeededOut;
  }
  async function runJob(jobId, action, payload) {
    const { token, ids } = payload;
    const succeeded = [];
    try {
      if (action === "TRASH") {
        await processInBatches(
          ids,
          jobId,
          (chunk) => gmailPost("messages/batchModify", token, { ids: chunk, addLabelIds: ["TRASH"] }),
          succeeded
        );
      } else if (action === "DELETE_FOREVER") {
        await processInBatches(
          ids,
          jobId,
          (chunk) => gmailPost("messages/batchDelete", token, { ids: chunk }),
          succeeded
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
          (chunk) => gmailPost("messages/batchDelete", token, { ids: chunk }),
          succeeded
        );
      }
      const finalJob = await getJob(jobId);
      if (finalJob) {
        finalJob.succeeded = succeeded;
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
        errorJob.succeeded = succeeded;
        errorJob.updatedAt = Date.now();
        await saveJob(jobId, errorJob);
      }
    }
  }
  async function executeUnsubscribe(email, token) {
    const info = email.unsubscribeInfo;
    if (!info) return;
    if (info.type === "one-click") {
      if (!isValidPublicHttpsUrl(info.url)) {
        throw new Error("Invalid or non-public HTTPS unsubscribe URL.");
      }
      await fetch(info.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        mode: "no-cors"
        // Crucial: bypasses CORS blocks in browser context
      });
      return;
    }
    if (info.type === "https") {
      if (!isValidPublicHttpsUrl(info.url)) {
        throw new Error("Invalid or non-public HTTPS unsubscribe URL.");
      }
      await chrome.tabs.create({ url: info.url, active: false });
      return;
    }
    if (info.type === "mailto") {
      let parsed;
      try {
        parsed = new URL(info.url);
      } catch {
        throw new Error("Invalid mailto URL.");
      }
      let to = "";
      try {
        to = parsed.pathname ? decodeURIComponent(parsed.pathname) : "";
      } catch {
        throw new Error("Malformed URI encoding in mailto recipient.");
      }
      if (/[\x00-\x1f\x7f]/.test(to)) {
        throw new Error("Invalid mailto recipient address.");
      }
      const cleanTo = to.trim();
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
      if (!emailRegex.test(cleanTo)) {
        throw new Error("Invalid mailto recipient address.");
      }
      const rawSubject = parsed.searchParams.get("subject") || "unsubscribe";
      const cleanSubject = rawSubject.replace(/[\r\n\x00-\x1f\x7f]/g, "").trim().slice(0, 200) || "unsubscribe";
      const rawMsg = [`To: ${cleanTo}`, `Subject: ${cleanSubject}`, "", ""].join("\r\n");
      const encoded = btoa(unescape(encodeURIComponent(rawMsg))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await gmailPost("messages/send", token, { raw: encoded });
    }
  }
})();
