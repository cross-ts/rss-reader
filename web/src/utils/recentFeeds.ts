import type { Article } from '../api/client';

/** 日付降順の記事から、フィードごとの最新記事を先頭から n 件拾う。 */
export function recentFeeds(articles: Article[], n = 5): Article[] {
  const seen = new Set<number>();
  const out: Article[] = [];
  for (const a of articles) {
    if (seen.has(a.feedId)) continue;
    seen.add(a.feedId);
    out.push(a);
    if (out.length >= n) break;
  }
  return out;
}
