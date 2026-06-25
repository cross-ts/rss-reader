import { useState, useMemo } from 'react';
import { type Article } from '../api/client';
import { extractThumbnail } from '../utils/thumbnail';
import { relativeTime } from '../utils/time';
import type { ViewMode } from './Topbar';

interface Props {
  articles: Article[];
  isLoading: boolean;
  isError: boolean;
  selectedArticleId: number | null;
  onSelectArticle: (article: Article) => void;
  viewMode: ViewMode;
  isRead: (id: number) => boolean;
}

export function ArticleList({
  articles,
  isLoading,
  isError,
  selectedArticleId,
  onSelectArticle,
  viewMode,
  isRead,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-text-sub">Loading articles...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-danger">Failed to load articles</p>
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

  if (viewMode === 'grid') {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              selected={selectedArticleId === article.id}
              read={isRead(article.id)}
              onSelect={() => onSelectArticle(article)}
            />
          ))}
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

// ---- Grid Card ----

function ArticleCard({
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

  return (
    <button
      onClick={onSelect}
      className={[
        'w-full text-left bg-white rounded-xl border overflow-hidden transition-all group',
        selected
          ? 'border-accent shadow-card-hover ring-1 ring-accent/20'
          : 'border-border shadow-card hover:shadow-card-hover hover:border-border-strong',
        read ? 'opacity-70' : '',
      ].join(' ')}
    >
      {/* Thumbnail */}
      {showImg && (
        <div className="w-full h-36 bg-bg-alt overflow-hidden">
          <img
            src={thumbnail}
            alt=""
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      )}

      {/* Content */}
      <div className="p-3">
        <h3 className={[
          'text-[13px] leading-snug mb-1.5 line-clamp-2',
          read ? 'font-normal text-text-sub' : 'font-semibold text-text-primary',
        ].join(' ')}>
          {!read && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-1.5 -translate-y-px flex-shrink-0" />
          )}
          {article.title}
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-text-sub">
          <span className="truncate">{article.feedTitle}</span>
          <span className="flex-shrink-0 text-text-muted">{relativeTime(article.publishedAt)}</span>
        </div>
      </div>
    </button>
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

  return (
    <button
      onClick={onSelect}
      className={[
        'w-full text-left flex items-center gap-3 px-5 py-3 border-b border-border transition-colors',
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
          {article.title}
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
