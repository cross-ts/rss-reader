// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedState } from '../usePersistedState';

// Node 26 has an experimental `localStorage` getter on globalThis that returns
// undefined and shadows jsdom's implementation. jsdom 29 stores the real
// Storage object as `_localStorage`. We also need to patch `localStorage` on
// globalThis so that the hook's calls to `localStorage.getItem/setItem` work.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsdomStorage = (window as any)._localStorage as Storage;

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: jsdomStorage,
    writable: true,
    configurable: true,
  });
});

describe('usePersistedState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaultValue when localStorage is empty', () => {
    const { result } = renderHook(() => usePersistedState('key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('reads existing value from localStorage on init', () => {
    localStorage.setItem('key', JSON.stringify('stored'));

    const { result } = renderHook(() => usePersistedState('key', 'default'));
    expect(result.current[0]).toBe('stored');
  });

  it('reads complex objects from localStorage', () => {
    const obj = { a: 1, b: [2, 3] };
    localStorage.setItem('obj-key', JSON.stringify(obj));

    const { result } = renderHook(() => usePersistedState('obj-key', {}));
    expect(result.current[0]).toEqual(obj);
  });

  it('writes to localStorage when value changes', () => {
    const { result } = renderHook(() => usePersistedState('key', 'initial'));

    act(() => {
      result.current[1]('updated');
    });

    expect(result.current[0]).toBe('updated');
    expect(localStorage.getItem('key')).toBe(JSON.stringify('updated'));
  });

  it('writes the initial default value to localStorage on mount', () => {
    renderHook(() => usePersistedState('key', 'default'));

    expect(localStorage.getItem('key')).toBe(JSON.stringify('default'));
  });

  it('handles invalid JSON in localStorage gracefully', () => {
    localStorage.setItem('key', 'not valid json{{{');

    const { result } = renderHook(() => usePersistedState('key', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('handles localStorage.getItem throwing an error', () => {
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage access denied');
    });

    const { result } = renderHook(() => usePersistedState('key', 'fallback'));
    expect(result.current[0]).toBe('fallback');

    spy.mockRestore();
  });

  it('handles localStorage.setItem throwing an error without crashing', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = renderHook(() => usePersistedState('key', 'value'));

    // Should still work in-memory even if persist fails
    act(() => {
      result.current[1]('new-value');
    });
    expect(result.current[0]).toBe('new-value');

    spy.mockRestore();
  });

  it('supports boolean values', () => {
    const { result } = renderHook(() => usePersistedState('bool', false));

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('bool')).toBe('true');
  });

  it('supports functional updates via setState', () => {
    const { result } = renderHook(() => usePersistedState('count', 0));

    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(1);
    expect(localStorage.getItem('count')).toBe('1');
  });
});
