import React from 'react';

interface Props {
  viewTitle: string;
  searchText: string;
  onSearchChange: (text: string) => void;
  onSearchClear: () => void;
  hasActiveSearch: boolean;
  unreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  onMarkAllRead: () => void;
  unreadCount: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  searchHitCount?: number | null;
  searchScope?: string;
  lastUpdated?: string | null;
  canToggleSidebar?: boolean;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function Topbar({
  viewTitle,
  searchText,
  onSearchChange,
  onSearchClear,
  hasActiveSearch,
  unreadOnly,
  onToggleUnreadOnly,
  onMarkAllRead,
  unreadCount,
  onRefresh,
  isRefreshing,
  searchHitCount,
  searchScope,
  lastUpdated,
  canToggleSidebar = false,
  isSidebarOpen = false,
  onToggleSidebar,
}: Props) {
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSearchClear();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="px-5 py-3 border-b border-border bg-surface flex-shrink-0">
      {/* Top row: title + last updated */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {canToggleSidebar && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-sub transition-colors hover:border-accent hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={isSidebarOpen}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <h1 className="min-w-0 text-base font-semibold text-text-primary truncate">{viewTitle}</h1>
        {lastUpdated && (
          <span className="flex-shrink-0 font-mono text-[10px] text-text-muted" title="Last updated">
            Updated {lastUpdated}
          </span>
        )}
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="flex w-full min-w-0 md:flex-1 md:max-w-md items-center gap-1.5">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search articles..."
              value={searchText}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-8 pr-8 py-1.5 bg-bg-alt border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
              aria-label="Search articles"
            />
            {(searchText || hasActiveSearch) && (
              <button
                onClick={onSearchClear}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary rounded-full hover:bg-surface-2"
                aria-label="Clear search"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {/* Search hit count + scope */}
          {hasActiveSearch && (
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-text-sub flex-shrink-0">
              {searchHitCount != null && (
                <span className="font-medium">{searchHitCount} hit{searchHitCount !== 1 ? 's' : ''}</span>
              )}
              {searchScope && (
                <span className="text-text-muted">in {searchScope}</span>
              )}
            </div>
          )}
        </div>

        {/* All / Unread filter segmented control */}
        <div
          className="inline-flex rounded-lg border border-border overflow-hidden min-h-[36px]"
          role="group"
          aria-label="Article filter"
        >
          <button
            onClick={() => unreadOnly && onToggleUnreadOnly()}
            className={[
              'px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
              !unreadOnly
                ? 'bg-accent text-white'
                : 'bg-surface text-text-sub hover:bg-surface-2 hover:text-text-primary',
            ].join(' ')}
            aria-label="Show all articles"
            aria-pressed={!unreadOnly}
          >
            All
          </button>
          <button
            onClick={() => !unreadOnly && onToggleUnreadOnly()}
            className={[
              'px-3 py-1.5 text-xs font-medium transition-colors border-l border-border focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
              unreadOnly
                ? 'bg-accent text-white'
                : 'bg-surface text-text-sub hover:bg-surface-2 hover:text-text-primary',
            ].join(' ')}
            aria-label="Show unread only"
            aria-pressed={unreadOnly}
          >
            Unread
          </button>
        </div>

        {/* Mark all read — destructive action, separated from filter */}
        <button
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface text-text-sub border border-border hover:border-danger hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[36px] focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none"
          aria-label={unreadCount > 0 ? `Mark ${unreadCount} as read` : 'Mark all as read'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {unreadCount > 0 ? `Mark ${unreadCount} as read` : 'Mark all as read'}
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface text-text-sub border border-border hover:border-accent hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[36px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          aria-label="Refresh feeds"
        >
          <svg className={['w-3.5 h-3.5', isRefreshing ? 'animate-spin' : ''].join(' ')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 14.652" />
          </svg>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
