mod config;
mod db;
mod feeds;
mod fetcher;
mod poller;
mod routes;
mod tokenize;

use anyhow::{bail, Result};
use axum::{
    extract::{Request, State},
    response::{IntoResponse, Response},
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

use futures_util::StreamExt;

use clap::Parser;

use crate::config::{Cli, Config};
use crate::db::DbConn;

/// プロキシ応答ボディの最大サイズ（50 MB）。
const MAX_PROXY_BYTES: usize = 50 * 1024 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub db: DbConn,
    pub config: Arc<Config>,
    pub client: Client,
    /// feeds.opml の read-modify-write を直列化するためのミューテックス。
    pub feeds_lock: Arc<tokio::sync::Mutex<()>>,
    /// フロント配信のリバースプロキシ用クライアント（リダイレクト追従）。
    pub proxy_client: Client,
}

#[tokio::main]
async fn main() -> Result<()> {
    // .env を clap の env フォールバックより先に読み込む
    let _ = dotenvy::dotenv();

    // CLI 引数をパース（優先順位: CLI 引数 > 環境変数 > 既定値）
    let cli = Cli::parse();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rss_reader=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_cli(cli)?;

    // config.db_path / config.feeds_path は from_env() で cwd 基準の絶対パスに解決済み。
    let bind_addr = format!("{}:{}", config.host, config.port);

    tracing::info!("Starting rss-reader");
    tracing::info!("  bind     = {}", bind_addr);
    tracing::info!("  db       = {}", config.db_path);
    tracing::info!("  feeds    = {}", config.feeds_path);
    match &config.static_dir {
        Some(dir) => tracing::info!("  frontend = static dir {}", dir),
        None => tracing::info!("  frontend = reverse-proxy {}", config.frontend_url),
    }

    // DB の親ディレクトリ作成は db::open 内で行われる（create_dir_all）。
    let db = db::open(&config.db_path)?;

    // feeds.opml フェイルセーフ起動
    {
        let feeds_path = config.feeds_path.clone();
        let db_clone = db.clone();
        match feeds::read_feeds_opml(&feeds_path)? {
            Some(subs) => {
                tracing::info!(
                    "feeds.opml found: {} folders, {} feeds — reconciling",
                    subs.folders.len(),
                    subs.feeds.len()
                );
                let subs_clone = subs.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = db_clone.lock().unwrap();
                    feeds::reconcile_subscriptions(&conn, &subs_clone)
                })
                .await??;
            }
            None => {
                let db_clone2 = db.clone();
                let feed_count: i64 = tokio::task::spawn_blocking(move || {
                    let conn = db_clone2.lock().unwrap();
                    conn.query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))
                        .map_err(|e| anyhow::anyhow!(e))
                })
                .await??;

                if feed_count > 0 {
                    bail!(
                        "feeds.opml が見つかりません（パス: {}）が、DB には {} 件の購読があります。\
                        CWD またはファイル権限を確認してください。誤って全削除しないよう起動を中止します。",
                        feeds_path,
                        feed_count
                    );
                }

                tracing::info!(
                    "feeds.opml 不在・DB 購読0件 → 空の feeds.opml を自動生成: {}",
                    feeds_path
                );
                let empty = feeds::Subscriptions::default();
                feeds::save_opml(&feeds_path, &empty)?;
                tokio::task::spawn_blocking(move || {
                    let conn = db_clone.lock().unwrap();
                    feeds::reconcile_subscriptions(&conn, &empty)
                })
                .await??;
            }
        }
    }

    // フィード取得用クライアント（timeout付き、自動リダイレクト無効＝SSRF手動検証のため）
    let client = Client::builder()
        .user_agent("rss-reader/0.1")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;

    // フロント配信プロキシ用クライアント（リダイレクト追従）
    let proxy_client = Client::builder()
        .user_agent("rss-reader/0.1")
        .timeout(Duration::from_secs(15))
        .build()?;

    let config_arc = Arc::new(config.clone());
    let state = AppState {
        db: db.clone(),
        config: config_arc.clone(),
        client: client.clone(),
        feeds_lock: Arc::new(tokio::sync::Mutex::new(())),
        proxy_client,
    };

    poller::start_poller(db.clone(), client.clone(), config.poll_interval_minutes).await;

    let api_router = Router::new()
        .route("/folders", get(routes::folders::list_folders))
        .route("/folders", post(routes::folders::create_folder))
        .route("/folders/{id}", put(routes::folders::update_folder))
        .route("/folders/{id}", delete(routes::folders::delete_folder))
        .route("/feeds", get(routes::feeds::list_feeds))
        .route("/feeds", post(routes::feeds::create_feed))
        .route("/feeds/discover", post(routes::feeds::discover_feed))
        .route("/feeds/{id}", put(routes::feeds::update_feed))
        .route("/feeds/{id}", delete(routes::feeds::delete_feed))
        .route("/articles", get(routes::articles::list_articles))
        .route("/refresh", post(routes::refresh::refresh));

    // フロント配信: STATIC_DIR ありはローカル配信、なしは FRONTEND_URL へリバースプロキシ
    let app = if let Some(static_dir) = config.static_dir.clone() {
        let static_service = ServeDir::new(&static_dir)
            .not_found_service(ServeFile::new(format!("{static_dir}/index.html")));
        Router::new()
            .nest("/api", api_router)
            .fallback_service(static_service)
            .with_state(state)
            .layer(CorsLayer::permissive())
            .layer(TraceLayer::new_for_http())
    } else {
        Router::new()
            .nest("/api", api_router)
            .fallback(proxy_handler)
            .with_state(state)
            .layer(CorsLayer::permissive())
            .layer(TraceLayer::new_for_http())
    };

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("Listening on http://{}", bind_addr);

    axum::serve(listener, app).await?;
    Ok(())
}

/// 非 /api リクエストを FRONTEND_URL へリバースプロキシする（DuckDB UI 方式）。
/// 拡張子の無いパスは SPA とみなし index.html にフォールバック。
/// アセットらしいパス（拡張子あり）で上流が 404 を返した場合はその 404 をそのまま伝播する。
async fn proxy_handler(State(state): State<AppState>, req: Request) -> Response {
    let path = req.uri().path().to_string();
    let query = req.uri().query().map(|q| q.to_string());
    let base = state.config.frontend_url.trim_end_matches('/').to_string();

    let mut target = format!("{}{}", base, path);
    if let Some(q) = &query {
        target.push('?');
        target.push_str(q);
    }

    // アセットらしいパスかどうかを先に判定する
    let looks_like_asset = path
        .rsplit('/')
        .next()
        .map(|seg| seg.contains('.'))
        .unwrap_or(false);

    let upstream = proxy_fetch(&state.proxy_client, &target).await;

    if let Some(ref parts) = upstream {
        if parts.0 != reqwest::StatusCode::NOT_FOUND {
            // 上流が 404 以外（成功・リダイレクト等）はそのまま返す
            return build_response(upstream.unwrap());
        }
        if looks_like_asset {
            // アセットパスで上流が 404 → 502 にせずそのまま 404 を伝播する
            return build_response(upstream.unwrap());
        }
    }

    // SPA フォールバック（拡張子の無いパスのみ index.html）
    if !looks_like_asset {
        let index_url = format!("{}/", base);
        // path == "/" のとき target と index_url が同一 URL になるため再 fetch しない。
        // 最初の proxy_fetch で既に試行済みのため、二重 fetch を避けて BAD_GATEWAY へフォールスルー。
        if index_url != target {
            if let Some(parts) = proxy_fetch(&state.proxy_client, &index_url).await {
                return build_response(parts);
            }
        }
    }

    (
        axum::http::StatusCode::BAD_GATEWAY,
        "frontend を取得できませんでした",
    )
        .into_response()
}

async fn proxy_fetch(
    client: &Client,
    url: &str,
) -> Option<(reqwest::StatusCode, Option<String>, bytes::Bytes)> {
    let resp = client.get(url).send().await.ok()?;
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Content-Length が既知なら事前チェック
    if let Some(content_length) = resp.content_length() {
        if content_length as usize > MAX_PROXY_BYTES {
            tracing::warn!(
                "proxy_fetch: Content-Length ({} bytes) が上限 {} bytes を超えています: {}",
                content_length,
                MAX_PROXY_BYTES,
                url
            );
            return None;
        }
    }

    // ストリーミングで読み込み、上限を超えたら打ち切る
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::with_capacity(MAX_PROXY_BYTES.min(1024 * 64));

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(_) => return None,
        };
        if buf.len() + chunk.len() > MAX_PROXY_BYTES {
            tracing::warn!(
                "proxy_fetch: レスポンスボディが上限 {} bytes を超えました: {}",
                MAX_PROXY_BYTES,
                url
            );
            return None;
        }
        buf.extend_from_slice(&chunk);
    }

    Some((status, content_type, bytes::Bytes::from(buf)))
}

fn build_response(parts: (reqwest::StatusCode, Option<String>, bytes::Bytes)) -> Response {
    let (status, content_type, body) = parts;
    let mut builder = axum::response::Response::builder().status(
        axum::http::StatusCode::from_u16(status.as_u16())
            .unwrap_or(axum::http::StatusCode::OK),
    );
    if let Some(ct) = content_type {
        builder = builder.header(axum::http::header::CONTENT_TYPE, ct);
    }
    builder
        .body(axum::body::Body::from(body))
        .unwrap_or_else(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
