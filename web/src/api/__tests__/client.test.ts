import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../client';

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('request wrapper', () => {
    it('throws on non-ok response with error text', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as Response);

      await expect(api.getFolders()).rejects.toThrow('HTTP 500: Internal Server Error');
    });

    it('throws on non-ok response when text() fails', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('fail')),
      } as Response);

      await expect(api.getFolders()).rejects.toThrow('HTTP 500: ');
    });

    it('returns undefined for 204 status', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse(null, 204));
      const result = await api.deleteFeed(1);
      expect(result).toBeUndefined();
    });

    it('sets Content-Type header to application/json', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse([]));
      await api.getFolders();
      expect(fetch).toHaveBeenCalledWith('/api/folders', {
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('getFolders', () => {
    it('calls GET /api/folders', async () => {
      const folders = [{ id: 1, name: 'Tech', feedCount: 3 }];
      vi.mocked(fetch).mockResolvedValue(mockResponse(folders));
      const result = await api.getFolders();
      expect(fetch).toHaveBeenCalledWith('/api/folders', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(folders);
    });
  });

  describe('createFolder', () => {
    it('calls POST /api/folders with name', async () => {
      const folder = { id: 1, name: 'Tech', feedCount: 0 };
      vi.mocked(fetch).mockResolvedValue(mockResponse(folder));
      const result = await api.createFolder('Tech');
      expect(fetch).toHaveBeenCalledWith('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Tech' }),
      });
      expect(result).toEqual(folder);
    });
  });

  describe('deleteFolder', () => {
    it('calls DELETE /api/folders/:id', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse(null, 204));
      await api.deleteFolder(5);
      expect(fetch).toHaveBeenCalledWith('/api/folders/5', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('getFeeds', () => {
    it('calls GET /api/feeds', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse([]));
      await api.getFeeds();
      expect(fetch).toHaveBeenCalledWith('/api/feeds', {
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('createFeed', () => {
    it('calls POST /api/feeds with url and folder', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ id: 1 }));
      await api.createFeed('https://example.com/feed', 'Tech');
      expect(fetch).toHaveBeenCalledWith('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/feed', folder: 'Tech' }),
      });
    });

    it('calls POST /api/feeds with url only (no folder)', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ id: 1 }));
      await api.createFeed('https://example.com/feed');
      expect(fetch).toHaveBeenCalledWith('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/feed' }),
      });
    });
  });

  describe('deleteFeed', () => {
    it('calls DELETE /api/feeds/:id', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse(null, 204));
      await api.deleteFeed(3);
      expect(fetch).toHaveBeenCalledWith('/api/feeds/3', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('discoverFeed', () => {
    it('calls POST /api/feeds/discover with url', async () => {
      const candidates = [{ feedUrl: 'https://example.com/rss', title: 'Blog' }];
      vi.mocked(fetch).mockResolvedValue(mockResponse(candidates));
      const result = await api.discoverFeed('https://example.com');
      expect(fetch).toHaveBeenCalledWith('/api/feeds/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      expect(result).toEqual(candidates);
    });
  });

  describe('getArticles', () => {
    it('calls GET /api/articles with no query params by default', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ items: [], total: 0 }));
      await api.getArticles();
      expect(fetch).toHaveBeenCalledWith('/api/articles', {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('builds query string from all params', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ items: [], total: 0 }));
      await api.getArticles({ folderId: 1, feedId: 2, q: 'test', limit: 10, offset: 20 });
      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/api/articles?');
      const params = new URLSearchParams(calledUrl.split('?')[1]);
      expect(params.get('folderId')).toBe('1');
      expect(params.get('feedId')).toBe('2');
      expect(params.get('q')).toBe('test');
      expect(params.get('limit')).toBe('10');
      expect(params.get('offset')).toBe('20');
    });

    it('omits undefined query params', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ items: [], total: 0 }));
      await api.getArticles({ feedId: 5 });
      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      const params = new URLSearchParams(calledUrl.split('?')[1]);
      expect(params.get('feedId')).toBe('5');
      expect(params.has('folderId')).toBe(false);
      expect(params.has('q')).toBe(false);
    });
  });

  describe('updateArticle', () => {
    it('calls PATCH /api/articles/:id with patch body', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse(null, 204));
      await api.updateArticle(42, { isRead: true, starred: false });
      expect(fetch).toHaveBeenCalledWith('/api/articles/42', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true, starred: false }),
      });
    });
  });

  describe('markArticlesRead', () => {
    it('calls POST /api/articles/mark-read with articleIds', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ updated: 3 }));
      const result = await api.markArticlesRead([1, 2, 3]);
      expect(fetch).toHaveBeenCalledWith('/api/articles/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleIds: [1, 2, 3] }),
      });
      expect(result).toEqual({ updated: 3 });
    });
  });

  describe('refresh', () => {
    it('calls POST /api/refresh without feedId', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ refreshed: 5 }));
      await api.refresh();
      expect(fetch).toHaveBeenCalledWith('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('calls POST /api/refresh?feedId=3 with feedId', async () => {
      vi.mocked(fetch).mockResolvedValue(mockResponse({ refreshed: 1 }));
      await api.refresh(3);
      expect(fetch).toHaveBeenCalledWith('/api/refresh?feedId=3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('getUnreadCounts', () => {
    it('calls GET /api/unread-counts', async () => {
      const counts = { total: 10, feeds: { '1': 5 }, folders: { '2': 5 } };
      vi.mocked(fetch).mockResolvedValue(mockResponse(counts));
      const result = await api.getUnreadCounts();
      expect(fetch).toHaveBeenCalledWith('/api/unread-counts', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(counts);
    });
  });
});
