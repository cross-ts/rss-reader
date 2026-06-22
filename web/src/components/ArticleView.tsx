import DOMPurify from 'dompurify';
import { type Article } from '../api/client';

interface Props {
  article: Article | null;
}

export function ArticleView({ article }: Props) {
  if (!article) {
    return (
      <section className="bg-bg flex items-center justify-center h-screen overflow-y-auto">
        <p className="text-xs text-text-sub">記事を選択してください</p>
      </section>
    );
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '日付不明';
    try {
      return new Date(iso).toLocaleString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '日付不明';
    }
  };

  return (
    <section className="bg-bg overflow-y-auto h-screen px-8 py-8 max-w-none">
      {/* ヘッダー */}
      <div className="mb-6 pb-5 border-b border-border max-w-3xl mx-auto">
        <h1 className="text-lg font-bold text-text-primary leading-snug mb-3">
          {article.title}
        </h1>
        <div className="flex flex-wrap gap-3 mb-3">
          <span className="font-mono text-xs text-accent font-semibold">{article.feedTitle}</span>
          {article.author && (
            <span className="font-mono text-xs text-text-sub">著者: {article.author}</span>
          )}
          <span className="font-mono text-xs text-text-sub">{formatDate(article.publishedAt)}</span>
        </div>
        {/^https?:\/\//.test(article.url) ? (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 border border-border rounded text-xs font-mono text-accent hover:border-accent hover:bg-surface-3 transition-colors"
          >
            元記事を開く ↗
          </a>
        ) : null}
      </div>

      {/* 本文 */}
      <div
        className="article-view-body text-text-primary max-w-3xl mx-auto"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.content) }}
      />
    </section>
  );
}
