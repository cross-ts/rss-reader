pub mod fts;

use anyhow::Result;
use duckdb::Connection;
use std::sync::{Arc, Mutex};

pub type DbConn = Arc<Mutex<Connection>>;

pub fn open(path: &str) -> Result<DbConn> {
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
    conn.execute_batch("INSTALL vss;")?;
    conn.execute_batch("LOAD vss;")?;

    // シーケンス作成（各文を個別実行）
    conn.execute_batch("CREATE SEQUENCE IF NOT EXISTS seq_folders;")?;
    conn.execute_batch("CREATE SEQUENCE IF NOT EXISTS seq_feeds;")?;
    conn.execute_batch("CREATE SEQUENCE IF NOT EXISTS seq_articles;")?;

    // テーブル作成（各文を個別実行）
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY DEFAULT nextval('seq_folders'),
            name VARCHAR UNIQUE
        );"
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
        );"
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
        );"
    )?;

    Ok(Arc::new(Mutex::new(conn)))
}
