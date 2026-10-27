import { useEffect, useRef } from 'react';
import { ArticleCard } from '../components/ArticleCard';
import { TimelineList } from '../components/ArticleTimeline';
import { Icon } from '../components/Icon';
import { useArticles } from '../hooks/useArticles';
import { useMarkRead, useRefresh, useSetRead } from '../hooks/useArticleMutations';
import { HeaderButton, HomeHeader, RefreshButton, useUnreadTotal } from './HomeHeader';

const HEADER = 56;

/**
 * 案B（Feedly / Inoreader 型）
 * - 画面上端を通り過ぎた未読記事を自動で既読にする（まとめて送信）。
 * - 開く前から既読だった記事は1行に圧縮。今回のスクロールで既読になった記事はその場で薄くするだけ（位置ずれ防止）。
 * - ヘッダーに未読数と「表示中を既読」。末尾に「読み終えました」+ 更新。
 */
export function FeedlyMock() {
  const query = useArticles('');
  const setRead = useSetRead();
  const markRead = useMarkRead();
  const refresh = useRefresh();
  const unread = useUnreadTotal();
  const box = useRef<HTMLDivElement>(null);

  // 最初に取得したときの既読状態（true = 圧縮表示）。冪等なので render 中に記録してよい。
  const readAtLoad = useRef(new Map<number, boolean>());
  for (const a of query.articles) if (!readAtLoad.current.has(a.id)) readAtLoad.current.set(a.id, a.isRead);

  // 上端を通り過ぎた未読記事を集めて、少し待ってからまとめて既読にする
  const pending = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unreadIds = useRef(new Set<number>());
  unreadIds.current = new Set(query.articles.filter((a) => !a.isRead).map((a) => a.id));
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = Number((e.target as HTMLElement).dataset.articleId);
          if (!e.isIntersecting && e.boundingClientRect.bottom <= HEADER && unreadIds.current.has(id)) {
            pending.current.add(id);
          }
        }
        if (pending.current.size === 0) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          markRead([...pending.current]);
          pending.current.clear();
        }, 400);
      },
      { rootMargin: `-${HEADER}px 0px 0px 0px` },
    );
    root.querySelectorAll('[data-article-id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [query.articles, markRead]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const loadedUnread = query.articles.filter((a) => !a.isRead).map((a) => a.id);

  return (
    <>
      <HomeHeader
        sub={
          <>
            <span className="font-semibold text-accent">未読 {unread ?? '–'} 件</span> · スクロールで既読
          </>
        }
        actions={
          <>
            <RefreshButton onRefresh={refresh} />
            <HeaderButton onClick={() => markRead(loadedUnread)} disabled={loadedUnread.length === 0}>
              <Icon name="check" small />
              表示中を既読
            </HeaderButton>
          </>
        }
      />
      <div ref={box}>
        <TimelineList
          query={query}
          emptyText="記事がありません。"
          renderItem={(a) => (
            <ArticleCard
              key={a.id}
              article={a}
              onSetRead={setRead}
              unreadBar
              dimRead
              compact={readAtLoad.current.get(a.id)}
            />
          )}
          end={
            <div className="flex flex-col items-center gap-3 px-5 py-16 text-center text-muted">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-hover text-fg">
                <Icon name="check" />
              </span>
              <b className="text-fg">すべて読み終えました</b>
              <HeaderButton primary onClick={() => void refresh()}>
                <Icon name="refresh" small />
                新着を確認
              </HeaderButton>
            </div>
          }
        />
      </div>
    </>
  );
}
