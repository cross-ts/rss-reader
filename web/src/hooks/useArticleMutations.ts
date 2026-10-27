import { useCallback } from 'react';
import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { api, type ArticleListResponse } from '../api/client';
import { useToast } from '../components/Toast';

type ArticlesData = InfiniteData<ArticleListResponse>;
type ReadPatch = { isRead: boolean; readAt: string | null };

const patchArticles = (queryClient: QueryClient, ids: ReadonlySet<number>, patch: ReadPatch) =>
  queryClient.setQueriesData<ArticlesData>({ queryKey: ['articles'] }, (old) =>
    old && {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        items: p.items.map((a) => (ids.has(a.id) ? { ...a, ...patch } : a)),
      })),
    },
  );

/** 既読/未読の楽観的更新。['articles'] は invalidate せず、未読数だけ取り直す。 */
export function useSetRead() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, isRead }: { id: number; isRead: boolean }) => api.updateArticle(id, { isRead }),
    onMutate: async ({ id, isRead }) => {
      await queryClient.cancelQueries({ queryKey: ['articles'] });
      // ロールバック用に、この記事の元の状態だけを記憶する（並行ミューテーションを巻き戻さない）
      let prev: ReadPatch | undefined;
      for (const [, data] of queryClient.getQueriesData<ArticlesData>({ queryKey: ['articles'] })) {
        const a = data?.pages.flatMap((p) => p.items).find((x) => x.id === id);
        if (a) {
          prev = { isRead: a.isRead, readAt: a.readAt };
          break;
        }
      }
      patchArticles(queryClient, new Set([id]), { isRead, readAt: isRead ? new Date().toISOString() : null });
      return { prev };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.prev) patchArticles(queryClient, new Set([id]), ctx.prev);
      toast('更新に失敗しました');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
    },
  });

  return (id: number, isRead: boolean) => mutation.mutate({ id, isRead });
}

/** 複数記事をまとめて既読にする（楽観的更新。失敗時は記事一覧を取り直す）。 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: (ids: number[]) => api.markRead(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ['articles'] });
      patchArticles(queryClient, new Set(ids), { isRead: true, readAt: new Date().toISOString() });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      toast('更新に失敗しました');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
    },
  });

  const { mutate } = mutation;
  return useCallback((ids: number[]) => {
    if (ids.length > 0) mutate(ids);
  }, [mutate]);
}

/** 記事一覧を「1ページ目だけ」に縮めて取り直す（reset だと Loading に戻ってガタつく）。 */
export async function reloadFirstPage(queryClient: QueryClient) {
  queryClient.setQueriesData<ArticlesData>({ queryKey: ['articles'] }, (d) =>
    d && { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) },
  );
  await queryClient.invalidateQueries({ queryKey: ['articles'] });
}

/** 全フィードを更新し、1ページ目だけ取り直して新着件数をトーストする。 */
export function useRefresh() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return async () => {
    const firstIds = () =>
      new Set(queryClient.getQueryData<ArticlesData>(['articles', ''])?.pages[0]?.items.map((a) => a.id));
    const before = firstIds();
    try {
      await api.refresh();
      await reloadFirstPage(queryClient);
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
      const n = [...firstIds()].filter((id) => !before.has(id)).length;
      toast(n > 0 ? `${n} 件の新着` : '新着はありません');
    } catch {
      toast('更新に失敗しました');
    }
  };
}
