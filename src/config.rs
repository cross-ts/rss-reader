use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub db_path: String,
    pub feeds_path: String,
    pub poll_interval_minutes: u64,
    pub host: String,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            db_path: env::var("DB_PATH").unwrap_or_else(|_| "data/rss.duckdb".to_string()),
            feeds_path: env::var("FEEDS_PATH").unwrap_or_else(|_| "feeds.yaml".to_string()),
            poll_interval_minutes: env::var("POLL_INTERVAL_MINUTES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(15),
            host: env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3000),
        }
    }
}
