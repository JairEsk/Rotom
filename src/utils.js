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
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

export function isValidPublicHttpsUrl(urlString) {
  if (typeof urlString !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;

  let hostname = parsed.hostname.toLowerCase();
  if (!hostname) return false;
  hostname = hostname.replace(/\.$/, '');

  // Reject localhost and local/internal/reserved domain suffixes
  const reservedSuffixes = [
    'localhost',
    'local',
    'internal',
    'lan',
    'home.arpa',
    'test',
    'example',
    'invalid',
    'onion',
    'alt',
    'nip.io',
    'sslip.io',
    'xip.io',
    'localtest.me'
  ];

  if (reservedSuffixes.some(s => hostname === s || hostname.endsWith('.' + s))) {
    return false;
  }

  // Reject IPv6 literals
  if (hostname.startsWith('[') || hostname.includes(':')) {
    return false;
  }

  // Check IPv4 addresses and block private / loopback / link-local / broadcast ranges
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);
    if (octets.some(o => o < 0 || o > 255)) return false;

    const [o0, o1] = octets;
    if (o0 === 0 || o0 === 10 || o0 === 127 || o0 >= 224) return false;
    if (o0 === 169 && o1 === 254) return false; // 169.254.0.0/16 Link-local / Cloud metadata
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return false; // 172.16.0.0/12 Private
    if (o0 === 192 && o1 === 168) return false; // 192.168.0.0/16 Private
    if (o0 === 100 && o1 >= 64 && o1 <= 127) return false; // 100.64.0.0/10 Carrier-grade NAT
    if (o0 === 192 && o1 === 0) return false; // 192.0.0.0/24, 192.0.2.0/24
    if (o0 === 198 && (o1 === 18 || o1 === 19 || o1 === 51)) return false; // Benchmark & TEST-NET-2
    if (o0 === 203 && o1 === 0) return false; // TEST-NET-3

    return true;
  }

  // Reject single-label hostnames without a dot (e.g. intranet)
  if (!hostname.includes('.')) return false;

  // Domain regex check (standard RFC hostname format)
  const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  return domainRegex.test(hostname);
}

// --- Unsubscribe: parse List-Unsubscribe & List-Unsubscribe-Post headers ----
export function parseUnsubscribeHeader(headers) {
  if (!Array.isArray(headers)) return null;
  let rawValue = '';
  let hasOneClick = false;

  headers.forEach(header => {
    if (!header || !header.name) return;
    const name = header.name.toLowerCase();
    if (name === 'list-unsubscribe' && typeof header.value === 'string') {
      rawValue = header.value;
    }
    if (name === 'list-unsubscribe-post' && typeof header.value === 'string') {
      // RFC 8058 requires the exact key-value pair List-Unsubscribe=One-Click
      if (/^\s*List-Unsubscribe\s*=\s*One-Click\s*$/i.test(header.value)) {
        hasOneClick = true;
      }
    }
  });

  if (!rawValue) return null;

  const urls = rawValue.match(/<([^>]+)>/g)?.map(m => m.slice(1, -1)) || [];
  const httpsUrl = urls.find(u => u.startsWith('https://'));
  const mailtoUrl = urls.find(u => u.startsWith('mailto:'));

  if (httpsUrl && hasOneClick) return { type: 'one-click', url: httpsUrl };
  if (mailtoUrl) return { type: 'mailto', url: mailtoUrl };
  if (httpsUrl) return { type: 'https', url: httpsUrl };
  return null;
}