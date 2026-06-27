import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ArticleListResponse } from '../api/client';

export function useArticleMutations() {
  const queryClient = useQueryClient();

  const markReadMutation = useMutation({
    mutationFn: (id: number) => api.updateArticle(id, { isRead: true }),
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ['articles'] });
      const previousQueries = queryClient.getQueriesData<ArticleListResponse>({ queryKey: ['articles'] });
      queryClient.setQueriesData<ArticleListResponse>({ queryKey: ['articles'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) => (a.id === id ? { ...a, isRead: true, readAt: new Date().toISOString() } : a)),
        };
      });
      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      context?.previousQueries.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
    },
  });

  const toggleReadMutation = useMutation({
    mutationFn: ({ id, currentIsRead }: { id: number; currentIsRead: boolean }) =>
      api.updateArticle(id, { isRead: !currentIsRead }),
    onMutate: async ({ id, currentIsRead }) => {
      await queryClient.cancelQueries({ queryKey: ['articles'] });
      const previousQueries = queryClient.getQueriesData<ArticleListResponse>({ queryKey: ['articles'] });
      queryClient.setQueriesData<ArticleListResponse>({ queryKey: ['articles'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) =>
            a.id === id ? { ...a, isRead: !currentIsRead, readAt: !currentIsRead ? new Date().toISOString() : null } : a,
          ),
        };
      });
      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      context?.previousQueries.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: (ids: number[]) => api.markArticlesRead(ids),
    onMutate: async (ids: number[]) => {
      await queryClient.cancelQueries({ queryKey: ['articles'] });
      const previousQueries = queryClient.getQueriesData<ArticleListResponse>({ queryKey: ['articles'] });
      const idSet = new Set(ids);
      queryClient.setQueriesData<ArticleListResponse>({ queryKey: ['articles'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) =>
            idSet.has(a.id) ? { ...a, isRead: true, readAt: new Date().toISOString() } : a,
          ),
        };
      });
      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      context?.previousQueries.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
    },
  });

  const toggleStarredMutation = useMutation({
    mutationFn: ({ id, currentStarred }: { id: number; currentStarred: boolean }) =>
      api.updateArticle(id, { starred: !currentStarred }),
    onMutate: async ({ id, currentStarred }) => {
      await queryClient.cancelQueries({ queryKey: ['articles'] });
      const previousQueries = queryClient.getQueriesData<ArticleListResponse>({ queryKey: ['articles'] });
      queryClient.setQueriesData<ArticleListResponse>({ queryKey: ['articles'] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) => (a.id === id ? { ...a, starred: !currentStarred } : a)),
        };
      });
      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      context?.previousQueries.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['unreadCounts'] });
    },
  });

  const markRead = useCallback((id: number) => markReadMutation.mutate(id), [markReadMutation]);
  const toggleRead = useCallback((id: number, currentIsRead: boolean) => toggleReadMutation.mutate({ id, currentIsRead }), [toggleReadMutation]);
  const markAllRead = useCallback((ids: number[]) => markAllReadMutation.mutate(ids), [markAllReadMutation]);
  const toggleStarred = useCallback((id: number, currentStarred: boolean) => toggleStarredMutation.mutate({ id, currentStarred }), [toggleStarredMutation]);

  return { markRead, toggleRead, markAllRead, toggleStarred };
}
