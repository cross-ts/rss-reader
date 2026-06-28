import { useState, useMemo } from 'react';
import { type Article } from '../api/client';
import { extractThumbnail } from '../utils/thumbnail';
import { relativeTime } from '../utils/time';
import { decodeEntities } from '../utils/decodeEntities';

interface Props {
  articles: Article[];
  isLoading: boolean;
  isError: boolean;
  hasFeeds: boolean;
  selectedArticleId: number | null;
  onSelectArticle: (article: Article) => void;
  onRetry?: () => void;
  addingFeedName?: string | null;
  onOpenAddFeed?: () => void;
  onOpenOpmlGuide?: () => void;
  searchQuery?: string;
  unreadOnly?: boolean;
  totalCount?: number;
  selectionLabel?: string;
  onClearSearch?: () => void;
  onToggleUnreadOnly?: () => void;
  onRefresh?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isFetchingMore?: boolean;
}

// ---- Skeleton placeholders ----

function SkeletonRow() {
  return (
    <div className="w-full flex items-center gap-3 px-5 py-3 border-b border-border">
      <div className="skeleton w-14 h-14 rounded-lg flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="skeleton h-4 w-4/5" />
        <div className="skeleton h-3 w-2/5" />
      </div>
      <div className="skeleton h-3 w-12 flex-shrink-0" />
    </div>
  );
}

export function ArticleList({
  articles,
  isLoading,
  isError,
  hasFeeds,
  selectedArticleId,
  onSelectArticle,
  onRetry,
  addingFeedName,
  onOpenAddFeed,
  onOpenOpmlGuide,
  searchQuery,
  unreadOnly,
  totalCount,
  selectionLabel,
  onClearSearch,
  onToggleUnreadOnly,
  onRefresh,
  onLoadMore,
  hasMore,
  isFetchingMore,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: 10 }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-danger mb-3">Failed to load articles</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Show fetching state when a feed is being added
  if (addingFeedName && articles.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-text-sub">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span>{addingFeedName} から記事を取得しています…</span>
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (articles.length === 0) {
    if (!hasFeeds) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_40%),linear-gradient(180deg,_#ffffff_0%,_#fff9f0_100%)]">
          <div className="w-full max-w-xl px-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-accent/15">
              <svg className="h-8 w-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h8m3 0v6m0 0h6m-6 0l6-6M9 10h4M9 14h6" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
              まだフィードが登録されていません
            </h2>
            <p className="mt-3 text-sm leading-6 text-text-sub">
              最初のフィードを追加すると、ここに最新の記事が並びます。URL を貼って追加するか、OPML を使って既存の購読を移行できます。
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={onOpenAddFeed}
                className="inline-flex min-w-[240px] items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="text-base leading-none">+</span>
                最初のフィードを追加する
              </button>
              <button
                onClick={onOpenOpmlGuide}
                className="inline-flex min-w-[200px] items-center justify-center gap-2 rounded-xl border border-border bg-white px-5 py-3 text-sm font-medium text-text-primary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                OPML の使い方を見る
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (unreadOnly && (totalCount ?? 0) > 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg className="w-12 h-12 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-text-sub">未読記事はありません</p>
            {onToggleUnreadOnly && (
              <button
                onClick={onToggleUnreadOnly}
                className="text-sm text-accent hover:text-accent-hover transition-colors mt-2 block mx-auto"
              >
                すべての記事を表示
              </button>
            )}
          </div>
        </div>
      );
    }

    if (searchQuery) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg className="w-12 h-12 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-sm text-text-sub">&ldquo;{searchQuery}&rdquo; に一致する記事はありません</p>
            {selectionLabel && (
              <p className="text-xs text-text-muted mt-1">{selectionLabel} を検索</p>
            )}
            {onClearSearch && (
              <button
                onClick={onClearSearch}
                className="text-sm text-accent hover:text-accent-hover transition-colors mt-2 block mx-auto"
              >
                検索をクリア
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-12 h-12 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <p className="text-sm text-text-sub">{selectionLabel ? `${selectionLabel} に記事がありません` : '記事がありません'}</p>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none mt-4"
            >
              更新
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {articles.map((article) => (
        <ArticleRow
          key={article.id}
          article={article}
          selected={selectedArticleId === article.id}
          read={article.isRead}
          onSelect={() => onSelectArticle(article)}
        />
      ))}
      {hasMore && (
        <div className="py-4 text-center">
          {isFetchingMore ? (
            <span className="inline-flex items-center gap-2 text-sm text-text-sub">
              <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              読み込み中…
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onLoadMore?.()}
              className="text-sm text-accent hover:text-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              もっと読む
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- List Row ----

function ArticleRow({
  article,
  selected,
  read,
  onSelect,
}: {
  article: Article;
  selected: boolean;
  read: boolean;
  onSelect: () => void;
}) {
  const thumbnail = useMemo(() => extractThumbnail(article.content), [article.content]);
  const [imgError, setImgError] = useState(false);
  const showImg = thumbnail && !imgError;
  const decodedTitle = useMemo(() => decodeEntities(article.title), [article.title]);

  return (
    <button
      data-article-id={article.id}
      onClick={onSelect}
      className={[
        'w-full text-left flex items-center gap-3 px-5 py-3 border-b border-border transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
        selected
          ? 'bg-accent-light'
          : 'hover:bg-bg-alt',
        read ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Small thumbnail */}
      {showImg && (
        <div className="w-14 h-14 rounded-lg bg-bg-alt overflow-hidden flex-shrink-0">
          <img
            src={thumbnail}
            alt=""
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Unread dot */}
      {!read && (
        <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
      )}

      {/* Text */}
      <div className="flex-1 min-w-0">
        <h3 className={[
          'text-[13px] leading-snug truncate',
          read ? 'font-normal text-text-sub' : 'font-semibold text-text-primary',
        ].join(' ')}>
          {decodedTitle}
        </h3>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-sub">
          <span className="truncate">{article.feedTitle}</span>
        </div>
      </div>

      {article.starred && (
        <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      )}

      {/* Date */}
      <span className="flex-shrink-0 text-[11px] text-text-muted">
        {relativeTime(article.publishedAt)}
      </span>
    </button>
  );
}
