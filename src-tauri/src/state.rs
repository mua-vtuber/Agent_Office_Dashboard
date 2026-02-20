use crate::config::AppConfig;
use crate::models::agent::SlotCounts;
use crate::storage::db::DbPool;
use std::sync::{Arc, Mutex};

/// 앱 전역 공유 상태.
/// Tauri managed state + axum 라우터 양쪽에서 사용한다.
#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub config: Arc<AppConfig>,
    pub slot_counts: Arc<Mutex<SlotCounts>>,
}
