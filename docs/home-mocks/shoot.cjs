// Usage: node shoot.cjs <baseUrl> <outDir>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = process.argv[2];
const OUT = process.argv[3];

const FEEDS = ['Publickey', 'The Verge', 'Zenn Trend', 'Hacker News', 'GIGAZINE', 'Stratechery', 'Go Blog', 'React Blog'];
const TITLES = [
  'TypeScript 7.0 正式リリース、Go 移植でビルドが 10 倍高速に',
  'The quiet return of RSS: why readers are coming back',
  'React Query で楽観的更新を安全に書く 5 つのパターン',
  'SQLite FTS5 で日本語全文検索を実用レベルにする',
  'Show HN: A tiny self-hosted feed reader in Go',
  'Apple、新しい Vision 製品ラインを発表',
  'Aggregation Theory, ten years later',
  'Go 1.27 リリースノートまとめ',
  'React Compiler がデフォルト有効に',
  'Tailwind CSS v4.3 の新機能',
  '無限スクロールは本当にユーザーのためになるのか',
  'Designing unread state for timelines',
  'Postgres 19 の論理レプリケーション改善',
  'Vite 8 で Rolldown が標準バンドラーに',
  'Mastodon の markers API でタイムライン位置を同期する',
  'Why Instagram added “You’re All Caught Up”',
  'Feedly が AI 要約機能を全ユーザーに開放',
  'Building a reading-progress indicator that respects users',
  'CSS scroll anchoring の仕組みと落とし穴',
  'The economics of newsletters in 2026',
];
const EXCERPT =
  'これは記事の抜粋テキストです。フィードから取得した本文の先頭を数行だけ表示します。既読・未読の状態や、どこまでチェックしたかが一目で分かるかを比較するためのダミー本文です。';

const now = Date.now();
let nextId = 1;
const mk = (minutesAgo, isRead, i) => {
  const id = nextId++;
  const img = i % 4 === 1 ? `<img src="https://img.mock/${id}.svg">` : '';
  return {
    id,
    feedId: (i % FEEDS.length) + 1,
    feedTitle: FEEDS[i % FEEDS.length],
    title: TITLES[i % TITLES.length],
    url: `https://example.com/a/${id}`,
    author: i % 3 === 0 ? 'Kouhei' : null,
    content: `<p>${EXCERPT}</p>${img}`,
    publishedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    isRead,
    readAt: isRead ? new Date(now).toISOString() : null,
  };
};

function makeDb() {
  nextId = 1;
  const arts = [];
  for (let i = 0; i < 70; i++) {
    // 新しい 12 件は未読、それ以降はたまに未読が混ざる
    const unread = i < 12 || i === 15 || i === 22;
    arts.push(mk(8 + i * 37, !unread, i));
  }
  return arts;
}

function sorted(db) {
  return [...db].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.id - a.id);
}

async function install(page, db) {
  await page.route('https://img.mock/**', (route) => {
    const n = Number(route.request().url().match(/(\d+)\.svg/)[1]);
    const h = (n * 47) % 360;
    route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,60%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,40%)"/></linearGradient></defs><rect width="800" height="420" fill="url(#g)"/></svg>`,
    });
  });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (b) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/articles' && req.method() === 'GET') {
      let items = sorted(db.arts);
      if (url.searchParams.get('unread') === '1') items = items.filter((a) => !a.isRead);
      const limit = Number(url.searchParams.get('limit') || 50);
      const offset = Number(url.searchParams.get('offset') || 0);
      return json({ items: items.slice(offset, offset + limit), total: items.length });
    }
    const m = p.match(/^\/api\/articles\/(\d+)$/);
    if (m && req.method() === 'PATCH') {
      const a = db.arts.find((x) => x.id === Number(m[1]));
      const { isRead } = req.postDataJSON();
      a.isRead = isRead;
      a.readAt = isRead ? new Date().toISOString() : null;
      return route.fulfill({ status: 204 });
    }
    if (p === '/api/articles/mark-read') {
      const { articleIds } = req.postDataJSON();
      for (const a of db.arts) if (articleIds.includes(a.id)) a.isRead = true;
      return json({ updated: articleIds.length });
    }
    if (p === '/api/unread-counts') return json({ total: db.arts.filter((a) => !a.isRead).length, feeds: {}, folders: {} });
    if (p === '/api/refresh') return json({ refreshed: 0 });
    return json([]);
  });
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

async function open(browser, vp, mock, init) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vp], locale: 'ja-JP', colorScheme: 'light' });
  const page = await ctx.newPage();
  const db = { arts: makeDb() };
  await install(page, db);
  await page.addInitScript(init || (() => {}));
  await page.goto(`${BASE}/#/?mock=${mock}`);
  await page.waitForSelector('[data-article-id]');
  await page.waitForTimeout(300);
  return { ctx, page, db };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const vp of ['desktop', 'mobile']) {
    // 現行
    {
      const { ctx, page } = await open(browser, vp, 'current');
      await shot(page, `current-${vp}`);
      await ctx.close();
    }
    // A: 新着ピル + 前回位置
    {
      // 前回は 6 番目の記事が先頭だった、という状態から開く
      const { ctx, page, db } = await open(browser, vp, 'x', () => localStorage.setItem('homeLastTopId', '6'));
      // 新着が 3 件届いた → ピル表示
      for (let i = 0; i < 3; i++) {
        const a = mk(-1 - i, false, 30 + i);
        db.arts.push(a);
      }
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
      await page.waitForSelector('text=新着 3 件');
      await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-article-id="6"]').getBoundingClientRect().top + scrollY - 380));
      await page.waitForTimeout(300);
      await shot(page, `x-${vp}`);
      await ctx.close();
    }
    // B: スクロールで既読
    {
      const { ctx, page } = await open(browser, vp, 'feedly');
      await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-article-id="9"]').getBoundingClientRect().top + scrollY));
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollBy(0, -(innerHeight * 0.6)));
      await page.waitForTimeout(500);
      await shot(page, `feedly-${vp}`);
      await ctx.close();
    }
    // C: 未読 → チェック済み境界
    {
      const { ctx, page } = await open(browser, vp, 'caughtup');
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('b')].find((b) => /未読はここまで|すべてチェック/.test(b.textContent));
        window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.45);
      });
      await page.waitForTimeout(600);
      await shot(page, `caughtup-${vp}`);
      // 「上の N 件を既読にして完了」を押した後
      await page.click('text=/件を既読にしてチェック完了/');
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('b')].find((b) => /すべてチェック/.test(b.textContent));
        window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.45);
      });
      await page.waitForTimeout(300);
      await shot(page, `caughtup-done-${vp}`);
      await ctx.close();
    }
    // D: 受信箱
    {
      const { ctx, page } = await open(browser, vp, 'inbox');
      await page.locator('[data-article-id="3"]').getByText('ここまで既読').click();
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-article-id="2"]').getBoundingClientRect().top + scrollY - 140));
      await page.waitForTimeout(300);
      await shot(page, `inbox-${vp}`);
      await page.getByRole('tab', { name: 'すべて' }).click();
      await page.waitForTimeout(600);
      await page.mouse.move(5, 5);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await shot(page, `inbox-all-${vp}`);
      await ctx.close();
    }
    // E: 横スワイプ
    {
      const { ctx, page } = await open(browser, vp, 'swipe');
      // 2 件を右スワイプで既読にしてから、3 件目をスワイプ途中で止める
      const drag = async (id, dx, release = true) => {
        const box = await page.locator(`[data-article-id="${id}"]`).boundingBox();
        const y = box.y + Math.min(60, box.height / 2);
        await page.mouse.move(box.x + 40, y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 40 + (dx * i) / 8, y);
        if (release) await page.mouse.up();
        await page.waitForTimeout(400);
      };
      await drag(1, 140);
      await drag(2, 140);
      await drag(4, 120, false);
      await shot(page, `swipe-${vp}`);
      await page.mouse.up();
      await ctx.close();
    }
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
