import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeUnsubscribe } from './background.js';

describe('executeUnsubscribe', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 0, type: 'opaque' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a POST request without credentials and blocking redirects for valid one-click URLs', async () => {
    const email = {
      unsubscribeInfo: {
        type: 'one-click',
        url: 'https://unsubscribe.newsletter.org/optout?token=abc'
      }
    };

    await executeUnsubscribe(email, 'fake-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://unsubscribe.newsletter.org/optout?token=abc',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
        mode: 'no-cors',
        credentials: 'omit',
        redirect: 'error'
      }
    );
  });

  it('rejects non-one-click https unsubscribe requests', async () => {
    const email = {
      unsubscribeInfo: {
        type: 'https',
        url: 'https://unsubscribe.newsletter.org/optout'
      }
    };

    await expect(executeUnsubscribe(email, 'fake-token')).rejects.toThrow(
      'Unsupported unsubscribe method.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects localhost and private IP one-click URLs to prevent SSRF', async () => {
    const unsafeUrls = [
      'http://unsubscribe.newsletter.org/optout',
      'https://localhost:8080/unsub',
      'https://127.0.0.1/unsub',
      'https://10.0.0.1/unsub',
      'https://192.168.1.1/unsub',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/unsub'
    ];

    for (const url of unsafeUrls) {
      const email = { unsubscribeInfo: { type: 'one-click', url } };
      await expect(executeUnsubscribe(email, 'fake-token')).rejects.toThrow(
        'Unsubscribe URL must be a valid public HTTPS URL.'
      );
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing unsubscribeInfo', async () => {
    await expect(executeUnsubscribe({}, 'fake-token')).rejects.toThrow(
      'Missing unsubscribe information.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
