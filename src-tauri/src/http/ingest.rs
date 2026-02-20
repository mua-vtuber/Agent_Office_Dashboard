use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use crate::http::server::IngestState;
use crate::models::agent::*;
use crate::models::event::*;
use crate::services::{appearance, normalizer, state_machine};
use crate::storage::agents_repo::AgentsRepo;
use crate::storage::events_repo::EventsRepo;
use crate::storage::state_repo::StateRepo;
use tauri::Emitter;

/// POST /ingest -- hook payload 수신 -> 10단계 파이프라인 (hooks-integration.md SS5.3)
pub async fn ingest_handler(
    State(ingest): State<IngestState>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    // Step 1: JSON 파싱은 axum이 처리 (실패 시 400 자동 반환)

    // Step 2: 정규화
    let event = match normalizer::normalize(&payload) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("ingest: normalization failed: {e}");
            return (StatusCode::BAD_REQUEST, format!("normalization failed: {e}"));
        }
    };

    let state = &ingest.app_state;
    let app_handle = &ingest.app_handle;

    // Step 3: 핑거프린트 중복 검사
    let tool_name = event.payload
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let fingerprint = normalizer::generate_fingerprint(
        event.session_id.as_deref().unwrap_or(""),
        tool_name,
        &event.ts,
        &event.payload,
    );

    let events_repo = EventsRepo::new(state.db.clone());

    // Step 4: events 테이블에 INSERT (중복이면 skip)
    match events_repo.insert(&event, &fingerprint) {
        Ok(false) => {
            tracing::debug!("ingest: duplicate event (fingerprint={})", fingerprint);
            return (StatusCode::OK, "duplicate, skipped".to_string());
        }
        Ok(true) => {}
        Err(e) => {
            tracing::error!("ingest: event insert failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("storage error: {e}"));
        }
    }

    // Step 5: 에이전트 미등록 시 자동 등록
    let agents_repo = AgentsRepo::new(state.db.clone());
    let state_repo = StateRepo::new(state.db.clone());
    let is_new_agent = ensure_agent_registered(
        &agents_repo,
        &state_repo,
        &event,
        state,
    );

    // Step 6: 상태 전이
    let mut agent_state = match state_repo.get(&event.agent_id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            // 방금 등록된 에이전트의 초기 상태
            AgentState {
                agent_id: event.agent_id.clone(),
                status: AgentStatus::Offline,
                prev_status: None,
                thinking_text: None,
                current_task: None,
                workspace_id: event.workspace_id.clone(),
                since: event.ts.clone(),
                last_event_ts: event.ts.clone(),
                session_id: event.session_id.clone(),
                peer_agent_id: None,
                home_x: 0.0,
            }
        }
        Err(e) => {
            tracing::error!("ingest: state get failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("state error: {e}"));
        }
    };

    let transition_result = state_machine::on_event(
        &event,
        &mut agent_state,
        &state.config.state_machine,
        0, // TODO: consecutive failures 추적은 Phase 4에서 구현
    );

    // Step 7: agent_state 테이블 UPDATE
    if let Err(e) = state_repo.upsert(&agent_state) {
        tracing::error!("ingest: state upsert failed: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("state error: {e}"));
    }

    // Step 8 & 9: Tauri 이벤트 emit
    match transition_result {
        state_machine::TransitionResult::Changed { prev_status, new_status } => {
            // 새 에이전트 등장
            if is_new_agent || (prev_status == AgentStatus::Offline && new_status == AgentStatus::Appearing) {
                let slot_counts = state.slot_counts.lock()
                    .map(|s| s.clone())
                    .unwrap_or_default();
                let appearance = appearance::generate_appearance(
                    &event.agent_id,
                    &slot_counts,
                    &state.config.appearance,
                );

                let appeared_payload = serde_json::json!({
                    "agent_id": event.agent_id,
                    "display_name": event.agent_id.split('/').last().unwrap_or(&event.agent_id),
                    "role": "worker",
                    "employment_type": "contractor",
                    "workspace_id": event.workspace_id,
                    "status": new_status,
                    "appearance": appearance,
                    "ts": event.ts,
                });

                if let Err(e) = app_handle.emit("mascot://agent-appeared", &appeared_payload) {
                    tracing::error!("ingest: emit agent-appeared failed: {e}");
                }
            }

            // 퇴장
            if new_status == AgentStatus::Offline {
                let departed_payload = serde_json::json!({
                    "agent_id": event.agent_id,
                    "ts": event.ts,
                });
                if let Err(e) = app_handle.emit("mascot://agent-departed", &departed_payload) {
                    tracing::error!("ingest: emit agent-departed failed: {e}");
                }
            } else {
                // 상태 변경
                let update_payload = serde_json::json!({
                    "agent_id": event.agent_id,
                    "status": new_status,
                    "prev_status": prev_status,
                    "thinking_text": agent_state.thinking_text,
                    "current_task": agent_state.current_task,
                    "workspace_id": event.workspace_id,
                    "peer_agent_id": agent_state.peer_agent_id,
                    "chat_message": extract_chat_message(&event),
                    "ts": event.ts,
                });
                if let Err(e) = app_handle.emit("mascot://agent-update", &update_payload) {
                    tracing::error!("ingest: emit agent-update failed: {e}");
                }
            }
        }
        state_machine::TransitionResult::NoOp => {
            // 상태 변경 없음, emit 불필요
        }
    }

    // Step 10: 200 응답
    (StatusCode::OK, "ok".to_string())
}

/// 에이전트 미등록 시 자동 등록. 등록했으면 true 반환.
fn ensure_agent_registered(
    agents_repo: &AgentsRepo,
    state_repo: &StateRepo,
    event: &NormalizedEvent,
    state: &crate::state::AppState,
) -> bool {
    match agents_repo.get_by_id(&event.agent_id) {
        Ok(Some(_)) => false,
        Ok(None) => {
            // 신규 에이전트 등록
            let slot_counts = state.slot_counts.lock()
                .map(|s| s.clone())
                .unwrap_or_default();
            let appearance = appearance::generate_appearance(
                &event.agent_id,
                &slot_counts,
                &state.config.appearance,
            );

            let display_name = event.agent_id
                .split('/')
                .last()
                .unwrap_or(&event.agent_id)
                .to_string();

            let agent = MascotAgent {
                agent_id: event.agent_id.clone(),
                display_name,
                role: AgentRole::Worker,
                employment_type: EmploymentType::Contractor,
                workspace_id: event.workspace_id.clone(),
                status: AgentStatus::Offline,
                thinking_text: None,
                current_task: None,
                appearance,
                last_active_ts: event.ts.clone(),
            };

            if let Err(e) = agents_repo.upsert(&agent) {
                tracing::error!("ingest: agent upsert failed: {e}");
                return false;
            }

            // 초기 상태 저장
            let initial_state = AgentState {
                agent_id: event.agent_id.clone(),
                status: AgentStatus::Offline,
                prev_status: None,
                thinking_text: None,
                current_task: None,
                workspace_id: event.workspace_id.clone(),
                since: event.ts.clone(),
                last_event_ts: event.ts.clone(),
                session_id: event.session_id.clone(),
                peer_agent_id: None,
                home_x: 0.0,
            };

            if let Err(e) = state_repo.upsert(&initial_state) {
                tracing::error!("ingest: initial state upsert failed: {e}");
            }

            tracing::info!("ingest: registered new agent: {}", event.agent_id);
            true
        }
        Err(e) => {
            tracing::error!("ingest: agent lookup failed: {e}");
            false
        }
    }
}

/// chatting 상태에서 대화 메시지 추출
fn extract_chat_message(event: &NormalizedEvent) -> Option<String> {
    event.payload
        .get("message")
        .and_then(|v| v.as_str())
        .map(String::from)
}
