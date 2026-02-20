mod commands;
mod config;
mod error;
mod http;
mod models;
mod services;
mod storage;
mod tray;

pub use config::AppConfig;
pub use error::{AppError, ConfigError};

use tauri::Manager;

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .setup(|app| {
            // config.toml 로드
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

            // HTTP 서버를 백그라운드 태스크로 시작
            let server_config = config.server.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http::server::start_http_server(&server_config).await {
                    // TODO: replace with user-visible error (emit to WebView or native dialog)
                    tracing::error!("HTTP server error: {e}");
                }
            });

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
