import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type Article } from '../api/client';

export const PAGE_SIZE = 30;

/**
 * 記事の無限スクロール取得。q='' は全記事（Home）。id で重複を除いて返す。
 * unreadOnly のときは「読み込み済みのうちまだ未読の件数」を次の offset にする
 * （このセッションで既読にした分だけサーバー側の未読リストが縮むため）。
 */
export function useArticles(
  q: string,
  { unreadOnly = false, enabled = true }: { unreadOnly?: boolean; enabled?: boolean } = {},
) {
  const query = useInfiniteQuery({
    queryKey: unreadOnly ? ['articles', q, 'unread'] : ['articles', q],
    queryFn: ({ pageParam }) =>
      api.getArticles({ q: q || undefined, unreadOnly: unreadOnly || undefined, limit: PAGE_SIZE, offset: pageParam }),
    enabled,
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const items = all.flatMap((p) => p.items);
      const n = unreadOnly ? items.filter((a) => !a.isRead).length : items.length;
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
