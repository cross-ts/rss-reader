use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::feeds::{read_feeds_yaml, reconcile_from_yaml, save_yaml, FolderYamlEntry};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderResponse {
    pub id: i32,
    pub name: String,
    pub feed_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct FolderBody {
    pub name: String,
}

pub async fn list_folders(
    State(state): State<AppState>,
) -> Result<Json<Vec<FolderResponse>>, (StatusCode, String)> {
    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || {
        let conn = db.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT f.id, f.name, COUNT(fd.id) AS feed_count
                 FROM folders f
                 LEFT JOIN feeds fd ON fd.folder_id = f.id
                 GROUP BY f.id, f.name
                 ORDER BY f.name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(FolderResponse {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    feed_count: r.get(2)?,
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

pub async fn create_folder(
    State(state): State<AppState>,
    Json(body): Json<FolderBody>,
) -> Result<(StatusCode, Json<FolderResponse>), (StatusCode, String)> {
    let folder_name = body.name.clone();

    // Fix 2: feeds.yaml の read-modify-write を直列化
    let _guard = state.feeds_lock.lock().await;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_yaml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用
    if !yaml.folders.iter().any(|f| f.name == folder_name) {
        yaml.folders.push(FolderYamlEntry { name: folder_name.clone() });
    }

    // 3. yaml 保存（エラーを伝播）
    save_yaml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml保存失敗: {e}")))?;

    // 4. reconcile → 結果を DB から取得
    let fname = folder_name.clone();
    let yaml_clone = yaml.clone();
    let folder = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_from_yaml(&conn, &yaml_clone)?;

            let folder: FolderResponse = conn
                .query_row(
                    "SELECT f.id, f.name, COUNT(fd.id) AS feed_count
                     FROM folders f
                     LEFT JOIN feeds fd ON fd.folder_id = f.id
                     WHERE f.name = ?
                     GROUP BY f.id, f.name",
                    duckdb::params![fname],
                    |r| {
                        Ok(FolderResponse {
                            id: r.get(0)?,
                            name: r.get(1)?,
                            feed_count: r.get(2)?,
                        })
                    },
                )
                .map_err(|e| anyhow::anyhow!(e))?;

            Ok::<_, anyhow::Error>(folder)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(folder)))
}

pub async fn update_folder(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(body): Json<FolderBody>,
) -> Result<Json<FolderResponse>, (StatusCode, String)> {
    // 旧名取得
    let db_old = state.db.clone();
    let old_name: String = tokio::task::spawn_blocking(move || {
        let conn = db_old.lock().unwrap();
        conn.query_row(
            "SELECT name FROM folders WHERE id = ?",
            duckdb::params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::NOT_FOUND, e))?;

    let new_name = body.name.clone();

    // Fix 2: feeds.yaml の read-modify-write を直列化
    let _guard = state.feeds_lock.lock().await;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_yaml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用（folder 名変更 & feeds の folder 参照も更新）
    for f in yaml.folders.iter_mut() {
        if f.name == old_name {
            f.name = new_name.clone();
        }
    }
    for feed in yaml.feeds.iter_mut() {
        if feed.folder.as_deref() == Some(&old_name) {
            feed.folder = Some(new_name.clone());
        }
    }

    // 3. yaml 保存（エラーを伝播）
    save_yaml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml保存失敗: {e}")))?;

    // 4. reconcile → 結果を DB から取得
    let fname = new_name.clone();
    let yaml_clone = yaml.clone();
    let folder = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            let conn = db.lock().unwrap();
            reconcile_from_yaml(&conn, &yaml_clone)?;

            let folder: FolderResponse = conn
                .query_row(
                    "SELECT f.id, f.name, COUNT(fd.id) AS feed_count
                     FROM folders f
                     LEFT JOIN feeds fd ON fd.folder_id = f.id
                     WHERE f.name = ?
                     GROUP BY f.id, f.name",
                    duckdb::params![fname],
                    |r| {
                        Ok(FolderResponse {
                            id: r.get(0)?,
                            name: r.get(1)?,
                            feed_count: r.get(2)?,
                        })
                    },
                )
                .map_err(|e| anyhow::anyhow!(e))?;

            Ok::<_, anyhow::Error>(folder)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(folder))
}

pub async fn delete_folder(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<StatusCode, (StatusCode, String)> {
    // 対象 folder 名取得
    let db_old = state.db.clone();
    let folder_name: String = tokio::task::spawn_blocking(move || {
        let conn = db_old.lock().unwrap();
        conn.query_row(
            "SELECT name FROM folders WHERE id = ?",
            duckdb::params![id],
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

    // 2. yaml に変更を適用（folder 削除、feeds の folder 参照を None に）
    yaml.folders.retain(|f| f.name != folder_name);
    for feed in yaml.feeds.iter_mut() {
        if feed.folder.as_deref() == Some(&folder_name) {
            feed.folder = None;
        }
    }

    // 3. yaml 保存（エラーを伝播）
    save_yaml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.yaml保存失敗: {e}")))?;

    // 4. reconcile
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
