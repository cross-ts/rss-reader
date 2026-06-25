# RSS Reader

複数のRSS/Atomフィードを自動巡回してSQLiteに蓄積し、**日本語全文検索**付きでブラウザから閲覧できる、セルフホスト型のRSSリーダー（単一ユーザー・ローカル用途）。

- バックエンド: Rust（axum + tokio）
- ストレージ: SQLite（rusqlite bundled + FTS5 による日本語全文検索）
- 日本語トークナイズ: lindera（IPADIC）→ SQLite FTS5（BM25）
- フロントエンド: React + Vite（SPA、3ペイン）
- フィード定義: `feeds.opml` を **SSOT（単一の正本）** とし、SQLiteはそこから再構築される派生キャッシュ

## 必要環境
- Rust（cargo）
- Node.js + **pnpm**（npmは使わない）

## セットアップと起動
```sh
# 1) フロントエンドをビルド（web/dist を生成）
pnpm -C web install
pnpm -C web run build

# 2) バックエンドを起動（必ずプロジェクトルートから）
cargo run
# → http://127.0.0.1:3000
```
> **バイナリを実行したカレントディレクトリ（cwd）に `feeds.opml` と `data/` が作られます。**
> 初回起動時に `feeds.opml` が存在しなければ空の OPML 2.0 テンプレートが自動生成されます。
> `DB_PATH`/`FEEDS_PATH` で任意のパスを指定可能（相対パスは cwd 基準で解決、絶対パスはそのまま使用）。

### 設定（環境変数 / `.env`）
| 変数 | 既定 | 説明 |
|---|---|---|
| `HOST` | `127.0.0.1` | バインドアドレス（既定はループバックのみ） |
| `PORT` | `3000` | ポート |
| `POLL_INTERVAL_MINUTES` | `15` | フィード巡回間隔 |
| `DB_PATH` | `data/rss.sqlite` | SQLiteファイル |
| `FEEDS_PATH` | `feeds.opml` | フィード定義（SSOT） |
| `FRONTEND_URL` | `https://cross-ts.github.io/rss-reader/` | フロント配信元（`STATIC_DIR` 未指定時にリバースプロキシ） |
| `STATIC_DIR` | （未設定） | ローカル静的配信する場合のみ指定（例: `web/dist`） |

### CLI オプション

環境変数に加え、コマンドライン引数でも設定を指定できます。**優先順位は「CLI 引数 > 環境変数（`.env` 含む）> 既定値」** です。

| フラグ | 対応 env 変数 | 既定値 | 説明 |
|---|---|---|---|
| `--feeds <PATH>` | `FEEDS_PATH` | `feeds.opml` | feeds.opml のパス |
| `--db <PATH>` | `DB_PATH` | `data/rss.sqlite` | SQLite ファイルのパス |
| `--host <ADDR>` | `HOST` | `127.0.0.1` | バインドアドレス |
| `-p`, `--port <PORT>` | `PORT` | `3000` | ポート番号 |
| `--frontend-url <URL>` | `FRONTEND_URL` | `https://cross-ts.github.io/rss-reader/` | フロント配信元 URL |
| `--static-dir <PATH>` | `STATIC_DIR` | （未設定） | ローカル静的配信ディレクトリ |
| `--poll-interval <MINUTES>` | `POLL_INTERVAL_MINUTES` | `15` | フィード巡回間隔（分） |

```sh
# 全オプションの確認
rss-reader --help

# バージョン確認
rss-reader --version

# 例: ポートと DB パスを指定して起動
rss-reader --port 3100 --db /var/data/rss.sqlite
```

> パス系オプション（`--feeds`, `--db`）は相対パスの場合 cwd 基準で絶対パスに解決されます。絶対パスを指定した場合はそのまま使用されます。

### リバースプロキシ配信（デフォルト）

`STATIC_DIR` を指定しない場合、バックエンドは `FRONTEND_URL` が指す GitHub Pages からフロントを取得して `localhost` の単一オリジンで配信する。

```sh
# FRONTEND_URL のデフォルトは https://cross-ts.github.io/rss-reader/
cargo run
# → http://localhost:3000 でアクセス

# ポートを変えたい場合
PORT=3100 cargo run
```

`/api/*` はローカル DB に直結し、それ以外のリクエストは Pages にプロキシされる。SPA の拡張子なしパス（例: `/some/route`）は自動的に `index.html` にフォールバックする。

### ローカル静的配信（オフライン・ビルド確認用）

`STATIC_DIR` を指定すると Pages にアクセスせずローカルの `web/dist` から配信する。

```sh
pnpm -C web install
pnpm -C web run build
STATIC_DIR=web/dist cargo run
# → http://localhost:3000
```

### 開発（ホットリロード）
```sh
cargo run                 # API :3000
pnpm -C web run dev       # Vite :5173（/api を :3000 にプロキシ）
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
  - DB に購読が残っていなければ、空の OPML 2.0 テンプレートを cwd に自動生成して起動を続行する。
  - DB に購読が残っている場合は、誤って全削除しないよう**起動を中止**する（CWD やファイル権限を確認すること）。
- `feeds.opml` が読み取り/パース不能なら**起動を中止**（fail-fast）。
- フィードを `feeds.opml` から削除すると、reconcile時にそのフィードの記事も削除される（孤立防止）。

## 主な機能
- 複数フィードの定期巡回（条件付きGET）と `(feed_id, guid)` による重複排除
- フォルダ単位のグルーピングと記事一覧（公開日降順）
- 日本語キーワードの全文検索（lindera + SQLite FTS5 / BM25）
- Web UIからのフィード/フォルダ管理

## セキュリティ上の注意
- 既定で **127.0.0.1（ループバック）にのみバインド**。無認証のため、**そのまま外部公開しない**こと（公開する場合は認証・TLS・許可Originの追加が必須）。
- フィード取得は **http/https のみ許可**し、ループバック/プライベート/リンクローカルIP（DNS解決後を含む）への取得を拒否（SSRF対策）。タイムアウト・リダイレクト上限あり。
- 記事本文は表示前に DOMPurify でサニタイズ。元記事リンクは http/https のみ。

## 既知の制限 / 今後の対応（codexアーキテクチャレビュー由来）
MVPとして許容し、将来対応とする項目:
- **ポーリングのsingle-flight化**: 起動巡回・定期巡回・手動更新・フィード追加時取得が重複し得る。
- **FTS再構築の最適化**: 現在は巡回ごとに全件再構築（`rebuild`）。変更があった時のみ/差分・デバウンス化したい。
- **DBアクセスの並行性**: 単一 `Connection` + `Mutex`。feed単位のバッチトランザクション、読み書き接続分離が望ましい。
- **lindera tokenizer の再利用**: 現在は呼び出し毎に辞書ロード。1度だけ構築して共有したい。
- **GUIDのupsert**: 現在は `DO NOTHING`。記事の訂正・更新が反映されない。
- **安定ID / ソフトデリート**: フィード再追加でIDが変わり得る。`feeds.yaml` に不変IDを持たせる案。
- **CSP / 画像プロキシ**: CSPヘッダ、外部画像の取り扱い。
- **VSS（ベクトル類似検索）**: （撤去済・将来再導入余地）
- **WAL/クラッシュ堅牢性**: SQLite WAL モード使用中。通常は自動復旧されるが、異常終了時に WAL/SHM ファイルが残る場合がある。

## 既知の制約（将来対応）

リバースプロキシ配信・OPML・SPA 周辺で現在簡易実装となっている項目:

- **リバースプロキシのヘッダ透過が限定的**: `Content-Type` のみ転送し、`HEAD`/`Range`/`ETag`/`Cache-Control`/`Last-Modified` 等は未対応。レスポンスボディのサイズ上限なし（上流の巨大ファイルをそのまま中継する）。プロキシ先リダイレクトの SSRF 制限なし（`proxy_client` はリダイレクト自動追従）。
- **エラーコード体系の未整理**: API/プロキシが返す HTTP ステータス（400/404/502/504）の設計が統一されていない。
- **OPML 関連の簡易実装**: 階層フォルダ（ネスト）の OPML ラウンドトリップ、OPML 保存と DB reconcile の跨ぎ原子性、`collect_outline` のフィード子要素への再帰が未対応。
- **フィード自動検出の簡易実装**: `rel=alternate` の優先順位付けや候補の絞り込みが未実装。
- **SPA フォールバック判定**: 拡張子有無のみで判定しており、`Accept` ヘッダ（`text/html` を期待するかどうか）を考慮していない。
- **ポーリングの single-flight**: 起動巡回・定期巡回・手動更新・フィード追加時の取得が重複し得る。
- **WAL/クラッシュ堅牢性**: SQLite WAL モード使用中。前述のとおり。
- **VSS（ローカル埋め込みによる類似記事検索）**: 撤去済み。将来再導入の余地あり。
