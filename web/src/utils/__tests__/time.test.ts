import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDate } from '../time';

describe('formatDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 日時不明 for null / empty / invalid', () => {
    expect(formatDate(null)).toBe('日時不明');
    expect(formatDate('')).toBe('日時不明');
    expect(formatDate('not-a-date')).toBe('日時不明');
  });

  it('returns at least 1分前 (including future dates)', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T12:00:10Z') });
    expect(formatDate('2024-06-01T12:00:00Z')).toBe('1分前');
    expect(formatDate('2024-06-01T13:00:00Z')).toBe('1分前');
  });

  it('returns N分前 under an hour', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T12:59:00Z') });
    expect(formatDate('2024-06-01T12:00:00Z')).toBe('59分前');
  });

  it('returns N時間前 under a day', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T13:00:00Z') });
    expect(formatDate('2024-06-01T12:00:00Z')).toBe('1時間前');
    vi.setSystemTime(new Date('2024-06-02T11:00:00Z'));
    expect(formatDate('2024-06-01T12:00:00Z')).toBe('23時間前');
  });

  it('returns M月D日 within the same year', () => {
    vi.useFakeTimers({ now: new Date('2024-12-15T12:00:00') });
    expect(formatDate(new Date('2024-06-01T12:00:00').toISOString())).toBe('6月1日');
  });

  it('returns YYYY年M月D日 for other years', () => {
    vi.useFakeTimers({ now: new Date('2025-07-01T12:00:00') });
    expect(formatDate(new Date('2024-06-01T12:00:00').toISOString())).toBe('2024年6月1日');
  });
});
