import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useArticleMutations } from '../useArticleMutations';
import { api, type Article, type ArticleListResponse } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: {
    updateArticle: vi.fn(),
    markArticlesRead: vi.fn(),
  },
}));

const mockUpdateArticle = vi.mocked(api.updateArticle);
const mockMarkArticlesRead = vi.mocked(api.markArticlesRead);

function createArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 1,
    feedId: 1,
    feedTitle: 'Test Feed',
    title: 'Test Article',
    url: 'https://example.com/article',
    author: null,
    content: '<p>Content</p>',
    publishedAt: '2024-01-01T00:00:00Z',
    isRead: false,
    readAt: null,
    starred: false,
    ...overrides,
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function seedArticlesCache(
  queryClient: QueryClient,
  articles: Article[],
): void {
  queryClient.setQueryData<ArticleListResponse>(['articles'], {
    items: articles,
    total: articles.length,
  });
}

describe('useArticleMutations', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    vi.resetAllMocks();
    mockUpdateArticle.mockResolvedValue(undefined);
    mockMarkArticlesRead.mockResolvedValue({ updated: 1 });
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('markRead', () => {
    it('calls api.updateArticle with isRead: true', async () => {
      const article = createArticle({ id: 42 });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.markRead(42);
      });

      await waitFor(() => {
        expect(mockUpdateArticle).toHaveBeenCalledWith(42, { isRead: true });
      });
    });

    it('optimistically updates the article cache to isRead: true', async () => {
      const article = createArticle({ id: 1, isRead: false });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.markRead(1);
      });

      await waitFor(() => {
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].isRead).toBe(true);
        expect(cached?.items[0].readAt).toBeTruthy();
      });
    });

    it('rolls back on API error', async () => {
      mockUpdateArticle.mockRejectedValueOnce(new Error('Network error'));

      const article = createArticle({ id: 1, isRead: false, readAt: null });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.markRead(1);
      });

      await waitFor(() => {
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].isRead).toBe(false);
        expect(cached?.items[0].readAt).toBeNull();
      });
    });
  });

  describe('toggleRead', () => {
    it('toggles from unread to read', async () => {
      const article = createArticle({ id: 1, isRead: false });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.toggleRead(1, false);
      });

      await waitFor(() => {
        expect(mockUpdateArticle).toHaveBeenCalledWith(1, { isRead: true });
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].isRead).toBe(true);
        expect(cached?.items[0].readAt).toBeTruthy();
      });
    });

    it('toggles from read to unread', async () => {
      const article = createArticle({
        id: 1,
        isRead: true,
        readAt: '2024-01-01T00:00:00Z',
      });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.toggleRead(1, true);
      });

      await waitFor(() => {
        expect(mockUpdateArticle).toHaveBeenCalledWith(1, { isRead: false });
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].isRead).toBe(false);
        expect(cached?.items[0].readAt).toBeNull();
      });
    });

    it('rolls back on error', async () => {
      mockUpdateArticle.mockRejectedValueOnce(new Error('fail'));

      const article = createArticle({ id: 1, isRead: false, readAt: null });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.toggleRead(1, false);
      });

      await waitFor(() => {
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].isRead).toBe(false);
        expect(cached?.items[0].readAt).toBeNull();
      });
    });
  });

  describe('markAllRead', () => {
    it('calls api.markArticlesRead with the given ids', async () => {
      const articles = [
        createArticle({ id: 1, isRead: false }),
        createArticle({ id: 2, isRead: false }),
        createArticle({ id: 3, isRead: true }),
      ];
      seedArticlesCache(queryClient, articles);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.markAllRead([1, 2]);
      });

      await waitFor(() => {
        expect(mockMarkArticlesRead).toHaveBeenCalledWith([1, 2]);
      });
    });

    it('optimistically marks specified articles as read', async () => {
      const articles = [
        createArticle({ id: 1, isRead: false }),
        createArticle({ id: 2, isRead: false }),
        createArticle({ id: 3, isRead: false }),
      ];
      seedArticlesCache(queryClient, articles);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.markAllRead([1, 3]);
      });

      await waitFor(() => {
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].isRead).toBe(true);
        expect(cached?.items[0].readAt).toBeTruthy();
        // id=2 should remain unread
        expect(cached?.items[1].isRead).toBe(false);
        expect(cached?.items[2].isRead).toBe(true);
        expect(cached?.items[2].readAt).toBeTruthy();
      });
    });

    it('rolls back all changes on error', async () => {
      mockMarkArticlesRead.mockRejectedValueOnce(new Error('fail'));

      const articles = [
        createArticle({ id: 1, isRead: false, readAt: null }),
        createArticle({ id: 2, isRead: false, readAt: null }),
      ];
      seedArticlesCache(queryClient, articles);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.markAllRead([1, 2]);
      });

      await waitFor(() => {
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].isRead).toBe(false);
        expect(cached?.items[1].isRead).toBe(false);
      });
    });
  });

  describe('toggleStarred', () => {
    it('toggles starred from false to true', async () => {
      const article = createArticle({ id: 1, starred: false });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.toggleStarred(1, false);
      });

      await waitFor(() => {
        expect(mockUpdateArticle).toHaveBeenCalledWith(1, { starred: true });
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].starred).toBe(true);
      });
    });

    it('toggles starred from true to false', async () => {
      const article = createArticle({ id: 1, starred: true });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.toggleStarred(1, true);
      });

      await waitFor(() => {
        expect(mockUpdateArticle).toHaveBeenCalledWith(1, { starred: false });
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].starred).toBe(false);
      });
    });

    it('rolls back on error', async () => {
      mockUpdateArticle.mockRejectedValueOnce(new Error('fail'));

      const article = createArticle({ id: 1, starred: false });
      seedArticlesCache(queryClient, [article]);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.toggleStarred(1, false);
      });

      await waitFor(() => {
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].starred).toBe(false);
      });
    });

    it('does not affect other articles in cache', async () => {
      const articles = [
        createArticle({ id: 1, starred: false }),
        createArticle({ id: 2, starred: true }),
      ];
      seedArticlesCache(queryClient, articles);

      const { result } = renderHook(() => useArticleMutations(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.toggleStarred(1, false);
      });

      await waitFor(() => {
        const cached =
          queryClient.getQueryData<ArticleListResponse>(['articles']);
        expect(cached?.items[0].starred).toBe(true);
        // Article 2 should be unchanged
        expect(cached?.items[1].starred).toBe(true);
      });
    });
  });
});
