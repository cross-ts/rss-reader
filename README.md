# RSS Reader

複数のRSS/Atomフィードを自動巡回してDuckDBに蓄積し、**日本語全文検索**付きでブラウザから閲覧できる、セルフホスト型のRSSリーダー（単一ユーザー・ローカル用途）。

- バックエンド: Rust（axum + tokio）
- ストレージ: DuckDB（`fts` 拡張による日本語全文検索）
- 日本語トークナイズ: lindera（IPADIC）→ DuckDB FTS（BM25）
- フロントエンド: React + Vite（SPA、3ペイン）
- フィード定義: `feeds.opml` を **SSOT（単一の正本）** とし、DuckDBはそこから再構築される派生キャッシュ

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
> 注: DBパス・feeds.opml・`web/dist` は相対パスで解決されるため、**プロジェクトルートから起動**すること。

### 設定（環境変数 / `.env`）
| 変数 | 既定 | 説明 |
|---|---|---|
| `HOST` | `127.0.0.1` | バインドアドレス（既定はループバックのみ） |
| `PORT` | `3000` | ポート |
| `POLL_INTERVAL_MINUTES` | `15` | フィード巡回間隔 |
| `DB_PATH` | `data/rss.duckdb` | DuckDBファイル |
| `FEEDS_PATH` | `feeds.opml` | フィード定義（SSOT） |
| `FRONTEND_URL` | `https://cross-ts.github.io/rss-reader/` | フロント配信元（`STATIC_DIR` 未指定時にリバースプロキシ） |
| `STATIC_DIR` | （未設定） | ローカル静的配信する場合のみ指定（例: `web/dist`） |

### 開発（ホットリロード）
```sh
cargo run                 # API :3000
pnpm -C web run dev       # Vite :5173（/api を :3000 にプロキシ）
```

## feeds.opml（SSOT）
フォルダとフィードの正本は `feeds.opml`。Web UIからの追加/削除/フォルダ変更はこのファイルへ書き戻され、その後DuckDBが `feeds.opml` に一致するよう再構築（reconcile）される。手動編集も可能（再起動で反映）。
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
- 起動時、`feeds.opml` が読み取り/パース不能なら**起動を中止**（fail-fast）。不在でDBに購読が残っている場合も、誤って全削除しないよう**起動を中止**する。
- フィードを `feeds.opml` から削除すると、reconcile時にそのフィードの記事も削除される（孤立防止）。

## 主な機能
- 複数フィードの定期巡回（条件付きGET）と `(feed_id, guid)` による重複排除
- フォルダ単位のグルーピングと記事一覧（公開日降順）
- 日本語キーワードの全文検索（lindera + DuckDB FTS / BM25）
- Web UIからのフィード/フォルダ管理

## セキュリティ上の注意
- 既定で **127.0.0.1（ループバック）にのみバインド**。無認証のため、**そのまま外部公開しない**こと（公開する場合は認証・TLS・許可Originの追加が必須）。
- フィード取得は **http/https のみ許可**し、ループバック/プライベート/リンクローカルIP（DNS解決後を含む）への取得を拒否（SSRF対策）。タイムアウト・リダイレクト上限あり。
- 記事本文は表示前に DOMPurify でサニタイズ。元記事リンクは http/https のみ。

## 既知の制限 / 今後の対応（codexアーキテクチャレビュー由来）
MVPとして許容し、将来対応とする項目:
- **ポーリングのsingle-flight化**: 起動巡回・定期巡回・手動更新・フィード追加時取得が重複し得る。
- **FTS再構築の最適化**: 現在は巡回ごとに全件再構築（`overwrite=1`）。変更があった時のみ/差分・デバウンス化したい。
- **DBアクセスの並行性**: 単一 `Connection` + `Mutex`。feed単位のバッチトランザクション、読み書き接続分離が望ましい。
- **lindera tokenizer の再利用**: 現在は呼び出し毎に辞書ロード。1度だけ構築して共有したい。
- **GUIDのupsert**: 現在は `DO NOTHING`。記事の訂正・更新が反映されない。
- **安定ID / ソフトデリート**: フィード再追加でIDが変わり得る。`feeds.yaml` に不変IDを持たせる案。
- **絶対パス徹底 / CSP / 画像プロキシ**: 起動ディレクトリ非依存化、CSPヘッダ、外部画像の取り扱い。
- **VSS（ベクトル類似検索）**: （撤去済・将来再導入余地）
- **WAL/クラッシュ堅牢性**: FTSインデックス再構築（`overwrite=1`）中にプロセスが異常終了すると、WALが再生不能になり起動できなくなる場合がある（`Cannot drop entry fts_main_articles`）。暫定復旧は `data/rss.duckdb.wal` の削除（メインDBは保持。記事はSSOT＋再巡回で復元）。将来対応: 再構築後の `CHECKPOINT`、または起動時のWAL自動復旧。
