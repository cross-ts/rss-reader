import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { api } from '../api/client';
import { ArticleTimeline } from '../components/ArticleTimeline';
import { Page, PageHeader } from '../components/PageHeader';
import { RecentFeedsPanel } from '../components/RecentFeedsPanel';
import { RefreshIcon } from '../components/icons';
import { useRefresh } from '../hooks/useArticleMutations';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

const LABEL = { idle: '引っ張って更新', pull: '引っ張って更新', ready: '離して更新', loading: '更新中…' };

export function HomePage() {
  const area = useRef<HTMLDivElement>(null);
  const refresh = useRefresh();
  const { height, phase, animate } = usePullToRefresh(refresh, area);
  const unread = useQuery({ queryKey: ['unreadCounts'], queryFn: api.getUnreadCounts });
  const total = unread.data?.total ?? 0;

  return (
    <Page aside={<RecentFeedsPanel />}>
      <div ref={area}>
        <div
          style={{ height }}
          aria-live="polite"
          className={`flex items-center justify-center gap-2.5 overflow-hidden ${animate ? 'transition-[height] duration-200' : ''}`}
        >
          {height > 0 && (
            <>
              <Spinner size="sm" shade="subtle" />
              <Text type="supporting">{LABEL[phase]}</Text>
            </>
          )}
        </div>
        <PageHeader
          title="ホーム"
          caption={unread.data ? (total > 0 ? `未読 ${total} 件` : 'すべて読みました') : ' '}
          actions={
            <Button
              label="更新"
              variant="secondary"
              icon={<Icon icon={RefreshIcon} />}
              clickAction={refresh}
            />
          }
        />
        <ArticleTimeline q="" emptyTitle="まだ記事がありません" emptyDescription="購読からフィードを追加すると、ここに新着が並びます。" />
      </div>
    </Page>
  );
}
