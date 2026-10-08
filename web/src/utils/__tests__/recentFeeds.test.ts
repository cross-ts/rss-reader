import { describe, it, expect } from 'vitest';
import { recentFeeds } from '../recentFeeds';
import { makeArticle } from '../../test/factories';

describe('recentFeeds', () => {
  it('keeps the first article of each feed, in order', () => {
    const list = [
      makeArticle(1, { feedId: 1 }),
      makeArticle(2, { feedId: 2 }),
      makeArticle(3, { feedId: 1 }),
      makeArticle(4, { feedId: 3 }),
    ];
    expect(recentFeeds(list).map((a) => a.id)).toEqual([1, 2, 4]);
  });

  it('limits to n', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((i) => makeArticle(i, { feedId: i }));
    expect(recentFeeds(list)).toHaveLength(5);
    expect(recentFeeds(list, 2)).toHaveLength(2);
  });
});
