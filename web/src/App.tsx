import { useState, useMemo, useCallback, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconRail } from './components/IconRail';
import { Sidebar, type SidebarSelection } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ArticleList } from './components/ArticleList';
import { ArticleView } from './components/ArticleView';
import { ToastProvider, useToast } from './components/Toast';
import { useReadState } from './hooks/useReadState';
import { usePersistedState } from './hooks/usePersistedState';
import { useDebounce } from './hooks/useDebounce';
import { api, type Article } from './api/client';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
    },
  },
});

const DESKTOP_BREAKPOINT = 1280;
const TABLET_BREAKPOINT = 900;
const ICON_RAIL_WIDTH = 56;
const SIDEBAR_WIDTH = 260;
const ARTICLE_LIST_MIN_WIDTH = 300;
const ARTICLE_VIEW_MIN_WIDTH = 560;

type LayoutMode = 'desktop' | 'tablet' | 'mobile';

/** Format a Date as HH:MM */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getViewportWidth(): number {
  if (typeof window === 'undefined') {
    return DESKTOP_BREAKPOINT;
  }
  return window.innerWidth;
}

function getLayoutMode(width: number): LayoutMode {
  if (width >= DESKTOP_BREAKPOINT) return 'desktop';
  if (width >= TABLET_BREAKPOINT) return 'tablet';
  return 'mobile';
}

function AppInner() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { isRead, markRead, toggleRead, markAllRead, undoMarkAllRead, readIds } = useReadState();

  // Navigation state
  const [selection, setSelection] = useState<SidebarSelection>({ type: 'newsfeed' });
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [railView, setRailView] = useState<'newsfeed' | 'search' | 'add' | 'settings'>('newsfeed');

  // Search state
  const [searchText, setSearchText] = useState('');
  const debouncedQ = useDebounce(searchText.trim(), 300);

  // Persisted preferences
  const [unreadOnly, setUnreadOnly] = usePersistedState<boolean>('rss.unreadOnly', false);

  // Feed being added (for fetching indicator)
  const [addingFeedName, setAddingFeedName] = useState<string | null>(null);

  // Last updated time
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const layoutMode = useMemo(() => getLayoutMode(viewportWidth), [viewportWidth]);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(getViewportWidth());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (layoutMode === 'desktop') {
      setIsSidebarOpen(true);
    }
  }, [layoutMode]);

  // Build query params from selection
  const queryParams = useMemo(() => {
    const params: { folderId?: number; feedId?: number; q?: string; limit?: number } = {
      limit: 100,
    };
    if (selection.type === 'folder') params.folderId = selection.folderId;
    if (selection.type === 'feed') params.feedId = selection.feedId;
    if (debouncedQ) params.q = debouncedQ;
    return params;
  }, [selection, debouncedQ]);

  const { data, isLoading, isError, refetch: refetchArticles } = useQuery({
    queryKey: ['articles', queryParams],
    queryFn: () => api.getArticles(queryParams),
  });

  // Track when articles are successfully fetched
  useEffect(() => {
    if (data) {
      setLastUpdated(formatTime(new Date()));
    }
  }, [data]);

  // Also fetch all feeds for unread count calculations
  const { data: feeds = [] } = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });
  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: api.getFolders });

  // For unread counts, we fetch a larger set of articles (all articles) to compute badge counts
  // This is an approximation based on loaded articles
  const { data: allArticlesData } = useQuery({
    queryKey: ['articles', { limit: 500 }],
    queryFn: () => api.getArticles({ limit: 500 }),
    staleTime: 120_000,
  });

  // Compute unread counts from loaded articles
  const unreadCounts = useMemo(() => {
    const feedCounts = new Map<number, number>();
    const folderCounts = new Map<number, number>();
    let total = 0;

    const allArticles = allArticlesData?.items ?? [];
    for (const article of allArticles) {
      if (!readIds.has(article.id)) {
        total++;
        feedCounts.set(article.feedId, (feedCounts.get(article.feedId) ?? 0) + 1);
      }
    }

    // Compute folder counts by summing feed counts for feeds in each folder
    for (const folder of folders) {
      let folderTotal = 0;
      for (const feed of feeds) {
        if (feed.folder === folder.name) {
          folderTotal += feedCounts.get(feed.id) ?? 0;
        }
      }
      folderCounts.set(folder.id, folderTotal);
    }

    return { feeds: feedCounts, folders: folderCounts, total };
  }, [allArticlesData, readIds, feeds, folders]);

  const refresh = useMutation({
    mutationFn: () => {
      const feedId = selection.type === 'feed' ? selection.feedId : undefined;
      return api.refresh(feedId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      setLastUpdated(formatTime(new Date()));
      addToast('Feeds refreshed', 'success');
    },
    onError: (err) => {
      addToast(
        err instanceof Error ? err.message : 'Failed to refresh',
        'error',
        { label: 'Retry', onClick: () => refresh.mutate() },
      );
    },
  });

  // Filter articles by read state if unreadOnly
  const articles = useMemo(() => {
    const items = data?.items ?? [];
    if (!unreadOnly) return items;
    return items.filter((a) => !isRead(a.id));
  }, [data, unreadOnly, isRead]);

  // Search scope label
  const searchScope = useMemo(() => {
    switch (selection.type) {
      case 'newsfeed': return 'All';
      case 'folder': return selection.folderName;
      case 'feed': {
        const feed = feeds.find((f) => f.id === selection.feedId);
        return feed?.title || 'Feed';
      }
    }
  }, [selection, feeds]);

  // View title
  const viewTitle = useMemo(() => {
    if (debouncedQ) return `Search: "${debouncedQ}"`;
    switch (selection.type) {
      case 'newsfeed': return 'All Articles';
      case 'folder': return selection.folderName;
      case 'feed': {
        const feed = feeds.find((f) => f.id === selection.feedId);
        return feed?.title || 'Feed';
      }
    }
  }, [selection, feeds, debouncedQ]);

  // -- Selected article index management --
  const selectedIndex = useMemo(() => {
    if (!selectedArticle) return -1;
    return articles.findIndex((a) => a.id === selectedArticle.id);
  }, [articles, selectedArticle]);

  const handleSelectArticle = useCallback((article: Article) => {
    setSelectedArticle(article);
    if (layoutMode === 'mobile') {
      setIsSidebarOpen(false);
    }
  }, [layoutMode]);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  const handleSelect = useCallback((sel: SidebarSelection) => {
    setSelection(sel);
    setSelectedArticle(null);
    if (layoutMode !== 'desktop') {
      setIsSidebarOpen(false);
    }
    // When selecting from sidebar, switch rail to newsfeed view
    if (railView === 'search') {
      // keep search view
    } else if (railView !== 'add' && railView !== 'settings') {
      setRailView('newsfeed');
    }
  }, [layoutMode, railView]);

  const handleRailChange = useCallback((view: 'newsfeed' | 'search' | 'add' | 'settings') => {
    setRailView(view);
    if (view === 'newsfeed') {
      setSelection({ type: 'newsfeed' });
      setSelectedArticle(null);
    }
    if (view === 'search') {
      // Focus search - no selection change needed
    }
    if (layoutMode !== 'desktop') {
      if (view === 'add' || view === 'settings') {
        setIsSidebarOpen(true);
      } else if (view === 'search') {
        setIsSidebarOpen(false);
      }
    }
  }, [layoutMode]);

  const handleToggleSidebar = useCallback(() => {
    if (layoutMode === 'desktop') return;
    setIsSidebarOpen((prev) => !prev);
  }, [layoutMode]);

  const handleSearchClear = useCallback(() => {
    setSearchText('');
  }, []);

  // ---- Mark all read with undo ----
  const handleMarkAllRead = useCallback(() => {
    const unreadIds = articles.filter((a) => !isRead(a.id)).map((a) => a.id);
    if (unreadIds.length === 0) return;
    const count = markAllRead(unreadIds);
    if (count > 0) {
      addToast(
        `${count} article${count !== 1 ? 's' : ''} marked as read`,
        'success',
        {
          label: 'Undo',
          onClick: () => {
            undoMarkAllRead();
            addToast('Undo: articles restored to unread', 'info');
          },
        },
      );
    }
  }, [articles, isRead, markAllRead, undoMarkAllRead, addToast]);

  const handleToggleUnreadOnly = useCallback(() => {
    setUnreadOnly((prev) => !prev);
  }, [setUnreadOnly]);

  // ---- Article navigation helpers ----
  const scrollArticleIntoView = useCallback((articleId: number) => {
    const el = document.querySelector(`[data-article-id="${articleId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, []);

  const selectArticleByIndex = useCallback((index: number) => {
    if (index >= 0 && index < articles.length) {
      const article = articles[index];
      setSelectedArticle(article);
      // scrollIntoView happens after render
      requestAnimationFrame(() => scrollArticleIntoView(article.id));
    }
  }, [articles, scrollArticleIntoView]);

  const goToPrevArticle = useCallback(() => {
    if (selectedIndex > 0) {
      selectArticleByIndex(selectedIndex - 1);
    }
  }, [selectedIndex, selectArticleByIndex]);

  const goToNextArticle = useCallback(() => {
    if (selectedIndex < articles.length - 1) {
      selectArticleByIndex(selectedIndex + 1);
    }
  }, [selectedIndex, articles.length, selectArticleByIndex]);

  const goToNextUnread = useCallback(() => {
    // Search from current position onwards
    const startIdx = selectedIndex >= 0 ? selectedIndex + 1 : 0;
    for (let i = startIdx; i < articles.length; i++) {
      if (!isRead(articles[i].id)) {
        selectArticleByIndex(i);
        return;
      }
    }
    // Wrap around from beginning
    for (let i = 0; i < startIdx; i++) {
      if (!isRead(articles[i].id)) {
        selectArticleByIndex(i);
        return;
      }
    }
  }, [selectedIndex, articles, isRead, selectArticleByIndex]);

  // ---- ArticleView navigation callbacks ----
  const handlePrevArticle = selectedIndex > 0 ? goToPrevArticle : null;
  const handleNextArticle = selectedIndex < articles.length - 1 ? goToNextArticle : null;

  // Check if there's a next unread
  const hasNextUnread = useMemo(() => {
    return articles.some((a) => !isRead(a.id));
  }, [articles, isRead]);
  const handleNextUnread = hasNextUnread ? goToNextUnread : null;

  const handleToggleSelectedRead = useCallback(() => {
    if (selectedArticle) {
      toggleRead(selectedArticle.id);
    }
  }, [selectedArticle, toggleRead]);

  // Retry handler for ArticleList
  const handleRetryArticles = useCallback(() => {
    refetchArticles();
  }, [refetchArticles]);

  const showArticleFullscreen = layoutMode === 'mobile' && selectedArticle !== null;
  const layoutSidebarWidth = layoutMode === 'desktop' ? SIDEBAR_WIDTH : 0;
  const canShowArticleAndList =
    layoutMode !== 'mobile' &&
    viewportWidth >= ICON_RAIL_WIDTH + layoutSidebarWidth + ARTICLE_LIST_MIN_WIDTH + ARTICLE_VIEW_MIN_WIDTH;
  const showArticlePane = layoutMode === 'desktop' || selectedArticle !== null;
  const showListPane = !selectedArticle || layoutMode === 'desktop' || canShowArticleAndList;
  const contentGridClass =
    showListPane && showArticlePane
      ? 'grid-cols-[minmax(300px,360px)_minmax(560px,1fr)]'
      : 'grid-cols-1';
  const selectedArticleRead = selectedArticle ? isRead(selectedArticle.id) : false;
  const sidebarPanel = (
    <Sidebar
      selection={selection}
      onSelect={handleSelect}
      unreadCounts={unreadCounts}
      railView={railView}
      onFeedAdding={setAddingFeedName}
    />
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-white">
      {showArticleFullscreen ? (
        <div className="flex-1 min-w-0">
          <ArticleView
            article={selectedArticle}
            onClose={handleCloseArticle}
            onMarkRead={markRead}
            isRead={selectedArticleRead}
            onToggleRead={handleToggleSelectedRead}
            onPrev={handlePrevArticle}
            onNext={handleNextArticle}
            onNextUnread={handleNextUnread}
          />
        </div>
      ) : (
        <>
          {/* Icon Rail */}
          <IconRail activeView={railView} onChangeView={handleRailChange} />

          {/* Sidebar */}
          {layoutMode === 'desktop' && sidebarPanel}
          {layoutMode !== 'desktop' && (
            <>
              {isSidebarOpen && (
                <button
                  type="button"
                  aria-label="Close sidebar"
                  className="absolute inset-y-0 left-14 right-0 z-30 bg-black/20"
                  onClick={() => setIsSidebarOpen(false)}
                />
              )}
              {isSidebarOpen && (
                <div className="absolute inset-y-0 left-14 z-40 transition-transform duration-200 ease-out">
                  <div className="h-full shadow-2xl">
                    {sidebarPanel}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Main content area */}
          <div className="flex-1 flex min-w-0 flex-col overflow-hidden">
            {/* Topbar */}
            <Topbar
              viewTitle={viewTitle}
              searchText={searchText}
              onSearchChange={setSearchText}
              onSearchClear={handleSearchClear}
              hasActiveSearch={!!debouncedQ}
              unreadOnly={unreadOnly}
              onToggleUnreadOnly={handleToggleUnreadOnly}
              onMarkAllRead={handleMarkAllRead}
              onRefresh={() => refresh.mutate()}
              isRefreshing={refresh.isPending}
              searchHitCount={debouncedQ ? (data?.total ?? null) : null}
              searchScope={searchScope}
              lastUpdated={lastUpdated}
              canToggleSidebar={layoutMode !== 'desktop'}
              isSidebarOpen={isSidebarOpen}
              onToggleSidebar={handleToggleSidebar}
            />

            {/* Content: Article list + Article view */}
            <div className={['grid flex-1 min-w-0 overflow-hidden', contentGridClass].join(' ')}>
              {/* Article list */}
              {showListPane && (
                <div
                  className={[
                    'min-w-0 overflow-hidden',
                    showArticlePane ? 'border-r border-border' : '',
                  ].join(' ')}
                >
                  <ArticleList
                    articles={articles}
                    isLoading={isLoading}
                    isError={isError}
                    selectedArticleId={selectedArticle?.id ?? null}
                    onSelectArticle={handleSelectArticle}
                    isRead={isRead}
                    onRetry={handleRetryArticles}
                    addingFeedName={addingFeedName}
                  />
                </div>
              )}

              {/* Article view (right panel) */}
              {showArticlePane && (
                <div className="min-w-0 overflow-hidden bg-white">
                  <ArticleView
                    article={selectedArticle}
                    onClose={handleCloseArticle}
                    onMarkRead={markRead}
                    isRead={selectedArticleRead}
                    onToggleRead={handleToggleSelectedRead}
                    onPrev={handlePrevArticle}
                    onNext={handleNextArticle}
                    onNextUnread={handleNextUnread}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </QueryClientProvider>
  );
}
