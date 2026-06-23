use anyhow::Result;
use reqwest::Client;
use std::time::Duration;
use tokio::time;

use crate::db::Db;
use crate::fetcher::fetch_feed;

pub async fn run_once(db: Db, client: Client) -> Result<()> {
    // 全フィードを取得
    let feeds = {
        let db2 = db.clone();
        tokio::task::spawn_blocking(move || db2.get_feed_targets()).await??
    };

    for target in feeds {
        let db_clone = db.clone();
        let client_clone = client.clone();
        if let Err(e) = fetch_feed(
            db_clone,
            client_clone,
            target.id,
            target.url.clone(),
            target.etag,
            target.last_modified,
        )
        .await
        {
            tracing::warn!("Failed to fetch feed {}: {}", target.url, e);
        }
    }

    // FTSインデックス再構築
    {
        let db2 = db.clone();
        tokio::task::spawn_blocking(move || {
            if let Err(e) = db2.rebuild_search_index() {
                tracing::warn!("FTS rebuild failed: {}", e);
            }
        })
        .await?;
    }

    Ok(())
}

pub async fn start_poller(db: Db, client: Client, interval_minutes: u64) {
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
