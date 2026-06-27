import { useState, useMemo } from 'react';
import { type Article } from '../api/client';
import { extractThumbnail } from '../utils/thumbnail';
import { relativeTime } from '../utils/time';
import { decodeEntities } from '../utils/decodeEntities';

interface Props {
  articles: Article[];
  isLoading: boolean;
  isError: boolean;
  selectedArticleId: number | null;
  onSelectArticle: (article: Article) => void;
  isRead: (id: number) => boolean;
  onRetry?: () => void;
  addingFeedName?: string | null;
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
  selectedArticleId,
  onSelectArticle,
  isRead,
  onRetry,
  addingFeedName,
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
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-12 h-12 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <p className="text-sm text-text-sub">No articles found</p>
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
          read={isRead(article.id)}
          onSelect={() => onSelectArticle(article)}
        />
      ))}
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

      {/* Date */}
      <span className="flex-shrink-0 text-[11px] text-text-muted">
        {relativeTime(article.publishedAt)}
      </span>
    </button>
  );
}
