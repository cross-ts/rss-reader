# AGENTS.md — rss-reader（リポジトリ・ガイド）

セルフホスト型RSSリーダー（単一ユーザー・ローカル用途）。RSS/Atom を定期巡回して SQLite に蓄積し、**全文検索**付きでブラウザ閲覧する。

## Workflow

- 作成したPlanは全てGitHubの `issue` に登録して進行する
- ユーザー指示がない限り `git` 操作は全て行いPRのマージをもってタスクを完了とする

## 構成
- バックエンド: Go（標準ライブラリ中心 / `net/http` `ServeMux` / `log/slog`）。`main.go` + `internal/` 配下。
  - `internal/config`: 設定（`flag`）と XDG パス解決。
  - `internal/db`: SQLite 接続・スキーマ・reconcile・記事一覧/検索・FTS 索引。
  - `internal/feeds`: OPML 2.0 の読み書き（購読の正本）。
  - `internal/fetcher`: SSRF ガード付きフィード取得・条件付きGET・フィードURL自動検出。
  - `internal/poller`: 定期巡回。
  - `internal/server`: `AppState`・ルーティング・リバースプロキシ配信。
  - `internal/handlers`: `/api/*` ハンドラ（feeds / folders / articles / refresh）。
- ストレージ: SQLite（`github.com/mattn/go-sqlite3`、cgo）。全文検索は **FTS5 の trigram トークナイザ**（BM25 ランキング）。**ビルドタグ `sqlite_fts5` 必須**。
- フロントエンド: React + Vite（SPA, 3ペイン）。`web/` 配下。
- 購読の正本（SSOT）: **`feeds.opml`（OPML 2.0）**。SQLite はここから再構築される派生キャッシュ。

## ビルド / 実行（重要）
- バックエンド: `go build -tags sqlite_fts5 -o rss-reader .` / `go run -tags sqlite_fts5 .`。`go test` も含め **必ず `-tags sqlite_fts5` を付ける**（無いと FTS5 仮想テーブル作成に失敗し起動時 fail-fast）。cgo を使うため C コンパイラ（gcc/clang）が必要。既定 `127.0.0.1:3000`。
- フロントエンド: **pnpm を使う（npm 禁止）**。`pnpm -C web install` / `pnpm -C web run build` / `pnpm -C web run dev`。
- `feeds.opml`（設定）と `rss.sqlite`（データ）は既定で **XDG ベースディレクトリ**配下に作成される。DB はループ起動中ロックされる（WAL モード）。

## 設定（CLI フラグ）
設定は **CLI フラグのみ**。**環境変数・`.env` / dotenv は使用しない**。未指定時は既定値を使用。

| フラグ | 既定 | 説明 |
|---|---|---|
| `--host` | `127.0.0.1` | バインドアドレス（ループバックのみ） |
| `-p` / `--port` | `3000` | ポート |
| `--poll-interval` | `15` | 巡回間隔（分） |
| `--db` | `$XDG_DATA_HOME/rss-reader/rss.sqlite`（未設定時 `~/.local/share/rss-reader/rss.sqlite`） | SQLiteファイル |
| `--feeds` | `$XDG_CONFIG_HOME/rss-reader/feeds.opml`（未設定時 `~/.config/rss-reader/feeds.opml`） | 購読の正本（OPML 2.0） |
| `--frontend-url` | `https://cross-ts.github.io/rss-reader/` | フロント配信元。`--static-dir` 未指定時にここへリバースプロキシ |
| `--static-dir` | (未設定) | 指定時はローカル配信（dev/offline）。例 `web/dist` |

- パス系（`--feeds`/`--db`）を**明示指定した場合のみ**、相対パスは cwd 基準で絶対解決（絶対パスはそのまま）。未指定時のみ XDG 既定パスを使う。
- 全オプションは `go run -tags sqlite_fts5 . --help` で確認できる。

## 不変条件（壊さないこと）
- **SSOT は feeds.opml**。全 mutation（feed/folder の create/update/delete）は「`FeedsLock` 取得 → OPML読込 → 変更 → OPML 保存 → `ReconcileSubscriptions`」の順。`FeedsLock`（`server.AppState` の `sync.Mutex`）で read-modify-write を直列化（lost update 防止）。ハンドラには `&state.FeedsLock` を渡す。
- `ReconcileSubscriptions`（`internal/db`）はトランザクション（`db.Begin()` → `tx.Commit()`）付き。OPML にない feed の記事は `ON DELETE CASCADE` 相当で削除。OPML 読込失敗は fail-fast（不在=nil、パース失敗=err）。起動時、OPML 不在かつ DB に購読が残る場合は誤削除防止のため**起動中止**（`main.go` の `reconcileOnStartup`）。OPML 不在かつ DB が空なら空テンプレートを自動生成。
- **SSRF 対策**: フィード取得は http/https のみ（`fetcher.ValidateFeedURL`）。DNS解決後 IP でループバック/プライベート/リンクローカル/CGNAT を拒否（`checkIP`/`checkIPv4`/`checkIPv6`）。リダイレクトは Go 標準の自動追従を無効化し（`CheckRedirect`）、`FetchWithGuard(Conditional)` で手動・毎ホップ検証。15s タイムアウト、10MB 上限（`MaxFeedBytes`）。新規取得経路を足すときも `FetchWithGuard` 系を使う。
- **FTS**: `articles_fts` を `fts5(..., tokenize='trigram')` で作成し、`articles` への INSERT/DELETE/UPDATE をトリガで同期。検索は `articles_fts MATCH ?`。並び順は全経路共通で `published_at DESC`（関連度順は使用しない）。3文字以上は trigram MATCH、1〜2文字は LIKE フォールバック（trigram は3-gram のため）。全件再構築は `INSERT INTO articles_fts(articles_fts) VALUES('rebuild')`。
- リバースプロキシ配信時、プロキシ先は `FRONTEND_URL` のオリジンと**厳密一致**するもののみ許可（SSRF 対策）。`/api/*` はローカル DB に直結。
- 記事本文はフロントで DOMPurify サニタイズ。元記事リンクは http/https のみ。

## レビュー / 運用
- **レビューは codex 必須**（コード＋アーキテクチャ）。例:
  - コード差分: `codex exec -C <repo-root> review --uncommitted --skip-git-repo-check < /dev/null`
  - 設計観点: `codex exec -C <repo-root> -s read-only "<観点>" < /dev/null`
  - CWD が git 外だと失敗するので必ず `-C <repo-root>`。background は stdin 待ちになるので `< /dev/null`。
- 実装・修正・検証はサブエージェントに委譲し、メインは設計/監査/レビューに専念する方針。

## 既知の制限 / 今後の対応
MVP として許容し将来対応とする項目（詳細は README）:
- ポーリングの single-flight 化（起動巡回・定期巡回・手動更新・追加時取得が重複し得る）。
- FTS は巡回ごとに全件 `rebuild`。GUID は `DO NOTHING`（訂正・更新が未反映）。
- リバースプロキシのヘッダ透過は `Content-Type` のみ。SQLite WAL の異常終了時に WAL/SHM が残る場合あり。
