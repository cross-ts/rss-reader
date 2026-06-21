use anyhow::Result;
use reqwest::Client;
use std::time::Duration;
use tokio::time;

use crate::db::{fts, DbConn};
use crate::fetcher::fetch_feed;

pub async fn run_once(db: DbConn, client: Client) -> Result<()> {
    // 全フィードを取得
    let feeds: Vec<(i32, String, Option<String>, Option<String>)> = {
        let db2 = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db2.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT id, url, etag, last_modified FROM feeds"
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i32>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok::<_, anyhow::Error>(result)
        })
        .await??
    };

    for (feed_id, url, etag, last_modified) in feeds {
        let db_clone = db.clone();
        let client_clone = client.clone();
        if let Err(e) = fetch_feed(db_clone, client_clone, feed_id, url.clone(), etag, last_modified).await {
            tracing::warn!("Failed to fetch feed {}: {}", url, e);
        }
    }

    // FTSインデックス再構築
    {
        let db2 = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db2.lock().unwrap();
            if let Err(e) = fts::rebuild_fts_index(&conn) {
                tracing::warn!("FTS rebuild failed: {}", e);
            }
        })
        .await?;
    }

    Ok(())
}

pub async fn start_poller(db: DbConn, client: Client, interval_minutes: u64) {
    // 起動直後に1回実行
    let db2 = db.clone();
    let client2 = client.clone();
    tokio::spawn(async move {
        tracing::info!("Initial poll starting...");
        if let Err(e) = run_once(db2, client2).await {
            tracing::warn!("Initial poll error: {}", e);
        }
        tracing::info!("Initial poll done");
    });

    // 定期ポーリング
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(interval_minutes * 60));
        interval.tick().await; // 最初のティックは即時なのでスキップ
        loop {
            interval.tick().await;
            tracing::info!("Scheduled poll starting...");
            if let Err(e) = run_once(db.clone(), client.clone()).await {
                tracing::warn!("Scheduled poll error: {}", e);
            }
        }
    });
}
