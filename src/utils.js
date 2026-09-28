export function formatBytes(b) {
  if (!b) return '0 B';
  const kb = 1024, units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.floor(Math.log(b) / Math.log(kb));
  return parseFloat((b / Math.pow(kb, unitIndex)).toFixed(1)) + ' ' + units[unitIndex];
}

export function formatDate(raw) {
  if (!raw) return '';
  try {
    const date = new Date(raw);
    const now = new Date();
    
    // Normalize to midnight for accurate calendar day differences
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const emailDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffTime = today - emailDay;
    const diffDays = Math.round(diffTime / 86400000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 365) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function escHtml(t) {
  if (t == null) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeCssValue(value) {
  const str = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(str);
  }
  const length = str.length;
  let result = '';
  const firstCodeUnit = str.charCodeAt(0);
  for (let index = 0; index < length; index++) {
    const codeUnit = str.charCodeAt(index);
    if (codeUnit === 0x0000) {
      result += '\uFFFD';
      continue;
    }
    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }
    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      result += `\\${str.charAt(index)}`;
      continue;
    }
    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += str.charAt(index);
      continue;
    }
    result += `\\${str.charAt(index)}`;
  }
  return result;
}

export function buildSenderQuery(value) {
  if (typeof value !== 'string') return '';
  let sanitized = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === '"' || char === '\\') continue;
    sanitized += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
  }
  const sender = sanitized.replace(/\s+/g, ' ').trim();
  return sender ? `from:"${sender}"` : '';
}

function isPublicIpv6(ipv6) {
  if (ipv6.includes('%')) return false;
  const parts = ipv6.split('::');
  if (parts.length > 2) return false;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if ((parts.length === 1 && missing !== 0) || (parts.length === 2 && missing < 1)) {
    return false;
  }
  const full = [...left, ...Array(missing).fill('0'), ...right];
  if (full.length !== 8) return false;
  const groups = full.map(g => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  if (groups.some(Number.isNaN)) return false;

  const [g0, g1] = groups;
  // Only IANA Global Unicast (2000::/3) is routable on the public Internet
  if ((g0 & 0xe000) !== 0x2000) return false;
  // Exclude 2001:0000::/32 (Teredo), 2001:0002::/48 (Benchmarking), 2001:0010::/28 (ORCHID), 2001:0db8::/32 (Documentation)
  if (g0 === 0x2001 && (g1 === 0x0000 || g1 === 0x0002 || (g1 >= 0x0010 && g1 <= 0x002f) || g1 === 0x0db8)) {
    return false;
  }
  // Exclude 2002::/16 (6to4, which can embed private/loopback IPv4 addresses)
  if (g0 === 0x2002) return false;

  return true;
}

export function isPublicHttpsUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  for (let i = 0; i < rawUrl.length; i++) {
    const code = rawUrl.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;

  const host = parsed.hostname.toLowerCase();
  if (!host) return false;

  if (host.startsWith('[') && host.endsWith(']')) {
    return isPublicIpv6(host.slice(1, -1));
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    if (octets.some(o => o < 0 || o > 255)) return false;
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

  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    return false;
  }

  const reservedTlds = /\.(localhost|local|internal|intranet|corp|home|lan|localdomain|invalid|test|example|onion)$/i;
  if (reservedTlds.test(host)) return false;

  const tld = host.split('.').pop();
  if (!tld || /^\d+$/.test(tld)) return false;

  return true;
}

export function parseUnsubscribeHeader(headers) {
  if (!Array.isArray(headers)) return null;
  let rawValue = '';
  let hasOneClick = false;
  headers.forEach(header => {
    const name = (header?.name || '').toLowerCase();
    if (name === 'list-unsubscribe') rawValue = header.value || '';
    if (name === 'list-unsubscribe-post' && /list-unsubscribe\s*=\s*one-click/i.test(header.value || '')) {
      hasOneClick = true;
    }
  });
  if (!rawValue) return null;

  const urls = rawValue.match(/<([^>]+)>/g)?.map(m => m.slice(1, -1).trim()) || [];
  const httpsUrl = urls.find(u => isPublicHttpsUrl(u));
  const mailtoUrl = urls.find(u => u.startsWith('mailto:'));

  if (httpsUrl && hasOneClick) return { type: 'one-click', url: httpsUrl };
  if (mailtoUrl) return { type: 'mailto', url: mailtoUrl };
  return null;
}
