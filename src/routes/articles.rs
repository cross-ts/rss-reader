use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::db::{Article, ArticleFilter};
use crate::AppState;

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

impl From<Article> for ArticleResponse {
    fn from(a: Article) -> Self {
        Self {
            id: a.id,
            feed_id: a.feed_id,
            feed_title: a.feed_title,
            title: a.title,
            url: a.url,
            author: a.author,
            content: a.content,
            published_at: a.published_at,
        }
    }
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
    // Clamp limit to 1..=200, normalize offset to >= 0
    let limit = query.limit.map(|l| l.clamp(1, 200)).or(Some(50));
    let offset = query.offset.map(|o| o.max(0)).or(Some(0));

    let filter = ArticleFilter {
        folder_id: query.folder_id,
        feed_id: query.feed_id,
        q: query.q,
        limit,
        offset,
    };

    let db = state.db.clone();

    let result = tokio::task::spawn_blocking(move || db.list_articles(filter))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ArticlesResponse {
        items: result.items.into_iter().map(ArticleResponse::from).collect(),
        total: result.total,
    }))
}
