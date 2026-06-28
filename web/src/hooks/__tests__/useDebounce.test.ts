import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from '../useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 500));
    expect(result.current).toBe('hello');
  });

  it('returns empty string immediately without delay', () => {
    const { result } = renderHook(() => useDebounce('', 500));
    expect(result.current).toBe('');
  });

  it('updates to empty string immediately when value becomes empty', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'hello', delay: 500 } },
    );

    expect(result.current).toBe('hello');

    rerender({ value: '', delay: 500 });

    // Empty string should be set immediately, no need to advance timers
    expect(result.current).toBe('');
  });

  it('debounces non-empty values after the specified delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: '', delay: 300 } },
    );

    rerender({ value: 'search', delay: 300 });

    // Before the delay, debounced value should still be empty
    expect(result.current).toBe('');

    // Advance time partially — still not updated
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('');

    // Advance past the delay
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('search');
  });

  it('clears the previous timer when value changes before delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: '', delay: 300 } },
    );

    rerender({ value: 'abc', delay: 300 });

    // Advance partway
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('');

    // Change value before delay finishes — should reset timer
    rerender({ value: 'abcdef', delay: 300 });

    // Advance past the original delay but not the new one
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('');

    // Now advance past the new timer
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('abcdef');
  });

  it('resets timer when delay changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'test', delay: 500 } },
    );

    // The initial value is set via useState, so it's 'test' immediately
    expect(result.current).toBe('test');

    // Change to a new value
    rerender({ value: 'updated', delay: 500 });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('test');

    // Change delay — effect re-runs with new timer
    rerender({ value: 'updated', delay: 200 });

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('updated');
  });
});
