use anyhow::{anyhow, Result};
use chrono::NaiveDateTime;
use duckdb::params;
use duckdb::Connection;
use std::sync::{Arc, Mutex, MutexGuard};

use super::{Article, ArticleFilter, ArticlesResult, Feed, FeedTarget, FetchMeta, Folder, NewArticle};
use crate::feeds::Subscriptions;
use crate::tokenize::tokenize;

/// DuckDB backed database.
/// Wraps `Arc<Mutex<Connection>>` for shared access from `spawn_blocking`.
pub struct DuckdbDb {
    conn: Arc<Mutex<Connection>>,
}

impl Clone for DuckdbDb {
    fn clone(&self) -> Self {
        Self {
            conn: self.conn.clone(),
        }
    }
}

impl DuckdbDb {
    /// Poison-safe lock helper: converts PoisonError to anyhow::Error.
    fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|e| anyhow!("DB lock poisoned: {e}"))
    }

    /// Open (or create) a DuckDB database at `path`, run migrations.
    pub fn open(path: &str) -> Result<Self> {
        // データディレクトリ作成
        if let Some(parent) = std::path::Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let conn = Connection::open(path)?;

        // 拡張機能インストール（各文を個別実行）
        conn.execute_batch("INSTALL fts;")?;
        conn.execute_batch("LOAD fts;")?;

        // シーケンス作成（各文を個別実行）
        conn.execute_batch("CREATE SEQUENCE IF NOT EXISTS seq_folders;")?;
        conn.execute_batch("CREATE SEQUENCE IF NOT EXISTS seq_feeds;")?;
        conn.execute_batch("CREATE SEQUENCE IF NOT EXISTS seq_articles;")?;

        // テーブル作成（各文を個別実行）
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_folders'),
                name VARCHAR UNIQUE
            );",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_feeds'),
                folder_id INTEGER,
                title VARCHAR,
                url VARCHAR UNIQUE,
                site_url VARCHAR,
                etag VARCHAR,
                last_modified VARCHAR,
                last_fetched_at TIMESTAMP
            );",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_articles'),
                feed_id INTEGER,
                guid VARCHAR,
                title VARCHAR,
                url VARCHAR,
                author VARCHAR,
                content VARCHAR,
                title_tokens VARCHAR,
                content_tokens VARCHAR,
                published_at TIMESTAMP,
                fetched_at TIMESTAMP,
                UNIQUE(feed_id, guid)
            );",
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn feed_count(&self) -> Result<i64> {
        let conn = self.conn()?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))?;
        Ok(count)
    }

    pub fn reconcile_subscriptions(&self, subs: &Subscriptions) -> Result<()> {
        let conn = self.conn()?;
        conn.execute_batch("BEGIN")?;

        let result: Result<()> = (|| {
            // 1. folders を upsert
            for folder in &subs.folders {
                conn.execute(
                    "INSERT INTO folders (name) VALUES (?) ON CONFLICT (name) DO NOTHING",
                    params![folder.name],
                )?;
            }

            // 2. feeds を upsert（folder_id は名前から解決）
            for feed in &subs.feeds {
                let folder_id: Option<i32> = if let Some(ref fname) = feed.folder {
                    conn.query_row(
                        "SELECT id FROM folders WHERE name = ?",
                        params![fname],
                        |r| r.get(0),
                    )
                    .ok()
                } else {
                    None
                };

                conn.execute(
                    "INSERT INTO feeds (folder_id, title, url) VALUES (?, ?, ?)
                     ON CONFLICT (url) DO UPDATE SET folder_id = excluded.folder_id, title = excluded.title",
                    params![folder_id, feed.title, feed.url],
                )?;

                // OPML(SSOT) の htmlUrl を site_url に反映する。
                let su = feed.site_url.as_deref().filter(|s| !s.is_empty());
                conn.execute(
                    "UPDATE feeds SET site_url = ? WHERE url = ?",
                    params![su, feed.url],
                )?;
            }

            // 3. 購読にない feed の articles を削除 → feed を削除
            let feed_urls: Vec<String> = subs.feeds.iter().map(|f| f.url.clone()).collect();
            if !feed_urls.is_empty() {
                let placeholders: String = feed_urls
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("${}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");
                // articles 削除
                let sql_art = format!(
                    "DELETE FROM articles WHERE feed_id IN (SELECT id FROM feeds WHERE url NOT IN ({}))",
                    placeholders
                );
                let params_art: Vec<&dyn duckdb::ToSql> =
                    feed_urls.iter().map(|s| s as &dyn duckdb::ToSql).collect();
                conn.execute(&sql_art, duckdb::params_from_iter(params_art.iter()))?;

                // feeds 削除
                let sql_feeds = format!("DELETE FROM feeds WHERE url NOT IN ({})", placeholders);
                let params_feeds: Vec<&dyn duckdb::ToSql> =
                    feed_urls.iter().map(|s| s as &dyn duckdb::ToSql).collect();
                conn.execute(
                    &sql_feeds,
                    duckdb::params_from_iter(params_feeds.iter()),
                )?;
            } else {
                // 購読に feed が0件 → 全 articles/feeds 削除
                conn.execute("DELETE FROM articles", [])?;
                conn.execute("DELETE FROM feeds", [])?;
            }

            // 4. 購読にない folder を削除
            let folder_names: Vec<String> = subs.folders.iter().map(|f| f.name.clone()).collect();
            if !folder_names.is_empty() {
                let placeholders: String = folder_names
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("${}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");
                // 参照を NULL に
                let sql_null = format!(
                    "UPDATE feeds SET folder_id = NULL WHERE folder_id IN (SELECT id FROM folders WHERE name NOT IN ({}))",
                    placeholders
                );
                let params_null: Vec<&dyn duckdb::ToSql> = folder_names
                    .iter()
                    .map(|s| s as &dyn duckdb::ToSql)
                    .collect();
                conn.execute(&sql_null, duckdb::params_from_iter(params_null.iter()))?;

                // folder 削除
                let sql_del = format!("DELETE FROM folders WHERE name NOT IN ({})", placeholders);
                let params_del: Vec<&dyn duckdb::ToSql> = folder_names
                    .iter()
                    .map(|s| s as &dyn duckdb::ToSql)
                    .collect();
                conn.execute(&sql_del, duckdb::params_from_iter(params_del.iter()))?;
            } else {
                conn.execute(
                    "UPDATE feeds SET folder_id = NULL WHERE folder_id IS NOT NULL",
                    [],
                )?;
                conn.execute("DELETE FROM folders", [])?;
            }

            Ok(())
        })();

        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    pub fn list_articles(&self, filter: ArticleFilter) -> Result<ArticlesResult> {
        let conn = self.conn()?;
        let limit = filter.limit.unwrap_or(50);
        let offset = filter.offset.unwrap_or(0);

        if let Some(ref search_q) = filter.q {
            // 記事が0件のときは FTS インデックス未作成のため空を返す
            let article_count: i64 = conn
                .query_row("SELECT count(*) FROM articles", [], |r| r.get(0))?;
            if article_count == 0 {
                return Ok(ArticlesResult {
                    items: vec![],
                    total: 0,
                });
            }

            let tokenized_q = tokenize(search_q).unwrap_or_else(|_| search_q.clone());

            // Build filter clauses with bind parameters
            let mut filter_clauses = vec![];
            let mut filter_bind_values: Vec<Box<dyn duckdb::ToSql>> = vec![];

            if let Some(fid) = filter.folder_id {
                filter_clauses.push("f.folder_id = ?".to_string());
                filter_bind_values.push(Box::new(fid));
            }
            if let Some(fid) = filter.feed_id {
                filter_clauses.push("a.feed_id = ?".to_string());
                filter_bind_values.push(Box::new(fid));
            }

            let filter_str = if filter_clauses.is_empty() {
                "TRUE".to_string()
            } else {
                filter_clauses.join(" AND ")
            };

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

            // Build total params: tokenized_q + filter values
            let mut total_params: Vec<&dyn duckdb::ToSql> = vec![&tokenized_q as &dyn duckdb::ToSql];
            for v in &filter_bind_values {
                total_params.push(v.as_ref());
            }
            let total: i64 = conn
                .query_row(&total_sql, duckdb::params_from_iter(total_params.iter()), |r| r.get(0))?;

            // Build query params: tokenized_q + filter values + limit + offset
            let mut query_params: Vec<&dyn duckdb::ToSql> = vec![&tokenized_q as &dyn duckdb::ToSql];
            for v in &filter_bind_values {
                query_params.push(v.as_ref());
            }
            query_params.push(&limit as &dyn duckdb::ToSql);
            query_params.push(&offset as &dyn duckdb::ToSql);

            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(duckdb::params_from_iter(query_params.iter()), |r| {
                let published_at: Option<NaiveDateTime> = r.get(7)?;
                Ok(Article {
                    id: r.get(0)?,
                    feed_id: r.get(1)?,
                    feed_title: r.get(2)?,
                    title: r.get(3)?,
                    url: r.get(4)?,
                    author: r.get(5)?,
                    content: r.get(6)?,
                    published_at: published_at
                        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }

            Ok(ArticlesResult { items, total })
        } else {
            // 通常検索（published_at 降順）
            let mut where_clauses = vec![];
            let mut bind_values: Vec<Box<dyn duckdb::ToSql>> = vec![];

            if let Some(fid) = filter.folder_id {
                where_clauses.push("f.folder_id = ?".to_string());
                bind_values.push(Box::new(fid));
            }
            if let Some(fid) = filter.feed_id {
                where_clauses.push("a.feed_id = ?".to_string());
                bind_values.push(Box::new(fid));
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
            let total_params: Vec<&dyn duckdb::ToSql> = bind_values.iter().map(|v| v.as_ref()).collect();
            let total: i64 = if total_params.is_empty() {
                conn.query_row(&total_sql, [], |r| r.get(0))?
            } else {
                conn.query_row(&total_sql, duckdb::params_from_iter(total_params.iter()), |r| r.get(0))?
            };

            let sql = format!(
                "SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title, COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url, a.author, COALESCE(a.content, '') AS content, a.published_at
                 FROM articles a
                 JOIN feeds f ON f.id = a.feed_id
                 {}
                 ORDER BY a.published_at DESC NULLS LAST
                 LIMIT ? OFFSET ?",
                where_str
            );

            let mut query_params: Vec<&dyn duckdb::ToSql> = bind_values.iter().map(|v| v.as_ref()).collect();
            query_params.push(&limit as &dyn duckdb::ToSql);
            query_params.push(&offset as &dyn duckdb::ToSql);

            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(duckdb::params_from_iter(query_params.iter()), |r| {
                let published_at: Option<NaiveDateTime> = r.get(7)?;
                Ok(Article {
                    id: r.get(0)?,
                    feed_id: r.get(1)?,
                    feed_title: r.get(2)?,
                    title: r.get(3)?,
                    url: r.get(4)?,
                    author: r.get(5)?,
                    content: r.get(6)?,
                    published_at: published_at
                        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }

            Ok(ArticlesResult { items, total })
        }
    }

    pub fn list_feeds(&self) -> Result<Vec<Feed>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT f.id, f.title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
             FROM feeds f
             LEFT JOIN folders fo ON fo.id = f.folder_id
             LEFT JOIN articles a ON a.feed_id = f.id
             GROUP BY f.id, f.title, f.url, f.site_url, fo.name
             ORDER BY f.title",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Feed {
                id: r.get(0)?,
                title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                url: r.get(2)?,
                site_url: r.get(3)?,
                folder: r.get(4)?,
                article_count: r.get(5)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT f.id, f.name, COUNT(fd.id) AS feed_count
             FROM folders f
             LEFT JOIN feeds fd ON fd.folder_id = f.id
             GROUP BY f.id, f.name
             ORDER BY f.name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Folder {
                id: r.get(0)?,
                name: r.get(1)?,
                feed_count: r.get(2)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_feed_targets(&self) -> Result<Vec<FeedTarget>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT id, url, etag, last_modified FROM feeds")?;
        let rows = stmt.query_map([], |r| {
            Ok(FeedTarget {
                id: r.get(0)?,
                url: r.get(1)?,
                etag: r.get(2)?,
                last_modified: r.get(3)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    pub fn get_feed_targets_by_id(&self, feed_id: i32) -> Result<Vec<FeedTarget>> {
        let conn = self.conn()?;
        let mut stmt =
            conn.prepare("SELECT id, url, etag, last_modified FROM feeds WHERE id = ?")?;
        let rows = stmt.query_map(params![feed_id], |r| {
            Ok(FeedTarget {
                id: r.get(0)?,
                url: r.get(1)?,
                etag: r.get(2)?,
                last_modified: r.get(3)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

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
        let conn = self.conn()?;
        let n = conn.execute(
            "INSERT INTO articles (feed_id, guid, title, url, author, content, title_tokens, content_tokens, published_at, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (feed_id, guid) DO NOTHING",
            params![
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
            ],
        )?;
        Ok(n)
    }

    pub fn update_feed_fetch_metadata(
        &self,
        feed_id: i32,
        etag: Option<&str>,
        last_modified: Option<&str>,
        last_fetched_at: chrono::NaiveDateTime,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE feeds SET etag=?, last_modified=?, last_fetched_at=? WHERE id=?",
            params![etag, last_modified, last_fetched_at, feed_id],
        )?;
        Ok(())
    }

    pub fn rebuild_search_index(&self) -> Result<()> {
        let conn = self.conn()?;
        let count: i64 = conn.query_row("SELECT count(*) FROM articles", [], |r| r.get(0))?;
        if count == 0 {
            return Ok(());
        }

        conn.execute_batch(
            "PRAGMA create_fts_index('articles', 'id', 'title_tokens', 'content_tokens', stemmer='none', stopwords='none', overwrite=1);",
        )?;

        tracing::info!("FTS index rebuilt ({} articles)", count);
        Ok(())
    }

    /// Query a single feed by URL (used after reconcile to return the created/updated feed).
    pub fn get_feed_by_url(&self, url: &str) -> Result<Feed> {
        let conn = self.conn()?;
        let feed = conn.query_row(
            "SELECT f.id, f.title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
             FROM feeds f
             LEFT JOIN folders fo ON fo.id = f.folder_id
             LEFT JOIN articles a ON a.feed_id = f.id
             WHERE f.url = ?
             GROUP BY f.id, f.title, f.url, f.site_url, fo.name",
            params![url],
            |r| {
                Ok(Feed {
                    id: r.get(0)?,
                    title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    url: r.get(2)?,
                    site_url: r.get(3)?,
                    folder: r.get(4)?,
                    article_count: r.get(5)?,
                })
            },
        )?;
        Ok(feed)
    }

    /// Query a single folder by name (used after reconcile to return the created folder).
    pub fn get_folder_by_name(&self, name: &str) -> Result<Folder> {
        let conn = self.conn()?;
        let folder = conn.query_row(
            "SELECT f.id, f.name, COUNT(fd.id) AS feed_count
             FROM folders f
             LEFT JOIN feeds fd ON fd.folder_id = f.id
             WHERE f.name = ?
             GROUP BY f.id, f.name",
            params![name],
            |r| {
                Ok(Folder {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    feed_count: r.get(2)?,
                })
            },
        )?;
        Ok(folder)
    }

    /// Get feed URL by id (used in delete/update routes).
    pub fn get_feed_url_by_id(&self, id: i32) -> Result<String> {
        let conn = self.conn()?;
        let url: String = conn.query_row(
            "SELECT url FROM feeds WHERE id = ?",
            params![id],
            |r| r.get(0),
        )?;
        Ok(url)
    }

    /// Get feed info by id (url, title, folder_name) for update route.
    pub fn get_feed_info_by_id(&self, id: i32) -> Result<(String, String, Option<String>)> {
        let conn = self.conn()?;
        let result = conn.query_row(
            "SELECT f.url, f.title, fo.name FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = ?",
            params![id],
            |r| Ok((r.get(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default(), r.get(2)?)),
        )?;
        Ok(result)
    }

    /// Get folder name by id.
    pub fn get_folder_name_by_id(&self, id: i32) -> Result<String> {
        let conn = self.conn()?;
        let name: String = conn.query_row(
            "SELECT name FROM folders WHERE id = ?",
            params![id],
            |r| r.get(0),
        )?;
        Ok(name)
    }

    /// Transactionally insert articles and update feed fetch metadata.
    /// Prevents partial success (articles inserted but metadata stale).
    pub fn apply_fetch_result(
        &self,
        feed_id: i32,
        articles: &[NewArticle],
        meta: &FetchMeta,
    ) -> Result<usize> {
        let conn = self.conn()?;
        conn.execute_batch("BEGIN")?;

        let result: Result<usize> = (|| {
            let mut inserted = 0usize;
            for article in articles {
                let n = conn.execute(
                    "INSERT INTO articles (feed_id, guid, title, url, author, content, title_tokens, content_tokens, published_at, fetched_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (feed_id, guid) DO NOTHING",
                    params![
                        feed_id,
                        article.guid,
                        article.title,
                        article.url,
                        article.author,
                        article.content,
                        article.title_tokens,
                        article.content_tokens,
                        article.published_at,
                        meta.fetched_at,
                    ],
                )?;
                inserted += n;
            }

            conn.execute(
                "UPDATE feeds SET etag=?, last_modified=?, last_fetched_at=? WHERE id=?",
                params![meta.etag, meta.last_modified, meta.fetched_at, feed_id],
            )?;

            Ok(inserted)
        })();

        match result {
            Ok(n) => {
                conn.execute_batch("COMMIT")?;
                Ok(n)
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
}
