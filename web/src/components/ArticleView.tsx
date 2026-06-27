import { useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { type Article } from '../api/client';
import { relativeTime } from '../utils/time';
import { decodeEntities } from '../utils/decodeEntities';

interface Props {
  article: Article | null;
  onClose: () => void;
  onMarkRead: (id: number) => void;
  isRead?: boolean;
  onToggleRead?: () => void;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  onNextUnread?: (() => void) | null;
  starred?: boolean;
  onToggleStarred?: () => void;
}

export function ArticleView({ article, onClose, onMarkRead, isRead, onToggleRead, onPrev, onNext, onNextUnread, starred, onToggleStarred }: Props) {
  // Mark as read when article is opened
  useEffect(() => {
    if (article && !article.isRead) {
      onMarkRead(article.id);
    }
  }, [article, onMarkRead]);

  const decodedTitle = useMemo(
    () => (article ? decodeEntities(article.title) : ''),
    [article],
  );

  if (!article) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-alt">
        <div className="text-center">
          <svg className="w-16 h-16 text-text-muted/30 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
          <p className="text-sm text-text-muted">Select an article to read</p>
        </div>
      </div>
    );
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const isValidUrl = /^https?:\/\//i.test(article.url);

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Article header */}
      <div className="flex-shrink-0 px-8 pt-6 pb-4 border-b border-border">
        <div className="max-w-3xl mx-auto">
          {/* Close + navigation buttons */}
          <div className="flex items-start gap-2 mb-4">
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-sub hover:bg-bg-alt hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              aria-label="Close article"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>

            {/* Navigation buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={onPrev ?? undefined}
                disabled={!onPrev}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-sub hover:bg-bg-alt hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                aria-label="Previous article"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                </svg>
              </button>
              <button
                onClick={onNext ?? undefined}
                disabled={!onNext}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-sub hover:bg-bg-alt hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                aria-label="Next article"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={onNextUnread ?? undefined}
                disabled={!onNextUnread}
                className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium text-text-sub hover:bg-bg-alt hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                aria-label="Next unread article"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Next unread
              </button>
              {onToggleRead && (
                <button
                  onClick={onToggleRead}
                  className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium text-text-sub hover:bg-bg-alt hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  aria-label={isRead ? 'Mark as unread' : 'Mark as read'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {isRead ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    )}
                  </svg>
                  {isRead ? 'Unread' : 'Read'}
                </button>
              )}
              {onToggleStarred && (
                <button
                  onClick={onToggleStarred}
                  className={[
                    'flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                    starred ? 'text-amber-500 hover:bg-bg-alt' : 'text-text-sub hover:bg-bg-alt hover:text-text-primary',
                  ].join(' ')}
                  aria-label={starred ? 'Unstar' : 'Star'}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  {starred ? 'Starred' : 'Star'}
                </button>
              )}
            </div>

            <h1 className="text-xl font-bold text-text-primary leading-snug flex-1 ml-1">
              {decodedTitle}
            </h1>
          </div>

          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-3 text-sm pl-11">
            <span className="text-accent font-medium">{article.feedTitle}</span>
            {article.author && (
              <>
                <span className="text-text-muted">by</span>
                <span className="text-text-primary">{article.author}</span>
              </>
            )}
            <span className="text-text-muted" title={formatDate(article.publishedAt)}>
              {relativeTime(article.publishedAt)}
            </span>
          </div>

          {/* Original link */}
          {isValidUrl && (
            <div className="mt-3 pl-11">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-alt border border-border rounded-lg text-xs text-accent font-medium hover:bg-accent-light hover:border-accent/30 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Open original
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Article body */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div
          className="article-view-body max-w-3xl mx-auto pl-11"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.content) }}
        />
      </div>
    </div>
  );
}
