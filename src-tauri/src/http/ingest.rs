use axum::http::StatusCode;
use axum::Json;

/// POST /ingest -- hook payload 수신 (스텁: 수신만 하고 200 응답)
pub async fn ingest_handler(Json(payload): Json<serde_json::Value>) -> StatusCode {
    // TODO: normalizer -> state machine -> storage -> emit 파이프라인 구현
    tracing::info!("ingest received: {}", payload);
    StatusCode::OK
}
