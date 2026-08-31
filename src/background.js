import { gmailPost, gmailGet, AuthError } from './api.js';

chrome.runtime.onInstalled.addListener(() => {
  console.log('R.O.T.O.M. installed.');
});

// We keep track of running jobs
const jobs = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_JOB') {
    const jobId = Date.now().toString();
    jobs[jobId] = { status: 'running', processed: 0, total: msg.payload.ids?.length || 0, succeeded: [], failed: 0 };
    
    // Fire and forget
    runJob(jobId, msg.action, msg.payload).catch(err => {
      console.error('Job failed:', err);
      if (jobs[jobId]) jobs[jobId].error = err.message;
    });

    sendResponse({ jobId });
    return false;
  }
  
  if (msg.type === 'GET_JOB_STATUS') {
    const job = jobs[msg.jobId];
    sendResponse(job || null);
    if (job && (job.status === 'done' || job.status === 'error')) {
      delete jobs[msg.jobId]; // Limpiar para evitar memory leak
    }
    return false;
  }
  
  if (msg.type === 'EXECUTE_UNSUBSCRIBE') {
    executeUnsubscribe(msg.payload.email, msg.payload.token)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});

async function runJob(jobId, action, payload) {
  const job = jobs[jobId];
  const { token, ids } = payload;
  
  try {
    if (action === 'TRASH') {
      const total = ids.length;
      job.total = total;
      for (let i = 0; i < total; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        await gmailPost('messages/batchModify', token, { ids: chunk, addLabelIds: ['TRASH'] });
        job.succeeded.push(...chunk);
        job.processed += chunk.length;
      }
    } else if (action === 'DELETE_FOREVER') {
      const total = ids.length;
      job.total = total;
      for (let i = 0; i < total; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        await gmailPost('messages/batchDelete', token, { ids: chunk });
        job.succeeded.push(...chunk);
        job.processed += chunk.length;
      }
    } else if (action === 'EMPTY_TRASH') {
      let pageToken = undefined;
      let allIds = [];
      do {
        const res = await gmailGet('messages', token, { labelIds: 'TRASH', maxResults: 500, pageToken });
        if (res.messages) allIds.push(...res.messages.map(m => m.id));
        pageToken = res.nextPageToken;
      } while (pageToken);
      
      job.total = allIds.length;
      if (allIds.length === 0) {
        job.status = 'done';
        return;
      }

      for (let i = 0; i < allIds.length; i += 1000) {
        const chunk = allIds.slice(i, i + 1000);
        await gmailPost('messages/batchDelete', token, { ids: chunk });
        job.succeeded.push(...chunk);
        job.processed += chunk.length;
      }
    }
    
    job.status = 'done';
  } catch (err) {
    if (err instanceof AuthError) {
      job.error = 'AUTH_ERROR';
    } else {
      job.error = err.message;
    }
    job.status = 'error';
  }
}

// Unsubscribe bypassing CORS with mode: 'no-cors'
async function executeUnsubscribe(email, token) {
  const info = email.unsubscribeInfo;
  if (!info) return;

  if (info.type === 'one-click' || info.type === 'https') {
    if (!info.url.startsWith('https://')) {
      throw new Error('Unsubscribe URL is not HTTPS.');
    }
    const response = await fetch(info.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      mode: 'no-cors' // Crucial: bypasses CORS blocks
    });
    // With no-cors, response is opaque (status 0). We assume success if it didn't throw network error.
    return;
  }

  if (info.type === 'mailto') {
    const parsed = new URL(info.url);
    const to = parsed.pathname;
    const subject = parsed.searchParams.get('subject') || 'unsubscribe';
    const rawMsg = [`To: ${to}`, `Subject: ${subject}`, ``, ``].join('\r\n');
    const encoded = btoa(unescape(encodeURIComponent(rawMsg)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmailPost('messages/send', token, { raw: encoded });
  }
}
