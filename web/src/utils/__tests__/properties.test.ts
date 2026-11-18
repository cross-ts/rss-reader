import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { Feed, Folder } from '../../api/client';
import { dedupeById } from '../articles';
import { buildSections } from '../subscriptions';
import { safeHttpUrl } from '../url';

const folderNames = fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 6 });

// feed.folder は必ず folders のいずれか、または null（API の不変条件）。
const catalog = folderNames.chain((names) =>
  fc
    .uniqueArray(fc.nat(), { maxLength: 15 })
    .chain((ids) =>
      fc.tuple(
        ...ids.map((id) =>
          fc.record({
            id: fc.constant(id),
            title: fc.string(),
            url: fc.string(),
            siteUrl: fc.constant(null),
            folder: fc.option(names.length ? fc.constantFrom(...names) : fc.constant(null), { nil: null }),
            articleCount: fc.constant(0),
          }),
        ),
      ),
    )
    .map((feeds): { folders: Folder[]; feeds: Feed[] } => ({
      folders: names.map((name, i) => ({ id: i + 1, name, feedCount: 0 })),
      feeds,
    })),
);

describe('buildSections properties', () => {
  it('without a query every feed appears in exactly one section', () => {
    fc.assert(
      fc.property(catalog, ({ folders, feeds }) => {
        const ids = buildSections(folders, feeds, undefined, '').flatMap((s) => s.feeds.map((f) => f.id));
        return ids.length === feeds.length && new Set(ids).size === feeds.length;
      }),
    );
  });

  it('with a query results are a subset of the unfiltered feeds and each matches', () => {
    fc.assert(
      fc.property(catalog, fc.string(), ({ folders, feeds }, q) => {
        const all = new Set(buildSections(folders, feeds, undefined, '').flatMap((s) => s.feeds.map((f) => f.id)));
        const needle = q.trim().toLowerCase();
        return buildSections(folders, feeds, undefined, q)
          .flatMap((s) => s.feeds)
          .every((f) => all.has(f.id) && `${f.title} ${f.url}`.toLowerCase().includes(needle));
      }),
    );
  });
});

describe('safeHttpUrl properties', () => {
  const input = fc.oneof(
    fc.string(),
    fc.webUrl(),
    fc.constantFrom('javascript:alert(1)', 'data:text/html,x', 'ftp://a/b', ''),
  );

  it('returns null or the input itself with an http(s) protocol', () => {
    fc.assert(
      fc.property(input, (u) => {
        const r = safeHttpUrl(u);
        return r === null || (r === u && /^https?:$/.test(new URL(r).protocol));
      }),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(input, (u) => {
        const once = safeHttpUrl(u);
        return safeHttpUrl(once) === once;
      }),
    );
  });
});

describe('dedupeById properties', () => {
  const pages = fc.array(
    fc.record({ items: fc.array(fc.record({ id: fc.integer({ min: 0, max: 20 }), tag: fc.nat() })) }),
  );

  it('has no duplicate ids, keeps first-occurrence order, and preserves the id set', () => {
    fc.assert(
      fc.property(pages, (ps) => {
        const out = dedupeById(ps);
        const flat = ps.flatMap((p) => p.items);
        const firstOccurrence = flat.filter((a, i) => flat.findIndex((b) => b.id === a.id) === i);
        return (
          new Set(out.map((a) => a.id)).size === out.length &&
          out.length === firstOccurrence.length &&
          out.every((a, i) => a === firstOccurrence[i])
        );
      }),
    );
  });
});
