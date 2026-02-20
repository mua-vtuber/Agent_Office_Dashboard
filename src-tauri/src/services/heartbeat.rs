use crate::state::AppState;

/// Heartbeat 서비스 메인 루프. Task 7에서 본격 구현.
pub async fn run_heartbeat(_state: AppState, _app_handle: tauri::AppHandle) {
    tracing::info!("heartbeat service started (stub)");
    // TODO: Task 7에서 tokio::time::interval 루프 구현
    std::future::pending::<()>().await;
}
