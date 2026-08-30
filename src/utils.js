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
