use anyhow::{bail, Result};
use clap::{Parser, ValueEnum};
use std::path::{Path, PathBuf};

/// DB driver selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum DbDriver {
    Sqlite,
    Duckdb,
}

impl std::fmt::Display for DbDriver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbDriver::Sqlite => write!(f, "sqlite"),
            DbDriver::Duckdb => write!(f, "duckdb"),
        }
    }
}

/// セルフホスト型 RSS リーダー
#[derive(Parser, Debug)]
#[command(name = "rss-reader", version, about = "セルフホスト型 RSS リーダー", long_about = None)]
pub struct Cli {
    /// feeds.opml のパス（相対パスは cwd 基準で解決）
    #[arg(long = "feeds", env = "FEEDS_PATH", default_value = "feeds.opml")]
    pub feeds_path: String,

    /// DB driver（sqlite or duckdb）
    #[arg(long = "db-driver", env = "DB_DRIVER", value_enum, default_value = "duckdb")]
    pub db_driver: DbDriver,

    /// DB ファイルのパス（相対パスは cwd 基準で解決）。
    /// 未指定時は driver に応じた既定パスを使用。
    #[arg(long = "db", env = "DB_PATH")]
    pub db_path: Option<String>,

    /// バインドアドレス
    #[arg(long, env = "HOST", default_value = "127.0.0.1")]
    pub host: String,

    /// ポート番号
    #[arg(short = 'p', long, env = "PORT", default_value_t = 3000)]
    pub port: u16,

    /// フロントエンド配信元 URL（STATIC_DIR 未指定時にリバースプロキシ）
    #[arg(long = "frontend-url", env = "FRONTEND_URL", default_value = "https://cross-ts.github.io/rss-reader/")]
    pub frontend_url: String,

    /// ローカル静的配信ディレクトリ（dev/offline 用）
    #[arg(long = "static-dir", env = "STATIC_DIR")]
    pub static_dir: Option<String>,

    /// フィード巡回間隔（分）
    #[arg(long = "poll-interval", env = "POLL_INTERVAL_MINUTES", default_value_t = 15)]
    pub poll_interval_minutes: u64,
}

#[derive(Debug, Clone)]
pub struct Config {
    /// DB driver.
    pub db_driver: DbDriver,
    /// DB ファイルパス（絶対パスに解決済み）。
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
    /// CLI 引数から設定を構築する。
    /// `db_path` と `feeds_path` は **バイナリ実行時のカレントディレクトリ（cwd）基準** で
    /// 絶対パスに解決される。絶対パスが指定された場合はそのまま使用する。
    /// `frontend_url` は http/https スキームのみ許可する。
    pub fn from_cli(cli: Cli) -> Result<Self> {
        let cwd = std::env::current_dir()?;

        // FRONTEND_URL のバリデーション
        let parsed = url::Url::parse(&cli.frontend_url)
            .map_err(|e| anyhow::anyhow!("FRONTEND_URL のパースに失敗: {}: {}", cli.frontend_url, e))?;
        match parsed.scheme() {
            "http" | "https" => {}
            s => bail!("FRONTEND_URL は http/https のみ許可されています (got: {}): {}", s, cli.frontend_url),
        }

        // static_dir: 空文字列は None として扱う（env 由来で空文字列が渡る場合の互換）
        let static_dir = cli.static_dir.filter(|s| !s.is_empty());

        // DB パス: 未指定時は driver に応じた既定パスを補完
        let db_path_raw = cli.db_path.unwrap_or_else(|| {
            match cli.db_driver {
                DbDriver::Sqlite => "data/rss.sqlite".to_string(),
                DbDriver::Duckdb => "data/rss.duckdb".to_string(),
            }
        });

        Ok(Config {
            db_driver: cli.db_driver,
            db_path: resolve_path(&cwd, &db_path_raw)
                .to_string_lossy()
                .into_owned(),
            feeds_path: resolve_path(&cwd, &cli.feeds_path)
                .to_string_lossy()
                .into_owned(),
            poll_interval_minutes: cli.poll_interval_minutes,
            host: cli.host,
            port: cli.port,
            frontend_url: cli.frontend_url,
            static_dir,
        })
    }
}
