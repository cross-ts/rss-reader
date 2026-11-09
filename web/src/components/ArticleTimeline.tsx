import { useEffect, useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Spinner } from '@astryxdesign/core/Spinner';
import { useArticles } from '../hooks/useArticles';
import { useSetRead } from '../hooks/useArticleMutations';
import { ArticleRow } from './ArticleRow';

function RowSkeleton({ index }: { index: number }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-7 first:border-t" aria-hidden="true">
      <Skeleton width={160} height={12} index={index} />
      <Skeleton width="80%" height={22} index={index} />
      <Skeleton width="95%" height={14} index={index} />
    </div>
  );
}

export function ArticleTimeline({ q, emptyTitle, emptyDescription }: { q: string; emptyTitle: string; emptyDescription?: string }) {
  const { articles, isPending, isError, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, refetch } =
    useArticles(q);
  const setRead = useSetRead();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    // 次ページ取得に失敗したら監視を止める（無限リトライ防止）。再試行は手動。
    if (!el || !hasNextPage || isFetchNextPageError) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (isPending) {
    return (
      <div role="status" aria-label="読み込み中">
        {[0, 1, 2, 3].map((i) => (
          <RowSkeleton key={i} index={i} />
        ))}
      </div>
    );
  }
  if (isError && articles.length === 0) {
    return (
      <div className="py-20">
        <EmptyState
          title="読み込みに失敗しました"
          description="サーバーに接続できませんでした。"
          actions={<Button label="再試行" onClick={() => refetch()} />}
        />
      </div>
    );
  }
  if (articles.length === 0) {
    return (
      <div className="py-20">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div>
      {articles.map((a) => (
        <ArticleRow key={a.id} article={a} onSetRead={setRead} />
      ))}
      {hasNextPage && isFetchNextPageError && !isFetchingNextPage ? (
        <div className="flex justify-center py-10">
          <Button label="続きを再読み込み" onClick={() => fetchNextPage()} />
        </div>
      ) : (
        hasNextPage && (
          <div ref={sentinel} className="flex justify-center py-10">
            <Spinner label="さらに読み込み中" />
          </div>
        )
      )}
    </div>
  );
}
