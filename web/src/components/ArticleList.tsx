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
    <section className="bg-surface border-r border-border flex flex-col overflow-hidden h-screen">
      {/* ツールバー */}
      <div className="px-3 py-3 border-b border-border flex-shrink-0 flex flex-col gap-2">
        <form onSubmit={handleSearch} className="flex gap-1.5">
          <input
            type="search"
            placeholder="キーワード検索…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1.5 bg-surface-2 border border-border rounded text-xs font-mono text-text-primary placeholder-text-sub focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="px-2.5 py-1.5 bg-surface-3 border border-border rounded text-xs text-text-sub hover:text-text-primary hover:border-accent transition-colors"
          >
            検索
          </button>
          {committedQ && (
            <button
              type="button"
              onClick={() => { setSearchText(''); setCommittedQ(''); }}
              className="px-2.5 py-1.5 bg-surface-3 border border-border rounded text-xs text-text-sub hover:text-danger hover:border-danger transition-colors"
            >
              クリア
            </button>
          )}
        </form>
        <button
          className="w-full px-3 py-1.5 bg-surface-2 border border-border rounded text-xs text-text-sub hover:border-accent hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? '更新中…' : '全フィード更新'}
        </button>
      </div>

      {refresh.isSuccess && (
        <p className="px-3 py-1.5 text-xs text-accent flex-shrink-0">
          {refresh.data.refreshed} 件更新しました
        </p>
      )}

      {/* 状態表示 */}
      {isLoading && (
        <p className="px-4 py-8 text-xs text-text-sub text-center">読み込み中…</p>
      )}
      {isError && (
        <p className="px-4 py-8 text-xs text-danger text-center">記事の取得に失敗しました</p>
      )}
      {!isLoading && !isError && articles.length === 0 && (
        <p className="px-4 py-8 text-xs text-text-sub text-center">記事がありません</p>
      )}

      {/* 記事カード一覧 */}
      <ul className="flex-1 overflow-y-auto">
        {articles.map((article) => {
          const excerpt = stripHtml(article.content);
          const isSelected = selectedArticleId === article.id;
          return (
            <li
              key={article.id}
              className={[
                'px-3 py-3 border-b border-border cursor-pointer transition-colors',
                isSelected
                  ? 'bg-surface-3 border-l-2 border-l-accent pl-[10px]'
                  : 'hover:bg-surface-2',
              ].join(' ')}
              onClick={() => onSelectArticle(article)}
            >
              <div className="text-xs font-semibold text-text-primary leading-snug mb-1 line-clamp-2">
                {article.title}
              </div>
              <div className="flex gap-2 mb-1">
                <span className="font-mono text-[10px] text-accent truncate max-w-[60%]">
                  {article.feedTitle}
                </span>
                <span className="font-mono text-[10px] text-text-sub ml-auto whitespace-nowrap">
                  {formatDate(article.publishedAt)}
                </span>
              </div>
              <p className="text-[11px] text-text-sub leading-relaxed line-clamp-2">
                {excerpt.slice(0, 120)}{excerpt.length > 120 ? '…' : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
