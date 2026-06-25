import { useState, useMemo, useCallback } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconRail } from './components/IconRail';
import { Sidebar, type SidebarSelection } from './components/Sidebar';
import { Topbar, type ViewMode } from './components/Topbar';
import { ArticleList } from './components/ArticleList';
import { ArticleView } from './components/ArticleView';
import { useReadState } from './hooks/useReadState';
import { usePersistedState } from './hooks/usePersistedState';
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

function AppInner() {
  const qc = useQueryClient();
  const { isRead, markRead, markAllRead, readIds } = useReadState();

  // Navigation state
  const [selection, setSelection] = useState<SidebarSelection>({ type: 'newsfeed' });
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [railView, setRailView] = useState<'newsfeed' | 'search' | 'add' | 'settings'>('newsfeed');

  // Search state
  const [searchText, setSearchText] = useState('');
  const [committedQ, setCommittedQ] = useState('');

  // Persisted preferences
  const [viewMode, setViewMode] = usePersistedState<ViewMode>('rss.viewMode', 'grid');
  const [unreadOnly, setUnreadOnly] = usePersistedState<boolean>('rss.unreadOnly', false);

  // Build query params from selection
  const queryParams = useMemo(() => {
    const params: { folderId?: number; feedId?: number; q?: string; limit?: number } = {
      limit: 100,
    };
    if (selection.type === 'folder') params.folderId = selection.folderId;
    if (selection.type === 'feed') params.feedId = selection.feedId;
    if (committedQ) params.q = committedQ;
    return params;
  }, [selection, committedQ]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['articles', queryParams],
    queryFn: () => api.getArticles(queryParams),
  });

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
    },
  });

  // Filter articles by read state if unreadOnly
  const articles = useMemo(() => {
    const items = data?.items ?? [];
    if (!unreadOnly) return items;
    return items.filter((a) => !isRead(a.id));
  }, [data, unreadOnly, isRead]);

  // View title
  const viewTitle = useMemo(() => {
    if (committedQ) return `Search: "${committedQ}"`;
    switch (selection.type) {
      case 'newsfeed': return 'All Articles';
      case 'folder': return selection.folderName;
      case 'feed': {
        const feed = feeds.find((f) => f.id === selection.feedId);
        return feed?.title || 'Feed';
      }
    }
  }, [selection, feeds, committedQ]);

  const handleSelectArticle = useCallback((article: Article) => {
    setSelectedArticle(article);
  }, []);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  const handleSelect = useCallback((sel: SidebarSelection) => {
    setSelection(sel);
    setSelectedArticle(null);
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
      setSelectedArticle(null);
    }
    if (view === 'search') {
      // Focus search - no selection change needed
    }
  }, []);

  const handleSearchSubmit = useCallback(() => {
    setCommittedQ(searchText.trim());
  }, [searchText]);

  const handleSearchClear = useCallback(() => {
    setSearchText('');
    setCommittedQ('');
  }, []);

  const handleMarkAllRead = useCallback(() => {
    const ids = articles.map((a) => a.id);
    markAllRead(ids);
  }, [articles, markAllRead]);

  const handleToggleViewMode = useCallback(() => {
    setViewMode((prev) => prev === 'grid' ? 'list' : 'grid');
  }, [setViewMode]);

  const handleToggleUnreadOnly = useCallback(() => {
    setUnreadOnly((prev) => !prev);
  }, [setUnreadOnly]);

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
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <Topbar
          viewTitle={viewTitle}
          searchText={searchText}
          onSearchChange={setSearchText}
          onSearchSubmit={handleSearchSubmit}
          onSearchClear={handleSearchClear}
          hasActiveSearch={!!committedQ}
          unreadOnly={unreadOnly}
          onToggleUnreadOnly={handleToggleUnreadOnly}
          viewMode={viewMode}
          onToggleViewMode={handleToggleViewMode}
          onMarkAllRead={handleMarkAllRead}
          onRefresh={() => refresh.mutate()}
          isRefreshing={refresh.isPending}
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
              selectedArticleId={selectedArticle?.id ?? null}
              onSelectArticle={handleSelectArticle}
              viewMode={selectedArticle ? 'list' : viewMode}
              isRead={isRead}
            />
          </div>

          {/* Article view (right panel) */}
          {selectedArticle && (
            <ArticleView
              article={selectedArticle}
              onClose={handleCloseArticle}
              onMarkRead={markRead}
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
      <AppInner />
    </QueryClientProvider>
  );
}
