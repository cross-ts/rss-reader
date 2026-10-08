import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSetRead, useRefresh } from '../useArticleMutations';
import { api, type ArticleListResponse } from '../../api/client';
import { makeArticle } from '../../test/factories';

const toastSpy = vi.fn();
vi.mock('../../components/Toast', () => ({ useToast: () => toastSpy }));

const seed = (): InfiniteData<ArticleListResponse> => ({
  pages: [{ items: [makeArticle(1), makeArticle(2)], total: 2 }],
  pageParams: [0],
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['articles', ''], seed());
  qc.setQueryData(['articles', 'q'], seed());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const isRead = (key: string, id: number) =>
    qc.getQueryData<InfiniteData<ArticleListResponse>>(['articles', key])!.pages[0].items.find((a) => a.id === id)!
      .isRead;
  return { qc, wrapper, isRead };
}

describe('useSetRead', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastSpy.mockClear();
  });

  it('optimistically updates every articles cache', async () => {
    const { wrapper, isRead } = setup();
    let resolve!: () => void;
    vi.spyOn(api, 'updateArticle').mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const { result } = renderHook(() => useSetRead(), { wrapper });
    act(() => result.current(1, true));
    await waitFor(() => expect(isRead('', 1)).toBe(true));
    expect(isRead('q', 1)).toBe(true);
    expect(isRead('', 2)).toBe(false);
    expect(api.updateArticle).toHaveBeenCalledWith(1, { isRead: true });
    resolve();
  });

  it('rolls back and toasts on error', async () => {
    const { wrapper, isRead } = setup();
    vi.spyOn(api, 'updateArticle').mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useSetRead(), { wrapper });
    act(() => result.current(1, true));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('更新に失敗しました'));
    expect(isRead('', 1)).toBe(false);
    expect(isRead('q', 1)).toBe(false);
  });
});

describe('useRefresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastSpy.mockClear();
  });

  it('trims to the first page without dropping data, refetches it and toasts the new count', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    vi.spyOn(api, 'getArticles').mockResolvedValue({ items: [makeArticle(9), makeArticle(1)], total: 3 });
    // 2 ページ分をキャッシュに積む（observer が無いので invalidate では refetch されない点に注意）
    qc.setQueryData<InfiniteData<ArticleListResponse>>(['articles', ''], {
      pages: [
        { items: [makeArticle(1)], total: 3 },
        { items: [makeArticle(2)], total: 3 },
      ],
      pageParams: [0, 1],
    });
    vi.spyOn(api, 'refresh').mockResolvedValue({ refreshed: 1 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRefresh(), { wrapper });
    // 購読者を付けて active にする（staleTime が無限なのでマウントでは取得しない）
    const { useArticles } = await import('../useArticles');
    renderHook(() => useArticles(''), { wrapper });
    await act(async () => {
      await result.current();
    });
    const data = qc.getQueryData<InfiniteData<ArticleListResponse>>(['articles', ''])!;
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].items.map((a) => a.id)).toEqual([9, 1]);
    expect(toastSpy).toHaveBeenCalledWith('1 件の新着');
  });
});
