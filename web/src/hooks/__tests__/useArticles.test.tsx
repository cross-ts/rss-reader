import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useArticles } from '../useArticles';
import { api } from '../../api/client';
import { makeArticle } from '../../test/factories';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useArticles', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pages with offset, flattens and dedupes by id', async () => {
    const spy = vi
      .spyOn(api, 'getArticles')
      .mockResolvedValueOnce({ items: [makeArticle(1), makeArticle(2)], total: 4 })
      .mockResolvedValueOnce({ items: [makeArticle(2), makeArticle(3)], total: 4 });
    const { result } = renderHook(() => useArticles('foo'), { wrapper });
    await waitFor(() => expect(result.current.articles.map((a) => a.id)).toEqual([1, 2]));
    expect(spy).toHaveBeenLastCalledWith({ q: 'foo', limit: 30, offset: 0 });
    expect(result.current.hasNextPage).toBe(true);

    act(() => {
      void result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.articles).toHaveLength(3));
    expect(spy).toHaveBeenLastCalledWith({ q: 'foo', limit: 30, offset: 2 });
    expect(result.current.articles.map((a) => a.id)).toEqual([1, 2, 3]);
    // 4 items loaded (with one duplicate) >= total -> no more pages
    expect(result.current.hasNextPage).toBe(false);
  });

  it('omits q when empty', async () => {
    const spy = vi.spyOn(api, 'getArticles').mockResolvedValue({ items: [], total: 0 });
    const { result } = renderHook(() => useArticles(''), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ q: undefined, limit: 30, offset: 0 });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('unreadOnly offsets by the loaded articles that are still unread', async () => {
    const spy = vi
      .spyOn(api, 'getArticles')
      .mockResolvedValueOnce({ items: [makeArticle(1), makeArticle(2, { isRead: true }), makeArticle(3)], total: 5 })
      .mockResolvedValueOnce({ items: [makeArticle(4)], total: 3 });
    const { result } = renderHook(() => useArticles('', { unreadOnly: true }), { wrapper });
    await waitFor(() => expect(result.current.articles).toHaveLength(3));
    expect(spy).toHaveBeenLastCalledWith({ q: undefined, unreadOnly: true, limit: 30, offset: 0 });
    act(() => {
      void result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.articles).toHaveLength(4));
    // 2 は既読になってサーバーの未読リストから外れているので offset は 2
    expect(spy).toHaveBeenLastCalledWith({ q: undefined, unreadOnly: true, limit: 30, offset: 2 });
  });
});
