import { useRef } from 'react';
import { ArticleCard } from '../components/ArticleCard';
import { TimelineList } from '../components/ArticleTimeline';
import { Icon } from '../components/Icon';
import { useArticles } from '../hooks/useArticles';
import { useMarkRead, useRefresh, useSetRead } from '../hooks/useArticleMutations';
import { HeaderButton, HomeHeader, RefreshButton, useUnreadTotal } from './HomeHeader';

/**
 * 案C（Instagram「You're All Caught Up」型）
 * - 上に未読だけを並べ、読み切った所に「すべてチェックしました」の境界カードを置く。
 * - 境界より下は既読記事を1行で並べる（振り返り用）。
 * - 今回読んだ記事は未読セクションに薄く残す（並びが変わらない）。
 */
export function CaughtUpMock() {
  const unreadQ = useArticles('', { unreadOnly: true });
  const allQ = useArticles('', { enabled: unreadQ.isSuccess && !unreadQ.hasNextPage });
  const setRead = useSetRead();
  const markRead = useMarkRead();
  const refresh = useRefresh();
  const unread = useUnreadTotal();

  // 未読セクションに一度でも出た記事は既読セクションに重複させない
  const inUnread = useRef(new Set<number>());
  for (const a of unreadQ.articles) inUnread.current.add(a.id);
  const left = unreadQ.articles.filter((a) => !a.isRead).map((a) => a.id);

  const boundary = (
    <div className="border-b border-line px-5 py-10 text-center">
      <span className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full border-2 border-accent text-accent">
        <Icon name="check" />
      </span>
      <b className="block text-lg">{left.length > 0 ? '未読はここまで' : 'すべてチェックしました'}</b>
      <p className="mt-1 text-sm text-muted">ここから下は既読の記事です</p>
      {left.length > 0 && (
        <div className="mt-4">
          <HeaderButton primary onClick={() => markRead(left)}>
            <Icon name="check" small />
            {left.length} 件を既読にしてチェック完了
          </HeaderButton>
        </div>
      )}
    </div>
  );

  return (
    <>
      <HomeHeader
        sub={unread != null && (unread > 0 ? `未読 ${unread} 件 → 既読の順` : 'すべてチェック済み')}
        actions={<RefreshButton onRefresh={refresh} />}
      />
      <TimelineList
        query={unreadQ}
        emptyText=""
        renderItem={(a) => <ArticleCard key={a.id} article={a} onSetRead={setRead} unreadBar dimRead />}
        end={
          <>
            {boundary}
            {allQ.isSuccess && (
              <TimelineList
                query={allQ}
                emptyText=""
                renderItem={(a) =>
                  inUnread.current.has(a.id) ? null : (
                    <ArticleCard key={a.id} article={a} onSetRead={setRead} compact />
                  )
                }
              />
            )}
          </>
        }
      />
    </>
  );
}
