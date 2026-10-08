import { describe, it, expect } from 'vitest';
import { buildSections } from '../subscriptions';
import type { Feed, Folder, UnreadCounts } from '../../api/client';

const folders: Folder[] = [
  { id: 2, name: 'テック/Web', feedCount: 1 },
  { id: 1, name: 'テック', feedCount: 1 },
  { id: 3, name: '空', feedCount: 0 },
];
const feed = (id: number, title: string, folder: string | null): Feed => ({
  id,
  title,
  url: `https://${title.toLowerCase()}.example.com/feed`,
  siteUrl: null,
  folder,
  articleCount: 0,
});
const feeds = [feed(1, 'Zenn', 'テック/Web'), feed(2, 'Hd', 'テック'), feed(3, 'Solo', null)];
const unread: UnreadCounts = { total: 6, feeds: { '1': 2, '2': 3, '3': 1 }, folders: {} };

describe('buildSections', () => {
  it('sorts folders by name, computes depth/label, puts 未分類 last', () => {
    const s = buildSections(folders, feeds, unread, '');
    const keys = s.map((x) => x.key);
    expect(keys.indexOf('1')).toBeLessThan(keys.indexOf('2'));
    expect(keys[keys.length - 1]).toBe('none');
    expect(s.map((x) => x.label)).toContain('未分類');
    const web = s.find((x) => x.key === '2')!;
    expect(web.depth).toBe(1);
    expect(web.label).toBe('Web');
    expect(s[s.length - 1].folder).toBeNull();
  });

  it('sums unread of direct feeds only', () => {
    const s = buildSections(folders, feeds, unread, '');
    expect(s.find((x) => x.key === '1')!.unread).toBe(3);
    expect(s.find((x) => x.key === '2')!.unread).toBe(2);
    expect(s.find((x) => x.key === 'none')!.unread).toBe(1);
  });

  it('keeps empty folders but hides empty 未分類 without query', () => {
    const s = buildSections(folders, feeds.slice(0, 2), unread, '');
    expect(s.some((x) => x.key === '3')).toBe(true);
    expect(s.some((x) => x.key === 'none')).toBe(false);
  });

  it('filters by title/url and drops empty sections when querying', () => {
    const s = buildSections(folders, feeds, unread, 'ZENN');
    expect(s.map((x) => x.key)).toEqual(['2']);
    expect(s[0].feeds).toHaveLength(1);
    expect(s[0].total).toBe(1);
  });

  it('works without unread counts', () => {
    const s = buildSections(folders, feeds, undefined, '');
    expect(s.every((x) => x.unread === 0)).toBe(true);
  });
});
