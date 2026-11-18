import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { env, unreadTotal } from './helpers';

test('[F-API-1] discover, refresh, mark-read, unread-counts and settings endpoints', async ({ request }) => {
  await test.step('POST /api/feeds/discover lists the RSS and Atom candidates', async () => {
    const res = await request.post('/api/feeds/discover', { data: { url: `${env('FIXTURE_URL')}/site.html` } });
    expect(res.ok()).toBeTruthy();
    const urls = (await res.json()).map((c: { feedUrl: string }) => c.feedUrl).sort();
    expect(urls).toEqual([`${env('FIXTURE_URL')}/feed2.atom`, `${env('FIXTURE_URL')}/feed2.xml`]);
  });
  await test.step('POST /api/refresh refreshes at least one feed', async () => {
    const res = await request.post('/api/refresh');
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).refreshed).toBeGreaterThanOrEqual(1);
  });

  let id = 0;
  let before = 0;
  await test.step('find the rhubarb article and record unread total', async () => {
    const res = await request.get('/api/articles?q=rhubarb');
    expect(res.ok()).toBeTruthy();
    const found = (await res.json()).items.filter((a: { title: string }) => a.title.includes('rhubarb'));
    expect(found).toHaveLength(1);
    expect(found[0].isRead).toBe(false);
    id = found[0].id;
    before = await unreadTotal(request);
  });
  await test.step('POST /api/articles/mark-read marks it read', async () => {
    const res = await request.post('/api/articles/mark-read', { data: { articleIds: [id] } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).updated).toBe(1);
    expect(await unreadTotal(request)).toBe(before - 1);
  });
  await test.step('PATCH /api/articles/{id} marks it unread again', async () => {
    const res = await request.patch(`/api/articles/${id}`, { data: { isRead: false } });
    expect(res.ok()).toBeTruthy();
    expect(await unreadTotal(request)).toBe(before);
  });
  await test.step('GET /api/settings reports the effective config', async () => {
    const res = await request.get('/api/settings');
    expect(res.ok()).toBeTruthy();
    const s = await res.json();
    expect(s.feeds.value).toBe(env('FEEDS_PATH'));
    expect(s.pollIntervalMinutes.value).toBe(1440);
  });
  await test.step('PUT /api/settings persists to config.yml; read-only keys are rejected', async () => {
    const ok = await request.put('/api/settings', { data: { pollIntervalMinutes: 1440 } });
    expect(ok.status()).toBe(204);
    expect(readFileSync(`${env('RUN_DIR')}/config/rss-reader/config.yml`, 'utf8')).toContain('1440');
    const rejected = await request.put('/api/settings', { data: { db: '/tmp/x' } });
    expect(rejected.status()).toBe(400);
  });
});
