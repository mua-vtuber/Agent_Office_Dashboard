use crate::config::ServerConfig;
use crate::error::AppError;
use crate::http::ingest::ingest_handler;
use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;

async fn health_handler() -> &'static str {
    "ok"
}

/// axum 라우터의 공유 상태. AppState + Tauri AppHandle.
#[derive(Clone)]
pub struct IngestState {
    pub app_state: AppState,
    pub app_handle: tauri::AppHandle,
}

pub fn create_router(state: IngestState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/ingest", post(ingest_handler))
        .with_state(state)
}

/// axum HTTP 서버를 시작한다. Tauri의 tokio runtime에서 spawn한다.
pub async fn start_http_server(
    config: &ServerConfig,
    app_state: AppState,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e: std::net::AddrParseError| AppError::HttpServer(e.to_string()))?;

    let ingest_state = IngestState {
        app_state,
        app_handle,
    };
    let router = create_router(ingest_state);

    tracing::info!("HTTP server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| AppError::HttpServer(e.to_string()))?;

    axum::serve(listener, router)
        .await
        .map_err(|e| AppError::HttpServer(e.to_string()))?;

    Ok(())
}
