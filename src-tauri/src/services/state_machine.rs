use crate::config::StateMachineConfig;
use crate::models::agent::{AgentState, AgentStatus};
use crate::models::event::{EventType, NormalizedEvent};

/// 전이 결과
#[derive(Debug)]
pub enum TransitionResult {
    /// 상태가 변경됨
    Changed {
        prev_status: AgentStatus,
        new_status: AgentStatus,
    },
    /// 상태 변경 없음 (매트릭스에 없는 조합 or heartbeat)
    NoOp,
}

/// 이벤트를 처리하여 에이전트 상태를 전이한다 (state-machine.md §4)
pub fn on_event(
    event: &NormalizedEvent,
    state: &mut AgentState,
    config: &StateMachineConfig,
    consecutive_failures: u32,
) -> TransitionResult {
    let prev = state.status.clone();

    // last_event_ts는 항상 갱신
    state.last_event_ts = event.ts.clone();

    // Heartbeat: 타임스탬프만 갱신, 상태 불변
    if event.event_type == EventType::Heartbeat {
        return TransitionResult::NoOp;
    }

    // 전역: agent_stopped → disappearing (모든 상태에서, offline 제외)
    if event.event_type == EventType::AgentStopped && prev != AgentStatus::Offline {
        return apply_transition(state, AgentStatus::Disappearing, &event.ts, &prev);
    }

    // 전이 매트릭스 조회
    if let Some(next) = find_transition(&prev, &event.event_type, event, config, consecutive_failures) {
        // 특수 처리: walking 전 prev_status 저장
        if next == AgentStatus::Walking {
            state.prev_status = Some(prev.clone());
            state.peer_agent_id = event.target_agent_id.clone();
        }

        // thinking 텍스트 갱신
        if event.thinking_text.is_some() {
            state.thinking_text = event.thinking_text.clone();
        }

        // 작업 요약 갱신
        if let Some(tool_name) = event.payload.get("tool_name").and_then(|v| v.as_str()) {
            state.current_task = Some(tool_name.to_string());
        }

        return apply_transition(state, next, &event.ts, &prev);
    }

    // 특수: startled + startled_done (조건부 전이)
    if prev == AgentStatus::Startled && event.event_type == EventType::StartledDone {
        let next = if state.current_task.is_some() {
            AgentStatus::Working
        } else {
            AgentStatus::Idle
        };
        return apply_transition(state, next, &event.ts, &prev);
    }

    // 특수: returning + arrive_at_home (prev_status 복원)
    if prev == AgentStatus::Returning && event.event_type == EventType::ArriveAtHome {
        let next = state.prev_status.clone().unwrap_or(AgentStatus::Idle);
        state.prev_status = None;
        state.peer_agent_id = None;
        return apply_transition(state, next, &event.ts, &prev);
    }

    // no-op
    tracing::debug!(
        "transition_ignored: agent={} {:?} + {:?}",
        state.agent_id,
        prev,
        event.event_type,
    );
    TransitionResult::NoOp
}

/// 전이 매트릭스 (state-machine.md §4.1)
fn find_transition(
    current: &AgentStatus,
    event_type: &EventType,
    event: &NormalizedEvent,
    config: &StateMachineConfig,
    consecutive_failures: u32,
) -> Option<AgentStatus> {
    use AgentStatus::*;
    use EventType::*;

    match (current, event_type) {
        // === 기본 전이 ===
        (Offline, AgentStarted) => Some(Appearing),
        (Appearing, AppearDone) => Some(Idle),

        (Idle, TaskStarted) => Some(Working),
        (Idle, ToolStarted) => Some(Working),
        (Idle, MessageSent) => Some(Walking),

        (Working, ThinkingUpdated) => Some(Thinking),
        (Working, TaskCompleted) => Some(Completed),
        (Working, TaskFailed) => Some(Failed),
        (Working, ToolFailed) => Some(classify_failure(event, config, consecutive_failures)),
        (Working, ToolStarted) => Some(Working),
        (Working, ToolSucceeded) => Some(Working),
        (Working, MessageSent) => Some(Walking),

        (Thinking, ToolStarted) => Some(Working),
        (Thinking, TaskCompleted) => Some(Completed),
        (Thinking, TaskFailed) => Some(Failed),
        (Thinking, ThinkingUpdated) => Some(Thinking),

        (PendingInput, AgentUnblocked) => Some(Working),
        (PendingInput, TaskStarted) => Some(Working),

        (Failed, AgentUnblocked) => Some(Working),
        (Failed, TaskStarted) => Some(Working),

        (Completed, TaskStarted) => Some(Working),

        (Disappearing, DisappearDone) => Some(Offline),

        // === 졸기 / 깨어남 ===
        (Resting, TaskStarted) => Some(Startled),
        (Resting, MessageReceived) => Some(Startled),
        (Resting, MessageSent) => Some(Startled),

        // startled_done과 arrive_at_home은 on_event()에서 특수 처리

        // === 대화 ===
        (Walking, ArriveAtPeer) => Some(Chatting),
        (Chatting, MessageDone) => Some(Returning),

        _ => None,
    }
}

/// 치명/재시도 실패 분류 (state-machine.md §4.3)
fn classify_failure(
    event: &NormalizedEvent,
    config: &StateMachineConfig,
    consecutive_failures: u32,
) -> AgentStatus {
    let error_message = event
        .payload
        .get("error_message")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let lower_msg = error_message.to_lowercase();

    // 치명적 키워드 검사
    for keyword in &config.fatal_keywords {
        if lower_msg.contains(&keyword.to_lowercase()) {
            return AgentStatus::Failed;
        }
    }

    // 연속 실패 횟수 초과
    if consecutive_failures >= config.fatal_consecutive_failures {
        return AgentStatus::Failed;
    }

    AgentStatus::PendingInput
}

/// 상태 전이 적용
fn apply_transition(
    state: &mut AgentState,
    next_status: AgentStatus,
    ts: &str,
    prev: &AgentStatus,
) -> TransitionResult {
    let prev_clone = prev.clone();
    state.status = next_status.clone();
    state.since = ts.to_string();

    TransitionResult::Changed {
        prev_status: prev_clone,
        new_status: next_status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::TimerTransitionsConfig;
    use crate::models::agent::*;
    use crate::models::event::*;

    fn test_config() -> StateMachineConfig {
        StateMachineConfig {
            fatal_keywords: vec![
                "permission denied".into(),
                "not found".into(),
                "ENOENT".into(),
                "EACCES".into(),
            ],
            retryable_keywords: vec![
                "timeout".into(),
                "EAGAIN".into(),
                "rate limit".into(),
                "ECONNREFUSED".into(),
            ],
            fatal_consecutive_failures: 3,
            timer_transitions: TimerTransitionsConfig {
                idle_to_resting_secs: 120,
                completed_to_disappear_secs: 60,
                chat_timeout_secs: 5,
            },
        }
    }

    fn make_state(status: AgentStatus) -> AgentState {
        AgentState {
            agent_id: "test-agent".into(),
            status,
            prev_status: None,
            thinking_text: None,
            current_task: None,
            workspace_id: "test".into(),
            since: "2026-02-20T15:00:00Z".into(),
            last_event_ts: "2026-02-20T15:00:00Z".into(),
            session_id: None,
            peer_agent_id: None,
            home_x: 0.5,
        }
    }

    fn make_event(event_type: EventType) -> NormalizedEvent {
        NormalizedEvent {
            id: "evt-1".into(),
            version: "1.1".into(),
            ts: "2026-02-20T15:01:00Z".into(),
            event_type,
            source: EventSource::Hook,
            workspace_id: "test".into(),
            terminal_session_id: "term-1".into(),
            run_id: None,
            session_id: None,
            agent_id: "test-agent".into(),
            target_agent_id: None,
            task_id: None,
            severity: Severity::Info,
            payload: serde_json::json!({}),
            thinking_text: None,
            raw: serde_json::json!({}),
        }
    }

    // === 기본 라이프사이클 ===

    #[test]
    fn test_offline_to_appearing() {
        let mut state = make_state(AgentStatus::Offline);
        let event = make_event(EventType::AgentStarted);
        let result = on_event(&event, &mut state, &test_config(), 0);
        assert!(matches!(result, TransitionResult::Changed { .. }));
        assert_eq!(state.status, AgentStatus::Appearing);
    }

    #[test]
    fn test_appearing_to_idle() {
        let mut state = make_state(AgentStatus::Appearing);
        let event = make_event(EventType::AppearDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Idle);
    }

    #[test]
    fn test_idle_to_working() {
        let mut state = make_state(AgentStatus::Idle);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_working_to_thinking() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ThinkingUpdated);
        event.thinking_text = Some("hmm...".into());
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Thinking);
        assert_eq!(state.thinking_text.as_deref(), Some("hmm..."));
    }

    #[test]
    fn test_working_to_completed() {
        let mut state = make_state(AgentStatus::Working);
        let event = make_event(EventType::TaskCompleted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Completed);
    }

    #[test]
    fn test_working_to_failed_fatal_keyword() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "permission denied"});
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Failed);
    }

    #[test]
    fn test_working_to_pending_input_retryable() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "timeout occurred"});
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::PendingInput);
    }

    #[test]
    fn test_working_to_failed_consecutive() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "some unknown error"});
        on_event(&event, &mut state, &test_config(), 3);
        assert_eq!(state.status, AgentStatus::Failed);
    }

    #[test]
    fn test_working_to_pending_input_unknown() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "some unknown error"});
        on_event(&event, &mut state, &test_config(), 1);
        assert_eq!(state.status, AgentStatus::PendingInput);
    }

    #[test]
    fn test_universal_agent_stopped() {
        for status in [
            AgentStatus::Idle,
            AgentStatus::Working,
            AgentStatus::Thinking,
            AgentStatus::Resting,
            AgentStatus::Chatting,
        ] {
            let mut state = make_state(status);
            let event = make_event(EventType::AgentStopped);
            on_event(&event, &mut state, &test_config(), 0);
            assert_eq!(state.status, AgentStatus::Disappearing);
        }
    }

    #[test]
    fn test_disappearing_to_offline() {
        let mut state = make_state(AgentStatus::Disappearing);
        let event = make_event(EventType::DisappearDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Offline);
    }

    // === 졸기 / 깨어남 ===

    #[test]
    fn test_resting_task_started_startled() {
        let mut state = make_state(AgentStatus::Resting);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Startled);
    }

    #[test]
    fn test_startled_done_to_working_with_task() {
        let mut state = make_state(AgentStatus::Startled);
        state.current_task = Some("do something".into());
        let event = make_event(EventType::StartledDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_startled_done_to_idle_without_task() {
        let mut state = make_state(AgentStatus::Startled);
        state.current_task = None;
        let event = make_event(EventType::StartledDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Idle);
    }

    // === 대화 ===

    #[test]
    fn test_idle_message_sent_to_walking() {
        let mut state = make_state(AgentStatus::Idle);
        let mut event = make_event(EventType::MessageSent);
        event.target_agent_id = Some("other-agent".into());
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Walking);
        assert_eq!(state.prev_status, Some(AgentStatus::Idle));
        assert_eq!(state.peer_agent_id.as_deref(), Some("other-agent"));
    }

    #[test]
    fn test_walking_arrive_at_peer_to_chatting() {
        let mut state = make_state(AgentStatus::Walking);
        let event = make_event(EventType::ArriveAtPeer);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Chatting);
    }

    #[test]
    fn test_chatting_message_done_to_returning() {
        let mut state = make_state(AgentStatus::Chatting);
        let event = make_event(EventType::MessageDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Returning);
    }

    #[test]
    fn test_returning_arrive_home_restores_prev_status() {
        let mut state = make_state(AgentStatus::Returning);
        state.prev_status = Some(AgentStatus::Working);
        let event = make_event(EventType::ArriveAtHome);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
        assert!(state.prev_status.is_none());
        assert!(state.peer_agent_id.is_none());
    }

    // === no-op ===

    #[test]
    fn test_noop_transition() {
        let mut state = make_state(AgentStatus::Offline);
        let event = make_event(EventType::ToolStarted);
        let result = on_event(&event, &mut state, &test_config(), 0);
        assert!(matches!(result, TransitionResult::NoOp));
        assert_eq!(state.status, AgentStatus::Offline);
    }

    #[test]
    fn test_heartbeat_updates_timestamp_only() {
        let mut state = make_state(AgentStatus::Working);
        let event = make_event(EventType::Heartbeat);
        let result = on_event(&event, &mut state, &test_config(), 0);
        assert!(matches!(result, TransitionResult::NoOp));
        assert_eq!(state.status, AgentStatus::Working);
        assert_eq!(state.last_event_ts, "2026-02-20T15:01:00Z");
    }

    // === 복귀 전이 ===

    #[test]
    fn test_pending_input_to_working() {
        let mut state = make_state(AgentStatus::PendingInput);
        let event = make_event(EventType::AgentUnblocked);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_failed_to_working() {
        let mut state = make_state(AgentStatus::Failed);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_completed_to_working() {
        let mut state = make_state(AgentStatus::Completed);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_thinking_to_working() {
        let mut state = make_state(AgentStatus::Thinking);
        let event = make_event(EventType::ToolStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }
}
