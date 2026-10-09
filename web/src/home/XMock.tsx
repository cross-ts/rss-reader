import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ArticleCard } from '../components/ArticleCard';
import { TimelineList } from '../components/ArticleTimeline';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { PAGE_SIZE, useArticles } from '../hooks/useArticles';
import { reloadFirstPage, useSetRead } from '../hooks/useArticleMutations';
import { HomeHeader, RefreshButton, useUnreadTotal } from './HomeHeader';

const MARK_KEY = 'homeLastTopId';
const readMark = () => {
  try {
    return Number(localStorage.getItem(MARK_KEY)) || null;
  } catch {
    return null;
  }
};
const writeMark = (id: number) => {
  try {
    localStorage.setItem(MARK_KEY, String(id));
  } catch {
    // ignore
  }
};

/**
 * 案A（X / Mastodon 型）
 * - 新着は勝手に差し込まず、上部の「新着 N 件」ピルで知らせる。押したら先頭へ。
 * - 前回見た先頭記事の位置に「ここまで確認済み」の区切り線を引く。
 * - 縦方向の操作はスクロールのみ（pull-to-refresh を廃止し、更新はヘッダーのボタン）。
 */
export function XMock() {
  const query = useArticles('');
  const setRead = useSetRead();
  const qc = useQueryClient();
  const toast = useToast();
  const unread = useUnreadTotal();
  const topId = query.articles[0]?.id;

  // 前回の先頭記事 id。区切り線はこの記事の直前に引く。
  const [mark, setMark] = useState(readMark);
  useEffect(() => {
    if (topId != null) writeMark(topId);
  }, [topId]);

  // 1ページ目だけを定期的に覗いて、表示中の先頭より上にある件数を数える
  const head = useQuery({
    queryKey: ['articlesHead'],
    queryFn: () => api.getArticles({ limit: PAGE_SIZE }),
    enabled: topId != null,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const newCount = useMemo(() => {
    if (!head.data || topId == null) return 0;
    const i = head.data.items.findIndex((a) => a.id === topId);
    return i < 0 ? head.data.items.length : i;
  }, [head.data, topId]);

  const showNew = async () => {
    if (topId != null) setMark(topId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await reloadFirstPage(qc);
  };

  const refresh = async () => {
    try {
      await api.refresh();
      const r = await head.refetch();
      const i = r.data?.items.findIndex((a) => a.id === topId) ?? 0;
      if (i === 0) toast('新着はありません');
    } catch {
      toast('更新に失敗しました');
    }
  };

  return (
    <>
      <HomeHeader sub={unread != null && `未読 ${unread} 件`} actions={<RefreshButton onRefresh={refresh} />} />
      {newCount > 0 && (
        <div className="pointer-events-none sticky top-[64px] z-30 flex h-0 justify-center">
          <button
            type="button"
            onClick={showNew}
            className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-white shadow-lg"
          >
            <Icon name="up" small />
            新着 {newCount >= PAGE_SIZE ? `${PAGE_SIZE}+` : newCount} 件
          </button>
        </div>
      )}
      <TimelineList
        query={query}
        emptyText="記事がありません。"
        renderItem={(a, i) => (
          <div key={a.id}>
            {i > 0 && a.id === mark && (
              <div className="flex items-center gap-3 bg-panel px-3.5 py-2 text-xs font-semibold text-accent sm:px-5">
                <span className="h-px flex-1 bg-accent/60" />
                ここから下は前回確認済み
                <span className="h-px flex-1 bg-accent/60" />
              </div>
            )}
            <ArticleCard article={a} onSetRead={setRead} unreadBar />
          </div>
        )}
        end={<div className="px-5 py-12 text-center text-sm text-muted">これより古い記事はありません</div>}
      />
    </>
  );
}
