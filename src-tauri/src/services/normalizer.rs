use crate::error::AppError;
use crate::models::event::*;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};

static EVENT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 전역 고유 이벤트 ID 생성
fn generate_event_id() -> String {
    let ts = chrono::Utc::now().format("%Y%m%d%H%M%S");
    let seq = EVENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("evt_{ts}_{seq:06}")
}

/// 핑거프린트 생성 (hooks-integration.md §7.6)
/// fingerprint = hash(session_id + tool_name + ts_bucket + payload_hash)
pub fn generate_fingerprint(
    session_id: &str,
    tool_name: &str,
    ts: &str,
    payload: &serde_json::Value,
) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    session_id.hash(&mut hasher);
    tool_name.hash(&mut hasher);
    // ts_bucket: 1초 단위 절삭 (최소 19자: "2026-02-20T15:00:00")
    let ts_bucket = if ts.len() >= 19 { &ts[..19] } else { ts };
    ts_bucket.hash(&mut hasher);
    let payload_str = payload.to_string();
    payload_str.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// agent_id 도출 (hooks-integration.md §7.3)
pub fn derive_agent_id(
    team_name: Option<&str>,
    agent_name: Option<&str>,
    session_id: Option<&str>,
) -> String {
    match (team_name, agent_name) {
        (Some(team), Some(name)) => format!("{team}/{name}"),
        (Some(team), None) => format!("{team}/leader"),
        (None, Some(name)) => name.to_string(),
        (None, None) => session_id.unwrap_or("unknown").to_string(),
    }
}

/// hook payload → NormalizedEvent 변환 (hooks-integration.md §5.3~§7)
pub fn normalize(raw: &serde_json::Value) -> Result<NormalizedEvent, AppError> {
    let hook_type = raw
        .get("hook_type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Normalize("missing hook_type field".into()))?;

    let meta = raw.get("_meta").cloned().unwrap_or_else(|| serde_json::json!({}));
    let workspace_id = meta
        .get("workspace_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let terminal_session_id = meta
        .get("terminal_session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let ts = meta
        .get("collected_at")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let session_id = raw.get("session_id").and_then(|v| v.as_str());
    let team_name = raw.get("team_name").and_then(|v| v.as_str());
    let agent_name = raw.get("agent_name").and_then(|v| v.as_str());

    let agent_id = derive_agent_id(team_name, agent_name, session_id);

    let (event_type, severity, payload, target_agent_id, task_id) =
        map_hook_type(hook_type, raw)?;

    let _tool_name = raw
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let _fingerprint_payload = raw.get("tool_input").unwrap_or(&serde_json::json!({}));

    Ok(NormalizedEvent {
        id: generate_event_id(),
        version: "1.1".to_string(),
        ts,
        event_type,
        source: EventSource::Hook,
        workspace_id: workspace_id.to_string(),
        terminal_session_id: terminal_session_id.to_string(),
        run_id: raw.get("run_id").and_then(|v| v.as_str()).map(String::from),
        session_id: session_id.map(String::from),
        agent_id,
        target_agent_id,
        task_id,
        severity,
        payload,
        thinking_text: extract_thinking(raw),
        raw: raw.clone(),
    })
}

/// hook_type → (EventType, Severity, payload, target_agent_id, task_id) 매핑
fn map_hook_type(
    hook_type: &str,
    raw: &serde_json::Value,
) -> Result<(EventType, Severity, serde_json::Value, Option<String>, Option<String>), AppError> {
    match hook_type {
        "SubagentStart" => Ok((
            EventType::AgentStarted,
            Severity::Info,
            serde_json::json!({
                "agent_type": raw.get("agent_type").and_then(|v| v.as_str()).unwrap_or(""),
                "prompt_preview": raw.get("prompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.chars().take(200).collect::<String>())
                    .unwrap_or_default(),
            }),
            None,
            None,
        )),
        "SubagentStop" => Ok((
            EventType::AgentStopped,
            Severity::Info,
            serde_json::json!({
                "result": raw.get("result").and_then(|v| v.as_str()).unwrap_or(""),
            }),
            None,
            None,
        )),
        "Stop" => Ok((
            EventType::AgentStopped,
            Severity::Info,
            serde_json::json!({
                "reason": raw.get("reason").and_then(|v| v.as_str()).unwrap_or(""),
                "summary": raw.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
            }),
            None,
            None,
        )),
        "PreToolUse" => normalize_pre_tool_use(raw),
        "PostToolUse" => normalize_post_tool_use(raw),
        "Notification" => Ok((
            EventType::Notification,
            match raw.get("level").and_then(|v| v.as_str()) {
                Some("error") => Severity::Error,
                Some("warn") => Severity::Warn,
                Some("debug") => Severity::Debug,
                _ => Severity::Info,
            },
            serde_json::json!({
                "message": raw.get("message").and_then(|v| v.as_str()).unwrap_or(""),
            }),
            None,
            None,
        )),
        other => Err(AppError::Normalize(format!("unknown hook_type: {other}"))),
    }
}

/// PreToolUse 시맨틱 추출 (hooks-integration.md §6.1)
fn normalize_pre_tool_use(
    raw: &serde_json::Value,
) -> Result<(EventType, Severity, serde_json::Value, Option<String>, Option<String>), AppError> {
    let tool_name = raw
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tool_input = raw.get("tool_input").cloned().unwrap_or_else(|| serde_json::json!({}));

    let (event_type, task_id) = match tool_name {
        "TaskCreate" => (EventType::TaskCreated, None),
        "TaskUpdate" => {
            let status = tool_input.get("status").and_then(|v| v.as_str());
            let tid = tool_input
                .get("taskId")
                .and_then(|v| v.as_str())
                .map(String::from);
            match status {
                Some("completed") => (EventType::TaskCompleted, tid),
                Some("in_progress") => (EventType::TaskStarted, tid),
                _ => (EventType::TaskProgress, tid),
            }
        }
        _ => (EventType::ToolStarted, None),
    };

    Ok((
        event_type,
        Severity::Info,
        serde_json::json!({
            "tool_name": tool_name,
            "tool_input": tool_input,
        }),
        None,
        task_id,
    ))
}

/// PostToolUse 매핑: error 필드 존재 시 ToolFailed, 아니면 ToolSucceeded
fn normalize_post_tool_use(
    raw: &serde_json::Value,
) -> Result<(EventType, Severity, serde_json::Value, Option<String>, Option<String>), AppError> {
    let tool_name = raw
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let has_error = raw.get("error").is_some()
        && !raw.get("error").map_or(true, |v| v.is_null());

    if has_error {
        let error_msg = raw
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        Ok((
            EventType::ToolFailed,
            Severity::Warn,
            serde_json::json!({
                "tool_name": tool_name,
                "error_message": error_msg,
                "exit_code": raw.get("exit_code").and_then(|v| v.as_i64()),
            }),
            None,
            None,
        ))
    } else {
        Ok((
            EventType::ToolSucceeded,
            Severity::Info,
            serde_json::json!({
                "tool_name": tool_name,
            }),
            None,
            None,
        ))
    }
}

/// thinking/extended_thinking 텍스트 추출 (hooks-integration.md §6.2)
fn extract_thinking(raw: &serde_json::Value) -> Option<String> {
    raw.get("thinking")
        .and_then(|v| v.as_str())
        .or_else(|| raw.get("extended_thinking").and_then(|v| v.as_str()))
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_normalize_subagent_start() {
        let raw = json!({
            "hook_type": "SubagentStart",
            "session_id": "sess-1",
            "agent_name": "worker-01",
            "agent_type": "general-purpose",
            "team_name": "my-project",
            "prompt": "do something",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::AgentStarted);
        assert_eq!(event.agent_id, "my-project/worker-01");
        assert_eq!(event.workspace_id, "my-project");
        assert_eq!(event.source, EventSource::Hook);
    }

    #[test]
    fn test_normalize_subagent_stop() {
        let raw = json!({
            "hook_type": "SubagentStop",
            "session_id": "sess-1",
            "agent_name": "worker-01",
            "team_name": "my-project",
            "result": "completed",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::AgentStopped);
    }

    #[test]
    fn test_normalize_pre_tool_use_basic() {
        let raw = json!({
            "hook_type": "PreToolUse",
            "session_id": "sess-1",
            "tool_name": "Read",
            "tool_input": {"file_path": "/some/file"},
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::ToolStarted);
    }

    #[test]
    fn test_normalize_pre_tool_use_task_update_completed() {
        let raw = json!({
            "hook_type": "PreToolUse",
            "session_id": "sess-1",
            "tool_name": "TaskUpdate",
            "tool_input": {"taskId": "1", "status": "completed"},
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::TaskCompleted);
    }

    #[test]
    fn test_normalize_post_tool_use_success() {
        let raw = json!({
            "hook_type": "PostToolUse",
            "session_id": "sess-1",
            "tool_name": "Read",
            "tool_result": "file contents",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::ToolSucceeded);
    }

    #[test]
    fn test_normalize_post_tool_use_failure() {
        let raw = json!({
            "hook_type": "PostToolUse",
            "session_id": "sess-1",
            "tool_name": "Bash",
            "error": "command failed",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::ToolFailed);
    }

    #[test]
    fn test_normalize_stop_event() {
        let raw = json!({
            "hook_type": "Stop",
            "session_id": "sess-1",
            "reason": "completed",
            "summary": "task done",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::AgentStopped);
    }

    #[test]
    fn test_normalize_missing_hook_type() {
        let raw = json!({"some": "data"});
        let result = normalize(&raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_fingerprint_deterministic() {
        let fp1 = generate_fingerprint("sess-1", "Read", "2026-02-20T15:00:00Z", &json!({}));
        let fp2 = generate_fingerprint("sess-1", "Read", "2026-02-20T15:00:00Z", &json!({}));
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_fingerprint_different_inputs() {
        let fp1 = generate_fingerprint("sess-1", "Read", "2026-02-20T15:00:00Z", &json!({}));
        let fp2 = generate_fingerprint("sess-2", "Read", "2026-02-20T15:00:00Z", &json!({}));
        assert_ne!(fp1, fp2);
    }

    #[test]
    fn test_agent_id_derivation() {
        assert_eq!(
            derive_agent_id(Some("my-team"), Some("worker-01"), Some("sess-1")),
            "my-team/worker-01"
        );
        assert_eq!(
            derive_agent_id(Some("my-team"), None, Some("sess-1")),
            "my-team/leader"
        );
        assert_eq!(
            derive_agent_id(None, None, Some("sess-1")),
            "sess-1"
        );
    }
}
