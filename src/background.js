/* eslint-disable no-control-regex */
import { gmailPost, gmailGet, AuthError } from './api.js';
import { isValidPublicHttpsUrl } from './utils.js';

chrome.runtime.onInstalled.addListener(() => {
  console.log('R.O.T.O.M. installed.');
});

const STALE_JOB_TIMEOUT_MS = 60000;

// Persist jobs in storage.session across transient service worker restarts
async function getJob(jobId) {
  const data = await chrome.storage.session.get(jobId);
  const job = data[jobId] || null;
  if (job && job.status === 'running' && Date.now() - (job.updatedAt || 0) > STALE_JOB_TIMEOUT_MS) {
    job.status = 'error';
    job.error = 'Service worker suspended unexpectedly';
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
  if (msg.type === 'START_JOB') {
    const jobId = Date.now().toString();
    const initialJob = {
      status: 'running',
      processed: 0,
      total: msg.payload.ids?.length || 0,
      failed: 0,
      updatedAt: Date.now()
    };

    saveJob(jobId, initialJob).then(() => {
      sendResponse({ jobId });
      runJob(jobId, msg.action, msg.payload);
    });

    return true; // Keep message channel open for async saveJob
  }
  
  if (msg.type === 'GET_JOB_STATUS') {
    getJob(msg.jobId).then((job) => {
      sendResponse(job || null);
    });
    return true; // Keep message channel open for async getJob
  }
  
  if (msg.type === 'CLEAR_JOB') {
    deleteJob(msg.jobId).then(() => sendResponse({ success: true }));
    return true;
  }
  
  if (msg.type === 'EXECUTE_UNSUBSCRIBE') {
    executeUnsubscribe(msg.payload.email, msg.payload.token)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function processInBatches(ids, jobId, processChunk, succeededOut = []) {
  const job = await getJob(jobId);
  if (!job) return succeededOut;
  job.total = ids.length;
  job.updatedAt = Date.now();
  await saveJob(jobId, job);

  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    try {
      await processChunk(chunk);
      succeededOut.push(...chunk);
    } catch (err) {
      console.error('Batch chunk error:', err);
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
    if (action === 'TRASH') {
      await processInBatches(ids, jobId, chunk => 
        gmailPost('messages/batchModify', token, { ids: chunk, addLabelIds: ['TRASH'] }),
        succeeded
      );
    } else if (action === 'DELETE_FOREVER') {
      await processInBatches(ids, jobId, chunk => 
        gmailPost('messages/batchDelete', token, { ids: chunk }),
        succeeded
      );
    } else if (action === 'EMPTY_TRASH') {
      let pageToken = undefined;
      let allIds = [];
      do {
        const res = await gmailGet('messages', token, { labelIds: 'TRASH', maxResults: 500, pageToken, includeSpamTrash: true });
        if (res.messages) allIds.push(...res.messages.map(m => m.id));
        pageToken = res.nextPageToken;
        const currentJob = await getJob(jobId);
        if (currentJob) {
          currentJob.updatedAt = Date.now();
          await saveJob(jobId, currentJob);
        }
      } while (pageToken);
      
      await processInBatches(allIds, jobId, chunk => 
        gmailPost('messages/batchDelete', token, { ids: chunk }),
        succeeded
      );
    }
    
    const finalJob = await getJob(jobId);
    if (finalJob) {
      finalJob.succeeded = succeeded;
      finalJob.status = (finalJob.failed > 0 && finalJob.succeeded.length === 0) ? 'error' : 'done';
      if (finalJob.status === 'error' && !finalJob.error) {
        finalJob.error = 'All batch operations failed';
      }
      finalJob.updatedAt = Date.now();
      await saveJob(jobId, finalJob);
    }
  } catch (err) {
    const errorJob = await getJob(jobId);
    if (errorJob) {
      errorJob.status = 'error';
      errorJob.error = (err instanceof AuthError) ? 'AUTH_ERROR' : (err.message || 'Unknown error');
      errorJob.succeeded = succeeded;
      errorJob.updatedAt = Date.now();
      await saveJob(jobId, errorJob);
    }
  }
}

// Execute Unsubscribe (RFC 8058 One-Click POST, HTTPS landing page, or mailto)
async function executeUnsubscribe(email, token) {
  const info = email.unsubscribeInfo;
  if (!info) return;

  if (info.type === 'one-click') {
    if (!isValidPublicHttpsUrl(info.url)) {
      throw new Error('Invalid or non-public HTTPS unsubscribe URL.');
    }
    await fetch(info.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      mode: 'no-cors' // Crucial: bypasses CORS blocks in browser context
    });
    // With no-cors, response is opaque (status 0). We assume success if it didn't throw network error.
    return;
  }

  if (info.type === 'https') {
    if (!isValidPublicHttpsUrl(info.url)) {
      throw new Error('Invalid or non-public HTTPS unsubscribe URL.');
    }
    await chrome.tabs.create({ url: info.url, active: false });
    return;
  }

  if (info.type === 'mailto') {
    let parsed;
    try {
      parsed = new URL(info.url);
    } catch {
      throw new Error('Invalid mailto URL.');
    }

    let to = '';
    try {
      to = parsed.pathname ? decodeURIComponent(parsed.pathname) : '';
    } catch {
      throw new Error('Malformed URI encoding in mailto recipient.');
    }

    if (/[\x00-\x1f\x7f]/.test(to)) {
      throw new Error('Invalid mailto recipient address.');
    }

    const cleanTo = to.trim();
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(cleanTo)) {
      throw new Error('Invalid mailto recipient address.');
    }

    const rawSubject = parsed.searchParams.get('subject') || 'unsubscribe';
    const cleanSubject = rawSubject.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim().slice(0, 200) || 'unsubscribe';

    const rawMsg = [`To: ${cleanTo}`, `Subject: ${cleanSubject}`, '', ''].join('\r\n');
    const encoded = btoa(unescape(encodeURIComponent(rawMsg)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmailPost('messages/send', token, { raw: encoded });
  }
}
