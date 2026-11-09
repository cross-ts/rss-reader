import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@astryxdesign/core/Avatar';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { List, ListItem } from '@astryxdesign/core/List';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { api } from '../api/client';
import { ArticleTimeline } from '../components/ArticleTimeline';
import { Page, PageHeader } from '../components/PageHeader';
import { RecentFeedsPanel } from '../components/RecentFeedsPanel';
import { SearchIcon } from '../components/icons';
import { useDebounce } from '../hooks/useDebounce';
import { parseHash } from '../hooks/useHashRoute';
import { decodeEntities } from '../utils/decodeEntities';
import { domainOf } from '../utils/url';

type TabKey = 'articles' | 'feeds';

function FeedResults({ q }: { q: string }) {
  const { data: feeds, isPending } = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });
  if (isPending)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const query = q.trim().toLowerCase();
  const list = (feeds ?? []).filter((f) => !query || `${f.title} ${f.url}`.toLowerCase().includes(query));
  if (list.length === 0)
    return (
      <div className="py-20">
        <EmptyState title="一致するフィードがありません" />
      </div>
    );
  return (
    <List hasDividers edge="flush" density="spacious">
      {list.map((f) => {
        const title = decodeEntities(f.title);
        return (
          <ListItem
            key={f.id}
            startContent={<Avatar name={title} size="md" shape="rounded" tooltip={false} />}
            label={title}
            description={domainOf(f.url)}
            endContent={
              <Text type="supporting" hasTabularNumbers>
                {f.articleCount} 件
              </Text>
            }
          />
        );
      })}
    </List>
  );
}

export function SearchPage() {
  // App が key={rawHash} でマウントするので、初期値だけ URL から読む
  const [q, setQ] = useState(() => parseHash(location.hash).params.get('q') ?? '');
  const [tab, setTab] = useState<TabKey>('articles');
  const debounced = useDebounce(q, 300);

  const onChange = (v: string) => {
    setQ(v);
    // replaceState は hashchange を発火しないので、入力中に再マウントされない
    history.replaceState(null, '', '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''));
  };

  return (
    <Page aside={<RecentFeedsPanel />}>
      <PageHeader title="検索" caption="全文検索（記事）と、購読中フィードの絞り込み。" />
      <div className="flex flex-col gap-4">
        <TextInput
          type="search"
          size="lg"
          label="検索"
          isLabelHidden
          hasAutoFocus
          hasClear
          value={q}
          onChange={onChange}
          placeholder="キーワードを入力"
          startIcon={SearchIcon}
          enterKeyHint="search"
          width="100%"
        />
        <TabList value={tab} onChange={(v) => setTab(v as TabKey)}>
          <Tab value="articles" label="記事" />
          <Tab value="feeds" label="フィード" />
        </TabList>
      </div>
      <div className="mt-2">
        {tab === 'articles' ? (
          <ArticleTimeline q={debounced.trim()} emptyTitle="一致する記事がありません" emptyDescription="別のキーワードで試してください。" />
        ) : (
          <FeedResults q={q} />
        )}
      </div>
    </Page>
  );
}
