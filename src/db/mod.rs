pub mod sqlite;

pub use sqlite::SqliteDb as Db;

// ── Shared types ──

/// Filter for listing articles.
#[derive(Debug, Clone, Default)]
pub struct ArticleFilter {
    pub folder_id: Option<i32>,
    pub feed_id: Option<i32>,
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// A single article returned from the DB layer.
#[derive(Debug, Clone)]
pub struct Article {
    pub id: i32,
    pub feed_id: i32,
    pub feed_title: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    pub content: String,
    pub published_at: Option<String>,
}

/// Result of listing articles (items + total count).
#[derive(Debug, Clone)]
pub struct ArticlesResult {
    pub items: Vec<Article>,
    pub total: i64,
}

/// A feed row joined with folder name and article count.
#[derive(Debug, Clone)]
pub struct Feed {
    pub id: i32,
    pub title: String,
    pub url: String,
    pub site_url: Option<String>,
    pub folder: Option<String>,
    pub article_count: i64,
}

/// A folder row with feed count.
#[derive(Debug, Clone)]
pub struct Folder {
    pub id: i32,
    pub name: String,
    pub feed_count: i64,
}

/// Minimal feed info needed by the poller/fetcher to know what to fetch.
#[derive(Debug, Clone)]
pub struct FeedTarget {
    pub id: i32,
    pub url: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

/// Data for a new article to be inserted (used by apply_fetch_result).
#[derive(Debug, Clone)]
pub struct NewArticle {
    pub guid: String,
    pub title: String,
    pub url: String,
    pub author: String,
    pub content: String,
    pub title_tokens: String,
    pub content_tokens: String,
    pub published_at: Option<chrono::NaiveDateTime>,
}

/// Metadata update for a feed after fetching.
#[derive(Debug, Clone)]
pub struct FetchMeta {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub fetched_at: chrono::NaiveDateTime,
}
