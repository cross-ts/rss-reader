import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { dedupeById } from '../utils/articles';

export const PAGE_SIZE = 30;

/** 記事の無限スクロール取得。q='' は全記事（Home）。id で重複を除いて返す。 */
export function useArticles(q: string) {
  const query = useInfiniteQuery({
    queryKey: ['articles', q],
    queryFn: ({ pageParam }) => api.getArticles({ q: q || undefined, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const n = all.reduce((s, p) => s + p.items.length, 0);
      return n < last.total && last.items.length > 0 ? n : undefined;
    },
  });

  const articles = useMemo(() => dedupeById(query.data?.pages ?? []), [query.data]);

  return { ...query, articles };
}
