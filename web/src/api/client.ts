// ---- 型定義 ----

export interface Folder {
  id: number;
  name: string;
  feedCount: number;
}

export interface Feed {
  id: number;
  title: string;
  url: string;
  siteUrl: string | null;
  folder: string | null;
  articleCount: number;
}

export interface Article {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  url: string;
  author: string | null;
  content: string;
  publishedAt: string | null; // ISO8601
}

export interface ArticleListResponse {
  items: Article[];
  total: number;
}

export interface ArticleQuery {
  folderId?: number;
  feedId?: number;
  q?: string;
  limit?: number;
  offset?: number;
}

// ---- fetch ラッパ ----

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ---- API 関数 ----

export const api = {
  // フォルダ一覧
  getFolders(): Promise<Folder[]> {
    return request('/api/folders');
  },

  // フォルダ追加
  createFolder(name: string): Promise<Folder> {
    return request('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  // フィード一覧
  getFeeds(): Promise<Feed[]> {
    return request('/api/feeds');
  },

  // フィード追加
  createFeed(url: string, folder?: string | null): Promise<Feed> {
    return request('/api/feeds', {
      method: 'POST',
      body: JSON.stringify({ url, folder }),
    });
  },

  // フィード削除
  deleteFeed(id: number): Promise<void> {
    return request(`/api/feeds/${id}`, { method: 'DELETE' });
  },

  // 記事一覧
  getArticles(query: ArticleQuery = {}): Promise<ArticleListResponse> {
    const params = new URLSearchParams();
    if (query.folderId != null) params.set('folderId', String(query.folderId));
    if (query.feedId != null) params.set('feedId', String(query.feedId));
    if (query.q) params.set('q', query.q);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));
    const qs = params.toString();
    return request(`/api/articles${qs ? `?${qs}` : ''}`);
  },

  // 更新（全件 or 特定フィード）
  refresh(feedId?: number): Promise<{ refreshed: number }> {
    const qs = feedId != null ? `?feedId=${feedId}` : '';
    return request(`/api/refresh${qs}`, { method: 'POST' });
  },
};
