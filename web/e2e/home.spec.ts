import { expect, test } from '@playwright/test';
import { env, unreadTotal } from './helpers';

const TITLES = ['Fixture article ゆずポンズ', 'Fixture article kumquat', 'Fixture article rhubarb'];

test('[F-HOME-1] fixture articles are listed on Home', async ({ page }) => {
  await test.step('open Home', async () => {
    await page.goto('/');
  });
  await test.step('every fixture article title is visible', async () => {
    for (const title of TITLES) {
      await expect(page.getByRole('link', { name: title })).toBeVisible();
    }
  });
});

test('[F-HOME-2] read toggle updates card, unread count and persists', async ({ page }) => {
  const card = page.getByRole('article').filter({ has: page.getByRole('link', { name: 'Fixture article rhubarb' }) });
  let before = 0;

  await test.step('open Home and record unread total', async () => {
    await page.goto('/');
    await expect(card).toBeVisible();
    before = await unreadTotal(page.request);
  });
  await test.step('card starts unread', async () => {
    await expect(card.getByTitle('未読')).toBeVisible();
    await expect(card.getByRole('button', { name: '既読にする', exact: true })).toBeVisible();
  });
  await test.step('click 既読にする', async () => {
    await card.getByRole('button', { name: '既読にする', exact: true }).click();
    await expect(card.getByRole('button', { name: '未読にする', exact: true })).toBeVisible();
    await expect(card.getByTitle('未読')).toHaveCount(0);
  });
  await test.step('server unread total drops by one', async () => {
    await expect.poll(() => unreadTotal(page.request)).toBe(before - 1);
  });
  await test.step('read state survives reload', async () => {
    await page.reload();
    await expect(card.getByRole('button', { name: '未読にする', exact: true })).toBeVisible();
    await expect(card.getByTitle('未読')).toHaveCount(0);
  });
  await test.step('click 未読にする restores unread', async () => {
    await card.getByRole('button', { name: '未読にする', exact: true }).click();
    await expect(card.getByRole('button', { name: '既読にする', exact: true })).toBeVisible();
    await expect(card.getByTitle('未読')).toBeVisible();
    await expect.poll(() => unreadTotal(page.request)).toBe(before);
  });
});

test('[F-HOME-3] copy link shows a toast and writes the article URL to the clipboard', async ({ page }) => {
  const card = page.getByRole('article').filter({ has: page.getByRole('link', { name: 'Fixture article kumquat' }) });

  await test.step('open Home', async () => {
    await page.goto('/');
    await expect(card).toBeVisible();
  });
  await test.step('click リンクをコピー', async () => {
    await card.getByRole('button', { name: 'リンクをコピー' }).click();
  });
  await test.step('toast confirms the copy', async () => {
    await expect(page.getByRole('status')).toHaveText('リンクをコピーしました');
  });
  await test.step('clipboard holds the absolute article URL', async () => {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toBe(`${env('FIXTURE_URL')}/item/2.html`);
  });
});
