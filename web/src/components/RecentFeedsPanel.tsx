import { useMemo } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { useArticles } from '../hooks/useArticles';
import { decodeEntities } from '../utils/decodeEntities';
import { recentFeeds } from '../utils/recentFeeds';
import { formatDate } from '../utils/time';
import { safeHttpUrl } from '../utils/url';

/** 右パネル: Home と同じキャッシュの1ページ目から導出した、最近更新されたフィード。 */
export function RecentFeedsPanel() {
  const { articles } = useArticles('');
  const rows = useMemo(() => recentFeeds(articles), [articles]);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="recent-feeds" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Heading level={2} id="recent-feeds" weight="semibold">
          最近更新
        </Heading>
        <Link href="#/subscriptions" color="secondary" size="sm">
          すべて
        </Link>
      </div>
      <List edge="flush" density="compact">
        {rows.map((a) => {
          const feedTitle = decodeEntities(a.feedTitle);
          return (
            <ListItem
              key={a.feedId}
              href={safeHttpUrl(a.url) ?? undefined}
              target="_blank"
              startContent={<Avatar name={feedTitle} size="sm" shape="rounded" tooltip={false} />}
              label={feedTitle}
              description={`${formatDate(a.publishedAt)} · ${decodeEntities(a.title)}`}
            />
          );
        })}
      </List>
    </section>
  );
}
