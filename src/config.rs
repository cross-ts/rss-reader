use anyhow::{bail, Result};
use std::env;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Config {
    /// DuckDB ファイルパス（絶対パスに解決済み）。
    pub db_path: String,
    /// feeds.opml パス（絶対パスに解決済み）。
    pub feeds_path: String,
    pub poll_interval_minutes: u64,
    pub host: String,
    pub port: u16,
    /// フロントエンド配信元（GitHub Pages 等）。STATIC_DIR 未指定時にリバースプロキシで配信する。
    pub frontend_url: String,
    /// ローカル静的配信ディレクトリ。指定時はプロキシせずここから配信する（dev/offline 用）。
    pub static_dir: Option<String>,
}

/// 相対パスを cwd 基準で絶対パスに解決する。既に絶対パスならそのまま返す。
/// 既存ファイルの場合は canonicalize でシンボリックリンクも解決する。
fn resolve_path(cwd: &Path, raw: &str) -> PathBuf {
    let p = Path::new(raw);
    let joined = if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) };
    // ファイルが既に存在すれば canonicalize（シンボリックリンク解決）、
    // 未存在なら join した絶対パスをそのまま使う（初回起動時はまだ無い）。
    joined.canonicalize().unwrap_or(joined)
}

impl Config {
    /// 環境変数（または既定値）から設定を読み込む。
    /// `db_path` と `feeds_path` は **バイナリ実行時のカレントディレクトリ（cwd）基準** で
    /// 絶対パスに解決される。env で絶対パスが指定された場合はそのまま使用する。
    pub fn from_env() -> Result<Self> {
        let cwd = std::env::current_dir()?;

        let frontend_url = env::var("FRONTEND_URL")
            .unwrap_or_else(|_| "https://cross-ts.github.io/rss-reader/".to_string());

        // FRONTEND_URL のバリデーション
        let parsed = url::Url::parse(&frontend_url)
            .map_err(|e| anyhow::anyhow!("FRONTEND_URL のパースに失敗: {}: {}", frontend_url, e))?;
        match parsed.scheme() {
            "http" | "https" => {}
            s => bail!("FRONTEND_URL は http/https のみ許可されています (got: {}): {}", s, frontend_url),
        }

        let raw_db = env::var("DB_PATH").unwrap_or_else(|_| "data/rss.duckdb".to_string());
        let raw_feeds = env::var("FEEDS_PATH").unwrap_or_else(|_| "feeds.opml".to_string());

        Ok(Config {
            db_path: resolve_path(&cwd, &raw_db)
                .to_string_lossy()
                .into_owned(),
            feeds_path: resolve_path(&cwd, &raw_feeds)
                .to_string_lossy()
                .into_owned(),
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
