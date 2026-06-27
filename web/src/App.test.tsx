import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const apiMock = vi.hoisted(() => ({
  getArticles: vi.fn(),
  getFeeds: vi.fn(),
  getFolders: vi.fn(),
  getUnreadCounts: vi.fn(),
  refresh: vi.fn(),
  updateArticle: vi.fn(),
  markArticlesRead: vi.fn(),
  createFeed: vi.fn(),
  createFolder: vi.fn(),
  deleteFeed: vi.fn(),
  deleteFolder: vi.fn(),
  discoverFeed: vi.fn(),
}));

vi.mock('./api/client', () => ({
  api: apiMock,
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1440,
    });

    apiMock.getArticles.mockResolvedValue({ items: [], total: 0 });
    apiMock.getFeeds.mockResolvedValue([
      {
        id: 2,
        title: 'AWS Feed',
        url: 'https://example.com/feed.xml',
        siteUrl: 'https://example.com',
        folder: 'Tech',
        articleCount: 0,
      },
    ]);
    apiMock.getFolders.mockResolvedValue([
      { id: 1, name: 'Tech', feedCount: 1 },
    ]);
    apiMock.getUnreadCounts.mockResolvedValue({
      total: 0,
      feeds: { '2': 0 },
      folders: { '1': 0 },
    });
    apiMock.refresh.mockResolvedValue({ refreshed: 0 });
    apiMock.updateArticle.mockResolvedValue(undefined);
    apiMock.markArticlesRead.mockResolvedValue({ updated: 0 });
    apiMock.createFeed.mockResolvedValue({
      id: 3,
      title: 'New Feed',
      url: 'https://example.com/new.xml',
      siteUrl: 'https://example.com',
      folder: null,
      articleCount: 0,
    });
    apiMock.createFolder.mockResolvedValue({ id: 3, name: 'New Folder', feedCount: 0 });
    apiMock.deleteFeed.mockResolvedValue(undefined);
    apiMock.deleteFolder.mockResolvedValue(undefined);
    apiMock.discoverFeed.mockResolvedValue({
      feedUrl: 'https://example.com/feed.xml',
      title: 'Example Feed',
    });
  });

  it('clears the search text when the sidebar selection changes', async () => {
    render(<App />);

    const searchInput = await screen.findByRole('textbox', { name: 'Search articles' });
    await screen.findByRole('button', { name: 'Tech' });

    fireEvent.change(searchInput, { target: { value: 'aws' } });
    expect((searchInput as HTMLInputElement).value).toBe('aws');

    fireEvent.click(screen.getByRole('button', { name: 'Tech' }));
    expect((searchInput as HTMLInputElement).value).toBe('');
  });
});
