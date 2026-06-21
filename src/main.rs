mod config;
mod db;
mod feeds;
mod fetcher;
mod poller;
mod routes;
mod tokenize;

use anyhow::{bail, Result};
use axum::{
    routing::{delete, get, post, put},
    Router,
};
use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::db::DbConn;

#[derive(Clone)]
pub struct AppState {
    pub db: DbConn,
    pub config: Arc<Config>,
    pub client: Client,
    /// Fix 2: feeds.yaml の read-modify-write を直列化するためのミューテックス。
    /// feed/folder の create/update/delete ハンドラはこのロックを取得してから
    /// yaml読込→変更→保存→reconcile を実行する。
    pub feeds_lock: Arc<tokio::sync::Mutex<()>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // .env読み込み
    let _ = dotenvy::dotenv();

    // トレーシング初期化
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rss_reader=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();

    // 起動時に絶対パスと host:port をログ出力
    let cwd = std::env::current_dir()?;
    let abs_db = cwd.join(&config.db_path).canonicalize().unwrap_or_else(|_| cwd.join(&config.db_path));
    let abs_feeds = {
        let p = cwd.join(&config.feeds_path);
        if p.exists() { p.canonicalize().unwrap_or(p.clone()) } else { p }
    };
    let abs_static = cwd.join("web/dist").canonicalize().unwrap_or_else(|_| cwd.join("web/dist"));
    let bind_addr = format!("{}:{}", config.host, config.port);

    tracing::info!("Starting rss-reader");
    tracing::info!("  bind   = {}", bind_addr);
    tracing::info!("  db     = {}", abs_db.display());
    tracing::info!("  feeds  = {}", abs_feeds.display());
    tracing::info!("  static = {}", abs_static.display());

    // DB初期化
    let db = db::open(&config.db_path)?;

    // feeds.yaml フェイルセーフ起動
    {
        let feeds_path = config.feeds_path.clone();
        let db_clone = db.clone();
        match feeds::read_feeds_yaml(&feeds_path)? {
            Some(yaml) => {
                tracing::info!(
                    "feeds.yaml found: {} folders, {} feeds — reconciling",
                    yaml.folders.len(),
                    yaml.feeds.len()
                );
                let yaml_clone = yaml.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = db_clone.lock().unwrap();
                    feeds::reconcile_from_yaml(&conn, &yaml_clone)
                })
                .await??;
            }
            None => {
                // feeds.yaml が不在 → DB の購読件数を確認
                let db_clone2 = db.clone();
                let feed_count: i64 = tokio::task::spawn_blocking(move || {
                    let conn = db_clone2.lock().unwrap();
                    conn.query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))
                        .map_err(|e| anyhow::anyhow!(e))
                })
                .await??;

                if feed_count > 0 {
                    bail!(
                        "feeds.yaml が見つかりません（パス: {}）が、DB には {} 件の購読があります。\
                        CWD またはファイル権限を確認してください。誤って全削除しないよう起動を中止します。",
                        abs_feeds.display(),
                        feed_count
                    );
                }

                // 0件なら空の feeds.yaml を新規作成して空 reconcile
                tracing::info!("feeds.yaml 不在・DB 購読0件 → 空の feeds.yaml を作成します");
                let empty = feeds::FeedsYaml::default();
                feeds::save_yaml(&feeds_path, &empty)?;
                tokio::task::spawn_blocking(move || {
                    let conn = db_clone.lock().unwrap();
                    feeds::reconcile_from_yaml(&conn, &empty)
                })
                .await??;
            }
        }
    }

    // HTTPクライアント（timeout付き、自動リダイレクト無効）
    // Fix 1: リダイレクト追跡は fetch_with_guard で手動実施し、各ホップで SSRF 検証を行う
    let client = Client::builder()
        .user_agent("rss-reader/0.1")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    let config_arc = Arc::new(config.clone());
    let state = AppState {
        db: db.clone(),
        config: config_arc.clone(),
        client: client.clone(),
        feeds_lock: Arc::new(tokio::sync::Mutex::new(())),
    };

    // ポーラー起動
    poller::start_poller(db.clone(), client.clone(), config.poll_interval_minutes).await;

    // APIルーター
    let api_router = Router::new()
        // folders
        .route("/folders", get(routes::folders::list_folders))
        .route("/folders", post(routes::folders::create_folder))
        .route("/folders/{id}", put(routes::folders::update_folder))
        .route("/folders/{id}", delete(routes::folders::delete_folder))
        // feeds
        .route("/feeds", get(routes::feeds::list_feeds))
        .route("/feeds", post(routes::feeds::create_feed))
        .route("/feeds/{id}", put(routes::feeds::update_feed))
        .route("/feeds/{id}", delete(routes::feeds::delete_feed))
        // articles
        .route("/articles", get(routes::articles::list_articles))
        // refresh
        .route("/refresh", post(routes::refresh::refresh))
        .with_state(state);

    // 静的配信（SPA フォールバック）
    let static_service = ServeDir::new("web/dist")
        .not_found_service(ServeFile::new("web/dist/index.html"));

    let app = Router::new()
        .nest("/api", api_router)
        .fallback_service(static_service)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("Listening on http://{}", bind_addr);

    axum::serve(listener, app).await?;
    Ok(())
}
