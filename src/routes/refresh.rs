use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::fetcher::fetch_feed;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshQuery {
    pub feed_id: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    pub refreshed: usize,
}

pub async fn refresh(
    State(state): State<AppState>,
    Query(query): Query<RefreshQuery>,
) -> Result<Json<RefreshResponse>, (StatusCode, String)> {
    let db = state.db.clone();

    // 対象フィードリストを取得
    let feeds = {
        let db2 = state.db.clone();
        let feed_id = query.feed_id;
        tokio::task::spawn_blocking(move || {
            if let Some(fid) = feed_id {
                db2.get_feed_targets_by_id(fid)
            } else {
                db2.get_feed_targets()
            }
        })
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    let refreshed = feeds.len();

    for target in feeds {
        let db_clone = state.db.clone();
        let client_clone = state.client.clone();
        if let Err(e) = fetch_feed(
            db_clone,
            client_clone,
            target.id,
            target.url.clone(),
            target.etag,
            target.last_modified,
        )
        .await
        {
            tracing::warn!("Failed to refresh feed {}: {}", target.url, e);
        }
    }

    // FTSインデックス再構築
    tokio::task::spawn_blocking(move || {
        if let Err(e) = db.rebuild_search_index() {
            tracing::warn!("FTS rebuild failed: {}", e);
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(RefreshResponse { refreshed }))
}
