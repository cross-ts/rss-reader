use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::db::fts;
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
    let feeds: Vec<(i32, String, Option<String>, Option<String>)> = {
        let db2 = state.db.clone();
        let feed_id = query.feed_id;
        tokio::task::spawn_blocking(move || {
            let conn = db2.lock().unwrap();
            let mut stmt = if let Some(_fid) = feed_id {
                conn.prepare(
                    "SELECT id, url, etag, last_modified FROM feeds WHERE id = ?"
                ).map_err(|e| e.to_string())?
            } else {
                conn.prepare(
                    "SELECT id, url, etag, last_modified FROM feeds"
                ).map_err(|e| e.to_string())?
            };

            let params_vec: Vec<Box<dyn duckdb::ToSql>> = if let Some(fid) = feed_id {
                vec![Box::new(fid)]
            } else {
                vec![]
            };

            let rows = stmt.query_map(duckdb::params_from_iter(params_vec.iter()), |r| {
                Ok((
                    r.get::<_, i32>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            }).map_err(|e| e.to_string())?;

            let mut result = Vec::new();
            for row in rows {
                result.push(row.map_err(|e| e.to_string())?);
            }
            Ok::<_, String>(result)
        })
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
    };

    let refreshed = feeds.len();

    for (feed_id, url, etag, last_modified) in feeds {
        let db_clone = state.db.clone();
        let client_clone = state.client.clone();
        if let Err(e) = fetch_feed(db_clone, client_clone, feed_id, url.clone(), etag, last_modified).await {
            tracing::warn!("Failed to refresh feed {}: {}", url, e);
        }
    }

    // FTSインデックス再構築
    tokio::task::spawn_blocking(move || {
        let conn = db.lock().unwrap();
        if let Err(e) = fts::rebuild_fts_index(&conn) {
            tracing::warn!("FTS rebuild failed: {}", e);
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(RefreshResponse { refreshed }))
}
