use anyhow::Result;
use duckdb::Connection;

pub fn rebuild_fts_index(conn: &Connection) -> Result<()> {
    // articlesテーブルに行がある場合のみインデックス作成
    let count: i64 = conn.query_row("SELECT count(*) FROM articles", [], |r| r.get(0))?;
    if count == 0 {
        return Ok(());
    }

    conn.execute_batch(
        "PRAGMA create_fts_index('articles', 'id', 'title_tokens', 'content_tokens', stemmer='none', stopwords='none', overwrite=1);"
    )?;

    tracing::info!("FTS index rebuilt ({} articles)", count);
    Ok(())
}
