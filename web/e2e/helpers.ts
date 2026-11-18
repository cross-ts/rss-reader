import { readFileSync } from 'node:fs';
import { expect, type APIRequestContext } from '@playwright/test';

export function env(name: 'FIXTURE_URL' | 'FEEDS_PATH' | 'RUN_DIR'): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let seq = 0;
export function uniq(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${seq++}`;
}

export function readFeedsOpml(): string {
  return readFileSync(env('FEEDS_PATH'), 'utf8');
}

export interface Feed {
  id: number;
  title: string;
  url: string;
  folder: string | null;
}

// Query strings are ignored by the fixture server, so each call yields a distinct subscription of feed2.xml.
// feed2 carries articles the Home/Search specs never match, unlike feed.xml.
export async function createFeed(
  request: APIRequestContext,
  opts: { title: string; folder?: string },
): Promise<Feed> {
  const url = `${env('FIXTURE_URL')}/feed2.xml?u=${opts.title}`;
  const created = await request.post('/api/feeds', { data: { url, folder: opts.folder ?? null } });
  expect(created.ok()).toBeTruthy();
  const feed: Feed = await created.json();
  const renamed = await request.put(`/api/feeds/${feed.id}`, { data: { title: opts.title } });
  expect(renamed.ok()).toBeTruthy();
  return { ...feed, title: opts.title };
}

export async function createFolder(request: APIRequestContext, name: string): Promise<void> {
  const res = await request.post('/api/folders', { data: { name } });
  expect(res.ok()).toBeTruthy();
}

export async function unreadTotal(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/unread-counts');
  expect(res.ok()).toBeTruthy();
  return (await res.json()).total;
}
