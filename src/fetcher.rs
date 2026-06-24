use anyhow::{bail, Context, Result};
use bytes::Bytes;
use chrono::Utc;
use feed_rs::parser;
use reqwest::{Client, Response};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::db::{Db, FetchMeta, NewArticle};
use crate::tokenize::tokenize;

/// Fix 3: フィード取得の最大バイト数（10MB）
const MAX_FEED_BYTES: usize = 10 * 1024 * 1024;

/// SSRF 対策: スキーム・ホスト・解決先 IP を検証する
pub async fn validate_feed_url(url: &str) -> Result<()> {
    let parsed = url::Url::parse(url).context("URL のパースに失敗")?;

    // スキームは http/https のみ
    match parsed.scheme() {
        "http" | "https" => {}
        s => bail!("許可されていないスキーム: {}", s),
    }

    let host = parsed
        .host_str()
        .context("ホスト名が取得できません")?;

    // ループバック・プライベートなどを即拒否（名前解決前に弾く）
    if host == "localhost" {
        bail!("ループバックアドレスへのアクセスは拒否されています: {}", host);
    }

    // IP リテラルを直接指定している場合
    if let Ok(ip) = host.parse::<IpAddr>() {
        check_ip(ip)?;
        return Ok(());
    }

    // ホスト名を DNS 解決して全 IP を検証
    let lookup_addr = format!("{}:80", host);
    let addrs = tokio::net::lookup_host(&lookup_addr)
        .await
        .context(format!("DNS 解決失敗: {}", host))?;

    for addr in addrs {
        check_ip(addr.ip())?;
    }

    Ok(())
}

fn check_ip(ip: IpAddr) -> Result<()> {
    match ip {
        IpAddr::V4(v4) => check_ipv4(v4),
        IpAddr::V6(v6) => check_ipv6(v6),
    }
}

fn check_ipv4(ip: Ipv4Addr) -> Result<()> {
    if ip.is_loopback() {
        bail!("ループバックアドレスへのアクセスは拒否されています: {}", ip);
    }
    if ip.is_private() {
        bail!("プライベートアドレスへのアクセスは拒否されています: {}", ip);
    }
    if ip.is_link_local() {
        bail!("リンクローカルアドレスへのアクセスは拒否されています: {}", ip);
    }
    // 0.0.0.0/8
    if ip.octets()[0] == 0 {
        bail!("無効なアドレスへのアクセスは拒否されています: {}", ip);
    }
    // 100.64.0.0/10 (CGNAT)
    let octets = ip.octets();
    if octets[0] == 100 && (octets[1] & 0xC0) == 64 {
        bail!("CGNAT アドレスへのアクセスは拒否されています: {}", ip);
    }
    Ok(())
}

fn check_ipv6(ip: Ipv6Addr) -> Result<()> {
    if ip.is_loopback() {
        bail!("ループバックアドレスへのアクセスは拒否されています: {}", ip);
    }
    let segments = ip.segments();
    // fc00::/7 (ユニークローカル)
    if (segments[0] & 0xFE00) == 0xFC00 {
        bail!("ユニークローカルアドレスへのアクセスは拒否されています: {}", ip);
    }
    // fe80::/10 (リンクローカル)
    if (segments[0] & 0xFFC0) == 0xFE80 {
        bail!("リンクローカルアドレスへのアクセスは拒否されています: {}", ip);
    }
    Ok(())
}

/// Fix 3: レスポンスボディを MAX_FEED_BYTES でキャップしながら読み込む。
/// Content-Length が上限を超える場合は事前拒否する。
async fn read_capped(resp: Response) -> Result<Bytes> {
    // Content-Length が既知なら事前チェック
    if let Some(content_length) = resp.content_length() {
        if content_length as usize > MAX_FEED_BYTES {
            bail!(
                "Content-Length ({} bytes) が上限 {} bytes を超えています",
                content_length,
                MAX_FEED_BYTES
            );
        }
    }

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::with_capacity(MAX_FEED_BYTES.min(1024 * 64));

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("レスポンスボディの読み込み中にエラーが発生しました")?;
        if buf.len() + chunk.len() > MAX_FEED_BYTES {
            bail!(
                "レスポンスボディが上限 {} bytes を超えました（SSRF/DoS対策）",
                MAX_FEED_BYTES
            );
        }
        buf.extend_from_slice(&chunk);
    }

    Ok(Bytes::from(buf))
}

/// 条件付きGET（ETag/Last-Modified）を含む SSRF 対策済みフェッチの結果型。
pub enum FetchOutcome {
    /// 304 Not Modified: コンテンツは変更なし
    NotModified,
    /// コンテンツ取得成功
    Fetched {
        bytes: Bytes,
        final_url: String,
        etag: Option<String>,
        last_modified: Option<String>,
    },
}

/// Fix 1: SSRF 対策済みの手動リダイレクト追跡フェッチ。
/// 各ホップで validate_feed_url を呼び、内部ホストへのリダイレクトを防ぐ。
///
/// 条件付きGETヘッダ（If-None-Match / If-Modified-Since）を受け取り、
/// 304 Not Modified の場合は FetchOutcome::NotModified を返す。
///
/// # Residual risk
/// DNS リバインディング: 初回検証後にリクエスト送出まで DNS の TTL が切れ、
/// 異なる IP に解決される可能性がある（TOCTOU）。完全防止には IP ピニング
///（`connect_info` レベルのフック）が必要だが、MVP では見送り。
pub async fn fetch_with_guard(
    client: &Client,
    start_url: &str,
    max_redirects: usize,
) -> Result<(Bytes, String)> {
    match fetch_with_guard_conditional(client, start_url, max_redirects, None, None).await? {
        FetchOutcome::NotModified => bail!("予期しない 304 Not Modified（条件付きヘッダなし）"),
        FetchOutcome::Fetched { bytes, final_url, .. } => Ok((bytes, final_url)),
    }
}

/// 条件付きGETヘッダ対応の SSRF 対策済みフェッチ。
/// `if_none_match`（ETag）と `if_modified_since`（Last-Modified）を指定可能。
/// 各ホップで validate_feed_url を呼び、内部ホストへのリダイレクトを防ぐ。
pub async fn fetch_with_guard_conditional(
    client: &Client,
    start_url: &str,
    max_redirects: usize,
    if_none_match: Option<&str>,
    if_modified_since: Option<&str>,
) -> Result<FetchOutcome> {
    let mut current_url = start_url.to_string();
    let mut is_first_hop = true;

    for hop in 0..=max_redirects {
        // 各ホップで SSRF 検証（リダイレクト先 URL も必ず通す）
        validate_feed_url(&current_url)
            .await
            .with_context(|| format!("SSRF 検証失敗 (hop {}): {}", hop, current_url))?;

        let mut req = client.get(&current_url);

        // 条件付きGETヘッダは最初のホップのみ付与（リダイレクト先には送らない）
        if is_first_hop {
            if let Some(etag) = if_none_match {
                req = req.header("If-None-Match", etag);
            }
            if let Some(lm) = if_modified_since {
                req = req.header("If-Modified-Since", lm);
            }
        }

        let resp = req.send().await.context("HTTP リクエスト失敗")?;

        let status = resp.status();

        // 304 Not Modified: コンテンツ変更なし
        if status.as_u16() == 304 {
            tracing::info!("304 Not Modified: {}", current_url);
            return Ok(FetchOutcome::NotModified);
        }

        if status.is_redirection() {
            let location = resp
                .headers()
                .get("location")
                .context("リダイレクトレスポンスに Location ヘッダがありません")?
                .to_str()
                .context("Location ヘッダが不正な文字を含んでいます")?;

            // 相対 URL を絶対 URL に変換
            let base = url::Url::parse(&current_url).context("現在の URL のパースに失敗")?;
            let next = base
                .join(location)
                .context("Location ヘッダの URL のパースに失敗")?;

            tracing::debug!("リダイレクト追跡 ({}/{}): {} -> {}", hop + 1, max_redirects, current_url, next);
            current_url = next.to_string();
            is_first_hop = false;
            continue;
        }

        // 非リダイレクトレスポンス → ボディを上限付きで読み込む（Fix 3）
        if !status.is_success() {
            bail!("HTTP エラー: {} ({})", status, current_url);
        }

        let final_url = current_url.clone();
        // レスポンスヘッダから ETag / Last-Modified を取得
        let etag = resp
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let last_modified = resp
            .headers()
            .get("last-modified")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let bytes = read_capped(resp).await?;
        return Ok(FetchOutcome::Fetched { bytes, final_url, etag, last_modified });
    }

    bail!("リダイレクト上限 ({}) を超えました", max_redirects);
}

pub async fn fetch_feed(
    db: Db,
    client: Client,
    feed_id: i32,
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<usize> {
    // Fix P1: 条件付きGET（ETag/Last-Modified）も fetch_with_guard_conditional 経由で送信。
    let outcome = fetch_with_guard_conditional(
        &client,
        &url,
        5,
        etag.as_deref(),
        last_modified.as_deref(),
    )
    .await?;

    let (body, new_etag, new_last_modified) = match outcome {
        FetchOutcome::NotModified => {
            tracing::info!("Feed {} not modified (304)", url);
            return Ok(0);
        }
        FetchOutcome::Fetched { bytes, etag, last_modified, .. } => {
            (bytes, etag, last_modified)
        }
    };

    let feed = parser::parse(body.as_ref()).context("Failed to parse feed")?;

    let now = Utc::now().naive_utc();

    // Build article list for transactional insert
    let mut new_articles = Vec::new();
    for entry in &feed.entries {
        let guid = entry.id.clone();
        if guid.is_empty() {
            continue;
        }

        let title = entry
            .title
            .as_ref()
            .map(|t| t.content.clone())
            .unwrap_or_default();

        let link = entry
            .links
            .first()
            .map(|l| l.href.clone())
            .unwrap_or_default();

        let author = entry
            .authors
            .first()
            .map(|a| a.name.clone())
            .unwrap_or_default();

        let content = entry
            .content
            .as_ref()
            .and_then(|c| c.body.clone())
            .or_else(|| entry.summary.as_ref().map(|s| s.content.clone()))
            .unwrap_or_default();

        let published_at = entry
            .published
            .or(entry.updated)
            .map(|dt| dt.naive_utc());

        let title_tokens = tokenize(&title).unwrap_or_else(|_| title.clone());
        let content_tokens = tokenize(&content).unwrap_or_else(|_| content.clone());

        new_articles.push(NewArticle {
            guid,
            title,
            url: link,
            author,
            content,
            title_tokens,
            content_tokens,
            published_at,
        });
    }

    let meta = FetchMeta {
        etag: new_etag,
        last_modified: new_last_modified,
        fetched_at: now,
    };

    // Transactionally insert all articles and update feed metadata
    let db_tx = db.clone();
    let inserted = tokio::task::spawn_blocking(move || {
        db_tx.apply_fetch_result(feed_id, &new_articles, &meta)
    })
    .await??;

    tracing::info!("Feed {} fetched, {} new articles", url, inserted);
    Ok(inserted)
}
