import { expect, test } from '@playwright/test';

test('[F-SEARCH-1] searching from the side box lists only matching articles', async ({ page }) => {
  // The side panel also links recent articles, so scope to timeline cards.
  const card = (title: string) =>
    page.getByRole('article').filter({ has: page.getByRole('link', { name: `Fixture article ${title}` }) });
  const kumquat = card('kumquat');
  const yuzu = card('ゆずポンズ');
  const rhubarb = card('rhubarb');

  await test.step('open Home', async () => {
    await page.goto('/');
  });
  await test.step('type a token and press Enter in 検索', async () => {
    await page.getByRole('searchbox', { name: '検索' }).fill('kumquat');
    await page.getByRole('searchbox', { name: '検索' }).press('Enter');
  });
  await test.step('URL carries q and only the matching article remains', async () => {
    await expect(page).toHaveURL(/#\/search\?q=kumquat$/);
    await expect(kumquat).toBeVisible();
    await expect(yuzu).toHaveCount(0);
    await expect(rhubarb).toHaveCount(0);
  });
  await test.step('search for a Japanese token on the Search page', async () => {
    await page.getByRole('searchbox', { name: '検索' }).fill('ゆずポンズ');
    await expect(page).toHaveURL(new RegExp(`#/search\\?q=${encodeURIComponent('ゆずポンズ')}$`));
    await expect(yuzu).toBeVisible();
    await expect(kumquat).toHaveCount(0);
  });
});
