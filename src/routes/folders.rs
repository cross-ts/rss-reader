use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::db::Folder;
use crate::feeds::{read_feeds_opml, save_opml, FolderEntry};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderResponse {
    pub id: i32,
    pub name: String,
    pub feed_count: i64,
}

impl From<Folder> for FolderResponse {
    fn from(f: Folder) -> Self {
        Self {
            id: f.id,
            name: f.name,
            feed_count: f.feed_count,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct FolderBody {
    pub name: String,
}

pub async fn list_folders(
    State(state): State<AppState>,
) -> Result<Json<Vec<FolderResponse>>, (StatusCode, String)> {
    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || db.list_folders())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(result.into_iter().map(FolderResponse::from).collect()))
}

pub async fn create_folder(
    State(state): State<AppState>,
    Json(body): Json<FolderBody>,
) -> Result<(StatusCode, Json<FolderResponse>), (StatusCode, String)> {
    // 空・空白のみのフォルダ名は拒否
    let folder_name = body.name.trim().to_string();
    if folder_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "フォルダ名を入力してください".to_string()));
    }

    // feeds.opml の read-modify-write を直列化
    let _guard = state.feeds_lock.lock().await;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_opml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用
    if !yaml.folders.iter().any(|f| f.name == folder_name) {
        yaml.folders.push(FolderEntry { name: folder_name.clone() });
    }

    // 3. yaml 保存（エラーを伝播）
    save_opml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml保存失敗: {e}")))?;

    // 4. reconcile → 結果を DB から取得
    let fname = folder_name.clone();
    let yaml_clone = yaml.clone();
    let folder = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            db.reconcile_subscriptions(&yaml_clone)?;
            db.get_folder_by_name(&fname)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(FolderResponse::from(folder))))
}

pub async fn update_folder(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(body): Json<FolderBody>,
) -> Result<Json<FolderResponse>, (StatusCode, String)> {
    // 空・空白のみのフォルダ名は拒否
    let new_name = body.name.trim().to_string();
    if new_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "フォルダ名を入力してください".to_string()));
    }

    // TOCTOU 防止：feeds_lock を先に取得してからDB読取・OPML read-modify-write を行う
    let _guard = state.feeds_lock.lock().await;

    // 旧名取得（ロック取得後に実施）
    let db_old = state.db.clone();
    let old_name = tokio::task::spawn_blocking(move || db_old.get_folder_name_by_id(id))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_opml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 同名衝突チェック：リネーム先の新名が自分以外の既存フォルダ名と一致する場合は 409
    if new_name != old_name && yaml.folders.iter().any(|f| f.name == new_name) {
        return Err((StatusCode::CONFLICT, "同名のフォルダが既に存在します".to_string()));
    }

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
    save_opml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml保存失敗: {e}")))?;

    // 4. reconcile → 結果を DB から取得
    let fname = new_name.clone();
    let yaml_clone = yaml.clone();
    let folder = tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || {
            db.reconcile_subscriptions(&yaml_clone)?;
            db.get_folder_by_name(&fname)
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(FolderResponse::from(folder)))
}


pub async fn delete_folder(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<StatusCode, (StatusCode, String)> {
    // TOCTOU 防止：feeds_lock を先に取得してからDB読取・OPML read-modify-write を行う
    let _guard = state.feeds_lock.lock().await;

    // 対象 folder 名取得（ロック取得後に実施）
    let db_old = state.db.clone();
    let folder_name = tokio::task::spawn_blocking(move || db_old.get_folder_name_by_id(id))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;

    // 1. yaml 取得
    let feeds_path = state.config.feeds_path.clone();
    let mut yaml = read_feeds_opml(&feeds_path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml読み込み失敗: {e}")))?
        .unwrap_or_default();

    // 2. yaml に変更を適用（folder 削除、feeds の folder 参照を None に）
    yaml.folders.retain(|f| f.name != folder_name);
    for feed in yaml.feeds.iter_mut() {
        if feed.folder.as_deref() == Some(&folder_name) {
            feed.folder = None;
        }
    }

    // 3. yaml 保存（エラーを伝播）
    save_opml(&feeds_path, &yaml)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("feeds.opml保存失敗: {e}")))?;

    // 4. reconcile
    let yaml_clone = yaml.clone();
    tokio::task::spawn_blocking({
        let db = state.db.clone();
        move || db.reconcile_subscriptions(&yaml_clone)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
