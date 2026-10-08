import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api, type ArticleListResponse } from '../api/client';
import { useToast } from '../components/Toast';

type ArticlesData = InfiniteData<ArticleListResponse>;

/** 既読/未読の楽観的更新。['articles'] は invalidate せず、未読数だけ取り直す。 */
export function useSetRead() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, isRead }: { id: number; isRead: boolean }) => api.updateArticle(id, { isRead }),
    onMutate: async ({ id, isRead }) => {
      await queryClient.cancelQueries({ queryKey: ['articles'] });
      const previous = queryClient.getQueriesData<ArticlesData>({ queryKey: ['articles'] });
      const readAt = isRead ? new Date().toISOString() : null;
      queryClient.setQueriesData<ArticlesData>({ queryKey: ['articles'] }, (old) =>
        old && {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((a) => (a.id === id ? { ...a, isRead, readAt } : a)),
          })),
        },
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast('更新に失敗しました');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
    },
  });

  return (id: number, isRead: boolean) => mutation.mutate({ id, isRead });
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
      await queryClient.resetQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
      const n = [...firstIds()].filter((id) => !before.has(id)).length;
      toast(n > 0 ? `${n} 件の新着` : '新着はありません');
    } catch {
      toast('更新に失敗しました');
    }
  };
}
