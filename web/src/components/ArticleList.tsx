import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Article } from '../api/client';

interface Props {
  folderId: number | null;
  feedId: number | null;
  selectedArticleId: number | null;
  onSelectArticle: (article: Article) => void;
}

export function ArticleList({ folderId, feedId, selectedArticleId, onSelectArticle }: Props) {
  const qc = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [committedQ, setCommittedQ] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['articles', { folderId, feedId, q: committedQ }],
    queryFn: () =>
      api.getArticles({
        folderId: folderId ?? undefined,
        feedId: feedId ?? undefined,
        q: committedQ || undefined,
        limit: 50,
      }),
  });

  const refresh = useMutation({
    mutationFn: () => api.refresh(feedId ?? undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['articles'] });
      qc.invalidateQueries({ queryKey: ['feeds'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCommittedQ(searchText.trim());
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '日付不明';
    try {
      return new Date(iso).toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '日付不明';
    }
  };

  const stripHtml = (html: string) => {
    return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  };

  const articles = data?.items ?? [];

  return (
    <section className="article-list">
      <div className="article-list-toolbar">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="search"
            placeholder="キーワード検索…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <button type="submit">検索</button>
          {committedQ && (
            <button type="button" onClick={() => { setSearchText(''); setCommittedQ(''); }}>
              クリア
            </button>
          )}
        </form>
        <button
          className="refresh-btn"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? '更新中…' : '全フィード更新'}
        </button>
      </div>

      {refresh.isSuccess && (
        <p className="refresh-result">{refresh.data.refreshed} 件更新しました</p>
      )}

      {isLoading && <p className="status-msg">読み込み中…</p>}
      {isError && <p className="status-msg error">記事の取得に失敗しました</p>}

      {!isLoading && !isError && articles.length === 0 && (
        <p className="status-msg">記事がありません</p>
      )}

      <ul className="article-cards">
        {articles.map((article) => (
          <li
            key={article.id}
            className={`article-card${selectedArticleId === article.id ? ' selected' : ''}`}
            onClick={() => onSelectArticle(article)}
          >
            <div className="article-card-title">{article.title}</div>
            <div className="article-card-meta">
              <span className="feed-title">{article.feedTitle}</span>
              <span className="pub-date">{formatDate(article.publishedAt)}</span>
            </div>
            <p className="article-card-excerpt">
              {stripHtml(article.content).slice(0, 120)}
              {stripHtml(article.content).length > 120 ? '…' : ''}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
