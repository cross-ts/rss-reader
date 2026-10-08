import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Feed } from '../api/client';
import { useToast } from '../components/Toast';

/** 購読画面のミューテーション。成功時は folders / feeds / unreadCounts を取り直す。 */
export function useSubscriptionMutations() {
  const qc = useQueryClient();
  const toast = useToast();

  const refreshLists = (articles: boolean) => () => {
    for (const k of ['folders', 'feeds', 'unreadCounts']) qc.invalidateQueries({ queryKey: [k] });
    // 購読画面では ['articles'] は非アクティブなので、stale 印が付くだけで再取得されない
    if (articles) qc.invalidateQueries({ queryKey: ['articles'] });
  };
  const onError = (e: Error) => toast(e.message.startsWith('HTTP 409') ? '同名のフォルダがあります' : '操作に失敗しました');

  const createFolder = useMutation({
    mutationFn: (name: string) => api.createFolder(name),
    onSuccess: refreshLists(false),
    onError,
  });
  const renameFolder = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.updateFolder(id, name),
    onSuccess: refreshLists(false),
    onError,
  });
  const deleteFolder = useMutation({
    mutationFn: (id: number) => api.deleteFolder(id),
    onSuccess: refreshLists(false),
    onError,
  });
  const createFeed = useMutation({
    mutationFn: ({ url, folder }: { url: string; folder: string | null }) => api.createFeed(url, folder),
    onSuccess: refreshLists(true),
    onError,
  });
  const renameFeed = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) => api.updateFeed(id, { title }),
    onSuccess: refreshLists(true),
    onError,
  });
  const deleteFeed = useMutation({
    mutationFn: (id: number) => api.deleteFeed(id),
    onSuccess: refreshLists(true),
    onError,
  });
  // D&D の手応えのため、フォルダ移動だけ楽観的に更新する
  const moveFeed = useMutation({
    mutationFn: ({ id, folder }: { id: number; folder: string | null }) => api.updateFeed(id, { folder }),
    onMutate: async ({ id, folder }) => {
      await qc.cancelQueries({ queryKey: ['feeds'] });
      const prev = qc.getQueryData<Feed[]>(['feeds']);
      qc.setQueryData<Feed[]>(['feeds'], (old) => old?.map((f) => (f.id === id ? { ...f, folder } : f)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(['feeds'], ctx?.prev);
      onError(e);
    },
    onSettled: refreshLists(false),
  });

  return { createFolder, renameFolder, deleteFolder, createFeed, renameFeed, deleteFeed, moveFeed };
}
