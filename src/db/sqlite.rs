use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

use super::{Article, ArticleFilter, ArticlesResult, Feed, FeedTarget, Folder};
use crate::feeds::Subscriptions;
use crate::tokenize::tokenize;

/// SQLite backed database (rusqlite bundled + FTS5).
/// Wraps `Arc<Mutex<Connection>>` for shared access from `spawn_blocking`.
pub struct SqliteDb {
    conn: Arc<Mutex<Connection>>,
}

impl Clone for SqliteDb {
    fn clone(&self) -> Self {
        Self {
            conn: self.conn.clone(),
        }
    }
}

impl SqliteDb {
    /// Open (or create) a SQLite database at `path`, run migrations.
    /// FTS5 availability is verified at startup (fail-fast).
    pub fn open(path: &str) -> Result<Self> {
        // データディレクトリ作成
        if let Some(parent) = std::path::Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let conn = Connection::open(path)?;

        // PRAGMA 設定
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        // テーブル作成
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            );",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER,
                title TEXT,
                url TEXT UNIQUE NOT NULL,
                site_url TEXT,
                etag TEXT,
                last_modified TEXT,
                last_fetched_at TEXT
            );",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id INTEGER,
                guid TEXT,
                title TEXT,
                url TEXT,
                author TEXT,
                content TEXT,
                title_tokens TEXT,
                content_tokens TEXT,
                published_at TEXT,
                fetched_at TEXT,
                UNIQUE(feed_id, guid)
            );",
        )?;

        // FTS5 外部コンテンツテーブル（fail-fast: bundled が FTS5 を含まない場合ここでエラー）
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
                title_tokens,
                content_tokens,
                content='articles',
                content_rowid='id',
                tokenize='unicode61'
            );",
        )
        .context("FTS5 の初期化に失敗しました。rusqlite bundled が FTS5 を含んでいるか確認してください")?;

        // INSERT トリガ: articles に行が挿入されたら articles_fts にも挿入
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
                INSERT INTO articles_fts(rowid, title_tokens, content_tokens)
                VALUES (new.id, new.title_tokens, new.content_tokens);
            END;",
        )?;

        // DELETE トリガ: articles から行が削除されたら articles_fts からも削除（FTS5 の 'delete' 特殊行）
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
                INSERT INTO articles_fts(articles_fts, rowid, title_tokens, content_tokens)
                VALUES ('delete', old.id, old.title_tokens, old.content_tokens);
            END;",
        )?;

        // UPDATE トリガ: articles が更新されたら FTS5 も更新（delete + insert）
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
                INSERT INTO articles_fts(articles_fts, rowid, title_tokens, content_tokens)
                VALUES ('delete', old.id, old.title_tokens, old.content_tokens);
                INSERT INTO articles_fts(rowid, title_tokens, content_tokens)
                VALUES (new.id, new.title_tokens, new.content_tokens);
            END;",
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn feed_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))?;
        Ok(count)
    }

    pub fn reconcile_subscriptions(&self, subs: &Subscriptions) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;

        let result: Result<()> = (|| {
            // 1. folders を upsert
            for folder in &subs.folders {
                tx.execute(
                    "INSERT INTO folders (name) VALUES (?1) ON CONFLICT (name) DO NOTHING",
                    params![folder.name],
                )?;
            }

            // 2. feeds を upsert（folder_id は名前から解決）
            for feed in &subs.feeds {
                let folder_id: Option<i32> = if let Some(ref fname) = feed.folder {
                    tx.query_row(
                        "SELECT id FROM folders WHERE name = ?1",
                        params![fname],
                        |r| r.get(0),
                    )
                    .ok()
                } else {
                    None
                };

                tx.execute(
                    "INSERT INTO feeds (folder_id, title, url) VALUES (?1, ?2, ?3)
                     ON CONFLICT (url) DO UPDATE SET folder_id = excluded.folder_id, title = excluded.title",
                    params![folder_id, feed.title, feed.url],
                )?;

                // OPML(SSOT) の htmlUrl を site_url に反映する。
                let su = feed.site_url.as_deref().filter(|s| !s.is_empty());
                tx.execute(
                    "UPDATE feeds SET site_url = ?1 WHERE url = ?2",
                    params![su, feed.url],
                )?;
            }

            // 3. 購読にない feed の articles を削除 → feed を削除
            let feed_urls: Vec<String> = subs.feeds.iter().map(|f| f.url.clone()).collect();
            if !feed_urls.is_empty() {
                let placeholders: String = feed_urls
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");

                // articles 削除
                let sql_art = format!(
                    "DELETE FROM articles WHERE feed_id IN (SELECT id FROM feeds WHERE url NOT IN ({}))",
                    placeholders
                );
                let params_art: Vec<Box<dyn rusqlite::types::ToSql>> = feed_urls
                    .iter()
                    .map(|s| Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>)
                    .collect();
                let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                    params_art.iter().map(|p| p.as_ref()).collect();
                tx.execute(&sql_art, param_refs.as_slice())?;

                // feeds 削除
                let sql_feeds = format!("DELETE FROM feeds WHERE url NOT IN ({})", placeholders);
                let params_feeds: Vec<Box<dyn rusqlite::types::ToSql>> = feed_urls
                    .iter()
                    .map(|s| Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>)
                    .collect();
                let param_refs2: Vec<&dyn rusqlite::types::ToSql> =
                    params_feeds.iter().map(|p| p.as_ref()).collect();
                tx.execute(&sql_feeds, param_refs2.as_slice())?;
            } else {
                // 購読に feed が0件 → 全 articles/feeds 削除
                tx.execute("DELETE FROM articles", [])?;
                tx.execute("DELETE FROM feeds", [])?;
            }

            // 4. 購読にない folder を削除
            let folder_names: Vec<String> = subs.folders.iter().map(|f| f.name.clone()).collect();
            if !folder_names.is_empty() {
                let placeholders: String = folder_names
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");

                // 参照を NULL に
                let sql_null = format!(
                    "UPDATE feeds SET folder_id = NULL WHERE folder_id IN (SELECT id FROM folders WHERE name NOT IN ({}))",
                    placeholders
                );
                let params_null: Vec<Box<dyn rusqlite::types::ToSql>> = folder_names
                    .iter()
                    .map(|s| Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>)
                    .collect();
                let param_refs3: Vec<&dyn rusqlite::types::ToSql> =
                    params_null.iter().map(|p| p.as_ref()).collect();
                tx.execute(&sql_null, param_refs3.as_slice())?;

                // folder 削除
                let sql_del = format!("DELETE FROM folders WHERE name NOT IN ({})", placeholders);
                let params_del: Vec<Box<dyn rusqlite::types::ToSql>> = folder_names
                    .iter()
                    .map(|s| Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>)
                    .collect();
                let param_refs4: Vec<&dyn rusqlite::types::ToSql> =
                    params_del.iter().map(|p| p.as_ref()).collect();
                tx.execute(&sql_del, param_refs4.as_slice())?;
            } else {
                tx.execute(
                    "UPDATE feeds SET folder_id = NULL WHERE folder_id IS NOT NULL",
                    [],
                )?;
                tx.execute("DELETE FROM folders", [])?;
            }

            Ok(())
        })();

        match result {
            Ok(()) => {
                tx.commit()?;
                Ok(())
            }
            Err(e) => {
                // tx は Drop 時に自動 rollback
                Err(e)
            }
        }
    }

    pub fn list_articles(&self, filter: ArticleFilter) -> Result<ArticlesResult> {
        let conn = self.conn.lock().unwrap();
        let limit = filter.limit.unwrap_or(50);
        let offset = filter.offset.unwrap_or(0);

        if let Some(ref search_q) = filter.q {
            // 記事が0件のときは FTS インデックス未作成のため空を返す
            let article_count: i64 = conn
                .query_row("SELECT count(*) FROM articles", [], |r| r.get(0))
                .unwrap_or(0);
            if article_count == 0 {
                return Ok(ArticlesResult {
                    items: vec![],
                    total: 0,
                });
            }

            // lindera トークン化 → 各トークンをダブルクォート phrase 化 → OR 結合
            let match_query = build_fts_query(search_q);
            if match_query.is_empty() {
                return Ok(ArticlesResult {
                    items: vec![],
                    total: 0,
                });
            }

            let mut filter_clauses = vec![];
            if let Some(fid) = filter.folder_id {
                filter_clauses.push(format!("f.folder_id = {}", fid));
            }
            if let Some(fid) = filter.feed_id {
                filter_clauses.push(format!("a.feed_id = {}", fid));
            }

            let filter_str = if filter_clauses.is_empty() {
                "1".to_string()
            } else {
                filter_clauses.join(" AND ")
            };

            // bm25() は小さいほど高関連 → ORDER BY ASC
            let sql = format!(
                "SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title,
                        COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url,
                        a.author, COALESCE(a.content, '') AS content, a.published_at
                 FROM articles a
                 JOIN feeds f ON f.id = a.feed_id
                 JOIN articles_fts fts ON a.id = fts.rowid
                 WHERE articles_fts MATCH ?1 AND {}
                 ORDER BY bm25(articles_fts) ASC
                 LIMIT ?2 OFFSET ?3",
                filter_str
            );

            let total_sql = format!(
                "SELECT count(*)
                 FROM articles a
                 JOIN feeds f ON f.id = a.feed_id
                 JOIN articles_fts fts ON a.id = fts.rowid
                 WHERE articles_fts MATCH ?1 AND {}",
                filter_str
            );

            let total: i64 = conn
                .query_row(&total_sql, params![match_query], |r| r.get(0))
                .unwrap_or(0);

            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![match_query, limit, offset], |r| {
                Ok(Article {
                    id: r.get(0)?,
                    feed_id: r.get(1)?,
                    feed_title: r.get(2)?,
                    title: r.get(3)?,
                    url: r.get(4)?,
                    author: r.get(5)?,
                    content: r.get(6)?,
                    published_at: r.get(7)?,
                })
            })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row?);
            }

            Ok(ArticlesResult { items, total })
        } else {
            // 通常検索（published_at 降順、NULL は最後）
            let mut where_clauses = vec![];
            if let Some(fid) = filter.folder_id {
                where_clauses.push(format!("f.folder_id = {}", fid));
            }
            if let Some(fid) = filter.feed_id {
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
            let total: i64 = conn
                .query_row(&total_sql, [], |r| r.get(0))
                .unwrap_or(0);

            let sql = format!(
                "SELECT a.id, a.feed_id, COALESCE(f.title, '') AS feed_title,
                        COALESCE(a.title, '') AS title, COALESCE(a.url, '') AS url,
                        a.author, COALESCE(a.content, '') AS content, a.published_at
                 FROM articles a
                 JOIN feeds f ON f.id = a.feed_id
                 {}
                 ORDER BY a.published_at IS NULL, a.published_at DESC
                 LIMIT ?1 OFFSET ?2",
                where_str
            );

            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![limit, offset], |r| {
                Ok(Article {
                    id: r.get(0)?,
                    feed_id: r.get(1)?,
                    feed_title: r.get(2)?,
                    title: r.get(3)?,
                    url: r.get(4)?,
                    author: r.get(5)?,
                    content: r.get(6)?,
                    published_at: r.get(7)?,
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, url, etag, last_modified FROM feeds WHERE id = ?1")?;
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
        let conn = self.conn.lock().unwrap();
        // datetime を RFC3339 固定長文字列（UTC, 末尾 Z）で保存
        let published_str = published_at.map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
        let fetched_str = fetched_at.format("%Y-%m-%dT%H:%M:%SZ").to_string();

        let n = conn.execute(
            "INSERT INTO articles (feed_id, guid, title, url, author, content, title_tokens, content_tokens, published_at, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
                published_str,
                fetched_str,
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
        let conn = self.conn.lock().unwrap();
        let fetched_str = last_fetched_at.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        conn.execute(
            "UPDATE feeds SET etag=?1, last_modified=?2, last_fetched_at=?3 WHERE id=?4",
            params![etag, last_modified, fetched_str, feed_id],
        )?;
        Ok(())
    }

    pub fn rebuild_search_index(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row("SELECT count(*) FROM articles", [], |r| r.get(0))?;
        if count == 0 {
            return Ok(());
        }

        conn.execute_batch("INSERT INTO articles_fts(articles_fts) VALUES('rebuild');")?;

        tracing::info!("FTS index rebuilt ({} articles)", count);
        Ok(())
    }

    pub fn get_feed_by_url(&self, url: &str) -> Result<Feed> {
        let conn = self.conn.lock().unwrap();
        let feed = conn.query_row(
            "SELECT f.id, f.title, f.url, f.site_url, fo.name AS folder_name, COUNT(a.id) AS article_count
             FROM feeds f
             LEFT JOIN folders fo ON fo.id = f.folder_id
             LEFT JOIN articles a ON a.feed_id = f.id
             WHERE f.url = ?1
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

    pub fn get_folder_by_name(&self, name: &str) -> Result<Folder> {
        let conn = self.conn.lock().unwrap();
        let folder = conn.query_row(
            "SELECT f.id, f.name, COUNT(fd.id) AS feed_count
             FROM folders f
             LEFT JOIN feeds fd ON fd.folder_id = f.id
             WHERE f.name = ?1
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

    pub fn get_feed_url_by_id(&self, id: i32) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let url: String = conn.query_row(
            "SELECT url FROM feeds WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok(url)
    }

    pub fn get_feed_info_by_id(&self, id: i32) -> Result<(String, String, Option<String>)> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT f.url, f.title, fo.name FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default(), r.get(2)?)),
        )?;
        Ok(result)
    }

    pub fn get_folder_name_by_id(&self, id: i32) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let name: String = conn.query_row(
            "SELECT name FROM folders WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok(name)
    }
}

/// lindera でトークン化し、各トークンをダブルクォート phrase 化して OR 結合する。
/// FTS5 MATCH 構文の特殊文字（OR/NEAR/(/)/*/"/^）をエスケープ。
/// 空トークンは除外。結果が空なら空文字列を返す。
fn build_fts_query(q: &str) -> String {
    let tokenized = tokenize(q).unwrap_or_else(|_| q.to_string());
    let tokens: Vec<&str> = tokenized
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return String::new();
    }
    let phrases: Vec<String> = tokens
        .iter()
        .map(|t| {
            // 内部の " を "" にエスケープし、全体をダブルクォートで囲む
            let escaped = t.replace('"', "\"\"");
            format!("\"{}\"", escaped)
        })
        .collect();
    phrases.join(" OR ")
}
