import { useState, useMemo, useCallback, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconRail } from './components/IconRail';
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

/** Format a Date as HH:MM */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AppInner() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { markRead, toggleRead, markAllRead, toggleStarred } = useArticleMutations();

  // Navigation state
  const [selection, setSelection] = useState<SidebarSelection>({ type: 'newsfeed' });
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
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
    const items = data?.items ?? [];
    if (!unreadOnly) return items;
    return items.filter((a) => !a.isRead);
  }, [data, unreadOnly]);

  const selectedArticle = useMemo(() => {
    if (selectedArticleId == null) return null;
    return articles.find((a) => a.id === selectedArticleId) ?? null;
  }, [articles, selectedArticleId]);

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
  }, []);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticleId(null);
  }, []);

  const handleSelect = useCallback((sel: SidebarSelection) => {
    setSelection(sel);
    setSelectedArticleId(null);
    // When selecting from sidebar, switch rail to newsfeed view
    if (railView === 'search') {
      // keep search view
    } else if (railView !== 'add' && railView !== 'settings') {
      setRailView('newsfeed');
    }
  }, [railView]);

  const handleRailChange = useCallback((view: 'newsfeed' | 'search' | 'add' | 'settings') => {
    setRailView(view);
    if (view === 'newsfeed') {
      setSelection({ type: 'newsfeed' });
      setSelectedArticleId(null);
    }
    if (view === 'search') {
      // Focus search - no selection change needed
    }
  }, []);

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
  }, [selectedIndex, articles, selectArticleByIndex]);

  // ---- ArticleView navigation callbacks ----
  const handlePrevArticle = selectedIndex > 0 ? goToPrevArticle : null;
  const handleNextArticle = selectedIndex < articles.length - 1 ? goToNextArticle : null;

  // Check if there's a next unread
  const hasNextUnread = useMemo(() => {
    return articles.some((a) => !a.isRead);
  }, [articles]);
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

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Icon Rail */}
      <IconRail activeView={railView} onChangeView={handleRailChange} />

      {/* Sidebar */}
      <Sidebar
        selection={selection}
        onSelect={handleSelect}
        unreadCounts={unreadCounts}
        railView={railView}
        onFeedAdding={setAddingFeedName}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
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
        />

        {/* Content: Article list + Article view */}
        <div className="flex-1 flex overflow-hidden">
          {/* Article list */}
          <div className={[
            'flex flex-col overflow-hidden transition-all',
            selectedArticle ? 'w-[360px] flex-shrink-0 border-r border-border' : 'flex-1',
          ].join(' ')}>
            <ArticleList
              articles={articles}
              isLoading={isLoading}
              isError={isError}
              selectedArticleId={selectedArticleId}
              onSelectArticle={handleSelectArticle}
              onRetry={handleRetryArticles}
              addingFeedName={addingFeedName}
            />
          </div>

          {/* Article view (right panel) */}
          {selectedArticle && (
            <ArticleView
              article={selectedArticle}
              onClose={handleCloseArticle}
              onMarkRead={markRead}
              isRead={selectedArticle.isRead}
              onToggleRead={handleToggleSelectedRead}
              onPrev={handlePrevArticle}
              onNext={handleNextArticle}
              onNextUnread={handleNextUnread}
              starred={selectedArticle.starred}
              onToggleStarred={() => toggleStarred(selectedArticle.id, selectedArticle.starred)}
            />
          )}
        </div>
      </div>
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
