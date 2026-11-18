# AGENTS.md — web/（React + Vite フロントエンド）

Substack 風のタイムライン SPA（Home / Subscriptions / Search）。バックエンド API（`/api/*`）を同一オリジンで叩く。記事本文の HTML は描画せず、テキスト抜粋と先頭画像・元記事リンク（http/https のみ）だけを表示する。

## スタック / コマンド
- React 19 + Vite + TypeScript + `@tanstack/react-query` + Tailwind CSS v4。
- **pnpm を使う（npm 禁止）**。`pnpm -C web install` / `pnpm -C web run build` / `pnpm -C web run dev`（:5173, `/api`→`http://localhost:3000` プロキシ）/ `pnpm -C web test`。
- esbuild のビルドは `web/pnpm-workspace.yaml` の `allowBuilds: { esbuild: true }` で許可。pnpm 11 では package.json の `pnpm` フィールドではなくこちら。必要に応じ `pnpm -C web rebuild esbuild`。
- E2E（Playwright, `web/e2e/`）はリポジトリルートの `scripts/verify/verify.sh e2e`（E2E のみ）/ `all`（tsc・unit・Go・feature map・E2E）/ `up`（フィクスチャ付きでアプリを起動したまま待機。`BASE_URL` 等を表示）で実行する。`playwright test` 単体は `BASE_URL` / `RUN_DIR` が必須で、ハーネス経由でないと動かない。失敗時は実行ログに `[F-…]` テスト名・ステップ名・スクリーンショット・trace のパスが出る（`pnpm -C web exec playwright show-trace <trace.zip>`）。
- 機能一覧は `web/e2e/FEATURES.md`。行の ID と spec のテストタイトル先頭 `[F-…]` は 1 対 1 で対応させ（`scripts/verify/check-feature-map.sh` が検査）、UI の挙動を変えたら行も更新する。spec は role / label / text のロケータと web-first assertion のみ。sleep・retry・skip を入れない。vitest は `src/**/*.test.{ts,tsx}` だけを拾うので E2E spec とは干渉しない。
- ビルド成果物 `web/dist` は gitignore。GitHub Pages へは Actions でデプロイ予定。

## スタイル
- Tailwind v4 の CSS-first。`tailwind.config.js` は無い。`src/styles.css` に `@import "tailwindcss"`、`:root` の CSS 変数（`--bg --fg --muted --line --hover --panel --accent`、`prefers-color-scheme: light` で上書き）、`@theme inline` での色・フォント登録（`bg-bg` `text-muted` `border-line` `bg-accent` など）、`@layer base`。
- 見た目は原則ユーティリティで書く。ブレークポイントは Tailwind 既定の `sm`=640 / `lg`=1024 / `xl`=1280 に一致（`sm` 未満: 下部タブバー、`lg` 未満: アイコンレール、`xl` 未満: 右カラム非表示）。
- スクロールするのは window。左右カラムは `sticky top-0 h-screen`。

## ルーティング
- ライブラリ無しの自前ハッシュルーティング（`hooks/useHashRoute.ts`、`#/` `#/search?q=` `#/subscriptions`）。理由: GitHub Pages のサブパス配信には SPA フォールバックが無く、`base: './'` ではネストしたパスで相対アセットが解決できないため。ハッシュなら Pages / Go 静的配信 / Vite dev のどれでも変更なしで動く。
- Search の入力は `history.replaceState` で URL だけ更新する（`hashchange` が発火しないので再マウントされずフォーカスが保たれる）。`App.tsx` は `SearchPage` を `key={rawHash}` でマウントし、外部からの遷移では作り直される。

## データ取得（React Query）
- キー: `['articles', q]`（Home は q=''、Search は q。`useInfiniteQuery`、30 件/ページ、id で重複排除）、`['feeds']`、`['folders']`、`['unreadCounts']`。
- 既読は楽観的更新（`useSetRead`）。**`['articles']` は invalidate しない**（読み込み済みの全ページを再取得してしまうため）。`['unreadCounts']` だけ取り直す。
- 更新（`useRefresh`）は `['articles']` を 1 ページ目だけに切り詰めて invalidate する（reset だと Loading に戻る）。
- 購読画面の変更系は `hooks/useSubscriptionMutations.ts`。成功時に folders / feeds / unreadCounts を invalidate、フィードの改名・削除・追加は articles も invalidate。フォルダ移動のみ楽観的更新。409 は「同名のフォルダがあります」。
- フィードの「最終更新」は API に無いので表示しない。「最近更新されたフィード」は Home と同じ `['articles','']` の 1 ページ目から導出する。

## ファイル
- `src/main.tsx` — エントリ（QueryClient、ToastProvider）。`src/App.tsx` — シェル（Sidebar / main / TabBar）。
- `src/api/client.ts` — 型と api 関数。
- `src/pages/` — HomePage / SearchPage / SubscriptionsPage。
- `src/components/` — Sidebar, TabBar, Columns, SearchBox, ArticleCard, ArticleTimeline（無限スクロール）, RecentFeedsPanel, Avatar, Icon, Toast, Modal（Modal/ConfirmDialog/PromptDialog）, Menu, AddFeedModal。
- `src/hooks/` — useHashRoute, useArticles, useArticleMutations（useSetRead / useRefresh）, usePullToRefresh（touch・マウスドラッグ・wheel、Home 専用）, useSubscriptionMutations, useDebounce。
- `src/utils/` — time（formatDate）, thumbnail, decodeEntities, avatar, url（safeHttpUrl）, subscriptions（buildSections）, recentFeeds。
- `src/test/` — setup（IntersectionObserver スタブ、clipboard モック）、テスト用ヘルパー。

## 設定
- `vite.config.ts`: `base: './'`（Pages とローカルプロキシ双方で解決）。dev の `/api` プロキシは維持。
