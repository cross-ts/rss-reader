# AGENTS.md — web/（React + Vite フロントエンド）

3ペイン SPA（Sidebar / ArticleList / ArticleView）。バックエンド API（`/api/*`）を同一オリジンで叩く。

## スタック / コマンド
- React 18 + Vite + TypeScript + `@tanstack/react-query` + `dompurify`。
- **pnpm を使う（npm 禁止）**。`pnpm -C web install` / `pnpm -C web run build` / `pnpm -C web run dev`（:5173, `/api`→`http://localhost:3000` プロキシ）。
- esbuild のビルドは `web/pnpm-workspace.yaml` の `allowBuilds: { esbuild: true }` で許可。pnpm 11 では package.json の `pnpm` フィールドではなくこちら。必要に応じ `pnpm -C web rebuild esbuild`。
- ビルド成果物 `web/dist` は gitignore。GitHub Pages へは Actions でデプロイ予定。

## ファイル
- `src/main.tsx` — エントリ（QueryClientProvider, CSS import）。
- `src/App.tsx` — 3ペインレイアウト。
- `src/api/client.ts` — 型（Folder/Feed/Article、`publishedAt: string | null`）と api 関数（getFolders/createFolder/getFeeds/createFeed/deleteFeed/getArticles/refresh）。
- `src/components/Sidebar.tsx` — フォルダ/フィードツリー＋追加フォーム。
- `src/components/ArticleList.tsx` — 検索ボックス＋記事カード（`formatDate` は null→「日付不明」、`stripHtml`）。
- `src/components/ArticleView.tsx` — 本文（`DOMPurify.sanitize`）、元記事リンクは http/https のみ。
- `src/styles.css` — スタイル。

## 第2フェーズでのフロント作業（予定/進行中）
- **Tailwind CSS 導入**（ダーク&モダン）: `tailwindcss`/`postcss`/`autoprefixer`、`tailwind.config.ts`（content=index.html・src/**、常時ダーク、near-black 背景＋teal/cyan アクセント、mono フォント）、`postcss.config.js`、エントリCSS に `@tailwind base/components/utilities`。全コンポーネントをユーティリティで再スタイル。原則: フラット・余白広め・2ウェイト・sentence case。URL/メタは monospace。
- **フォルダ削除UI**: `client.ts` に `deleteFolder(id)`、Sidebar の各フォルダ見出しに削除ボタン＋確認、成功時 folders/feeds/articles を invalidate。
- **フィード自動検出UI**: `client.ts` に `discoverFeed(url)`（`POST /api/feeds/discover`）。追加フォームの入力を「サイト or フィードURL」に。追加はサーバ側自動検出に任せる。任意で「検出」ボタンで候補プレビュー。
- **`vite.config.ts`**: `base: './'`（Pages とローカルプロキシ双方で解決）。dev の `/api` プロキシは維持。
