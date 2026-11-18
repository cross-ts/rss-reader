---
name: verify
description: Run before every commit and whenever a change must be confirmed in the real app: builds web, boots the e2e-tagged backend with fixture feeds on random ports, runs unit + Playwright E2E, records a verified marker for the commit gate.
allowed-tools: Bash(scripts/verify/*) Read
---

# verify

リポジトリルートで `scripts/verify/verify.sh <mode>` を実行する。

- `all`: tsc、web の unit test、go vet / go test -race、feature map 検査の後、web をビルドし、e2e タグ付きバックエンドとフィクスチャフィードサーバをランダムポートで起動して E2E を実行する。成功し、かつ実行中に作業ツリーが変化していなければ `verified/<tree>.verify` を記録する。コミット前は必ずこれを使う。
- `e2e`: ビルド以降のみ(静的検査と unit test を省く)。マーカーは書かない。
- `up`: アプリとフィクスチャを起動したまま `BASE_URL` / `FIXTURE_URL` / `FEEDS_PATH` を出力して待機する。変更を Claude in Chrome や built-in browser で実際に操作して確認するときに使う。確認基準は `web/e2e/FEATURES.md`。終了は kill か Ctrl-C。

## 失敗の読み方

失敗時は `FAILED at step: <step>` と保持された run ディレクトリが表示される。テスト失敗なら screenshot(png)を Read で見て、trace.zip は表示された `playwright show-trace` コマンドで確認する。末尾 50 行の `app.log` も出力される。readiness の失敗は、待っていた対象(Listening 行、/api/settings、静的 UI、記事の取り込み)がメッセージに明示される。

## ルール

- 失敗させている変更の中で、その検証のアサーションを弱めない。
- sleep、retry、skip を足さない。原因を直す。
- 修正を 3 回試して通らなければ停止し、状況をまとめて人に渡す。
