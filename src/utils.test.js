import { describe, it, expect } from 'vitest';
import { formatBytes, formatDate } from './utils.js';

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
});
