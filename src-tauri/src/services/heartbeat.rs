use crate::state::AppState;
use crate::models::agent::AgentStatus;
use crate::storage::state_repo::StateRepo;
use tauri::Emitter;

/// Heartbeat 서비스 메인 루프 (state-machine.md §5)
/// config.heartbeat.interval_secs 간격으로 에이전트 상태를 검사하여 타이머 전이 수행.
pub async fn run_heartbeat(state: AppState, app_handle: tauri::AppHandle) {
    let interval_secs = state.config.heartbeat.interval_secs;
    let timer_config = &state.config.state_machine.timer_transitions;

    let idle_to_resting = timer_config.idle_to_resting_secs;
    let completed_to_disappear = timer_config.completed_to_disappear_secs;
    let chat_timeout = timer_config.chat_timeout_secs;

    tracing::info!(
        "heartbeat service started (interval={}s, idle→rest={}s, completed→disappear={}s, chat_timeout={}s)",
        interval_secs, idle_to_resting, completed_to_disappear, chat_timeout,
    );

    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(interval_secs));

    loop {
        interval.tick().await;

        let now = chrono::Utc::now();
        let state_repo = StateRepo::new(state.db.clone());

        let agents = match state_repo.get_all() {
            Ok(agents) => agents,
            Err(e) => {
                tracing::error!("heartbeat: failed to get agent states: {e}");
                continue;
            }
        };

        for mut agent in agents {
            let elapsed_secs = match parse_elapsed_secs(&agent.since, &now) {
                Some(secs) => secs,
                None => {
                    tracing::warn!(
                        "heartbeat: failed to parse since={} for agent={}",
                        agent.since, agent.agent_id,
                    );
                    continue;
                }
            };

            let (should_transition, new_status) = match agent.status {
                AgentStatus::Idle if elapsed_secs >= idle_to_resting => {
                    (true, AgentStatus::Resting)
                }
                AgentStatus::Completed if elapsed_secs >= completed_to_disappear => {
                    (true, AgentStatus::Disappearing)
                }
                AgentStatus::Chatting if elapsed_secs >= chat_timeout => {
                    (true, AgentStatus::Returning)
                }
                _ => (false, agent.status.clone()),
            };

            if should_transition {
                let prev_status = agent.status.clone();
                let ts = now.to_rfc3339();

                agent.status = new_status.clone();
                agent.since = ts.clone();
                agent.last_event_ts = ts.clone();

                if let Err(e) = state_repo.upsert(&agent) {
                    tracing::error!(
                        "heartbeat: failed to update state for agent={}: {e}",
                        agent.agent_id,
                    );
                    continue;
                }

                tracing::info!(
                    "heartbeat: timer transition agent={} {:?} → {:?}",
                    agent.agent_id, prev_status, new_status,
                );

                // Tauri 이벤트 emit (ipc-protocol.md §2.2)
                let update_payload = serde_json::json!({
                    "agent_id": agent.agent_id,
                    "status": new_status,
                    "prev_status": prev_status,
                    "thinking_text": agent.thinking_text,
                    "current_task": agent.current_task,
                    "workspace_id": agent.workspace_id,
                    "peer_agent_id": agent.peer_agent_id,
                    "chat_message": null,
                    "ts": agent.since,
                });

                if let Err(e) = app_handle.emit("mascot://agent-update", &update_payload) {
                    tracing::error!("heartbeat: failed to emit agent-update: {e}");
                }
            }
        }
    }
}

/// ISO-8601 타임스탬프에서 현재까지 경과 초 계산
fn parse_elapsed_secs(since: &str, now: &chrono::DateTime<chrono::Utc>) -> Option<u64> {
    let since_dt = chrono::DateTime::parse_from_rfc3339(since).ok()?;
    let duration = *now - since_dt.with_timezone(&chrono::Utc);
    Some(duration.num_seconds().max(0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_elapsed_secs() {
        let now = chrono::Utc::now();
        let since = (now - chrono::Duration::seconds(120)).to_rfc3339();
        let elapsed = parse_elapsed_secs(&since, &now).expect("should parse");
        assert!(elapsed >= 119 && elapsed <= 121, "elapsed={elapsed}");
    }

    #[test]
    fn test_parse_elapsed_secs_invalid() {
        let now = chrono::Utc::now();
        assert!(parse_elapsed_secs("not-a-date", &now).is_none());
    }

    #[test]
    fn test_parse_elapsed_secs_future() {
        let now = chrono::Utc::now();
        let future = (now + chrono::Duration::seconds(60)).to_rfc3339();
        let elapsed = parse_elapsed_secs(&future, &now).expect("should parse");
        assert_eq!(elapsed, 0, "future timestamp should clamp to 0");
    }
}
