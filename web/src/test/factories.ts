import type { Article } from '../api/client';

export function makeArticle(id: number, over: Partial<Article> = {}): Article {
  return {
    id,
    feedId: 1,
    feedTitle: 'Feed',
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    author: null,
    content: '<p>body</p>',
    publishedAt: '2024-06-01T00:00:00Z',
    isRead: false,
    readAt: null,
    ...over,
  };
}
