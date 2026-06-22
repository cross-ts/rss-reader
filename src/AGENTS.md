# AGENTS.md — src/（Rust バックエンド）

axum サーバが「REST API ＋ RSSポーラー ＋ フロント配信（リバースプロキシ or 静的）」を担う。ルートからの相対パス前提で起動する。

## モジュール
- `main.rs` — エントリ。`AppState { db, config, client, feeds_lock, proxy_client }`、トレーシング初期化、起動時 fail-safe（OPML 読込→reconcile）、ポーラー起動、ルーティング、フロント配信（`STATIC_DIR` ありはローカル配信／なしは `FRONTEND_URL` へリバースプロキシ）。
- `config.rs` — env 読み込み（`Config::from_env`）。
- `feeds.rs` — 購読 SSOT（OPML）。`Subscriptions { folders: Vec<FolderEntry>, feeds: Vec<FeedEntry> }`、`FeedEntry { title, url, folder: Option<String>, site_url: Option<String> }`、`FolderEntry { name }`。`read_feeds_opml`（不在=Ok(None)/失敗=Err）、`save_opml`、`reconcile_subscriptions`（トランザクション＋記事CASCADE＋site_url補完）。OPML マッピング: フォルダ=子を持つ `<outline text>`、フィード=`<outline type="rss" text/title xmlUrl htmlUrl>`。
- `tokenize.rs` — lindera（IPADIC）で日本語をスペース区切りトークン列に。
- `db/mod.rs` — DuckDB 接続＋マイグレーション。`INSTALL/LOAD fts` のみ（vss は撤去）。シーケンス/テーブル（folders/feeds/articles、`UNIQUE(feed_id,guid)`、`title_tokens`/`content_tokens`）。各 DDL は個別 `execute_batch`。
- `db/fts.rs` — `rebuild_fts_index`（`create_fts_index(... overwrite=1)`、記事0件は早期 return）。
- `fetcher.rs` — SSRF 対策フェッチ（`validate_feed_url`／`fetch_with_guard`／`fetch_with_guard_conditional`／`FetchOutcome`／10MB `read_capped`）と `fetch_feed`（条件付きGET・記事 upsert・ETag/Last-Modified 更新）。
- `poller.rs` — tokio interval 巡回 → 取得後に FTS 再構築。
- `routes/folders.rs` `routes/feeds.rs` `routes/articles.rs` `routes/refresh.rs` — 各 API。

## 規約
- DB アクセスは `tokio::task::spawn_blocking` 内で `db.lock().unwrap()`。
- ハンドラのエラーは `(StatusCode, String)`。レスポンス型は `#[serde(rename_all = "camelCase")]`。
- mutation 系ハンドラは `feeds_lock` を取得してから OPML read-modify-write → reconcile。
- フィード取得を伴う処理は必ず `fetch_with_guard`（SSRF 検証込み）経由。

## API
| メソッド | パス | 役割 |
|---|---|---|
| GET | `/api/folders` | フォルダ一覧（配下フィード件数） |
| POST/PUT/DELETE | `/api/folders[/:id]` | フォルダ操作 |
| GET | `/api/feeds` | フィード一覧 |
| POST | `/api/feeds` | `{url, folder?}` 登録（url はサイトURLでも可。RSS自動検出フォールバック） |
| POST | `/api/feeds/discover` | `{url}` → `{feedUrl, title?}`（RSS自動検出） |
| PUT/DELETE | `/api/feeds/:id` | 変更/削除 |
| GET | `/api/articles` | `?folderId=&feedId=&q=&limit=&offset=`（q時は日本語FTS） |
| POST | `/api/refresh` | `?feedId=` 省略時は全フィード即時巡回＋FTS再構築 |
