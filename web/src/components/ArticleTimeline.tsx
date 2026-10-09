import type { ReactNode } from 'react';
import type { Article } from '../api/client';
import { useArticles } from '../hooks/useArticles';
import { useSetRead } from '../hooks/useArticleMutations';
import { useLoadMore } from '../hooks/useLoadMore';
import { ArticleCard } from './ArticleCard';

export const Spinner = () => (
  <span className="mr-2 inline-block size-3.5 animate-spin rounded-full border-2 border-line border-t-accent align-[-2px]" />
);

export function ArticleTimeline({ q, emptyText }: { q: string; emptyText: string }) {
  const query = useArticles(q);
  const setRead = useSetRead();
  return (
    <TimelineList
      query={query}
      emptyText={emptyText}
      renderItem={(a) => <ArticleCard key={a.id} article={a} onSetRead={setRead} />}
    />
  );
}

/**
 * useArticles の結果を Loading / エラー / 空 / 一覧 + 無限スクロールで描く。
 * end は最後のページまで読み終えたときだけ一覧の末尾に出す。
 */
export function TimelineList({
  query,
  emptyText,
  renderItem,
  end,
}: {
  query: ReturnType<typeof useArticles>;
  emptyText: ReactNode;
  renderItem: (a: Article, i: number, all: Article[]) => ReactNode;
  end?: ReactNode;
}) {
  const { articles, isPending, isError, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, refetch } = query;
  const sentinel = useLoadMore({ hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage });

  if (isPending) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        <Spinner />
        Loading…
      </div>
    );
  }
  if (isError && articles.length === 0) {
    return (
      <div className="px-5 py-16 text-center text-muted">
        読み込みに失敗しました。
        <button type="button" onClick={() => refetch()} className="ml-2 text-accent underline">
          再試行
        </button>
      </div>
    );
  }
  if (articles.length === 0) return end ?? <div className="px-5 py-16 text-center text-muted">{emptyText}</div>;

  return (
    <>
      {articles.map((a, i) => renderItem(a, i, articles))}
      {hasNextPage && isFetchNextPageError && !isFetchingNextPage ? (
        <div className="py-8 text-center text-sm text-muted">
          読み込みに失敗しました。
          <button type="button" onClick={() => fetchNextPage()} className="ml-2 text-accent underline">
            再試行
          </button>
        </div>
      ) : hasNextPage ? (
        <div ref={sentinel} className="py-8 text-center text-sm text-muted">
          <Spinner />
          Loading more…
        </div>
      ) : (
        end
      )}
    </>
  );
}
