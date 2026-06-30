import { useState, useMemo, useCallback, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar, type SidebarSelection } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ArticleList } from './components/ArticleList';
import { ArticleView } from './components/ArticleView';
import { ToastProvider, useToast } from './components/Toast';
import { useArticleMutations } from './hooks/useArticleMutations';
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
  const { markRead, toggleRead, markAllRead, toggleStarred } = useArticleMutations();

  // Navigation state
  const [selection, setSelection] = useState<SidebarSelection>({ type: 'newsfeed' });
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);

  // Search state
  const [searchText, setSearchText] = useState('');
  const debouncedQ = useDebounce(searchText.trim(), 300);

  // Persisted preferences
  const [unreadOnly, setUnreadOnly] = usePersistedState<boolean>('rss.unreadOnly', false);

  // Feed being added (for fetching indicator)
  const [addingFeedName, setAddingFeedName] = useState<string | null>(null);
  const [addPanelFocusToken, setAddPanelFocusToken] = useState(0);
  const [openAddPanelToken, setOpenAddPanelToken] = useState(0);
  const [openSettingsPanelToken, setOpenSettingsPanelToken] = useState(0);

  // Last updated time
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [seekingUnread, setSeekingUnread] = useState(false);

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

  // Build query params from selection (offset managed by useInfiniteQuery)
  const queryParams = useMemo(() => {
    const params: { folderId?: number; feedId?: number; q?: string; limit?: number } = {
      limit: 100,
    };
    if (selection.type === 'folder') params.folderId = selection.folderId;
    if (selection.type === 'feed') params.feedId = selection.feedId;
    if (debouncedQ) params.q = debouncedQ;
    return params;
  }, [selection, debouncedQ]);

  const {
    data,
    isLoading,
    isError,
    refetch: refetchArticles,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['articles', queryParams],
    queryFn: ({ pageParam }) => api.getArticles({ ...queryParams, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  // Flatten paginated results
  const allItems = data?.pages.flatMap(p => p.items) ?? [];

  // Track when articles are successfully fetched
  useEffect(() => {
    if (data) {
      setLastUpdated(formatTime(new Date()));
    }
  }, [data]);

  const { data: feeds = [] } = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });
  useQuery({ queryKey: ['folders'], queryFn: api.getFolders });

  const { data: unreadCountsData } = useQuery({
    queryKey: ['unreadCounts'],
    queryFn: api.getUnreadCounts,
    staleTime: 60_000,
  });

  const unreadCounts = useMemo(() => ({
    feeds: unreadCountsData?.feeds ?? {},
    folders: unreadCountsData?.folders ?? {},
    total: unreadCountsData?.total ?? 0,
  }), [unreadCountsData]);

  const refresh = useMutation({
    mutationFn: () => {
      const feedId = selection.type === 'feed' ? selection.feedId : undefined;
      return api.refresh(feedId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['unreadCounts'] });
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
    if (!unreadOnly) return allItems;
    return allItems.filter((a) => !a.isRead);
  }, [allItems, unreadOnly]);

  const selectedArticle = useMemo(() => {
    if (selectedArticleId == null) return null;
    return allItems.find((a) => a.id === selectedArticleId) ?? null;
  }, [allItems, selectedArticleId]);

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
    setSelectedArticleId(article.id);
    if (layoutMode === 'mobile') {
      setIsSidebarOpen(false);
    }
  }, [layoutMode]);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticleId(null);
  }, []);

  const handleSelect = useCallback((sel: SidebarSelection) => {
    setSelection(sel);
    setSelectedArticleId(null);
    if (layoutMode !== 'desktop') {
      setIsSidebarOpen(false);
    }
  }, [layoutMode]);

  const handleToggleSidebar = useCallback(() => {
    if (layoutMode === 'desktop') return;
    setIsSidebarOpen((prev) => !prev);
  }, [layoutMode]);

  const handleOpenAddFeed = useCallback(() => {
    setSelectedArticleId(null);
    if (layoutMode !== 'desktop') {
      setIsSidebarOpen(true);
    }
    setOpenAddPanelToken((prev) => prev + 1);
    setAddPanelFocusToken((prev) => prev + 1);
  }, [layoutMode]);

  const handleOpenOpmlGuide = useCallback(() => {
    setSelectedArticleId(null);
    if (layoutMode !== 'desktop') {
      setIsSidebarOpen(true);
    }
    setOpenSettingsPanelToken((prev) => prev + 1);
  }, [layoutMode]);

  const handleSearchClear = useCallback(() => {
    setSearchText('');
  }, []);

  const handleMarkAllRead = useCallback(() => {
    const unreadIds = articles.filter((a) => !a.isRead).map((a) => a.id);
    if (unreadIds.length === 0) return;
    markAllRead(unreadIds);
    const count = unreadIds.length;
    addToast(
      `${count} article${count !== 1 ? 's' : ''} marked as read`,
      'success',
      {
        label: 'Undo',
        onClick: () => {
          for (const id of unreadIds) {
            toggleRead(id, true);
          }
          addToast('Undo: articles restored to unread', 'info');
        },
      },
    );
  }, [articles, markAllRead, toggleRead, addToast]);

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
      setSelectedArticleId(article.id);
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
    const startIdx = selectedIndex >= 0 ? selectedIndex + 1 : 0;
    for (let i = startIdx; i < articles.length; i++) {
      if (!articles[i].isRead) {
        selectArticleByIndex(i);
        return;
      }
    }
    for (let i = 0; i < startIdx; i++) {
      if (!articles[i].isRead) {
        selectArticleByIndex(i);
        return;
      }
    }
    if (hasNextPage) {
      setSeekingUnread(true);
    }
  }, [selectedIndex, articles, selectArticleByIndex, hasNextPage]);

  useEffect(() => {
    if (!seekingUnread || isFetchingNextPage) return;
    const unreadIdx = articles.findIndex((a) => !a.isRead);
    if (unreadIdx >= 0) {
      setSeekingUnread(false);
      selectArticleByIndex(unreadIdx);
    } else if (!hasNextPage) {
      setSeekingUnread(false);
    } else {
      fetchNextPage();
    }
  }, [seekingUnread, articles, hasNextPage, isFetchingNextPage, fetchNextPage, selectArticleByIndex]);

  useEffect(() => {
    setSeekingUnread(false);
  }, [queryParams]);

  // ---- ArticleView navigation callbacks ----
  const handlePrevArticle = selectedIndex > 0 ? goToPrevArticle : null;
  const handleNextArticle = selectedIndex < articles.length - 1 ? goToNextArticle : null;

  const hasNextUnread = useMemo(() => {
    if (articles.some((a) => !a.isRead)) return true;
    if (!hasNextPage) return false;
    if (queryParams.q) return true;
    if (queryParams.feedId != null) {
      return (unreadCounts.feeds[String(queryParams.feedId)] ?? 0) > 0;
    }
    if (queryParams.folderId != null) {
      return (unreadCounts.folders[String(queryParams.folderId)] ?? 0) > 0;
    }
    return (unreadCounts.total ?? 0) > 0;
  }, [articles, hasNextPage, unreadCounts, queryParams.feedId, queryParams.folderId, queryParams.q]);
  const handleNextUnread = hasNextUnread ? goToNextUnread : null;

  const handleToggleSelectedRead = useCallback(() => {
    if (selectedArticle) {
      toggleRead(selectedArticle.id, selectedArticle.isRead);
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
    viewportWidth >= layoutSidebarWidth + ARTICLE_LIST_MIN_WIDTH + ARTICLE_VIEW_MIN_WIDTH;
  const showArticlePane = layoutMode === 'desktop' || selectedArticle !== null;
  const showListPane = !selectedArticle || layoutMode === 'desktop' || canShowArticleAndList;
  const contentGridClass =
    showListPane && showArticlePane
      ? 'grid-cols-[minmax(300px,360px)_minmax(560px,1fr)]'
      : 'grid-cols-1';
  const selectedArticleRead = selectedArticle?.isRead ?? false;
  const sidebarPanel = (
    <Sidebar
      selection={selection}
      onSelect={handleSelect}
      unreadCounts={unreadCounts}
      onFeedAdding={setAddingFeedName}
      addPanelFocusToken={addPanelFocusToken}
      openAddPanelToken={openAddPanelToken}
      openSettingsPanelToken={openSettingsPanelToken}
    />
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-white">
      {showArticleFullscreen ? (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ArticleView
            article={selectedArticle}
            onClose={handleCloseArticle}
            onMarkRead={markRead}
            isRead={selectedArticleRead}
            onToggleRead={handleToggleSelectedRead}
            onPrev={handlePrevArticle}
            onNext={handleNextArticle}
            onNextUnread={handleNextUnread}
            starred={selectedArticle?.starred ?? false}
            onToggleStarred={
              selectedArticle
                ? () => toggleStarred(selectedArticle.id, selectedArticle.starred)
                : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Sidebar */}
          {layoutMode === 'desktop' && sidebarPanel}
          {layoutMode !== 'desktop' && (
            <>
              {isSidebarOpen && (
                <button
                  type="button"
                  aria-label="Close sidebar"
                  className="absolute inset-y-0 left-0 right-0 z-30 bg-black/20"
                  onClick={() => setIsSidebarOpen(false)}
                />
              )}
              {isSidebarOpen && (
                <div className="absolute inset-y-0 left-0 z-40 transition-transform duration-200 ease-out">
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
              searchHitCount={debouncedQ ? (data?.pages[0]?.total ?? null) : null}
              searchScope={searchScope}
              lastUpdated={lastUpdated}
              canToggleSidebar={layoutMode !== 'desktop'}
              isSidebarOpen={isSidebarOpen}
              onToggleSidebar={handleToggleSidebar}
            />

            {/* Content: Article list + Article view */}
            <div className={['grid flex-1 min-w-0 min-h-0 overflow-hidden', contentGridClass].join(' ')}>
              {/* Article list */}
              {showListPane && (
                <div
                  className={[
                    'min-w-0 min-h-0 overflow-hidden flex flex-col',
                    showArticlePane ? 'border-r border-border' : '',
                  ].join(' ')}
                >
                  <ArticleList
                    articles={articles}
                    isLoading={isLoading}
                    isError={isError}
                    hasFeeds={feeds.length > 0}
                    selectedArticleId={selectedArticleId}
                    onSelectArticle={handleSelectArticle}
                    onRetry={handleRetryArticles}
                    addingFeedName={addingFeedName}
                    onOpenAddFeed={handleOpenAddFeed}
                    onOpenOpmlGuide={handleOpenOpmlGuide}
                    searchQuery={debouncedQ || undefined}
                    unreadOnly={unreadOnly}
                    totalCount={data?.pages[0]?.total}
                    selectionLabel={searchScope}
                    onClearSearch={handleSearchClear}
                    onToggleUnreadOnly={handleToggleUnreadOnly}
                    onRefresh={() => refresh.mutate()}
                    onLoadMore={() => fetchNextPage()}
                    hasMore={hasNextPage}
                    isFetchingMore={isFetchingNextPage}
                    isSingleFeed={selection.type === 'feed'}
                    isArticleOpen={selectedArticleId !== null}
                  />
                </div>
              )}

              {/* Article view (right panel) */}
              {showArticlePane && (
                <div className="min-w-0 min-h-0 overflow-hidden bg-white flex flex-col">
                  <ArticleView
                    article={selectedArticle}
                    onClose={handleCloseArticle}
                    onMarkRead={markRead}
                    isRead={selectedArticleRead}
                    onToggleRead={handleToggleSelectedRead}
                    onPrev={handlePrevArticle}
                    onNext={handleNextArticle}
                    onNextUnread={handleNextUnread}
                    starred={selectedArticle?.starred ?? false}
                    onToggleStarred={
                      selectedArticle
                        ? () => toggleStarred(selectedArticle.id, selectedArticle.starred)
                        : undefined
                    }
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
