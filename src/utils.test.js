import { describe, it, expect } from 'vitest';
import { formatBytes, formatDate, escHtml, escapeCssValue, buildSenderQuery, isPublicHttpsUrl, parseUnsubscribeHeader } from './utils.js';

describe('utils', () => {
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

  it('escapes HTML special characters including quotes', () => {
    expect(escHtml('')).toBe('');
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
    expect(escHtml(0)).toBe('0');
    expect(escHtml('"Acme Corp" <info@acme.com>')).toBe('&quot;Acme Corp&quot; &lt;info@acme.com&gt;');
    expect(escHtml("O'Reilly & Associates <script>alert(1)</script>")).toBe(
      'O&#39;Reilly &amp; Associates &lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapes CSS selector values safely', () => {
    expect(escapeCssValue('abcDEF123')).toBe('abcDEF123');
    expect(escapeCssValue('')).toBe('');
    expect(escapeCssValue(null)).toBe('');
    expect(escapeCssValue('id"with]quotes')).toBe('id\\"with\\]quotes');
    expect(escapeCssValue('18f3a9b')).toBe('\\31 8f3a9b');
    expect(escapeCssValue('-')).toBe('\\-');
    expect(escapeCssValue('a\x00b')).toBe('a\uFFFDb');
  });

  it('quotes and sanitizes Gmail sender filters', () => {
    expect(buildSenderQuery('')).toBe('');
    expect(buildSenderQuery(null)).toBe('');
    expect(buildSenderQuery('news@example.com')).toBe('from:"news@example.com"');
    expect(buildSenderQuery('  amazon.com  ')).toBe('from:"amazon.com"');
    expect(buildSenderQuery('attacker@example.com OR in:inbox')).toBe(
      'from:"attacker@example.com OR in:inbox"'
    );
    expect(buildSenderQuery('evil" OR in:trash')).toBe('from:"evil OR in:trash"');
    expect(buildSenderQuery('evil\\" OR in:spam')).toBe('from:"evil OR in:spam"');
    expect(buildSenderQuery('evil\r\nOR in:anywhere')).toBe('from:"evil OR in:anywhere"');
    expect(buildSenderQuery(`evil${String.fromCharCode(0x85)}OR in:sent`)).toBe(
      'from:"evil OR in:sent"'
    );
  });

  it('validates public HTTPS URLs and rejects private, local, or malformed URLs', () => {
    expect(isPublicHttpsUrl('https://unsubscribe.example.org/opt-out?id=123')).toBe(true);
    expect(isPublicHttpsUrl('https://8.8.8.8/unsub')).toBe(true);
    expect(isPublicHttpsUrl('https://[2606:4700:4700::1111]/unsub')).toBe(true);

    expect(isPublicHttpsUrl('')).toBe(false);
    expect(isPublicHttpsUrl(null)).toBe(false);
    expect(isPublicHttpsUrl('http://unsubscribe.example.org/opt-out')).toBe(false);
    expect(isPublicHttpsUrl('mailto:unsub@example.org')).toBe(false);
    expect(isPublicHttpsUrl('https://user:pass@unsubscribe.example.org/opt-out')).toBe(false);
    expect(isPublicHttpsUrl('https://localhost/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://sub.localhost/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://intranet/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://service.local/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://service.internal/unsub')).toBe(false);

    expect(isPublicHttpsUrl('https://127.0.0.1/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://2130706433/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://10.0.0.1/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://172.16.0.1/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://172.31.255.255/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://192.168.1.1/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPublicHttpsUrl('https://100.64.0.1/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://0.0.0.0/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://224.0.0.1/unsub')).toBe(false);

    expect(isPublicHttpsUrl('https://[::1]/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://[::ffff:127.0.0.1]/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://[fe80::1]/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://[fd00::1]/unsub')).toBe(false);
    expect(isPublicHttpsUrl('https://[2001:db8::1]/unsub')).toBe(false);
  });

  it('parses List-Unsubscribe headers requiring RFC 8058 One-Click for HTTPS', () => {
    expect(
      parseUnsubscribeHeader([
        { name: 'List-Unsubscribe', value: '<https://unsubscribe.example.org/opt-out>' },
        { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' }
      ])
    ).toEqual({ type: 'one-click', url: 'https://unsubscribe.example.org/opt-out' });

    expect(
      parseUnsubscribeHeader([
        { name: 'List-Unsubscribe', value: '<https://unsubscribe.example.org/opt-out>, <mailto:unsub@example.org>' }
      ])
    ).toEqual({ type: 'mailto', url: 'mailto:unsub@example.org' });

    expect(
      parseUnsubscribeHeader([
        { name: 'List-Unsubscribe', value: '<https://unsubscribe.example.org/opt-out>' }
      ])
    ).toBeNull();

    expect(
      parseUnsubscribeHeader([
        { name: 'List-Unsubscribe', value: '<https://127.0.0.1/unsub>, <mailto:unsub@example.org>' },
        { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' }
      ])
    ).toEqual({ type: 'mailto', url: 'mailto:unsub@example.org' });
  });
});
