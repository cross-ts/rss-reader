use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use duckdb::params;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::feeds::{read_feeds_opml, reconcile_subscriptions, save_opml, FeedEntry, FolderEntry};
use crate::fetcher::{fetch_feed, fetch_with_guard, validate_feed_url};
use crate::AppState;

/// HTML から `<link rel="alternate" type="application/rss+xml|atom+xml|json">` を抽出し、
/// base で絶対 URL 化した候補リストを返す。
pub fn discover_feed_url(html: &str, base: &url::Url) -> Vec<String> {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    // rel にスペース区切りで "alternate" を含む <link> を対象にする
    let selector = match Selector::parse(r#"link[rel~="alternate"]"#) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for el in doc.select(&selector) {
        let typ = el.value().attr("type").unwrap_or("").to_ascii_lowercase();
        let is_feed = matches!(
            typ.as_str(),
            "application/rss+xml"
                | "application/atom+xml"
                | "application/json"
                | "application/feed+json"
        );
        if !is_feed {
            continue;
        }
        if let Some(href) = el.value().attr("href") {
            if let Ok(abs) = base.join(href) {
                let s = abs.to_string();
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    }
    out
}

/// 入力 URL を「実際のフィード URL・タイトル・サイト URL」へ解決する。
/// 入力がフィードとしてパースできればそのまま、できなければ HTML から自動検出する。
async fn resolve_feed(
    client: &Client,
    input_url: &str,
) -> anyhow::Result<(String, String, Option<String>)> {
    let (bytes, final_url) = fetch_with_guard(client, input_url, 5).await?;

    // そのままフィードとしてパースできるか
    if let Ok(feed) = feed_rs::parser::parse(bytes.as_ref()) {
        let title = feed
            .title
            .map(|t| t.content)
            .unwrap_or_else(|| final_url.clone());
        let site_url = feed.links.into_iter().map(|l| l.href).next();
        return Ok((final_url, title, site_url));
    }

    // HTML とみなして自動検出。候補を順に試し、最初に取得・パースできたものを採用する。
    let html = String::from_utf8_lossy(bytes.as_ref());
    let base = url::Url::parse(&final_url)?;
    let candidates = discover_feed_url(&html, &base);
    if candidates.is_empty() {
        anyhow::bail!("ページからフィードを検出できませんでした");
    }

    // 検証通過後の fetch 試行を最大5回に制限する。
    // 検証（validate_feed_url）で弾かれた候補は枠を消費しない。
    let mut last_err: Option<anyhow::Error> = None;
    let mut fetch_attempts = 0usize;
    for candidate in candidates.into_iter() {
        if fetch_attempts >= 5 {
            break;
        }
        // 各候補も SSRF 検証（失敗は枠を消費せず continue）
        if let Err(e) = validate_feed_url(&candidate).await {
            last_err = Some(e);
            continue;
        }
        // 検証通過 → fetch 試行カウントを増やす
        fetch_attempts += 1;
        match fetch_with_guard(client, &candidate, 5).await {
            Ok((fbytes, ffinal)) => match feed_rs::parser::parse(fbytes.as_ref()) {
                Ok(feed) => {
                    let title = feed
                        .title
                        .map(|t| t.content)
                        .unwrap_or_else(|| ffinal.clone());
                    let site_url = feed.links.into_iter().map(|l| l.href).next();
                    return Ok((ffinal, title, site_url));
                }
                Err(e) => last_err = Some(e.into()),
            },
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err
        .unwrap_or_else(|| anyhow::anyhow!("検出した候補から有効なフィードを取得できませんでした")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedResponse {
    pub id: i32,
    pub title: String,
    pub url: String,
    pub site_url: Option<String>,
    pub folder: Option<String>,
    pub article_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateFeedBody {
    pub url: String,
    pub folder: Option<String>,
}

fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    serde::Deserialize::deserialize(de).map(Some)
}

#[derive(Debug, Deserialize)]
pub struct UpdateFeedBody {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub folder: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct DiscoverBody {
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResponse {
    pub feed_url: String,
    pub title: Option<String>,
}

/// サイト URL（または直接フィード URL）から RSS/Atom フィードを検出する。
/// `POST /api/feeds/discover`
pub async fn discover_feed(
    State(state): State<AppState>,
    Json(body): Json<DiscoverBody>,
) -> Result<Json<DiscoverResponse>, (StatusCode, String)> {
    validate_feed_url(&body.url)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("無効なURL: {e}")))?;

    let (feed_url, title, _site_url) = resolve_feed(&state.client, &body.url)
        .await
        .map_err(|e| (StatusCode::NOT_FOUND, format!("フィードを検出できませんでした: {e}")))?;

    Ok(Json(DiscoverResponse {
        feed_url,
        title: Some(title),
    }))
}

pub async fn list_feeds(
    State(state): State<AppState>,
) -> Result<Json<Vec<FeedResponse>>, (StatusCode, String)> {
    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || {
        let conn = db.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT f.id, f.title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
                 FROM feeds f
                 LEFT JOIN folders fo ON fo.id = f.folder_id
                 LEFT JOIN articles a ON a.feed_id = f.id
                 GROUP BY f.id, f.title, f.url, f.site_url, fo.name
                 ORDER BY f.title",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(FeedResponse {
                    id: r.get(0)?,
                    title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    url: r.get(2)?,
                    site_url: r.get(3)?,
                    folder: r.get(4)?,
                    article_count: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok::<_, String>(result)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(result))
}

pub async fn create_feed(
    State(state): State<AppState>,
    Json(body): Json<CreateFeedBody>,
) -> Result<(StatusCode, Json<FeedResponse>), (StatusCode, String)> {
    let input_url = body.url.clone();
    let folder_name = body.folder.clone();

    // SSRF検証（400を返す）
    validate_feed_url(&input_url)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("無効なURL: {e}")))?;

    // フィード URL を解決（パース不可ならサイトHTMLから RSS を自動検出）。
    // 解決できなければ 400。
    let (feed_url, title, site_url) = resolve_feed(&state.client, &input_url)
        .await
        .map_err(|e| {
            tracing::warn!("Failed to resolve feed for {}: {}", input_url, e);
            (
                StatusCode::BAD_REQUEST,
                format!("フィードを取得/検出できませんでした: {e}"),
            )
        })?;

    // feeds.opml の read-modify-write を直列化
    let _guard = state.feeds_lock.lock().await;

    // 1. 購読取得
    let feeds_path = state.config.feeds_path.clone();
    let mut subs = read_feeds_opml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. 変更を適用
    if let Some(ref fname) = folder_name {
        if !subs.folders.iter().any(|f| &f.name == fname) {
            subs.folders.push(FolderEntry { name: fname.clone() });
        }
    }
    if !subs.feeds.iter().any(|f| f.url == feed_url) {
        subs.feeds.push(FeedEntry {
            title: title.clone(),
            url: feed_url.clone(),
            folder: folder_name.clone(),
            site_url: site_url.clone(),
        });
    }

    // 3. 保存（エラーを伝播）
    save_opml(&feeds_path, &subs)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml保存失敗: {e}")))?;

    // 4. reconcile（DBを購読に一致させる。site_url も補完される）
    let feed_url2 = feed_url.clone();
    let subs_clone = subs.clone();
    let feed = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_subscriptions(&conn, &subs_clone)?;

            let feed: FeedResponse = conn
                .query_row(
                    "SELECT f.id, f.title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
                     FROM feeds f
                     LEFT JOIN folders fo ON fo.id = f.folder_id
                     LEFT JOIN articles a ON a.feed_id = f.id
                     WHERE f.url = ?
                     GROUP BY f.id, f.title, f.url, f.site_url, fo.name",
                    params![feed_url2],
                    |r| {
                        Ok(FeedResponse {
                            id: r.get(0)?,
                            title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                            url: r.get(2)?,
                            site_url: r.get(3)?,
                            folder: r.get(4)?,
                            article_count: r.get(5)?,
                        })
                    },
                )
                .map_err(|e| anyhow::anyhow!(e))?;

            Ok::<_, anyhow::Error>(feed)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // ロック解放後に初回巡回（バックグラウンド）
    drop(_guard);

    let feed_id = feed.id;
    let db3 = state.db.clone();
    let client3 = state.client.clone();
    tokio::spawn(async move {
        let _ = fetch_feed(db3.clone(), client3, feed_id, feed_url.clone(), None, None).await;
        // FTS再構築
        let _ = tokio::task::spawn_blocking(move || {
            let conn = db3.lock().unwrap();
            crate::db::fts::rebuild_fts_index(&conn)
        })
        .await;
    });

    Ok((StatusCode::CREATED, Json(feed)))
}

pub async fn update_feed(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(body): Json<UpdateFeedBody>,
) -> Result<Json<FeedResponse>, (StatusCode, String)> {
    // TOCTOU 防止：feeds_lock を先に取得してからDB読取・OPML read-modify-write を行う
    let _guard = state.feeds_lock.lock().await;

    // 旧情報取得（ロック取得後に実施）
    let db_old = state.db.clone();
    let (old_url, old_title, old_folder): (String, String, Option<String>) =
        tokio::task::spawn_blocking(move || {
            let conn = db_old.lock().unwrap();
            conn.query_row(
                "SELECT f.url, f.title, fo.name FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = ?",
                params![id],
                |r| Ok((r.get(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default(), r.get(2)?)),
            )
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::NOT_FOUND, e))?;

    let new_title = body.title.clone().unwrap_or(old_title.clone());
    // double-option で folder の「未指定」「明示null（解除）」「値あり」を区別
    let new_folder: Option<String> = match body.folder {
        None => old_folder.clone(),           // 未指定 → 既存維持
        Some(None) => None,                   // 明示null → フォルダ解除
        Some(Some(ref name)) => Some(name.clone()), // 値あり → そのフォルダに設定
    };

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_opml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用
    // 新規フォルダ名が指定された場合は folders に追加
    if let Some(ref fname) = new_folder {
        if !yaml.folders.iter().any(|f| &f.name == fname) {
            yaml.folders.push(FolderEntry { name: fname.clone() });
        }
    }
    for f in yaml.feeds.iter_mut() {
        if f.url == old_url {
            f.title = new_title.clone();
            f.folder = new_folder.clone();
        }
    }

    // 3. yaml 保存（エラーを伝播）
    save_opml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml保存失敗: {e}")))?;

    // 4. reconcile → 結果を DB から取得
    let old_url2 = old_url.clone();
    let yaml_clone = yaml.clone();
    let feed = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_subscriptions(&conn, &yaml_clone)?;

            let feed: FeedResponse = conn
                .query_row(
                    "SELECT f.id, f.title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
                     FROM feeds f
                     LEFT JOIN folders fo ON fo.id = f.folder_id
                     LEFT JOIN articles a ON a.feed_id = f.id
                     WHERE f.url = ?
                     GROUP BY f.id, f.title, f.url, f.site_url, fo.name",
                    params![old_url2],
                    |r| {
                        Ok(FeedResponse {
                            id: r.get(0)?,
                            title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                            url: r.get(2)?,
                            site_url: r.get(3)?,
                            folder: r.get(4)?,
                            article_count: r.get(5)?,
                        })
                    },
                )
                .map_err(|e| anyhow::anyhow!(e))?;

            Ok::<_, anyhow::Error>(feed)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(feed))
}

pub async fn delete_feed(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<StatusCode, (StatusCode, String)> {
    // TOCTOU 防止：feeds_lock を先に取得してからDB読取・OPML read-modify-write を行う
    let _guard = state.feeds_lock.lock().await;

    // 削除対象URLを取得（ロック取得後に実施）
    let db_url = state.db.clone();
    let feed_url: String = tokio::task::spawn_blocking(move || {
        let conn = db_url.lock().unwrap();
        conn.query_row(
            "SELECT url FROM feeds WHERE id = ?",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::NOT_FOUND, e))?;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_opml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用
    yaml.feeds.retain(|f| f.url != feed_url);

    // 3. yaml 保存（エラーを伝播）
    save_opml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml保存失敗: {e}")))?;

    // 4. reconcile（articles も削除される）
    let yaml_clone = yaml.clone();
    tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_subscriptions(&conn, &yaml_clone)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
