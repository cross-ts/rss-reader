# Feature map

Each row is a user-visible behavior that must keep working. The ID is the contract between this table and the Playwright specs: every `F-…` here has a test whose title starts with `[F-…]`, and vice versa (`scripts/verify/check-feature-map.sh`). Fixture data comes from `e2e/fixtureserver/testdata` (feed articles: ゆずポンズ, kumquat, rhubarb).

| ID | Route | How to reach | Locator | Expected |
| --- | --- | --- | --- | --- |
| F-HOME-1 | `#/` | Open `/` | `link` named `Fixture article ゆずポンズ` / `kumquat` / `rhubarb` | All three fixture articles are listed |
| F-HOME-2 | `#/` | Click the card button | `button` `既読にする` / `未読にする` inside the `article`; `title=未読` dot | Card switches to `未読にする`, the dot disappears, `/api/unread-counts` total drops by 1, the state survives reload; clicking `未読にする` restores it |
| F-HOME-3 | `#/` | Click the share button on a card | `button` named `リンクをコピー`; `role=status` | Toast `リンクをコピーしました` and the clipboard holds the absolute article URL |
| F-SEARCH-1 | `#/search?q=` | Type in the side `searchbox` `検索` and press Enter; then retype on the Search page | `searchbox` named `検索` | URL becomes `#/search?q=<term>` and only articles matching the term are listed (English and Japanese tokens) |
| F-FEED-1 | `#/subscriptions` | `+ フィードを追加`, enter `<fixture>/site.html`, `探す` | dialog `フィードを追加`: `getByLabel('URL')`, text `検出されたフィード`, `#add-feed-folder`, button `追加` | Both discovered feeds are offered; after choosing one and a folder, toast `フィードを追加しました`, the feed appears under the folder, `feeds.opml` contains its `xmlUrl` |
| F-SUB-1 | `#/subscriptions` | `+ フォルダ`, enter a name, `追加`; then `リネーム` another folder to that name | dialogs `フォルダを追加` / `フォルダ名を変更`, label `フォルダ名`; `role=status` | Folder section appears with `フィードなし（ここへドラッグして移動）`; renaming onto an existing name shows toast `同名のフォルダがあります` and both folders keep their names (adding a duplicate name is idempotent server-side, so it is not an error) |
| F-SUB-2 | `#/subscriptions` | Folder header buttons `リネーム` / `削除` | dialogs `フォルダ名を変更` (`変更`) and `フォルダを削除` (`削除`) | Renamed folder keeps its feed; after deletion the feed is listed under `未分類` |
| F-SUB-3 | `#/subscriptions` | Feed row buttons `タイトル編集` / `フォルダ移動` / `削除` | `textbox` `フィード名` (Enter), `menuitem` of the folder, dialog `フィードを削除` | New title shown and written to `feeds.opml`; feed is nested inside the chosen folder outline; after deletion its `xmlUrl` is gone from `feeds.opml` |
| F-SUB-4 | `#/subscriptions` | Type in the filter box | `searchbox` named `絞り込み` | Only feeds matching name/URL remain; no match shows `一致するフィードがありません。` |
| F-API-1 | n/a | Playwright `request` | `POST /api/feeds/discover`, `POST /api/refresh`, `POST /api/articles/mark-read`, `PATCH /api/articles/{id}`, `GET /api/unread-counts`, `GET`/`PUT /api/settings` | Discover returns the RSS and Atom candidates; refresh counts ≥1; mark-read updates 1 and unread total moves by 1; settings PUT writes `config.yml` and rejects read-only keys |
