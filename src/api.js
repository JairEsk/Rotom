const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class AuthError extends Error { constructor() { super('auth'); } }

export async function fetchWithBackoff(url, options, retries = 4, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429 && i < retries - 1) {
      const waitTime = delay * Math.pow(2, i) + Math.random() * 500;
      await new Promise(r => setTimeout(r, waitTime));
      continue;
    }
    return res;
  }
  return fetch(url, options); // fallback on last try
}

export async function gmailGet(path, token, params = {}) {
  const url = new URL(`${GMAIL}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) { v.forEach(val => url.searchParams.append(k, val)); } else if (v !== undefined && v !== '') { url.searchParams.set(k, v); }
  });
  const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'API error'); }
  return res.json();
}

export async function gmailPost(path, token, body) {
  const res = await fetchWithBackoff(`${GMAIL}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'API error'); }
  return res.json();
}

export async function gmailDelete(path, token) {
  const res = await fetchWithBackoff(`${GMAIL}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok && res.status !== 204) {
    const e = await res.json();
    throw new Error(e.error?.message || 'API error');
  }
}

export async function gmailBatchGet(ids, token) {
  if (ids.length === 0) return [];
  const boundary = 'batch_gmail_req_boundary';
  let body = '';
  ids.forEach((id, index) => {
    body += `--${boundary}\r\n`;
    body += `Content-Type: application/http\r\n`;
    body += `Content-ID: <item-${index}>\r\n\r\n`;
    body += `GET /gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post HTTP/1.1\r\n\r\n`;
  });
  body += `--${boundary}--\r\n`;

  const res = await fetchWithBackoff('https://gmail.googleapis.com/batch/gmail/v1', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/mixed; boundary="${boundary}"`
    },
    body: body
  });

  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    throw new Error(`Batch API error: ${res.status}`);
  }
  
  const text = await res.text();
  const matchBoundary = res.headers.get('content-type')?.match(/boundary=([^;]+)/);
  const resBoundary = matchBoundary ? `--${matchBoundary[1].replace(/["']/g, '')}` : `--${boundary}`;
  
  const parts = text.split(resBoundary);
  const messages = [];
  parts.forEach(part => {
    if (part.includes('HTTP/1.1 200 OK')) {
      const match = part.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const msg = JSON.parse(match[0]);
          if (msg.id) messages.push(msg);
        } catch(e) {}
      }
    }
  });
  return messages;
}
