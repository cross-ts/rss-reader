import { useEffect } from 'react';
import DOMPurify from 'dompurify';
import { type Article } from '../api/client';
import { relativeTime } from '../utils/time';

interface Props {
  article: Article | null;
  onClose: () => void;
  onMarkRead: (id: number) => void;
}

export function ArticleView({ article, onClose, onMarkRead }: Props) {
  // Mark as read when article is opened
  useEffect(() => {
    if (article) {
      onMarkRead(article.id);
    }
  }, [article, onMarkRead]);

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
          {/* Close button */}
          <div className="flex items-start gap-3 mb-4">
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-sub hover:bg-bg-alt hover:text-text-primary transition-colors"
              title="Close article"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-text-primary leading-snug flex-1">
              {article.title}
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-alt border border-border rounded-lg text-xs text-accent font-medium hover:bg-accent-light hover:border-accent/30 transition-colors"
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
