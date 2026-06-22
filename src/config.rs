use anyhow::{bail, Result};
use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub db_path: String,
    pub feeds_path: String,
    pub poll_interval_minutes: u64,
    pub host: String,
    pub port: u16,
    /// フロントエンド配信元（GitHub Pages 等）。STATIC_DIR 未指定時にリバースプロキシで配信する。
    pub frontend_url: String,
    /// ローカル静的配信ディレクトリ。指定時はプロキシせずここから配信する（dev/offline 用）。
    pub static_dir: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let frontend_url = env::var("FRONTEND_URL")
            .unwrap_or_else(|_| "https://cross-ts.github.io/rss-reader/".to_string());

        // FRONTEND_URL のバリデーション
        let parsed = url::Url::parse(&frontend_url)
            .map_err(|e| anyhow::anyhow!("FRONTEND_URL のパースに失敗: {}: {}", frontend_url, e))?;
        match parsed.scheme() {
            "http" | "https" => {}
            s => bail!("FRONTEND_URL は http/https のみ許可されています (got: {}): {}", s, frontend_url),
        }

        Ok(Config {
            db_path: env::var("DB_PATH").unwrap_or_else(|_| "data/rss.duckdb".to_string()),
            feeds_path: env::var("FEEDS_PATH").unwrap_or_else(|_| "feeds.opml".to_string()),
            poll_interval_minutes: env::var("POLL_INTERVAL_MINUTES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(15),
            host: env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3000),
            frontend_url,
            static_dir: env::var("STATIC_DIR").ok().filter(|s| !s.is_empty()),
        })
    }
}
