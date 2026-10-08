import { useMemo } from 'react';
import { useArticles } from '../hooks/useArticles';
import { Avatar } from './Avatar';
import { decodeEntities } from '../utils/decodeEntities';
import { recentFeeds } from '../utils/recentFeeds';
import { extractThumbnail } from '../utils/thumbnail';
import { formatDate } from '../utils/time';
import { safeHttpUrl } from '../utils/url';

/** 右カラム: Home と同じキャッシュの1ページ目から導出した、最近更新されたフィード。 */
export function RecentFeedsPanel() {
  const { articles } = useArticles('');
  const rows = useMemo(
    () => recentFeeds(articles).map((a) => ({ a, thumb: safeHttpUrl(extractThumbnail(a.content)) })),
    [articles],
  );
  return (
    <div className="rounded-2xl border border-line bg-panel px-5 py-[18px]">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="m-0 text-[17px] font-semibold">最近更新されたフィード</h3>
        <a href="#/subscriptions" className="text-[13px] text-muted">
          すべて表示
        </a>
      </div>
      {rows.map(({ a, thumb }) => {
        const feedTitle = decodeEntities(a.feedTitle);
        return (
          <a
            key={a.feedId}
            href={safeHttpUrl(a.url) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-3 border-t border-line py-2.5 first:border-t-0"
          >
            {thumb ? (
              <img
                src={thumb}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="size-14 flex-none rounded-lg bg-hover object-cover"
              />
            ) : (
              <Avatar title={feedTitle} size={56} />
            )}
            <div className="min-w-0 flex-1">
              <b className="block truncate text-sm">{feedTitle}</b>
              <span className="block truncate text-[13px] text-muted">{decodeEntities(a.title)}</span>
              <span className="block truncate text-[13px] text-muted">{formatDate(a.publishedAt)}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}
