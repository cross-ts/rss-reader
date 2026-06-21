use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use duckdb::params;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::feeds::{read_feeds_yaml, reconcile_from_yaml, save_yaml, FeedYamlEntry, FolderYamlEntry};
use crate::fetcher::{fetch_feed, fetch_with_guard, validate_feed_url};

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
    let url = body.url.clone();
    let folder_name = body.folder.clone();

    // SSRF検証（400を返す）
    validate_feed_url(&url)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("無効なURL: {e}")))?;

    // Fix 1: フィードのメタ情報を fetch_with_guard（SSRF 検証付き手動リダイレクト追跡）で取得
    let client = state.client.clone();
    let feed_meta = {
        let url2 = url.clone();
        let client2 = client.clone();
        async move {
            let (body_bytes, _final_url) = fetch_with_guard(&client2, &url2, 5).await?;
            let feed = feed_rs::parser::parse(body_bytes.as_ref())?;
            let title = feed.title.map(|t| t.content).unwrap_or_else(|| url2.clone());
            let site_url = feed.links.into_iter().next().map(|l| l.href);
            Ok::<_, anyhow::Error>((title, site_url))
        }
    }
    .await;

    let (title, site_url) = match feed_meta {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Failed to fetch feed meta for {}: {}", url, e);
            (url.clone(), None)
        }
    };

    // Fix 2: feeds.yaml の read-modify-write を直列化
    let _guard = state.feeds_lock.lock().await;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_yaml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用
    if let Some(ref fname) = folder_name {
        if !yaml.folders.iter().any(|f| &f.name == fname) {
            yaml.folders.push(FolderYamlEntry { name: fname.clone() });
        }
    }
    if !yaml.feeds.iter().any(|f| f.url == url) {
        yaml.feeds.push(FeedYamlEntry {
            title: title.clone(),
            url: url.clone(),
            folder: folder_name.clone(),
        });
    }

    // 3. yaml 保存（エラーを伝播）
    save_yaml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml保存失敗: {e}")))?;

    // 4. reconcile（DBを yaml に一致させる）
    let site_url2 = site_url.clone();
    let url3 = url.clone();
    let yaml_clone = yaml.clone();
    let feed = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_from_yaml(&conn, &yaml_clone)?;

            // site_url は reconcile 後に更新（yaml には持たせていないので直接 UPDATE）
            conn.execute(
                "UPDATE feeds SET site_url = ? WHERE url = ? AND site_url IS NULL",
                params![site_url2, url3],
            )?;

            let feed: FeedResponse = conn
                .query_row(
                    "SELECT f.id, f.title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
                     FROM feeds f
                     LEFT JOIN folders fo ON fo.id = f.folder_id
                     LEFT JOIN articles a ON a.feed_id = f.id
                     WHERE f.url = ?
                     GROUP BY f.id, f.title, f.url, f.site_url, fo.name",
                    params![url3],
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
        let _ = fetch_feed(db3.clone(), client3, feed_id, url.clone(), None, None).await;
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
    // 旧情報取得
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

    // Fix 2: feeds.yaml の read-modify-write を直列化
    let _guard = state.feeds_lock.lock().await;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_yaml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用
    // 新規フォルダ名が指定された場合は folders に追加
    if let Some(ref fname) = new_folder {
        if !yaml.folders.iter().any(|f| &f.name == fname) {
            yaml.folders.push(FolderYamlEntry { name: fname.clone() });
        }
    }
    for f in yaml.feeds.iter_mut() {
        if f.url == old_url {
            f.title = new_title.clone();
            f.folder = new_folder.clone();
        }
    }

    // 3. yaml 保存（エラーを伝播）
    save_yaml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml保存失敗: {e}")))?;

    // 4. reconcile → 結果を DB から取得
    let old_url2 = old_url.clone();
    let yaml_clone = yaml.clone();
    let feed = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_from_yaml(&conn, &yaml_clone)?;

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
    // 削除対象URLを取得
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

    // Fix 2: feeds.yaml の read-modify-write を直列化
    let _guard = state.feeds_lock.lock().await;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_yaml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用
    yaml.feeds.retain(|f| f.url != feed_url);

    // 3. yaml 保存（エラーを伝播）
    save_yaml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml保存失敗: {e}")))?;

    // 4. reconcile（articles も削除される）
    let yaml_clone = yaml.clone();
    tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_from_yaml(&conn, &yaml_clone)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
