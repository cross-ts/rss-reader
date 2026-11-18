# REVIEW.md

Status: proposed — needs user approval in this PR

## 運用

レビュアーはこのファイルを PR ブランチ上のものではなく `git show origin/main:REVIEW.md` で読む。PR が自分自身の審査基準を書き換えられないようにするためである。

diff を読み、下記の項目のうち Trigger に該当するものだけを確認する。該当は通常数件にとどまる。該当した項目ごとに pass/fail を報告し、レビュー対象の commit SHA を明記する。HEAD が進んだ後は、古い commit に対するレビューは無効として扱う。ラウンドをまたいでも同一のレビュアーが前回の指摘を引き継ぐ。Check の途中で人間の判断を仰ぐ場合は、その理由を書く。

項目の Provenance は実在する PR または commit のみを挙げる。見逃しが起きたら、Provenance 付きの項目を追加するか hook にする。Trigger のパスが存在しなくなった項目は編集時に削除する。

## R1 Outbound fetch / SSRF

Trigger: `internal/fetcher/**`、`http.Client` / `http.Transport` / `net.Dialer` の新規生成、feed URL・記事 URL・proxy 対象 URL を受けて外部へ接続する変更、`internal/opmlsync/**` および `main.go` の reconcile。

Check: 外部へ接続する経路がすべて `NewFeedClient` / `NewProxyClient` が使う `newSafeTransport()` を通ること。事前検証 `ValidateFeedURL` だけに頼っていないこと(接続時の名前解決が別に走るため、dial 時の IP 検証 `safeDialContext` が必要)。OPML 由来の URL は reconcile 時に `NormalizeURL` + `ValidateFeedURL` を通り、不正なものは DB へ保存されずスキップされること。`checkIP` の拒否範囲(loopback / private / link-local / CGNAT 等)を緩める変更には、拒否を維持するテストが残っていること。

Provenance: PR #181(CodeQL alert #1、DNS rebinding による check-then-use)、PR #97(OPML reconcile で `file://` / `ftp://` / localhost を保存していた)。

## R2 静的ファイル配信のパス閉じ込め

Trigger: `internal/server/proxy.go` の `staticHandler`、`http.ServeFile` / `http.Dir` / `filepath.Join` にリクエスト由来のパスを渡す変更。

Check: リクエストパスから自前でファイルシステムパスを組み立てていないこと。現状は `http.FileServer(http.Dir(StaticDir))` に委譲しており、`..`(`\` 区切りを含む)を含むリクエストが 404 または SPA の `index.html` にフォールバックし、StaticDir 外を読まないことをテストが固定していること。自前の containment 判定を導入する場合は symlink 経由の脱出を扱っていること。

Provenance: PR #183(CodeQL alert #3)。同 PR は commit 932b7a1 → d7a4857 と自前判定を作り直した末に標準ライブラリへの委譲に至り、レビューでは symlink 脱出が指摘された。PR #182(CodeQL alert #4、commit f12cd1b)は未マージで close されており、同じ指摘(symlink)を受けている。

## R3 feeds.opml が SSOT であることの維持

Trigger: `internal/feeds/**`、`internal/opmlsync/**`、`internal/handlers/feeds.go`、`internal/handlers/folders.go`、`main.go` の reconcile、`feeds.opml` を読み書きする変更。

Check: 変更系ハンドラが DB reconcile を成功させてから OPML を保存すること(逆順だと失敗時に SSOT と DB が乖離する)。OPML ファイルの不在を「購読ゼロ」と解釈して保存・reconcile しないこと(DB に feed があるのにファイルが無い場合は `ErrOPMLMissing` で 503、`opmlsync` は no-op)。read-modify-write で外部 OPML の情報を落とさないこと(feed の `type`、未知属性 `ExtraAttrs`、`<head><title>`、多段フォルダの階層)。外部編集が読み取り系 API と poller に反映されること。これらを扱うフィールドを追加・変更したら round-trip テストが対応していること。

Provenance: PR #79(reconcile を保存より先に実行)、PR #121(OPML 一時不在で既存購読が全削除される P0、Closes #87)、PR #84(実行中の外部編集を DB へ同期、Closes #83)、PR #99(feed type 書き換え)、PR #100(多段フォルダ)、PR #103(独自属性)、PR #109(head title)。

## R4 スキーマ変更と既存 DB ファイル

Trigger: `internal/db/**` 内の `CREATE TABLE` / `ALTER TABLE` / migration 関数(`migrateReadState` など)/ FTS 定義の変更、`internal/db/migration_smoke_test.go` の変更。

Check: 新規 DB だけでなく、変更前の形の既存 DB を開いて移行できること。`internal/db/migration_smoke_test.go` に、変更前スキーマを再現して開き直すケース(`TestMigrationUpgradesLegacyArticles`)と、再オープンで冪等であるケース(`TestMigrationFreshAndIdempotent`)があり、今回の変更もそこで覆われていること。列やテーブルの削除は既存データの扱いを明記していること。

Provenance: PR #36(commit 385ef58、migration_smoke_test.go 導入)、PR #163(commit 62e6c69、star 機能削除に伴い既存 DB の `starred` 列を `DROP COLUMN` する移行を追加し、同テストを拡張)。いずれも `git log --follow -- internal/db/migration_smoke_test.go` で確認した。障害記録ではなく、この種の変更が既存 DB を壊しうるという設計上の根拠である。

## R5 検索の FTS / LIKE 分岐と並び順

Trigger: `internal/db/db.go` の `listArticlesWithSearch`、FTS クエリや `ORDER BY` の変更。

Check: FTS と LIKE の切り替えが byte 長ではなく rune 数(`utf8.RuneCountInString`)であること(日本語 1〜2 文字が LIKE に入る)。検索なし・LIKE・FTS のどの経路でも `published_at` 降順(`published_at IS NULL, published_at DESC`)で揃っており、`bm25` 順に戻していないこと。分岐や並び順を変えた場合は日本語短クエリと並び順のテストがあること。

Provenance: PR #102(byte 長判定で日本語短クエリがヒットしない、Closes #96)、PR #86(FTS だけ `bm25` 順だった、Closes #85)。

## R6 既読切替が `['articles']` を invalidate しないこと

Trigger: `web/src/hooks/useArticleMutations.ts` の `useSetRead`、既読/未読の楽観的更新と rollback。

Check: 既読/未読の更新で `['articles']` を invalidate せず、`setQueriesData` による更新と `['unreadCounts']` の再取得だけで済ませていること(invalidate すると無限スクロールの表示が巻き戻る)。rollback は失敗した記事の `isRead` / `readAt` だけを戻し、全 cache の snapshot を復元していないこと(並行ミューテーションの成功分を巻き戻すため)。`invalidateQueries({ queryKey: ['articles'] })` は refresh 経路(`useRefresh`)など意図した箇所に限ること。

Provenance: PR #197 のレビューで Copilot が「全 `articles` cache の snapshot 復元は並行ミューテーションを壊す。`articles` は意図的に invalidate しない」と指摘し、commit a36074f で対応した。同ファイルの docstring が invalidate しない方針を明記している。旧 UI の既読まわりの不具合である PR #66(開いた記事を未読に戻しても自動で既読に戻る)と PR #165(未読フィルタ中に記事が一覧から消える)は、いずれも現行の hook を対象にしておらず、この項目の根拠には含めない。

## R7 記事由来の URL と HTML

Trigger: `web/src/**` で記事の `url` / `content` / feed の `siteUrl` を `href` / `src` に使う変更、`dangerouslySetInnerHTML`、`innerHTML`、新たな HTML 描画。

Check: 記事・feed 由来の URL は `safeHttpUrl`(`web/src/utils/url.ts`)を通してから `href` / `src` に渡すこと(`javascript:` / `data:` を落とすため)。`dangerouslySetInnerHTML` は現状 `Icon.tsx` の固定文字列(`P[name]`)だけであり、記事・feed 由来の値を渡す変更を認めない。記事本文を HTML として描画するなら DOMPurify 等でサニタイズし、リンクに `target="_blank"` と `rel="noopener noreferrer"` が残ることを実際の DOM で確認するテストがあること。

Provenance: PR #197(commit 7e08863、`safeHttpUrl` と `url.test.ts` の導入。事故の記録ではなく予防)。サニタイズまわりの過去の不具合として PR #164(DOMPurify が `target` を除去していた)と PR #81(本文の相対リンクがアプリ自身の URL に解決された)があるが、いずれも現行 UI では削除された `ArticleView` / `resolveLinks` の話であり、本文を HTML として描画し直す場合の参考に限る。

## R8 整数変換と上限

Trigger: `internal/config/**`、`internal/handlers/settings.go`、`internal/poller/**`、`strconv.Parse*` の結果を `int` / `int64` / `time.Duration` へ変換する変更。

Check: 外部入力(フラグ・環境変数・設定ファイル・`PUT /api/settings`)から来る整数は、変換前に上限を検査していること。poll interval には `config.MaxPollIntervalMinutes` があり、`config.Parse()` と settings ハンドラの両方、および `poller.Start` の変換箇所で守られていること。新しい経路を足したら同じ上限検査を通り、超過のテストがあること。

Provenance: PR #180(CodeQL alert #2、`ParseUint` から `time.Duration` への変換で溢れうる)。

## R9 検証そのものの変更

Trigger: 既存のテスト・E2E spec・property test のアサーションの削除や緩和、`.claude/hooks/**`、`.claude/settings.json`、`.githooks/**`、`scripts/verify/**`、`web/e2e/FEATURES.md`、`.github/workflows/**` の変更。

Check: 失敗している検証を通すために、同じ変更の中でアサーションを弱めていないこと(削除、`skip`、sleep、retry、期待値の書き換え)。検証用ファイルを変える変更は、その理由が PR の説明にあり、人間が確認していること。property test の反例は仕様上の不具合として扱い、テストを緩めずに修正されていること。FEATURES.md の ID と spec のタイトルが対応していること。

Provenance: インシデントに基づかない方針による項目。検証を担う仕組みを、検証される側の変更が書き換えられるという構造上の弱点を塞ぐためのもので、PR や commit の根拠は持たない。
