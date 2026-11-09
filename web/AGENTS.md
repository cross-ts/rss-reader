# AGENTS.md — web/（React + Vite フロントエンド）

Astryx（Meta のデザインシステム）で組んだ、静かな編集的レイアウトのタイムライン SPA（ホーム / 購読 / 検索）。バックエンド API（`/api/*`）を同一オリジンで叩く。記事本文の HTML は描画せず、テキスト抜粋と先頭画像・元記事リンク（http/https のみ）だけを表示する。

## スタック / コマンド
- React 19 + Vite + TypeScript + `@tanstack/react-query` + Tailwind CSS v4 + **Astryx**（`@astryxdesign/core` + `@astryxdesign/theme-neutral`、0.7.8）。
- Astryx のコンポーネント API は推測しない。`pnpm -C web exec astryx component <Name>` / `astryx docs <topic>` で確認する。
- `pnpm-workspace.yaml` の `minimumReleaseAge`（3 日）により、Astryx は公開後 3 日以上経った版しか入らない。`@astryxdesign/core` の postinstall（init 案内の表示のみ）は `allowBuilds` で拒否している。
- **pnpm を使う（npm 禁止）**。`pnpm -C web install` / `pnpm -C web run build` / `pnpm -C web run dev`（:5173, `/api`→`http://localhost:3000` プロキシ）/ `pnpm -C web test`。
- esbuild のビルドは `web/pnpm-workspace.yaml` の `allowBuilds: { esbuild: true }` で許可。pnpm 11 では package.json の `pnpm` フィールドではなくこちら。必要に応じ `pnpm -C web rebuild esbuild`。
- ビルド成果物 `web/dist` は gitignore。GitHub Pages へは Actions でデプロイ予定。

## スタイル / デザイン
- `src/styles.css` は Astryx の Tailwind ブリッジ構成。先頭の `@layer reset, theme, base, astryx-base, astryx-theme, components, utilities;` は必須（無いと Astryx が Tailwind ユーティリティに勝つ）。
- 色・余白・角丸は Astryx のトークン（Tailwind では `bg-surface` `text-secondary` `border-border` `bg-muted` など）。生の色値は書かない。ダークモードは `<Theme mode="system">` が OS 設定に追従。
- フォントは Figtree + Noto Sans JP（`--font-family-body/heading` を上書き）。
- シェルは `AppShell`（`height="auto"`、window がスクロール）+ `SideNav`。`lg` 未満では AppShell が上部バー + ドロワー（MobileNav）に切り替える。
- 本文カラムは `components/PageHeader.tsx` の `Page`（最大 720px）。右パネル（最近更新）は `xl` 以上のみ。
- 余白は Astryx の `docs layout/layout-spacing` に従う: padding はコンテナ（`Page` / 行 / ダイアログ）だけが持ち、子は margin を持たない（間隔は親の `gap`）。内側は狭い gap（1–2）、ブロック間は広い gap（`Page` は 8）で強弱を付ける。領域ごとに文字の左端線を 1 本に揃え、List/Item のように内側余白を持つ部品は `edge="flush"` で線を合わせる。内側の余白はトークン（Tailwind の数値クラス = `--spacing-1` 基準）のみ、生の px は構造上の幅だけ。
- 密なデータは Card ではなく行（List / Item / 罫線）で並べる。アイコンは Astryx のセマンティック名に無いものを `components/icons.tsx` の SVG コンポーネントで渡す。

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
- `src/main.tsx` — エントリ（QueryClient、Astryx `Theme`）。`src/App.tsx` — `AppShell` + `SideNav`。
- `src/api/client.ts` — 型と api 関数。
- `src/pages/` — HomePage / SearchPage / SubscriptionsPage。
- `src/components/` — PageHeader（Page / PageHeader）, ArticleRow, ArticleTimeline（無限スクロール）, RecentFeedsPanel, Dialogs（FormDialog / PromptDialog）, AddFeedDialog, folderOptions, icons, Toast（Astryx `useToast` の文字列ラッパ）。
- `src/hooks/` — useHashRoute, useArticles, useArticleMutations（useSetRead / useRefresh）, usePullToRefresh（Home 専用）, useSubscriptionMutations, useDebounce。
- `src/utils/` — time（formatDate）, thumbnail, decodeEntities, url（safeHttpUrl）, subscriptions（buildSections）, recentFeeds。
- `src/test/` — setup（IntersectionObserver / `<dialog>` スタブ、clipboard モック）、テスト用ヘルパー。

## 設定
- `vite.config.ts`: `base: './'`（Pages とローカルプロキシ双方で解決）。dev の `/api` プロキシは維持。
