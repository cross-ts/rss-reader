import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Columns } from '../components/Columns';
import { ArticleTimeline } from '../components/ArticleTimeline';
import { RecentFeedsPanel } from '../components/RecentFeedsPanel';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useDebounce } from '../hooks/useDebounce';
import { parseHash } from '../hooks/useHashRoute';
import { decodeEntities } from '../utils/decodeEntities';

type Tab = 'articles' | 'feeds';

function FeedResults({ q }: { q: string }) {
  const { data: feeds, isPending } = useQuery({ queryKey: ['feeds'], queryFn: api.getFeeds });
  if (isPending) return <div className="py-8 text-center text-sm text-muted">Loading…</div>;
  const query = q.trim().toLowerCase();
  const list = (feeds ?? []).filter((f) => !query || `${f.title} ${f.url}`.toLowerCase().includes(query));
  if (list.length === 0) return <div className="px-5 py-16 text-center text-muted">一致するフィードがありません。</div>;
  return (
    <>
      {list.map((f) => (
        <div key={f.id} className="flex min-w-0 items-center gap-3.5 border-b border-line px-3.5 py-4 sm:px-5">
          <Avatar title={decodeEntities(f.title)} size={40} />
          <div className="min-w-0 flex-1">
            <b className="block truncate">{decodeEntities(f.title)}</b>
            <span className="block truncate text-[13px] text-muted">{f.url}</span>
          </div>
          <span className="text-[13px] text-muted">{f.articleCount} 件</span>
        </div>
      ))}
    </>
  );
}

export function SearchPage() {
  // App が key={rawHash} でマウントするので、初期値だけ URL から読む
  const [q, setQ] = useState(() => parseHash(location.hash).params.get('q') ?? '');
  const [tab, setTab] = useState<Tab>('articles');
  const debounced = useDebounce(q, 300);

  const onChange = (v: string) => {
    setQ(v);
    // replaceState は hashchange を発火しないので、入力中に再マウントされない
    history.replaceState(null, '', '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''));
  };

  return (
    <Columns
      center={
        <>
          <div className="px-3.5 pt-4 sm:px-5">
            <div className="flex items-center gap-2.5 rounded-full border border-line bg-panel px-5 text-muted focus-within:border-accent">
              <Icon name="search" small />
              <input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => onChange(e.target.value)}
                placeholder="記事やフィードを検索"
                aria-label="検索"
                className="min-w-0 flex-1 border-0 bg-transparent py-[15px] text-[17px] text-fg outline-0"
              />
            </div>
          </div>
          <div className="mt-2 flex gap-7 border-b border-line px-3.5 sm:px-5">
            {(['articles', 'feeds'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 py-3.5 font-semibold ${tab === t ? 'border-fg text-fg' : 'border-transparent text-muted'}`}
              >
                {t === 'articles' ? '記事' : 'フィード'}
              </button>
            ))}
          </div>
          {tab === 'articles' ? (
            <ArticleTimeline q={debounced.trim()} emptyText="一致する記事がありません。" />
          ) : (
            <FeedResults q={q} />
          )}
        </>
      }
      right={<RecentFeedsPanel />}
    />
  );
}
