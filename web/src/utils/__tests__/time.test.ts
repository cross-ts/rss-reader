import { describe, it, expect, vi, afterEach } from 'vitest';
import { relativeTime } from '../time';

describe('relativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for null', () => {
    expect(relativeTime(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(relativeTime('')).toBe('');
  });

  it('returns "just now" for future dates', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T12:00:00Z') });
    expect(relativeTime('2024-06-01T13:00:00Z')).toBe('just now');
  });

  it('returns "just now" for less than 1 minute ago', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T12:00:30Z') });
    expect(relativeTime('2024-06-01T12:00:00Z')).toBe('just now');
  });

  it('returns "1m ago" for exactly 1 minute', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T12:01:00Z') });
    expect(relativeTime('2024-06-01T12:00:00Z')).toBe('1m ago');
  });

  it('returns "59m ago" for 59 minutes', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T12:59:00Z') });
    expect(relativeTime('2024-06-01T12:00:00Z')).toBe('59m ago');
  });

  it('returns "1h ago" for 60 minutes', () => {
    vi.useFakeTimers({ now: new Date('2024-06-01T13:00:00Z') });
    expect(relativeTime('2024-06-01T12:00:00Z')).toBe('1h ago');
  });

  it('returns "23h ago" for 23 hours', () => {
    vi.useFakeTimers({ now: new Date('2024-06-02T11:00:00Z') });
    expect(relativeTime('2024-06-01T12:00:00Z')).toBe('23h ago');
  });

  it('returns "1d ago" for 24 hours', () => {
    vi.useFakeTimers({ now: new Date('2024-06-02T12:00:00Z') });
    expect(relativeTime('2024-06-01T12:00:00Z')).toBe('1d ago');
  });

  it('returns "6d ago" for 6 days', () => {
    vi.useFakeTimers({ now: new Date('2024-06-07T12:00:00Z') });
    expect(relativeTime('2024-06-01T12:00:00Z')).toBe('6d ago');
  });

  it('returns "Mon DD" format for 7+ days but less than 365', () => {
    vi.useFakeTimers({ now: new Date('2024-06-15T12:00:00Z') });
    const result = relativeTime('2024-06-01T12:00:00Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('returns "Mon DD, YYYY" format for 365+ days', () => {
    vi.useFakeTimers({ now: new Date('2025-07-01T12:00:00Z') });
    const result = relativeTime('2024-06-01T12:00:00Z');
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  it('returns empty string for invalid date strings', () => {
    expect(relativeTime('not-a-date')).toBe('');
  });

  it('returns empty string for garbage input', () => {
    expect(relativeTime('xyz')).toBe('');
  });
});
