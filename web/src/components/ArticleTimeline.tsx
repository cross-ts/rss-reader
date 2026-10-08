import { useEffect, useRef } from 'react';
import { useArticles } from '../hooks/useArticles';
import { useSetRead } from '../hooks/useArticleMutations';
import { ArticleCard } from './ArticleCard';

const Spinner = () => (
  <span className="mr-2 inline-block size-3.5 animate-spin rounded-full border-2 border-line border-t-accent align-[-2px]" />
);

export function ArticleTimeline({ q, emptyText }: { q: string; emptyText: string }) {
  const { articles, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useArticles(q);
  const setRead = useSetRead();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
  if (articles.length === 0) return <div className="px-5 py-16 text-center text-muted">{emptyText}</div>;

  return (
    <>
      {articles.map((a) => (
        <ArticleCard key={a.id} article={a} onSetRead={setRead} />
      ))}
      {hasNextPage && (
        <div ref={sentinel} className="py-8 text-center text-sm text-muted">
          <Spinner />
          Loading more…
        </div>
      )}
    </>
  );
}
