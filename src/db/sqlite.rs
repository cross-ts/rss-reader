use anyhow::Result;

use super::{ArticleFilter, ArticlesResult, Feed, FeedTarget, Folder};
use crate::feeds::Subscriptions;

/// SQLite backed database (stub — to be implemented in phase 2).
pub struct SqliteDb;

impl Clone for SqliteDb {
    fn clone(&self) -> Self {
        Self
    }
}

impl SqliteDb {
    pub fn open(_path: &str) -> Result<Self> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn feed_count(&self) -> Result<i64> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn reconcile_subscriptions(&self, _subs: &Subscriptions) -> Result<()> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn list_articles(&self, _filter: ArticleFilter) -> Result<ArticlesResult> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn list_feeds(&self) -> Result<Vec<Feed>> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn get_feed_targets(&self) -> Result<Vec<FeedTarget>> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn get_feed_targets_by_id(&self, _feed_id: i32) -> Result<Vec<FeedTarget>> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn insert_article_if_new(
        &self,
        _feed_id: i32,
        _guid: &str,
        _title: &str,
        _url: &str,
        _author: &str,
        _content: &str,
        _title_tokens: &str,
        _content_tokens: &str,
        _published_at: Option<chrono::NaiveDateTime>,
        _fetched_at: chrono::NaiveDateTime,
    ) -> Result<usize> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn update_feed_fetch_metadata(
        &self,
        _feed_id: i32,
        _etag: Option<&str>,
        _last_modified: Option<&str>,
        _last_fetched_at: chrono::NaiveDateTime,
    ) -> Result<()> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn rebuild_search_index(&self) -> Result<()> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn get_feed_by_url(&self, _url: &str) -> Result<Feed> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn get_folder_by_name(&self, _name: &str) -> Result<Folder> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn get_feed_url_by_id(&self, _id: i32) -> Result<String> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn get_feed_info_by_id(&self, _id: i32) -> Result<(String, String, Option<String>)> {
        todo!("SQLite driver is not yet implemented")
    }

    pub fn get_folder_name_by_id(&self, _id: i32) -> Result<String> {
        todo!("SQLite driver is not yet implemented")
    }
}
