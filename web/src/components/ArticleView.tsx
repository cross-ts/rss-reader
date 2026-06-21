import DOMPurify from 'dompurify';
import { type Article } from '../api/client';

interface Props {
  article: Article | null;
}

export function ArticleView({ article }: Props) {
  if (!article) {
    return (
      <section className="article-view empty">
        <p>記事を選択してください</p>
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
    <section className="article-view">
      <div className="article-view-header">
        <h1 className="article-view-title">{article.title}</h1>
        <div className="article-view-meta">
          <span className="feed-title">{article.feedTitle}</span>
          {article.author && <span className="author">著者: {article.author}</span>}
          <span className="pub-date">{formatDate(article.publishedAt)}</span>
        </div>
        {/^https?:\/\//.test(article.url) ? (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="original-link"
          >
            元記事を開く ↗
          </a>
        ) : null}
      </div>

      <div
        className="article-view-body"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.content) }}
      />
    </section>
  );
}
