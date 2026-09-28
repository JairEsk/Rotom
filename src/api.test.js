import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gmailBatchGet, isValidMessageId, revokeOAuthToken } from './api.js';

describe('api message ID validation', () => {
  let fetchMock;

  beforeEach(() => {
    const rawMultipart = [
      '--batch_gmail_req_boundary',
      'Content-Type: application/http',
      '',
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      JSON.stringify({ id: '18f3c2a9b01d4e5f', sizeEstimate: 2048 }),
      '--batch_gmail_req_boundary--'
    ].join('\r\n');

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name.toLowerCase() === 'content-type' ? 'multipart/mixed; boundary=batch_gmail_req_boundary' : null)
      },
      text: () => Promise.resolve(rawMultipart)
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('revokes OAuth tokens without exposing them in the URL', async () => {
    const token = 'secret+token/with=value';
    await revokeOAuthToken(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(url).not.toContain(token);
    expect(options).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=secret%2Btoken%2Fwith%3Dvalue',
      credentials: 'omit',
      redirect: 'error'
    });
  });

  it('ignores empty OAuth tokens and rejects failed revocations', async () => {
    await revokeOAuthToken('');
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(revokeOAuthToken('expired-token')).rejects.toThrow(
      'OAuth revocation failed: 400'
    );
  });

  it('validates alphanumeric Gmail message IDs and rejects malformed values', () => {
    expect(isValidMessageId('18f3c2a9b01d4e5f')).toBe(true);
    expect(isValidMessageId('ABC123xyz987')).toBe(true);

    expect(isValidMessageId('')).toBe(false);
    expect(isValidMessageId(null)).toBe(false);
    expect(isValidMessageId(undefined)).toBe(false);
    expect(isValidMessageId(12345)).toBe(false);
    expect(isValidMessageId('18f3c2a9\r\nPOST /gmail/v1/users/me/messages/send')).toBe(false);
    expect(isValidMessageId('../messages/123')).toBe(false);
    expect(isValidMessageId('18f3c2a9?format=full')).toBe(false);
    expect(isValidMessageId('18f3c2a9" onclick="alert(1)')).toBe(false);
  });

  it('sends batch GET requests when all message IDs are valid', async () => {
    const res = await gmailBatchGet(['18f3c2a9b01d4e5f'], 'fake-token');

    expect(res).toEqual([{ id: '18f3c2a9b01d4e5f', sizeEstimate: 2048 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toContain(
      'GET /gmail/v1/users/me/messages/18f3c2a9b01d4e5f?format=metadata'
    );
  });

  it('rejects batch GET requests containing non-alphanumeric or CRLF-injected IDs', async () => {
    const maliciousIds = [
      '18f3c2a9\r\n\r\n--batch_gmail_req_boundary\r\n',
      '../other/path',
      '18f3c2a9&format=full',
      ''
    ];

    for (const badId of maliciousIds) {
      await expect(gmailBatchGet([badId], 'fake-token')).rejects.toThrow(
        'Invalid Gmail message ID.'
      );
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('filters out response parts with invalid message IDs', async () => {
    const poisonedMultipart = [
      '--batch_gmail_req_boundary',
      'HTTP/1.1 200 OK',
      '',
      JSON.stringify({ id: '18f3c2a9b01d4e5f', sizeEstimate: 1024 }),
      '--batch_gmail_req_boundary',
      'HTTP/1.1 200 OK',
      '',
      JSON.stringify({ id: '<img src=x onerror=alert(1)>', sizeEstimate: 512 }),
      '--batch_gmail_req_boundary--'
    ].join('\r\n');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'multipart/mixed; boundary=batch_gmail_req_boundary' },
      text: () => Promise.resolve(poisonedMultipart)
    });

    const res = await gmailBatchGet(['18f3c2a9b01d4e5f'], 'fake-token');
    expect(res).toEqual([{ id: '18f3c2a9b01d4e5f', sizeEstimate: 1024 }]);
  });
});
