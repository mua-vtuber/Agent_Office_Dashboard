mod commands;
mod config;
mod error;
mod http;
mod models;
mod services;
mod state;
mod storage;
mod tray;

pub use config::AppConfig;
pub use error::{AppError, ConfigError};
pub use state::AppState;

use models::agent::SlotCounts;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .setup(|app| {
            // 1. config.toml 로드
            let config_path = app
                .path()
                .resource_dir()
                .map(|d| d.join("config.toml"))
                .unwrap_or_else(|e| {
                    tracing::warn!("resource_dir() failed ({e}), falling back to ./config.toml");
                    std::path::PathBuf::from("config.toml")
                });

            let config = AppConfig::load(&config_path).map_err(|e| {
                eprintln!("Config load failed: {e}");
                e.to_string()
            })?;

            // 2. SQLite 초기화
            let db_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir() failed: {e}"))?;
            std::fs::create_dir_all(&db_dir)
                .map_err(|e| format!("failed to create data dir: {e}"))?;
            let db_path = db_dir.join("mascot.db");
            let db = storage::db::init_db(&db_path)
                .map_err(|e| format!("DB init failed: {e}"))?;

            // 3. AppState 생성 + managed state 등록
            let app_state = AppState {
                db: db.clone(),
                config: Arc::new(config.clone()),
                slot_counts: Arc::new(Mutex::new(SlotCounts::default())),
            };
            app.manage(app_state.clone());

            // 4. HTTP 서버 시작 (AppState + AppHandle 전달)
            let server_config = config.server.clone();
            let server_state = app_state.clone();
            let server_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http::server::start_http_server(
                    &server_config,
                    server_state,
                    server_handle,
                )
                .await
                {
                    tracing::error!("HTTP server error: {e}");
                }
            });

            // 5. Heartbeat 서비스 시작
            let heartbeat_state = app_state.clone();
            let heartbeat_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                services::heartbeat::run_heartbeat(heartbeat_state, heartbeat_handle).await;
            });

            // 6. 시스템 트레이
            tray::setup_tray(app).map_err(|e| e.to_string())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agents::get_all_agents,
            commands::agents::get_agent_resume,
            commands::agents::set_slot_counts,
            commands::agents::notify_animation_done,
            commands::agents::notify_movement_done,
            commands::agents::notify_chat_done,
            commands::agents::get_display_config,
            commands::window::toggle_click_through,
        ])
        .run(tauri::generate_context!())
        .expect("Fatal: failed to start tauri application");
}
