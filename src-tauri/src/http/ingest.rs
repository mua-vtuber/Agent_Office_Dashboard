use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

use crate::http::server::IngestState;

/// POST /ingest -- hook payload 수신 (스텁: 수신만 하고 200 응답)
pub async fn ingest_handler(
    State(_state): State<IngestState>,
    Json(payload): Json<serde_json::Value>,
) -> StatusCode {
    // TODO: Task 8에서 10단계 파이프라인 구현
    tracing::info!("ingest received: {}", payload);
    StatusCode::OK
}
