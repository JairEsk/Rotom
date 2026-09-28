(() => {
  // src/api.js
  var GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
  var MESSAGE_ID_REGEX = /^[a-zA-Z0-9]+$/;
  var AuthError = class extends Error {
    constructor() {
      super("auth");
    }
  };
  function isValidMessageId(id) {
    return typeof id === "string" && MESSAGE_ID_REGEX.test(id);
  }
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
  function isPublicIpv6(ipv6) {
    if (ipv6.includes("%")) return false;
    const parts = ipv6.split("::");
    if (parts.length > 2) return false;
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    if (parts.length === 1 && missing !== 0 || parts.length === 2 && missing < 1) {
      return false;
    }
    const full = [...left, ...Array(missing).fill("0"), ...right];
    if (full.length !== 8) return false;
    const groups = full.map((g) => /^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN);
    if (groups.some(Number.isNaN)) return false;
    const [g0, g1] = groups;
    if ((g0 & 57344) !== 8192) return false;
    if (g0 === 8193 && (g1 === 0 || g1 === 2 || g1 >= 16 && g1 <= 47 || g1 === 3512)) {
      return false;
    }
    if (g0 === 8194) return false;
    return true;
  }
  function isPublicHttpsUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
    for (let i = 0; i < rawUrl.length; i++) {
      const code = rawUrl.charCodeAt(i);
      if (code <= 32 || code === 127) return false;
    }
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (!host) return false;
    if (host.startsWith("[") && host.endsWith("]")) {
      return isPublicIpv6(host.slice(1, -1));
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      const octets = host.split(".").map(Number);
      if (octets.some((o) => o < 0 || o > 255)) return false;
      const [a, b, c] = octets;
      if (a === 0) return false;
      if (a === 10) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
      if (a === 192 && b === 88 && c === 99) return false;
      if (a === 192 && b === 168) return false;
      if (a === 198 && (b === 18 || b === 19)) return false;
      if (a === 198 && b === 51 && c === 100) return false;
      if (a === 203 && b === 0 && c === 113) return false;
      if (a >= 224) return false;
      return true;
    }
    if (!host.includes(".") || host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
      return false;
    }
    const reservedTlds = /\.(localhost|local|internal|intranet|corp|home|lan|localdomain|invalid|test|example|onion)$/i;
    if (reservedTlds.test(host)) return false;
    const tld = host.split(".").pop();
    if (!tld || /^\d+$/.test(tld)) return false;
    return true;
  }

  // src/background.js
  if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      console.log("R.O.T.O.M. installed.");
    });
  }
  var STALE_JOB_TIMEOUT_MS = 6e4;
  var JOB_ACTIONS = /* @__PURE__ */ new Set(["TRASH", "DELETE_FOREVER", "EMPTY_TRASH"]);
  var JOB_ID_REGEX = /^\d{13}$/;
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function hasValidToken(payload) {
    return typeof payload.token === "string" && payload.token.length > 0;
  }
  function isHeaderControlCharacter(char) {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127;
  }
  function isTrustedRuntimeSender(sender, runtimeId) {
    return typeof runtimeId === "string" && runtimeId.length > 0 && sender?.id === runtimeId;
  }
  function isValidRuntimeMessage(msg) {
    if (!isRecord(msg) || typeof msg.type !== "string") return false;
    if (msg.type === "START_JOB") {
      if (!JOB_ACTIONS.has(msg.action) || !isRecord(msg.payload) || !hasValidToken(msg.payload)) {
        return false;
      }
      if (msg.action === "EMPTY_TRASH") return true;
      return Array.isArray(msg.payload.ids) && msg.payload.ids.length > 0 && msg.payload.ids.every(isValidMessageId);
    }
    if (msg.type === "GET_JOB_STATUS" || msg.type === "CLEAR_JOB") {
      return typeof msg.jobId === "string" && JOB_ID_REGEX.test(msg.jobId);
    }
    if (msg.type === "EXECUTE_UNSUBSCRIBE") {
      const payload = msg.payload;
      const info = payload?.email?.unsubscribeInfo;
      return isRecord(payload) && hasValidToken(payload) && isRecord(payload.email) && isRecord(info) && (info.type === "one-click" || info.type === "mailto") && typeof info.url === "string" && info.url.length > 0;
    }
    return false;
  }
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
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!isTrustedRuntimeSender(sender, chrome.runtime.id)) return false;
      if (!isValidRuntimeMessage(msg)) {
        sendResponse({ success: false, error: "Invalid runtime message." });
        return false;
      }
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
  }
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
    const info = email?.unsubscribeInfo;
    if (!info || typeof info !== "object") {
      throw new Error("Missing unsubscribe information.");
    }
    if (info.type === "one-click") {
      if (!isPublicHttpsUrl(info.url)) {
        throw new Error("Unsubscribe URL must be a valid public HTTPS URL.");
      }
      const parsedUrl = new URL(info.url);
      await fetch(parsedUrl.href, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
        mode: "no-cors",
        // Crucial: bypasses CORS blocks
        credentials: "omit",
        redirect: "error"
      });
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
      if ([...to].some(isHeaderControlCharacter)) {
        throw new Error("Invalid mailto recipient address.");
      }
      const cleanTo = to.trim();
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
      if (!emailRegex.test(cleanTo)) {
        throw new Error("Invalid mailto recipient address.");
      }
      const rawSubject = parsed.searchParams.get("subject") || "unsubscribe";
      const cleanSubject = [...rawSubject].filter((char) => !isHeaderControlCharacter(char)).join("").trim().slice(0, 200) || "unsubscribe";
      const rawMsg = [`To: ${cleanTo}`, `Subject: ${cleanSubject}`, "", ""].join("\r\n");
      const encoded = btoa(unescape(encodeURIComponent(rawMsg))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await gmailPost("messages/send", token, { raw: encoded });
      return;
    }
    throw new Error("Unsupported unsubscribe method.");
  }
})();
