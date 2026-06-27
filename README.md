# RSS Reader

複数のRSS/Atomフィードを自動巡回してSQLiteに蓄積し、**全文検索**付きでブラウザから閲覧できる、セルフホスト型のRSSリーダー（単一ユーザー・ローカル用途）。

- バックエンド: Go（標準ライブラリ中心 / `net/http` `ServeMux`）
- ストレージ: SQLite（`mattn/go-sqlite3` + FTS5 による全文検索）
- 全文検索: SQLite FTS5 の **trigram トークナイザ**（BM25 ランキング）
- フロントエンド: React + Vite（SPA、3ペイン）
- フィード定義: `feeds.opml` を **SSOT（単一の正本）** とし、SQLiteはそこから再構築される派生キャッシュ

## 必要環境
- Go（cgo を使うため C コンパイラ（gcc/clang）が必要）
- Node.js + **pnpm**（npmは使わない）

## セットアップと起動
```sh
# 1) フロントエンドをビルド（web/dist を生成）
pnpm -C web install
pnpm -C web run build

# 2) バックエンドを起動（FTS5 を有効化するため -tags sqlite_fts5 が必須）
go run -tags sqlite_fts5 .
# → http://127.0.0.1:3000
```
> **`feeds.opml`（設定）と `rss.sqlite`（データ）は既定で XDG ベースディレクトリ配下に作成されます。**
> - `feeds.opml` → `$XDG_CONFIG_HOME/rss-reader/feeds.opml`（未設定時 `~/.config/rss-reader/feeds.opml`）
> - `rss.sqlite` → `$XDG_DATA_HOME/rss-reader/rss.sqlite`（未設定時 `~/.local/share/rss-reader/rss.sqlite`）
>
> 初回起動時に `feeds.opml` が存在しなければ、空の OPML 2.0 テンプレートが自動生成されます。
> `DB_PATH`/`FEEDS_PATH`（または `--db`/`--feeds`）で任意のパスを明示指定できます（相対パスは cwd 基準で解決、絶対パスはそのまま使用）。
>
> **このリポジトリ直下のサンプル `feeds.opml` を引き継ぎたい場合**は、`--feeds ./feeds.opml` で明示指定するか、`~/.config/rss-reader/` へ手動コピーしてください。

> **FTS5 について**: ビルドタグ `sqlite_fts5` を付けないと FTS5 仮想テーブルの作成に失敗し、起動時に fail-fast します。`go run`/`go build`/`go test` いずれも `-tags sqlite_fts5` を付けてください。

### 設定（環境変数）

設定は **環境変数のみ**（`os.Getenv`）と CLI フラグで読み込みます。**`.env` ファイルは使用しません**（dotenv 廃止）。

| 変数 | 既定 | 説明 |
|---|---|---|
| `HOST` | `127.0.0.1` | バインドアドレス（既定はループバックのみ） |
| `PORT` | `3000` | ポート |
| `POLL_INTERVAL_MINUTES` | `15` | フィード巡回間隔 |
| `DB_PATH` | `$XDG_DATA_HOME/rss-reader/rss.sqlite`（未設定時 `~/.local/share/rss-reader/rss.sqlite`） | SQLiteファイル |
| `FEEDS_PATH` | `$XDG_CONFIG_HOME/rss-reader/feeds.opml`（未設定時 `~/.config/rss-reader/feeds.opml`） | フィード定義（SSOT） |
| `FRONTEND_URL` | `https://cross-ts.github.io/rss-reader/` | フロント配信元（`STATIC_DIR` 未指定時にリバースプロキシ） |
| `STATIC_DIR` | （未設定） | ローカル静的配信する場合のみ指定（例: `web/dist`） |

### CLI オプション

環境変数に加え、コマンドライン引数でも設定を指定できます。**優先順位は「CLI 引数 > 環境変数 > 既定値」** です。

| フラグ | 対応 env 変数 | 既定値 | 説明 |
|---|---|---|---|
| `--feeds <PATH>` | `FEEDS_PATH` | XDG（上表参照） | feeds.opml のパス |
| `--db <PATH>` | `DB_PATH` | XDG（上表参照） | SQLite ファイルのパス |
| `--host <ADDR>` | `HOST` | `127.0.0.1` | バインドアドレス |
| `-p`, `--port <PORT>` | `PORT` | `3000` | ポート番号 |
| `--frontend-url <URL>` | `FRONTEND_URL` | `https://cross-ts.github.io/rss-reader/` | フロント配信元 URL |
| `--static-dir <PATH>` | `STATIC_DIR` | （未設定） | ローカル静的配信ディレクトリ |
| `--poll-interval <MINUTES>` | `POLL_INTERVAL_MINUTES` | `15` | フィード巡回間隔（分） |

```sh
# 全オプションの確認
go run -tags sqlite_fts5 . --help

# 例: ポートと DB パスを指定して起動
go run -tags sqlite_fts5 . --port 3100 --db /var/data/rss.sqlite
```

> パス系オプション（`--feeds`, `--db`）を明示指定した場合、相対パスは cwd 基準で絶対パスに解決されます。絶対パスはそのまま使用されます。明示指定が無い場合のみ XDG 既定パスが使われます。

### バイナリのビルド

```sh
go build -tags sqlite_fts5 -o rss-reader .
./rss-reader
```

### リバースプロキシ配信（デフォルト）

`STATIC_DIR` を指定しない場合、バックエンドは `FRONTEND_URL` が指す GitHub Pages からフロントを取得して `localhost` の単一オリジンで配信する。

```sh
# FRONTEND_URL のデフォルトは https://cross-ts.github.io/rss-reader/
go run -tags sqlite_fts5 .
# → http://localhost:3000 でアクセス
```

`/api/*` はローカル DB に直結し、それ以外のリクエストは Pages にプロキシされる。SPA の拡張子なしパス（例: `/some/route`）は自動的に `index.html` にフォールバックする。プロキシ先は `FRONTEND_URL` のオリジンと厳密一致するもののみ許可する（SSRF 対策）。

### ローカル静的配信（オフライン・ビルド確認用）

`STATIC_DIR` を指定すると Pages にアクセスせずローカルの `web/dist` から配信する。

```sh
pnpm -C web install
pnpm -C web run build
STATIC_DIR=web/dist go run -tags sqlite_fts5 .
# → http://localhost:3000
```

### 開発（ホットリロード）
```sh
go run -tags sqlite_fts5 .   # API :3000
pnpm -C web run dev          # Vite :5173（/api を :3000 にプロキシ）
```

## feeds.opml（SSOT）
フォルダとフィードの正本は `feeds.opml`。Web UIからの追加/削除/フォルダ変更はこのファイルへ書き戻され、その後SQLiteが `feeds.opml` に一致するよう再構築（reconcile）される。手動編集も可能（再起動で反映）。
```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>rss-reader subscriptions</title></head>
  <body>
    <outline text="AR/VR" title="AR/VR">
      <outline type="rss" text="Road to VR" title="Road to VR"
               xmlUrl="https://www.roadtovr.com/feed/" htmlUrl="https://www.roadtovr.com/"/>
    </outline>
  </body>
</opml>
```
- 起動時に `feeds.opml` が存在しない場合:
  - DB に購読が残っていなければ、空の OPML 2.0 テンプレートを既定パスに自動生成して起動を続行する。
  - DB に購読が残っている場合は、誤って全削除しないよう**起動を中止**する（パスやファイル権限を確認すること）。
- `feeds.opml` が読み取り/パース不能なら**起動を中止**（fail-fast）。
- フィードを `feeds.opml` から削除すると、reconcile時にそのフィードの記事も削除される（孤立防止）。

## 主な機能
- 複数フィードの定期巡回（条件付きGET）と `(feed_id, guid)` による重複排除
- フォルダ単位のグルーピングと記事一覧（公開日降順）
- キーワードの全文検索（SQLite FTS5 trigram / BM25）。3文字以上は trigram MATCH、1〜2文字は LIKE フォールバック。
- Web UIからのフィード/フォルダ管理

## セキュリティ上の注意
- 既定で **127.0.0.1（ループバック）にのみバインド**。無認証のため、**そのまま外部公開しない**こと（公開する場合は認証・TLS・許可Originの追加が必須）。
- フィード取得は **http/https のみ許可**し、ループバック/プライベート/リンクローカルIP（DNS解決後を含む）への取得を拒否（SSRF対策）。タイムアウト・リダイレクト上限・ボディサイズ上限あり。
- 記事本文は表示前に DOMPurify でサニタイズ。元記事リンクは http/https のみ。

## 既知の制限 / 今後の対応
MVPとして許容し、将来対応とする項目:
- **ポーリングのsingle-flight化**: 起動巡回・定期巡回・手動更新・フィード追加時取得が重複し得る。
- **FTS再構築の最適化**: 現在は巡回ごとに全件再構築（`rebuild`）。
- **GUIDのupsert**: 現在は `DO NOTHING`。記事の訂正・更新が反映されない。
- **リバースプロキシのヘッダ透過が限定的**: `Content-Type` のみ転送。
- **WAL/クラッシュ堅牢性**: SQLite WAL モード使用中。異常終了時に WAL/SHM ファイルが残る場合がある。
