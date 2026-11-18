# rss-reader

## Technology Stack

- Frontend
  - Framework: React
  - State Management: TanStack React Query
  - UI: Vite, Tailwind CSS

## Core Architecture

- SSOT: feeds.opml

## Verification

- コミット前に必ず `/verify` を通す。`Verified-By` トレーラはコミット時に自動付与されるので手で書かない。通せない場合のみコミットメッセージに `Verification-Skipped: <理由>` を付ける。
- 修正が 3 ラウンド失敗したら止め、人間に状況の要約を渡す。
- flaky なテストに skip・sleep・retry を入れない。根本原因を直すか、テストを削除してコミットメッセージに理由を残す。
- property test の反例はバグとして扱う。性質や生成器を弱めて通さない。
- 失敗させる変更の中で、既存のアサーションを変更しない。
- レビューは base ブランチの `REVIEW.md` に従い、レビュー結果には対象の HEAD SHA を明記する。見落としは、出典付きの `REVIEW.md` 項目かフックとして足し、対象パスが消えた項目は削除する。
- ゲート関連ファイル（`.claude/settings.json`、`.claude/hooks/`、`.githooks/`、`scripts/verify/`）はエージェントが編集せず、人間が行う。
- ゲートが認識するマーカーは実質 `verify` のみ（code-review の記録は未実装）。
- 有効化は人間が行う: フックを `.claude/settings.json` に登録し、`git config core.hooksPath .githooks` を実行する。
- 検証状況の確認: `git log --format='%h %s | %(trailers:key=Verified-By,valueonly)'`
