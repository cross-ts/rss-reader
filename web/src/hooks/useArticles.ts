import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type Article } from '../api/client';

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

  const articles = useMemo(() => {
    const seen = new Set<number>();
    const out: Article[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const a of page.items) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          out.push(a);
        }
      }
    }
    return out;
  }, [query.data]);

  return { ...query, articles };
}
