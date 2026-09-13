import { describe, it, expect } from 'vitest';
import { formatBytes, formatDate, escHtml, isValidPublicHttpsUrl, parseUnsubscribeHeader } from './utils.js';

describe('utils formatting', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });

  it('formats dates correctly', () => {
    const today = new Date().toISOString();
    expect(formatDate(today)).toBe('Today');

    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(formatDate(yesterday)).toBe('Yesterday');
  });

  it('escapes HTML special characters and quotes safely for elements and attributes', () => {
    expect(escHtml('Normal text')).toBe('Normal text');
    expect(escHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escHtml('Foo & Bar "baz" \'qux\'')).toBe('Foo &amp; Bar &quot;baz&quot; &#39;qux&#39;');
    expect(escHtml('attacker" onclick="evil()')).toBe('attacker&quot; onclick=&quot;evil()');
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });
});

describe('isValidPublicHttpsUrl', () => {
  it('allows valid public HTTPS URLs', () => {
    expect(isValidPublicHttpsUrl('https://example.com/unsub')).toBe(true);
    expect(isValidPublicHttpsUrl('https://sub.domain.org/path?token=abc')).toBe(true);
    expect(isValidPublicHttpsUrl('https://mail.google.com/mail/u/0/')).toBe(true);
  });

  it('rejects non-HTTPS protocols', () => {
    expect(isValidPublicHttpsUrl('http://example.com/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('ftp://example.com/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isValidPublicHttpsUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects URLs with credentials', () => {
    expect(isValidPublicHttpsUrl('https://user:pass@example.com/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://user@example.com/unsub')).toBe(false);
  });

  it('rejects localhost and reserved internal domain suffixes', () => {
    expect(isValidPublicHttpsUrl('https://localhost/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://sub.localhost/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://service.local/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://api.internal/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://router.lan/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://device.home.arpa/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://hidden.onion/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://test.example/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://test.invalid/unsub')).toBe(false);
  });

  it('rejects loopback, private, link-local and cloud metadata IPs', () => {
    expect(isValidPublicHttpsUrl('https://127.0.0.1/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://10.0.0.1/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://172.16.0.1/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://172.31.255.254/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://192.168.1.1/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isValidPublicHttpsUrl('https://100.64.0.1/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://0.0.0.0/unsub')).toBe(false);
  });

  it('rejects IPv6 literals', () => {
    expect(isValidPublicHttpsUrl('https://[::1]/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://[::ffff:127.0.0.1]/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://[fe80::1]/unsub')).toBe(false);
  });

  it('rejects known DNS wildcard resolving services', () => {
    expect(isValidPublicHttpsUrl('https://10.0.0.1.nip.io/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://127.0.0.1.sslip.io/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://192.168.1.1.xip.io/unsub')).toBe(false);
    expect(isValidPublicHttpsUrl('https://localtest.me/unsub')).toBe(false);
  });

  it('handles invalid URL input gracefully', () => {
    expect(isValidPublicHttpsUrl(null)).toBe(false);
    expect(isValidPublicHttpsUrl(undefined)).toBe(false);
    expect(isValidPublicHttpsUrl('')).toBe(false);
    expect(isValidPublicHttpsUrl('not-a-url')).toBe(false);
  });
});

describe('parseUnsubscribeHeader', () => {
  it('detects RFC 8058 One-Click unsubscribe when exact header is present', () => {
    const headers = [
      { name: 'List-Unsubscribe', value: '<https://example.com/unsub>, <mailto:unsub@example.com>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' }
    ];
    const res = parseUnsubscribeHeader(headers);
    expect(res).toEqual({ type: 'one-click', url: 'https://example.com/unsub' });
  });

  it('rejects partial or non-exact matches for List-Unsubscribe-Post', () => {
    const maliciousHeaders = [
      { name: 'List-Unsubscribe', value: '<https://example.com/unsub>, <mailto:unsub@example.com>' },
      { name: 'List-Unsubscribe-Post', value: 'X-List-Unsubscribe=One-Click-Evil' }
    ];
    const res = parseUnsubscribeHeader(maliciousHeaders);
    // Should fall back to mailto: instead of one-click
    expect(res).toEqual({ type: 'mailto', url: 'mailto:unsub@example.com' });
  });

  it('prefers mailto over plain HTTPS when One-Click is not present', () => {
    const headers = [
      { name: 'List-Unsubscribe', value: '<https://example.com/unsub>, <mailto:unsub@example.com>' }
    ];
    const res = parseUnsubscribeHeader(headers);
    expect(res).toEqual({ type: 'mailto', url: 'mailto:unsub@example.com' });
  });

  it('falls back to https landing page when only https URL is available', () => {
    const headers = [
      { name: 'List-Unsubscribe', value: '<https://example.com/unsub-landing>' }
    ];
    const res = parseUnsubscribeHeader(headers);
    expect(res).toEqual({ type: 'https', url: 'https://example.com/unsub-landing' });
  });

  it('returns null when no valid unsubscribe header exists', () => {
    expect(parseUnsubscribeHeader([])).toBeNull();
    expect(parseUnsubscribeHeader(null)).toBeNull();
    expect(parseUnsubscribeHeader([{ name: 'Subject', value: 'Hello' }])).toBeNull();
  });
});
