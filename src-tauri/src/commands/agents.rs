use crate::config::DisplayConfig;
use crate::error::AppError;
use crate::models::agent::*;
use crate::models::event::*;
use crate::services::state_machine;
use crate::state::AppState;
use crate::storage::agents_repo::AgentsRepo;
use crate::storage::events_repo::EventsRepo;
use crate::storage::state_repo::StateRepo;
use tauri::Emitter;

/// 모든 에이전트 + 현재 상태를 반환 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn get_all_agents(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MascotAgent>, AppError> {
    let agents_repo = AgentsRepo::new(state.db.clone());
    let state_repo = StateRepo::new(state.db.clone());

    let mut agents = agents_repo.get_all()?;
    let states = state_repo.get_all()?;

    // agents에 현재 상태 덮어쓰기
    for agent in &mut agents {
        if let Some(s) = states.iter().find(|s| s.agent_id == agent.agent_id) {
            agent.status = s.status.clone();
            agent.thinking_text = s.thinking_text.clone();
            agent.current_task = s.current_task.clone();
        }
    }

    Ok(agents)
}

/// 에이전트 이력서 정보 반환 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn get_agent_resume(
    state: tauri::State<'_, AppState>,
    agent_id: String,
) -> Result<serde_json::Value, AppError> {
    let agents_repo = AgentsRepo::new(state.db.clone());
    let events_repo = EventsRepo::new(state.db.clone());
    let state_repo = StateRepo::new(state.db.clone());

    let agent = match agents_repo.get_by_id(&agent_id)? {
        Some(mut a) => {
            // 현재 상태 반영
            if let Some(s) = state_repo.get(&agent_id)? {
                a.status = s.status;
                a.thinking_text = s.thinking_text;
                a.current_task = s.current_task;
            }
            a
        }
        None => return Ok(serde_json::json!(null)),
    };

    let recent_events = events_repo.get_recent_by_agent(
        &agent_id,
        state.config.resume.recent_events_limit,
    )?;
    let total_tasks_completed = events_repo.count_completed_tasks(&agent_id)?;
    let total_tools_used = events_repo.count_tools_used(&agent_id)?;

    let resume = serde_json::json!({
        "agent": agent,
        "recent_events": recent_events,
        "total_tasks_completed": total_tasks_completed,
        "total_tools_used": total_tools_used,
        "first_seen_ts": agent.last_active_ts,
    });

    Ok(resume)
}

/// WebView에서 Spine 스켈레톤 로드 후 슬롯 개수 전달 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn set_slot_counts(
    state: tauri::State<'_, AppState>,
    slot_counts: SlotCounts,
) -> Result<(), AppError> {
    let mut counts = state
        .slot_counts
        .lock()
        .map_err(|e| AppError::LockPoisoned(e.to_string()))?;
    *counts = slot_counts.clone();
    tracing::info!("slot_counts updated: {:?}", slot_counts);
    Ok(())
}

/// WebView가 Spine 애니메이션 완료를 알림 (synthetic 이벤트)
#[tauri::command]
pub async fn notify_animation_done(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    agent_id: String,
    animation: String,
) -> Result<(), AppError> {
    let event_type = match animation.as_str() {
        "appear" => EventType::AppearDone,
        "disappear" => EventType::DisappearDone,
        "startled" => EventType::StartledDone,
        other => {
            tracing::debug!("notify_animation_done: unhandled animation '{other}' for {agent_id}");
            return Ok(());
        }
    };

    process_synthetic_event(&state, &app_handle, &agent_id, event_type).await
}

/// WebView가 캐릭터 이동 완료를 알림 (synthetic 이벤트)
#[tauri::command]
pub async fn notify_movement_done(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    agent_id: String,
    movement_type: String,
) -> Result<(), AppError> {
    let event_type = match movement_type.as_str() {
        "arrive_at_peer" => EventType::ArriveAtPeer,
        "arrive_at_home" => EventType::ArriveAtHome,
        other => {
            tracing::debug!("notify_movement_done: unhandled type '{other}' for {agent_id}");
            return Ok(());
        }
    };

    process_synthetic_event(&state, &app_handle, &agent_id, event_type).await
}

/// WebView가 대화 말풍선 표시 완료를 알림
#[tauri::command]
pub async fn notify_chat_done(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    agent_id: String,
) -> Result<(), AppError> {
    process_synthetic_event(&state, &app_handle, &agent_id, EventType::MessageDone).await
}

/// 화면 배치 설정 반환 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn get_display_config(
    state: tauri::State<'_, AppState>,
) -> Result<DisplayConfig, AppError> {
    Ok(state.config.display.clone())
}

/// synthetic 이벤트를 처리하여 상태 전이 + emit 수행
async fn process_synthetic_event(
    state: &AppState,
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    event_type: EventType,
) -> Result<(), AppError> {
    let state_repo = StateRepo::new(state.db.clone());

    let mut agent_state = match state_repo.get(agent_id)? {
        Some(s) => s,
        None => {
            tracing::warn!("synthetic event for unknown agent: {agent_id}");
            return Ok(());
        }
    };

    let ts = chrono::Utc::now().to_rfc3339();
    let synthetic_event = NormalizedEvent {
        id: format!("syn_{}", chrono::Utc::now().format("%Y%m%d%H%M%S%f")),
        version: "1.1".to_string(),
        ts: ts.clone(),
        event_type,
        source: EventSource::Synthetic,
        workspace_id: agent_state.workspace_id.clone(),
        terminal_session_id: "webview".to_string(),
        run_id: None,
        session_id: agent_state.session_id.clone(),
        agent_id: agent_id.to_string(),
        target_agent_id: None,
        task_id: None,
        severity: Severity::Debug,
        payload: serde_json::json!({}),
        thinking_text: None,
        raw: serde_json::json!({}),
    };

    let result = state_machine::on_event(
        &synthetic_event,
        &mut agent_state,
        &state.config.state_machine,
        0,
    );

    state_repo.upsert(&agent_state)?;

    if let state_machine::TransitionResult::Changed { prev_status, new_status } = result {
        // 퇴장 완료 (disappear_done -> offline)
        if new_status == AgentStatus::Offline {
            let payload = serde_json::json!({
                "agent_id": agent_id,
                "ts": ts,
            });
            if let Err(e) = app_handle.emit("mascot://agent-departed", &payload) {
                tracing::error!("process_synthetic_event: emit agent-departed failed: {e}");
            }
        } else {
            let payload = serde_json::json!({
                "agent_id": agent_id,
                "status": new_status,
                "prev_status": prev_status,
                "thinking_text": agent_state.thinking_text,
                "current_task": agent_state.current_task,
                "workspace_id": agent_state.workspace_id,
                "peer_agent_id": agent_state.peer_agent_id,
                "chat_message": serde_json::Value::Null,
                "ts": ts,
            });
            if let Err(e) = app_handle.emit("mascot://agent-update", &payload) {
                tracing::error!("process_synthetic_event: emit agent-update failed: {e}");
            }
        }
    }

    Ok(())
}
