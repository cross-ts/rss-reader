use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDateTime;
use duckdb::params;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::tokenize::tokenize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleResponse {
    pub id: i32,
    pub feed_id: i32,
    pub feed_title: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub content: String,
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArticlesResponse {
    pub items: Vec<ArticleResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticlesQuery {
    pub folder_id: Option<i32>,
    pub feed_id: Option<i32>,
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_articles(
    State(state): State<AppState>,
    Query(query): Query<ArticlesQuery>,
) -> Result<Json<ArticlesResponse>, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);
    let q = query.q.clone();
    let folder_id = query.folder_id;
    let feed_id = query.feed_id;

    let db = state.db.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = db.lock().unwrap();

        if let Some(search_q) = q {
            // 記事が0件のときはFTSインデックス(match_bm25)が未作成のため、検索は空で返す
            let article_count: i64 = conn
                .query_row("SELECT count(*) FROM articles", [], |r| r.get(0))
                .unwrap_or(0);
            if article_count == 0 {
                return Ok::<_, String>(ArticlesResponse { items: vec![], total: 0 });
            }

            // FTS検索
            let tokenized_q = tokenize(&search_q).unwrap_or_else(|_| search_q.clone());

            // フォルダ/フィード条件（スコアフィルタなし）
            let mut filter_clauses = vec![];
            if let Some(fid) = folder_id {
                filter_clauses.push(format!("f.folder_id = {}", fid));
            }
            if let Some(fid) = feed_id {
                filter_clauses.push(format!("a.feed_id = {}", fid));
            }

            let filter_str = if filter_clauses.is_empty() {
                "TRUE".to_string()
            } else {
                filter_clauses.join(" AND ")
            };

            // items取得: 内側でフォルダ/フィード条件 → 外側でscoreフィルタ
            let sql = format!(
                "SELECT id, feed_id, feed_title, title, url, author, content, published_at, score
                 FROM (
                     SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title, COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url, a.author, COALESCE(a.content, '') AS content, a.published_at,
                            fts_main_articles.match_bm25(a.id, ?) AS score
                     FROM articles a
                     JOIN feeds f ON f.id = a.feed_id
                     WHERE {}
                 ) sub
                 WHERE score IS NOT NULL
                 ORDER BY score DESC
                 LIMIT ? OFFSET ?",
                filter_str
            );

            // total: 内側でフォルダ/フィード条件のみ → 外側でscore IS NOT NULLを適用
            let total_sql = format!(
                "SELECT count(*) FROM (
                    SELECT fts_main_articles.match_bm25(a.id, ?) AS score
                    FROM articles a
                    JOIN feeds f ON f.id = a.feed_id
                    WHERE {}
                ) sub
                WHERE sub.score IS NOT NULL",
                filter_str
            );

            let total: i64 = conn.query_row(
                &total_sql,
                params![tokenized_q],
                |r| r.get(0),
            ).unwrap_or(0);

            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![tokenized_q, limit, offset], |r| {
                let published_at: Option<NaiveDateTime> = r.get(7)?;
                Ok(ArticleResponse {
                    id: r.get(0)?,
                    feed_id: r.get(1)?,
                    feed_title: r.get(2)?,
                    title: r.get(3)?,
                    url: r.get(4)?,
                    author: r.get(5)?,
                    content: r.get(6)?,
                    published_at: published_at.map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                })
            }).map_err(|e| e.to_string())?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|e| e.to_string())?);
            }

            Ok::<_, String>(ArticlesResponse { items, total })
        } else {
            // 通常検索（published_at降順）
            let mut where_clauses = vec![];
            if let Some(fid) = folder_id {
                where_clauses.push(format!("f.folder_id = {}", fid));
            }
            if let Some(fid) = feed_id {
                where_clauses.push(format!("a.feed_id = {}", fid));
            }

            let where_str = if where_clauses.is_empty() {
                String::new()
            } else {
                format!("WHERE {}", where_clauses.join(" AND "))
            };

            let total_sql = format!(
                "SELECT count(*) FROM articles a JOIN feeds f ON f.id = a.feed_id {}",
                where_str
            );
            let total: i64 = conn.query_row(&total_sql, [], |r| r.get(0)).unwrap_or(0);

            let sql = format!(
                "SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title, COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url, a.author, COALESCE(a.content, '') AS content, a.published_at
                 FROM articles a
                 JOIN feeds f ON f.id = a.feed_id
                 {}
                 ORDER BY a.published_at DESC NULLS LAST
                 LIMIT {} OFFSET {}",
                where_str, limit, offset
            );

            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| {
                let published_at: Option<NaiveDateTime> = r.get(7)?;
                Ok(ArticleResponse {
                    id: r.get(0)?,
                    feed_id: r.get(1)?,
                    feed_title: r.get(2)?,
                    title: r.get(3)?,
                    url: r.get(4)?,
                    author: r.get(5)?,
                    content: r.get(6)?,
                    published_at: published_at.map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                })
            }).map_err(|e| e.to_string())?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|e| e.to_string())?);
            }

            Ok::<_, String>(ArticlesResponse { items, total })
        }
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(result))
}
