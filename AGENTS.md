# AGENTS.md — rss-reader（リポジトリ・ガイド）

セルフホスト型RSSリーダー（単一ユーザー・ローカル用途）。RSS/Atom を定期巡回して DuckDB に蓄積し、**日本語全文検索**付きでブラウザ閲覧する。

## 構成
- バックエンド: Rust（axum + tokio）。`src/` 配下 → `src/AGENTS.md` 参照。
- ストレージ: DuckDB（`fts` 拡張で日本語BM25全文検索）。`vss` は撤去済み（将来再導入余地）。
- 日本語トークナイズ: lindera（IPADIC）→ スペース区切り → DuckDB FTS。
- フロントエンド: React + Vite（SPA, 3ペイン）。`web/` 配下 → `web/AGENTS.md` 参照。
- 購読の正本（SSOT）: **`feeds.opml`（OPML 2.0）**。DuckDB はここから再構築される派生キャッシュ。

## ビルド / 実行（重要）
- バックエンド: `cargo build` / `cargo run`。**必ずプロジェクトルートから起動**（DBパス・feeds.opml・web/dist を相対解決するため）。既定 `127.0.0.1:3000`。
- フロントエンド: **pnpm を使う（npm 禁止）**。`pnpm -C web install` / `pnpm -C web run build` / `pnpm -C web run dev`。
- 起動中は `data/rss.duckdb` をロック。再ビルド前に `pkill -f target/debug/rss-reader`。

## 設定（環境変数 / `.env`）
| 変数 | 既定 | 説明 |
|---|---|---|
| `HOST` | `127.0.0.1` | バインドアドレス（ループバックのみ） |
| `PORT` | `3000` | ポート |
| `POLL_INTERVAL_MINUTES` | `15` | 巡回間隔 |
| `DB_PATH` | `data/rss.duckdb` | DuckDBファイル |
| `FEEDS_PATH` | `feeds.opml` | 購読の正本（OPML 2.0） |
| `FRONTEND_URL` | `https://cross-ts.github.io/rss-reader/` | フロント配信元。`STATIC_DIR` 未指定時にここへリバースプロキシ |
| `STATIC_DIR` | (未設定) | 指定時はローカル配信（dev/offline）。例 `web/dist` |

## 不変条件（壊さないこと）
- **SSOT は feeds.opml**。全 mutation（feed/folder の create/update/delete）は「`feeds_lock` 取得 → OPML読込 → 変更 → `save_opml` → `reconcile_subscriptions`」の順。`feeds_lock`（tokio Mutex）で read-modify-write を直列化（lost update 防止）。
- `reconcile_subscriptions` はトランザクション付き。OPML にない feed の記事は CASCADE 削除。OPML 読込失敗は fail-fast（不在=None、パース失敗=Err）。起動時、OPML 不在かつDBに購読が残る場合は誤削除防止のため起動中止。
- **SSRF 対策**: フィード取得は http/https のみ。DNS解決後IPでループバック/プライベート/リンクローカル/CGNAT を拒否。リダイレクトは手動・毎ホップ検証。15s タイムアウト、10MB 上限。新規取得経路を足すときも `fetch_with_guard` 系を使う。
- **FTS**: lindera でトークン化 → `create_fts_index(stemmer='none', stopwords='none', overwrite=1)` → `match_bm25`。`CREATE`/`INSERT`/`PRAGMA create_fts_index` を1つの `execute_batch` にまとめない（"Table does not exist" になる）。記事0件時は索引未作成なので検索は空で返す。
- 記事本文はフロントで DOMPurify サニタイズ。元記事リンクは http/https のみ。

## レビュー / 運用
- **レビューは codex 必須**（コード＋アーキテクチャ）。例:
  - コード差分: `codex exec -C <repo-root> review --uncommitted --skip-git-repo-check < /dev/null`
  - 設計観点: `codex exec -C <repo-root> -s read-only "<観点>" < /dev/null`
  - CWD が git 外だと失敗するので必ず `-C <repo-root>`。background は stdin 待ちになるので `< /dev/null`。
- 実装・修正・検証はサブエージェントに委譲し、メインは設計/監査/レビューに専念する方針。

## 第2フェーズ（進行中）
ダーク&モダンUI刷新（Tailwind）/ フォルダ削除UI / フィードURL自動検出 / VSS削除（FTSは維持）/ 購読 YAML→OPML 移行 / フロントを GitHub Pages へデプロイしバイナリがリバースプロキシ配信（DuckDB UI 方式）。詳細は `plans/https-x-com-cst-negi-status-206667971091-snazzy-prism.md` の「第2フェーズ」節、進捗は `plans/rss-reader-handoff.md`。
