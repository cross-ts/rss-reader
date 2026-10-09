import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArticleCard } from '../components/ArticleCard';
import { TimelineList } from '../components/ArticleTimeline';
import { Icon } from '../components/Icon';
import { useArticles } from '../hooks/useArticles';
import { useMarkRead, useRefresh, useSetRead } from '../hooks/useArticleMutations';
import { HeaderButton, HomeHeader, RefreshButton, useUnreadTotal } from './HomeHeader';

type Tab = 'unread' | 'all';

/**
 * 案D（Gmail / NetNewsWire / Reeder の受信箱型）
 * - 「未読 / すべて」タブ。既定は未読のみ＝残っている物がそのまま「未チェック」。
 * - 既読にした記事はタブを切り替える・更新するまで薄く残す（いきなり消えて位置がずれない）。
 * - 各記事に「ここまで既読」（NetNewsWire の Mark Above as Read）。ヘッダーに「すべて既読」と更新。
 */
export function InboxMock() {
  const [tab, setTab] = useState<Tab>('unread');
  const query = useArticles('', { unreadOnly: tab === 'unread' });
  const setRead = useSetRead();
  const markRead = useMarkRead();
  const refresh = useRefresh();
  const unread = useUnreadTotal();
  const qc = useQueryClient();

  const switchTab = (t: Tab) => {
    if (t === 'unread') qc.removeQueries({ queryKey: ['articles', '', 'unread'] });
    setTab(t);
    window.scrollTo(0, 0);
  };
  const loadedUnread = query.articles.filter((a) => !a.isRead).map((a) => a.id);

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => switchTab(t)}
      className={`relative flex-1 py-3 text-[15px] hover:bg-hover ${tab === t ? 'font-bold text-fg' : 'text-muted'}`}
    >
      {label}
      {tab === t && <span className="absolute inset-x-1/3 bottom-0 h-1 rounded-full bg-accent" />}
    </button>
  );

  return (
    <>
      <HomeHeader
        actions={
          <>
            <RefreshButton
              onRefresh={async () => {
                await refresh();
                if (tab === 'unread') await qc.resetQueries({ queryKey: ['articles', '', 'unread'] });
              }}
            />
            <HeaderButton onClick={() => markRead(loadedUnread)} disabled={loadedUnread.length === 0}>
              <Icon name="check" small />
              すべて既読
            </HeaderButton>
          </>
        }
      >
        <div role="tablist" className="flex">
          {tabBtn('unread', `未読${unread != null ? ` ${unread}` : ''}`)}
          {tabBtn('all', 'すべて')}
        </div>
      </HomeHeader>
      <TimelineList
        key={tab}
        query={query}
        emptyText=""
        renderItem={(a, i, all) => (
          <ArticleCard
            key={a.id}
            article={a}
            onSetRead={setRead}
            unreadBar
            dimRead
            compact={tab === 'all' && a.isRead}
            actions={
              !a.isRead && (
                <button
                  type="button"
                  onClick={() => markRead(all.slice(0, i + 1).filter((x) => !x.isRead).map((x) => x.id))}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] hover:bg-hover hover:text-fg"
                >
                  <Icon name="up" small />
                  ここまで既読
                </button>
              )
            }
          />
        )}
        end={
          tab === 'unread' && loadedUnread.length > 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted">
              未読はここまで（残り {loadedUnread.length} 件）
            </div>
          ) : tab === 'unread' ? (
            <div className="flex flex-col items-center gap-3 px-5 py-16 text-center text-muted">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-hover text-fg">
                <Icon name="inbox" />
              </span>
              <b className="text-fg">未読はありません</b>
              <HeaderButton onClick={() => switchTab('all')}>すべての記事を見る</HeaderButton>
            </div>
          ) : (
            <div className="px-5 py-12 text-center text-sm text-muted">これより古い記事はありません</div>
          )
        }
      />
    </>
  );
}
