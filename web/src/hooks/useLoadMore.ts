import { useEffect, useRef } from 'react';

interface Pager {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => unknown;
}

/** 返した ref の要素が画面に近づいたら次ページを取る。次ページ取得に失敗したら監視を止める（再試行は手動）。 */
export function useLoadMore<T extends HTMLElement = HTMLDivElement>({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
}: Pager) {
  const sentinel = useRef<T>(null);
  useEffect(() => {
    const el = sentinel.current;
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
  return sentinel;
}
