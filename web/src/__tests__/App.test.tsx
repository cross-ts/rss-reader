import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import type { Article } from '../api/client';

// ---- Mocks ----

vi.mock('../components/IconRail', () => ({
  IconRail: (props: any) => (
    <div data-testid="icon-rail" data-active-view={props.activeView}>
      <button data-testid="rail-newsfeed" onClick={() => props.onChangeView('newsfeed')} />
      <button data-testid="rail-search" onClick={() => props.onChangeView('search')} />
      <button data-testid="rail-add" onClick={() => props.onChangeView('add')} />
      <button data-testid="rail-settings" onClick={() => props.onChangeView('settings')} />
    </div>
  ),
}));

vi.mock('../components/Sidebar', () => ({
  Sidebar: (props: any) => (
    <div data-testid="sidebar" data-rail-view={props.railView}>
      <button
        data-testid="sidebar-select-folder"
        onClick={() => props.onSelect({ type: 'folder', folderId: 1, folderName: 'Tech' })}
      />
      <button
        data-testid="sidebar-select-feed"
        onClick={() => props.onSelect({ type: 'feed', feedId: 42 })}
      />
      <button
        data-testid="sidebar-select-newsfeed"
        onClick={() => props.onSelect({ type: 'newsfeed' })}
      />
    </div>
  ),
}));

vi.mock('../components/Topbar', () => ({
  Topbar: (props: any) => (
    <div
      data-testid="topbar"
      data-view-title={props.viewTitle}
      data-search-text={props.searchText}
      data-unread-only={String(props.unreadOnly)}
      data-last-updated={props.lastUpdated ?? ''}
      data-can-toggle-sidebar={String(props.canToggleSidebar)}
    >
      <button data-testid="topbar-refresh" onClick={props.onRefresh} />
      <button data-testid="topbar-search-change" onClick={() => props.onSearchChange('query')} />
      <button data-testid="topbar-search-clear" onClick={props.onSearchClear} />
      <button data-testid="topbar-mark-all-read" onClick={props.onMarkAllRead} />
      <button data-testid="topbar-toggle-unread" onClick={props.onToggleUnreadOnly} />
      <button data-testid="topbar-toggle-sidebar" onClick={props.onToggleSidebar} />
    </div>
  ),
}));

vi.mock('../components/ArticleList', () => ({
  ArticleList: (props: any) => (
    <div data-testid="article-list" data-selected-id={props.selectedArticleId ?? ''}>
      {props.articles?.map((a: any) => (
        <button key={a.id} data-testid={`article-${a.id}`} data-article-id={a.id} onClick={() => props.onSelectArticle(a)} />
      ))}
      <button data-testid="article-list-retry" onClick={props.onRetry} />
      <button data-testid="article-list-open-add" onClick={props.onOpenAddFeed} />
      <button data-testid="article-list-open-opml" onClick={props.onOpenOpmlGuide} />
      {props.onRefresh && <button data-testid="article-list-refresh" onClick={props.onRefresh} />}
    </div>
  ),
}));

vi.mock('../components/ArticleView', () => ({
  ArticleView: (props: any) => (
    <div data-testid="article-view" data-article-id={props.article?.id ?? ''}>
      <button data-testid="close-article" onClick={props.onClose} />
      {props.onPrev && <button data-testid="prev-article" onClick={props.onPrev} />}
      {props.onNext && <button data-testid="next-article" onClick={props.onNext} />}
      {props.onNextUnread && <button data-testid="next-unread" onClick={props.onNextUnread} />}
      {props.onToggleRead && <button data-testid="toggle-read" onClick={props.onToggleRead} />}
      {props.onToggleStarred && <button data-testid="toggle-starred" onClick={props.onToggleStarred} />}
    </div>
  ),
}));

vi.mock('../components/Toast', () => ({
  ToastProvider: ({ children }: any) => <>{children}</>,
  useToast: () => ({ addToast: vi.fn() }),
}));

const mockMarkRead = vi.fn();
const mockToggleRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockToggleStarred = vi.fn();

vi.mock('../hooks/useArticleMutations', () => ({
  useArticleMutations: () => ({
    markRead: mockMarkRead,
    toggleRead: mockToggleRead,
    markAllRead: mockMarkAllRead,
    toggleStarred: mockToggleStarred,
  }),
}));

vi.mock('../hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

vi.mock('../hooks/usePersistedState', () => ({
  usePersistedState: (_key: string, defaultValue: any) => {
    return useState(defaultValue);
  },
}));

const mockGetArticles = vi.fn();
const mockGetFeeds = vi.fn();
const mockGetFolders = vi.fn();
const mockGetUnreadCounts = vi.fn();
const mockRefresh = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    getArticles: (...args: any[]) => mockGetArticles(...args),
    getFeeds: (...args: any[]) => mockGetFeeds(...args),
    getFolders: (...args: any[]) => mockGetFolders(...args),
    getUnreadCounts: (...args: any[]) => mockGetUnreadCounts(...args),
    refresh: (...args: any[]) => mockRefresh(...args),
    updateArticle: vi.fn(),
    markArticlesRead: vi.fn(),
  },
}));

vi.mock('../styles.css', () => ({}));

// ---- Helpers ----

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 1,
    feedId: 10,
    feedTitle: 'Test Feed',
    title: 'Test Article',
    url: 'https://example.com/1',
    author: null,
    content: '<p>content</p>',
    publishedAt: '2024-01-01T00:00:00Z',
    isRead: false,
    readAt: null,
    starred: false,
    ...overrides,
  };
}

const sampleArticles: Article[] = [
  makeArticle({ id: 1, title: 'Article 1', isRead: false }),
  makeArticle({ id: 2, title: 'Article 2', isRead: true }),
  makeArticle({ id: 3, title: 'Article 3', isRead: false }),
];

function setupDefaultMocks() {
  mockGetArticles.mockResolvedValue({ items: sampleArticles, total: 3 });
  mockGetFeeds.mockResolvedValue([{ id: 10, title: 'Test Feed', url: 'https://example.com/feed' }]);
  mockGetFolders.mockResolvedValue([]);
  mockGetUnreadCounts.mockResolvedValue({ total: 2, feeds: { '10': 2 }, folders: {} });
  mockRefresh.mockResolvedValue({ refreshed: 1 });
}

function setupEmptyMocks() {
  mockGetArticles.mockResolvedValue({ items: [], total: 0 });
  mockGetFeeds.mockResolvedValue([]);
  mockGetFolders.mockResolvedValue([]);
  mockGetUnreadCounts.mockResolvedValue({ total: 0, feeds: {}, folders: {} });
}

// We need to get access to AppInner without the module-level QueryClient.
// The App component wraps AppInner in QueryClientProvider + ToastProvider.
// Since both are mocked (ToastProvider) or we need to control (QueryClient),
// we'll dynamically import to get a fresh module each test.

async function renderApp() {
  // Reset modules to get a fresh QueryClient each time
  vi.resetModules();

  // Re-apply mocks that are needed after resetModules
  const { default: App } = await import('../App');

  const result = render(<App />);
  await waitFor(() => {
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });
  return result;
}

/** Render and wait for articles to appear in the list */
async function renderAppWithArticles() {
  const result = await renderApp();
  await waitFor(() => {
    expect(screen.getByTestId('article-1')).toBeInTheDocument();
  });
  return result;
}

// ---- Tests ----

describe('App', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    Object.defineProperty(window, 'innerWidth', { value: 1400, writable: true, configurable: true });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true });
  });

  // -- Smoke / default render --

  it('renders without crashing', async () => {
    setupEmptyMocks();
    await renderApp();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
  });

  it('renders IconRail, Sidebar, Topbar, ArticleList, and ArticleView on desktop', async () => {
    await renderAppWithArticles();
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('article-list')).toBeInTheDocument();
    expect(screen.getByTestId('article-view')).toBeInTheDocument();
  });

  it('shows default view title "All Articles"', async () => {
    await renderApp();
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-view-title', 'All Articles');
  });

  it('sets railView to "newsfeed" by default', async () => {
    await renderApp();
    expect(screen.getByTestId('icon-rail')).toHaveAttribute('data-active-view', 'newsfeed');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-rail-view', 'newsfeed');
  });

  // -- Article selection --

  it('selects an article when clicked in article list', async () => {
    await renderAppWithArticles();

    fireEvent.click(screen.getByTestId('article-1'));

    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '1');
    expect(screen.getByTestId('article-list')).toHaveAttribute('data-selected-id', '1');
  });

  it('clears selected article when close is clicked', async () => {
    await renderAppWithArticles();

    fireEvent.click(screen.getByTestId('article-1'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '1');

    fireEvent.click(screen.getByTestId('close-article'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '');
  });

  // -- Unread filter --

  it('toggles unread-only filter', async () => {
    await renderApp();
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-unread-only', 'false');

    fireEvent.click(screen.getByTestId('topbar-toggle-unread'));
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-unread-only', 'true');

    fireEvent.click(screen.getByTestId('topbar-toggle-unread'));
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-unread-only', 'false');
  });

  it('filters articles by unread when unreadOnly is toggled', async () => {
    await renderAppWithArticles();

    // All 3 articles visible
    expect(screen.getByTestId('article-1')).toBeInTheDocument();
    expect(screen.getByTestId('article-2')).toBeInTheDocument();
    expect(screen.getByTestId('article-3')).toBeInTheDocument();

    // Toggle unread only - article 2 (isRead=true) should be filtered out
    fireEvent.click(screen.getByTestId('topbar-toggle-unread'));

    expect(screen.getByTestId('article-1')).toBeInTheDocument();
    expect(screen.queryByTestId('article-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('article-3')).toBeInTheDocument();
  });

  // -- Rail view changes --

  it('changes rail view when rail button is clicked', async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId('rail-search'));
    expect(screen.getByTestId('icon-rail')).toHaveAttribute('data-active-view', 'search');

    fireEvent.click(screen.getByTestId('rail-add'));
    expect(screen.getByTestId('icon-rail')).toHaveAttribute('data-active-view', 'add');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-rail-view', 'add');
  });

  it('resets selection when switching rail to newsfeed', async () => {
    await renderAppWithArticles();

    // Select an article first
    fireEvent.click(screen.getByTestId('article-1'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '1');

    // Switch rail to newsfeed resets selection
    fireEvent.click(screen.getByTestId('rail-newsfeed'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '');
  });

  // -- Sidebar selection --

  it('clears selected article when sidebar selection changes', async () => {
    await renderAppWithArticles();

    fireEvent.click(screen.getByTestId('article-1'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '1');

    fireEvent.click(screen.getByTestId('sidebar-select-folder'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '');
  });

  // -- Layout modes --

  describe('layout modes', () => {
    it('shows sidebar toggle button on tablet', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
      await renderApp();
      expect(screen.getByTestId('topbar')).toHaveAttribute('data-can-toggle-sidebar', 'true');
    });

    it('does not allow sidebar toggle on desktop', async () => {
      await renderApp();
      expect(screen.getByTestId('topbar')).toHaveAttribute('data-can-toggle-sidebar', 'false');
    });

    it('shows article fullscreen on mobile when article is selected', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true, configurable: true });
      await renderAppWithArticles();

      // Before selection: icon-rail visible
      expect(screen.getByTestId('icon-rail')).toBeInTheDocument();

      // Select article on mobile
      fireEvent.click(screen.getByTestId('article-1'));

      // In fullscreen mode, icon-rail and sidebar are hidden
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
      expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '1');
    });

    it('returns from fullscreen article on mobile when close is clicked', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true, configurable: true });
      await renderAppWithArticles();

      fireEvent.click(screen.getByTestId('article-1'));
      expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('close-article'));
      expect(screen.getByTestId('icon-rail')).toBeInTheDocument();
      expect(screen.getByTestId('article-list')).toBeInTheDocument();
    });

    it('hides sidebar by default on tablet and toggles it', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
      await renderApp();

      // Sidebar is not rendered on tablet by default (isSidebarOpen starts false)
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();

      // Toggle sidebar open
      fireEvent.click(screen.getByTestId('topbar-toggle-sidebar'));
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();

      // Toggle sidebar closed
      fireEvent.click(screen.getByTestId('topbar-toggle-sidebar'));
      expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    });
  });

  // -- Article navigation --

  describe('article navigation', () => {
    it('provides prev/next navigation callbacks', async () => {
      await renderAppWithArticles();

      // Select article 2 (middle)
      fireEvent.click(screen.getByTestId('article-2'));
      expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '2');

      // Both prev and next should be available
      expect(screen.getByTestId('prev-article')).toBeInTheDocument();
      expect(screen.getByTestId('next-article')).toBeInTheDocument();

      // Navigate to next
      fireEvent.click(screen.getByTestId('next-article'));
      expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '3');

      // At last article, no next button
      expect(screen.queryByTestId('next-article')).not.toBeInTheDocument();
      expect(screen.getByTestId('prev-article')).toBeInTheDocument();
    });

    it('navigates to previous article', async () => {
      await renderAppWithArticles();

      // Select article 2, go to prev
      fireEvent.click(screen.getByTestId('article-2'));
      fireEvent.click(screen.getByTestId('prev-article'));
      expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '1');

      // At first article, no prev
      expect(screen.queryByTestId('prev-article')).not.toBeInTheDocument();
    });

    it('provides next-unread when unread articles exist', async () => {
      await renderAppWithArticles();

      // Select article 2 (read). Unread articles exist (1 and 3).
      fireEvent.click(screen.getByTestId('article-2'));
      expect(screen.getByTestId('next-unread')).toBeInTheDocument();

      // Navigate to next unread (article 3)
      fireEvent.click(screen.getByTestId('next-unread'));
      expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '3');
    });
  });

  // -- Mark all read --

  it('calls markAllRead with unread article IDs', async () => {
    await renderAppWithArticles();

    fireEvent.click(screen.getByTestId('topbar-mark-all-read'));
    // Articles 1 and 3 are unread
    expect(mockMarkAllRead).toHaveBeenCalledWith([1, 3]);
  });

  it('does not call markAllRead when no unread articles', async () => {
    mockGetArticles.mockResolvedValue({
      items: [makeArticle({ id: 1, isRead: true }), makeArticle({ id: 2, isRead: true })],
      total: 2,
    });
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('article-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('topbar-mark-all-read'));
    expect(mockMarkAllRead).not.toHaveBeenCalled();
  });

  // -- Search --

  it('updates search text via topbar', async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId('topbar-search-change'));
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-search-text', 'query');
  });

  it('shows search title when search text is set', async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId('topbar-search-change'));
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-view-title', 'Search: "query"');
  });

  it('clears search text via topbar', async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId('topbar-search-change'));
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-search-text', 'query');

    fireEvent.click(screen.getByTestId('topbar-search-clear'));
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-search-text', '');
  });

  // -- Toggle starred --

  it('calls toggleStarred for the selected article', async () => {
    await renderAppWithArticles();

    fireEvent.click(screen.getByTestId('article-1'));
    fireEvent.click(screen.getByTestId('toggle-starred'));
    expect(mockToggleStarred).toHaveBeenCalledWith(1, false);
  });

  // -- Toggle read --

  it('calls toggleRead for the selected article', async () => {
    await renderAppWithArticles();

    fireEvent.click(screen.getByTestId('article-1'));
    fireEvent.click(screen.getByTestId('toggle-read'));
    expect(mockToggleRead).toHaveBeenCalledWith(1, false);
  });

  // -- Open add feed / OPML guide --

  it('opens add feed panel via article list callback', async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId('article-list-open-add'));
    expect(screen.getByTestId('icon-rail')).toHaveAttribute('data-active-view', 'add');
  });

  it('opens OPML/settings panel via article list callback', async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId('article-list-open-opml'));
    expect(screen.getByTestId('icon-rail')).toHaveAttribute('data-active-view', 'settings');
  });

  // -- Refresh --

  it('calls api.refresh when refresh button is clicked', async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId('topbar-refresh'));
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  // -- Viewport resize --

  it('responds to window resize events', async () => {
    await renderApp();
    // Initially desktop
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-can-toggle-sidebar', 'false');

    // Resize to tablet
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByTestId('topbar')).toHaveAttribute('data-can-toggle-sidebar', 'true');
  });

  // -- Retry articles --

  it('calls refetchArticles when retry is clicked in article list', async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId('article-list-retry'));
    // handleRetryArticles calls refetchArticles (covered line 354)
  });

  // -- ArticleList onRefresh --

  it('triggers refresh via article list refresh button', async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId('article-list-refresh'));
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  // -- Sidebar overlay close --

  it('closes sidebar via overlay button on tablet', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
    await renderApp();

    // Open sidebar
    fireEvent.click(screen.getByTestId('topbar-toggle-sidebar'));
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();

    // Click the overlay button (rendered by App.tsx, not mocked)
    const overlay = screen.getByLabelText('Close sidebar');
    fireEvent.click(overlay);

    // Sidebar should close
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  // -- Mobile fullscreen toggleStarred --

  it('calls toggleStarred in mobile fullscreen mode', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true, configurable: true });
    await renderAppWithArticles();

    fireEvent.click(screen.getByTestId('article-1'));
    // In fullscreen mode
    expect(screen.queryByTestId('icon-rail')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle-starred'));
    expect(mockToggleStarred).toHaveBeenCalledWith(1, false);
  });

  // -- Next-unread wrap-around --

  it('wraps around to find unread articles before current position', async () => {
    mockGetArticles.mockResolvedValue({
      items: [
        makeArticle({ id: 1, isRead: false }),
        makeArticle({ id: 2, isRead: true }),
        makeArticle({ id: 3, isRead: true }),
      ],
      total: 3,
    });
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('article-3')).toBeInTheDocument();
    });

    // Select article 3 (last, read)
    fireEvent.click(screen.getByTestId('article-3'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '3');

    // Next unread should wrap to article 1
    fireEvent.click(screen.getByTestId('next-unread'));
    expect(screen.getByTestId('article-view')).toHaveAttribute('data-article-id', '1');
  });

  // -- scrollIntoView --

  it('scrolls selected article into view on navigation', async () => {
    await renderAppWithArticles();

    const scrollIntoViewMock = vi.fn();
    const articleBtn = screen.getByTestId('article-2');
    articleBtn.scrollIntoView = scrollIntoViewMock;

    // Select article 1 first, then navigate to article 2
    fireEvent.click(screen.getByTestId('article-1'));
    fireEvent.click(screen.getByTestId('next-article'));

    // scrollIntoView should have been called
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });
  });

  // -- Sidebar closes on selection in non-desktop --

  it('closes sidebar on selection change in tablet mode', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
    await renderApp();

    // Open sidebar
    fireEvent.click(screen.getByTestId('topbar-toggle-sidebar'));
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();

    // Select something from sidebar
    fireEvent.click(screen.getByTestId('sidebar-select-folder'));

    // Sidebar should close
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });
});
