import { expect, test, type Locator, type Page } from '@playwright/test';
import { createFeed, createFolder, env, readFeedsOpml, uniq } from './helpers';

const section = (page: Page, folder: string): Locator =>
  page.locator('section').filter({ has: page.getByText(folder, { exact: true }) });

test('[F-FEED-1] adding a feed via discovery lists it and writes it to the OPML', async ({ page }) => {
  const folder = uniq('feedadd');
  const dialog = page.getByRole('dialog', { name: 'フィードを追加' });

  await test.step('create a target folder and open Subscriptions', async () => {
    await createFolder(page.request, folder);
    await page.goto('/#/subscriptions');
  });
  await test.step('open the add-feed dialog and discover from the site page', async () => {
    await page.getByRole('button', { name: '+ フィードを追加' }).click();
    await dialog.getByLabel('URL').fill(`${env('FIXTURE_URL')}/site.html`);
    await dialog.getByRole('button', { name: '探す' }).click();
    await expect(dialog.getByText('検出されたフィード')).toBeVisible();
  });
  await test.step('pick the RSS candidate and the folder', async () => {
    await dialog.getByRole('button', { name: /Fixture RSS 2/ }).click();
    await dialog.locator('#add-feed-folder').selectOption({ label: folder });
  });
  await test.step('submit', async () => {
    await dialog.getByRole('button', { name: '追加', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('フィードを追加しました');
    await expect(dialog).toHaveCount(0);
  });
  await test.step('feed is listed under the chosen folder', async () => {
    await expect(section(page, folder).getByText('Fixture RSS 2', { exact: true })).toBeVisible();
  });
  await test.step('feeds.opml contains the feed URL', async () => {
    await expect.poll(readFeedsOpml).toContain(`xmlUrl="${env('FIXTURE_URL')}/feed2.xml"`);
  });
});

test('[F-SUB-1] adding a folder lists it; renaming onto an existing name is rejected', async ({ page }) => {
  const name = uniq('folderadd');
  const other = uniq('folderother');

  await test.step('create another folder and open Subscriptions', async () => {
    await createFolder(page.request, other);
    await page.goto('/#/subscriptions');
  });
  await test.step('add the folder from the UI', async () => {
    await page.getByRole('button', { name: '+ フォルダ' }).click();
    const dialog = page.getByRole('dialog', { name: 'フォルダを追加' });
    await dialog.getByLabel('フォルダ名').fill(name);
    await dialog.getByRole('button', { name: '追加', exact: true }).click();
    await expect(section(page, name).getByText('フィードなし（ここへドラッグして移動）')).toBeVisible();
  });
  await test.step('rename the other folder to the same name', async () => {
    await section(page, other).getByRole('button', { name: 'リネーム' }).click();
    const dialog = page.getByRole('dialog', { name: 'フォルダ名を変更' });
    await dialog.getByLabel('フォルダ名').fill(name);
    await dialog.getByRole('button', { name: '変更' }).click();
    await expect(page.getByRole('status')).toHaveText('同名のフォルダがあります');
  });
  await test.step('both folders are still listed under their own names', async () => {
    await expect(page.getByText(name, { exact: true })).toHaveCount(1);
    await expect(page.getByText(other, { exact: true })).toHaveCount(1);
  });
});

test('[F-SUB-2] renaming and deleting a folder; its feeds move to 未分類', async ({ page }) => {
  const id = uniq('folderops');
  const renamed = `${id}-renamed`;
  const feedTitle = `${id}-feed`;

  await test.step('create a folder with one feed and open Subscriptions', async () => {
    await createFolder(page.request, id);
    await createFeed(page.request, { title: feedTitle, folder: id });
    await page.goto('/#/subscriptions');
    await expect(section(page, id).getByText(feedTitle, { exact: true })).toBeVisible();
  });
  await test.step('rename the folder', async () => {
    await section(page, id).getByRole('button', { name: 'リネーム' }).click();
    const dialog = page.getByRole('dialog', { name: 'フォルダ名を変更' });
    await dialog.getByLabel('フォルダ名').fill(renamed);
    await dialog.getByRole('button', { name: '変更' }).click();
    await expect(section(page, renamed).getByText(feedTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(id, { exact: true })).toHaveCount(0);
  });
  await test.step('delete the folder', async () => {
    await section(page, renamed).getByRole('button', { name: '削除' }).first().click();
    await page.getByRole('dialog', { name: 'フォルダを削除' }).getByRole('button', { name: '削除' }).click();
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);
  });
  await test.step('the feed is now under 未分類', async () => {
    await expect(section(page, '未分類').getByText(feedTitle, { exact: true })).toBeVisible();
  });
});

test('[F-SUB-3] editing, moving and deleting a feed is reflected in feeds.opml', async ({ page }) => {
  const id = uniq('feedops');
  const folder = `${id}-folder`;
  const original = `${id}-orig`;
  const renamed = `${id}-new`;
  let url = '';

  await test.step('create a folder and a feed, then filter to the feed', async () => {
    await createFolder(page.request, folder);
    url = (await createFeed(page.request, { title: original })).url;
    await page.goto('/#/subscriptions');
    await page.getByRole('searchbox', { name: '絞り込み' }).fill(id);
    await expect(page.getByText(original, { exact: true })).toBeVisible();
  });
  await test.step('edit the title', async () => {
    await page.getByRole('button', { name: 'タイトル編集' }).click();
    const input = page.getByRole('textbox', { name: 'フィード名' });
    await input.fill(renamed);
    await input.press('Enter');
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();
    await expect.poll(readFeedsOpml).toContain(`title="${renamed}"`);
  });
  await test.step('move the feed into the folder', async () => {
    await page.getByRole('button', { name: 'フォルダ移動' }).click();
    await page.getByRole('menuitem', { name: folder, exact: true }).click();
    await expect(section(page, folder).getByText(renamed, { exact: true })).toBeVisible();
    await expect
      .poll(() => {
        const opml = readFeedsOpml();
        const open = opml.indexOf(`<outline text="${folder}"`);
        const feed = opml.indexOf(`xmlUrl="${url}"`);
        return open >= 0 && feed > open && !opml.slice(open, feed).includes('</outline>');
      })
      .toBe(true);
  });
  await test.step('delete the feed', async () => {
    await page.getByRole('button', { name: '削除' }).last().click();
    await page.getByRole('dialog', { name: 'フィードを削除' }).getByRole('button', { name: '削除' }).click();
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);
    await expect.poll(readFeedsOpml).not.toContain(`xmlUrl="${url}"`);
  });
});

test('[F-SUB-4] the filter box narrows feeds by name', async ({ page }) => {
  const id = uniq('filter');
  const alpha = `${id}-alpha`;
  const beta = `${id}-beta`;

  await test.step('create two feeds and open Subscriptions', async () => {
    await createFeed(page.request, { title: alpha });
    await createFeed(page.request, { title: beta });
    await page.goto('/#/subscriptions');
    await expect(page.getByText(alpha, { exact: true })).toBeVisible();
    await expect(page.getByText(beta, { exact: true })).toBeVisible();
  });
  await test.step('filter by one name', async () => {
    await page.getByRole('searchbox', { name: '絞り込み' }).fill(alpha);
    await expect(page.getByText(alpha, { exact: true })).toBeVisible();
    await expect(page.getByText(beta, { exact: true })).toHaveCount(0);
  });
  await test.step('filter with no match', async () => {
    await page.getByRole('searchbox', { name: '絞り込み' }).fill(`${id}-none`);
    await expect(page.getByText('一致するフィードがありません。')).toBeVisible();
  });
});
