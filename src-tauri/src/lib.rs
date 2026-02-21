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
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .setup(|app| {
            // 1. config.toml 로드
            // 프로덕션: resource_dir()에서 번들된 config.toml 사용
            // 개발 모드: resource_dir()에 파일이 없으면 src-tauri/ (CARGO_MANIFEST_DIR) 폴백
            let config_path = {
                let resource_path = app
                    .path()
                    .resource_dir()
                    .map(|d| d.join("config.toml"))
                    .unwrap_or_else(|e| {
                        tracing::warn!("resource_dir() failed ({e})");
                        std::path::PathBuf::from("config.toml")
                    });

                if resource_path.exists() {
                    resource_path
                } else {
                    // 개발 모드 폴백: Cargo.toml이 있는 src-tauri/ 디렉토리
                    let dev_path =
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("config.toml");
                    tracing::info!("Dev mode: using config at {}", dev_path.display());
                    dev_path
                }
            };

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
            let cursor_polling_active = Arc::new(AtomicBool::new(false));
            let hit_zones = Arc::new(Mutex::new(Vec::new()));

            let app_state = AppState {
                db: db.clone(),
                config: Arc::new(config.clone()),
                slot_counts: Arc::new(Mutex::new(SlotCounts::default())),
                cursor_polling_active: cursor_polling_active.clone(),
                hit_zones: hit_zones.clone(),
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

            // 6. 커서 폴링 서비스 시작
            let poll_handle = app.handle().clone();
            let poll_active = cursor_polling_active.clone();
            let poll_zones = hit_zones.clone();
            let poll_interval = config.drag.poll_interval_ms;
            let poll_padding = config.drag.hit_padding_px;
            tauri::async_runtime::spawn(async move {
                services::cursor_poll::run_cursor_poll(
                    poll_handle,
                    poll_active,
                    poll_interval,
                    poll_zones,
                    poll_padding,
                )
                .await;
            });

            // 7. 창 설정 — 전체 화면 크기 + 클릭 통과
            if let Some(window) = app.get_webview_window("main") {
                // 모니터 크기에 맞춰 창 위치/크기 설정 (fullscreen 대신)
                if let Ok(monitor) = window.current_monitor() {
                    if let Some(monitor) = monitor {
                        let size = monitor.size();
                        let pos = monitor.position();
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(pos.x, pos.y),
                        ));
                        let _ = window.set_size(tauri::Size::Physical(
                            tauri::PhysicalSize::new(size.width, size.height),
                        ));
                    }
                }

                // 클릭 통과 활성화 — WebView 로드 전에도 데스크톱 조작 가능하도록
                if let Err(e) = window.set_ignore_cursor_events(true) {
                    tracing::warn!("Failed to set initial click-through: {e}");
                }
            }

            // 8. 시스템 트레이
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
            commands::agents::notify_drag_drop,
            commands::window::toggle_click_through,
            commands::window::get_cursor_pos,
            commands::window::set_cursor_polling,
            commands::window::set_hit_zones,
        ])
        .run(tauri::generate_context!())
        .expect("Fatal: failed to start tauri application");
}
