mod config;
mod error;
mod http;
mod models;
mod storage;

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
                .unwrap_or_else(|_| std::path::PathBuf::from("config.toml"));

            let config = AppConfig::load(&config_path).map_err(|e| {
                eprintln!("Config load failed: {e}");
                e.to_string()
            })?;

            // HTTP 서버를 백그라운드 태스크로 시작
            let server_config = config.server.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http::server::start_http_server(&server_config).await {
                    eprintln!("HTTP server error: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Fatal: failed to start tauri application");
}
