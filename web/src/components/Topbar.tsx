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
    <div className="px-5 py-3 border-b border-border bg-white flex-shrink-0">
      {/* Top row: title + last updated */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {canToggleSidebar && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-text-sub transition-colors hover:border-accent hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
          <span className="flex-shrink-0 text-[11px] text-text-muted" title="Last updated">
            Updated {lastUpdated}
          </span>
        )}
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 max-w-md">
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
            <div className="flex items-center gap-1.5 text-[11px] text-text-sub flex-shrink-0">
              {searchHitCount != null && (
                <span className="font-medium">{searchHitCount} hit{searchHitCount !== 1 ? 's' : ''}</span>
              )}
              {searchScope && (
                <span className="text-text-muted">in {searchScope}</span>
              )}
            </div>
          )}
        </div>

        {/* Unread only toggle */}
        <button
          onClick={onToggleUnreadOnly}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border min-h-[36px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
            unreadOnly
              ? 'bg-accent text-white border-accent'
              : 'bg-white text-text-sub border-border hover:border-accent hover:text-text-primary',
          ].join(' ')}
          aria-label={unreadOnly ? 'Show all articles' : 'Show unread only'}
          aria-pressed={unreadOnly}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
          Unread
        </button>

        {/* Mark all read */}
        <button
          onClick={onMarkAllRead}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-text-sub border border-border hover:border-accent hover:text-text-primary transition-colors min-h-[36px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          aria-label="Mark all as read"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          All Read
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-text-sub border border-border hover:border-accent hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[36px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
