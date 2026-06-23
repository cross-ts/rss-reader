pub mod duckdb_impl;
pub mod sqlite;

use anyhow::Result;

use crate::config::DbDriver;
use crate::feeds::Subscriptions;

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

// ── Enum dispatch ──

/// Driver-independent database handle. Each variant delegates to its concrete implementation.
pub enum Db {
    Sqlite(sqlite::SqliteDb),
    Duckdb(duckdb_impl::DuckdbDb),
}

impl Clone for Db {
    fn clone(&self) -> Self {
        match self {
            Db::Sqlite(s) => Db::Sqlite(s.clone()),
            Db::Duckdb(d) => Db::Duckdb(d.clone()),
        }
    }
}

impl Db {
    /// Open a database at `path` using the specified driver. Runs migrations.
    pub fn open(path: &str, driver: DbDriver) -> Result<Self> {
        match driver {
            DbDriver::Sqlite => Ok(Db::Sqlite(sqlite::SqliteDb::open(path)?)),
            DbDriver::Duckdb => Ok(Db::Duckdb(duckdb_impl::DuckdbDb::open(path)?)),
        }
    }

    /// Count feeds in the database (used for fail-safe OPML check at startup).
    pub fn feed_count(&self) -> Result<i64> {
        match self {
            Db::Sqlite(s) => s.feed_count(),
            Db::Duckdb(d) => d.feed_count(),
        }
    }

    /// Reconcile DB state with the OPML-derived subscriptions (transactional).
    pub fn reconcile_subscriptions(&self, subs: &Subscriptions) -> Result<()> {
        match self {
            Db::Sqlite(s) => s.reconcile_subscriptions(subs),
            Db::Duckdb(d) => d.reconcile_subscriptions(subs),
        }
    }

    /// List articles with optional folder/feed/search/pagination filters.
    pub fn list_articles(&self, filter: ArticleFilter) -> Result<ArticlesResult> {
        match self {
            Db::Sqlite(s) => s.list_articles(filter),
            Db::Duckdb(d) => d.list_articles(filter),
        }
    }

    /// List all feeds with folder name and article count.
    pub fn list_feeds(&self) -> Result<Vec<Feed>> {
        match self {
            Db::Sqlite(s) => s.list_feeds(),
            Db::Duckdb(d) => d.list_feeds(),
        }
    }

    /// List all folders with feed count.
    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        match self {
            Db::Sqlite(s) => s.list_folders(),
            Db::Duckdb(d) => d.list_folders(),
        }
    }

    /// Get all feeds as targets for the poller/fetcher.
    pub fn get_feed_targets(&self) -> Result<Vec<FeedTarget>> {
        match self {
            Db::Sqlite(s) => s.get_feed_targets(),
            Db::Duckdb(d) => d.get_feed_targets(),
        }
    }

    /// Get feed targets filtered by a single feed id.
    pub fn get_feed_targets_by_id(&self, feed_id: i32) -> Result<Vec<FeedTarget>> {
        match self {
            Db::Sqlite(s) => s.get_feed_targets_by_id(feed_id),
            Db::Duckdb(d) => d.get_feed_targets_by_id(feed_id),
        }
    }

    /// Insert an article if it doesn't already exist (UNIQUE(feed_id, guid)).
    /// Returns the number of rows inserted (0 or 1).
    pub fn insert_article_if_new(
        &self,
        feed_id: i32,
        guid: &str,
        title: &str,
        url: &str,
        author: &str,
        content: &str,
        title_tokens: &str,
        content_tokens: &str,
        published_at: Option<chrono::NaiveDateTime>,
        fetched_at: chrono::NaiveDateTime,
    ) -> Result<usize> {
        match self {
            Db::Sqlite(s) => s.insert_article_if_new(
                feed_id,
                guid,
                title,
                url,
                author,
                content,
                title_tokens,
                content_tokens,
                published_at,
                fetched_at,
            ),
            Db::Duckdb(d) => d.insert_article_if_new(
                feed_id,
                guid,
                title,
                url,
                author,
                content,
                title_tokens,
                content_tokens,
                published_at,
                fetched_at,
            ),
        }
    }

    /// Update ETag / Last-Modified / last_fetched_at for a feed.
    pub fn update_feed_fetch_metadata(
        &self,
        feed_id: i32,
        etag: Option<&str>,
        last_modified: Option<&str>,
        last_fetched_at: chrono::NaiveDateTime,
    ) -> Result<()> {
        match self {
            Db::Sqlite(s) => s.update_feed_fetch_metadata(feed_id, etag, last_modified, last_fetched_at),
            Db::Duckdb(d) => d.update_feed_fetch_metadata(feed_id, etag, last_modified, last_fetched_at),
        }
    }

    /// Rebuild the full-text search index.
    pub fn rebuild_search_index(&self) -> Result<()> {
        match self {
            Db::Sqlite(s) => s.rebuild_search_index(),
            Db::Duckdb(d) => d.rebuild_search_index(),
        }
    }

    /// Get a single feed by URL (used after reconcile to return the created/updated feed).
    pub fn get_feed_by_url(&self, url: &str) -> Result<Feed> {
        match self {
            Db::Sqlite(s) => s.get_feed_by_url(url),
            Db::Duckdb(d) => d.get_feed_by_url(url),
        }
    }

    /// Get a single folder by name.
    pub fn get_folder_by_name(&self, name: &str) -> Result<Folder> {
        match self {
            Db::Sqlite(s) => s.get_folder_by_name(name),
            Db::Duckdb(d) => d.get_folder_by_name(name),
        }
    }

    /// Get feed URL by id.
    pub fn get_feed_url_by_id(&self, id: i32) -> Result<String> {
        match self {
            Db::Sqlite(s) => s.get_feed_url_by_id(id),
            Db::Duckdb(d) => d.get_feed_url_by_id(id),
        }
    }

    /// Get (url, title, folder_name) for a feed by id.
    pub fn get_feed_info_by_id(&self, id: i32) -> Result<(String, String, Option<String>)> {
        match self {
            Db::Sqlite(s) => s.get_feed_info_by_id(id),
            Db::Duckdb(d) => d.get_feed_info_by_id(id),
        }
    }

    /// Get folder name by id.
    pub fn get_folder_name_by_id(&self, id: i32) -> Result<String> {
        match self {
            Db::Sqlite(s) => s.get_folder_name_by_id(id),
            Db::Duckdb(d) => d.get_folder_name_by_id(id),
        }
    }
}
