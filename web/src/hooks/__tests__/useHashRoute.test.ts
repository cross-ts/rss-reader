import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { parseHash, useHashRoute } from '../useHashRoute';

describe('parseHash', () => {
  it('defaults to / for empty and unknown paths', () => {
    expect(parseHash('').path).toBe('/');
    expect(parseHash('#/nope').path).toBe('/');
  });

  it('parses known paths and query params', () => {
    expect(parseHash('#/subscriptions').path).toBe('/subscriptions');
    const r = parseHash('#/search?q=a%20b');
    expect(r.path).toBe('/search');
    expect(r.params.get('q')).toBe('a b');
    expect(r.rawHash).toBe('/search?q=a%20b');
  });
});

describe('useHashRoute', () => {
  beforeEach(() => {
    location.hash = '';
    window.scrollTo = vi.fn();
  });

  it('follows hashchange and scrolls to top', () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.path).toBe('/');
    act(() => {
      location.hash = '#/search?q=x';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.path).toBe('/search');
    expect(result.current.params.get('q')).toBe('x');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('does not change on replaceState', () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => {
      history.replaceState(null, '', '#/subscriptions');
    });
    expect(result.current.path).toBe('/');
  });
});
