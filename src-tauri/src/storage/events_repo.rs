use crate::error::AppError;
use crate::models::event::{NormalizedEvent, ResumeEvent};
use crate::storage::db::DbPool;

fn extract_summary_from_type(event_type: &str, payload_str: &str) -> String {
    let payload: serde_json::Value = serde_json::from_str(payload_str).unwrap_or_default();
    let tool_name = payload.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
    match event_type {
        "\"task_completed\"" => "작업 완료".to_string(),
        "\"task_started\"" => "작업 시작".to_string(),
        "\"tool_started\"" => format!("도구 실행: {tool_name}"),
        "\"tool_succeeded\"" => format!("도구 성공: {tool_name}"),
        "\"tool_failed\"" => format!("도구 실패: {tool_name}"),
        "\"agent_started\"" => "에이전트 시작".to_string(),
        "\"agent_stopped\"" => "에이전트 종료".to_string(),
        _ => event_type.trim_matches('"').to_string(),
    }
}

pub struct EventsRepo {
    db: DbPool,
}

impl EventsRepo {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }

    /// 이벤트 저장. fingerprint 중복 시 skip (upsert).
    pub fn insert(&self, event: &NormalizedEvent, fingerprint: &str) -> Result<bool, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;

        let event_type_str = serde_json::to_string(&event.event_type)
            .map_err(|e| AppError::Normalize(e.to_string()))?;
        let source_str = serde_json::to_string(&event.source)
            .map_err(|e| AppError::Normalize(e.to_string()))?;
        let severity_str = serde_json::to_string(&event.severity)
            .map_err(|e| AppError::Normalize(e.to_string()))?;
        let payload_json = event.payload.to_string();
        let raw_json = event.raw.to_string();

        let rows = conn.execute(
            "INSERT OR IGNORE INTO events (id, version, ts, event_type, source, workspace_id,
             terminal_session_id, run_id, session_id, agent_id, target_agent_id, task_id,
             severity, payload_json, thinking_text, raw_json, fingerprint)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            rusqlite::params![
                event.id,
                event.version,
                event.ts,
                event_type_str,
                source_str,
                event.workspace_id,
                event.terminal_session_id,
                event.run_id,
                event.session_id,
                event.agent_id,
                event.target_agent_id,
                event.task_id,
                severity_str,
                payload_json,
                event.thinking_text,
                raw_json,
                fingerprint,
            ],
        )?;

        Ok(rows > 0)
    }

    /// 에이전트의 최근 이벤트 조회 (이력서용)
    pub fn get_recent_by_agent(&self, agent_id: &str, limit: usize) -> Result<Vec<ResumeEvent>, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT event_type, payload_json, ts FROM events WHERE agent_id = ?1 ORDER BY ts DESC LIMIT ?2",
        )?;

        let events = stmt
            .query_map(rusqlite::params![agent_id, limit as i64], |row| {
                let event_type_str: String = row.get(0)?;
                let payload_str: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
                let ts: String = row.get(2)?;
                let summary = extract_summary_from_type(&event_type_str, &payload_str);

                Ok(ResumeEvent {
                    event_type: event_type_str,
                    summary,
                    ts,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(events)
    }

    /// 완료된 작업 수 카운트
    pub fn count_completed_tasks(&self, agent_id: &str) -> Result<u64, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM events WHERE agent_id = ?1 AND event_type = '\"task_completed\"'",
            rusqlite::params![agent_id],
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }

    /// 사용한 도구 수 카운트
    pub fn count_tools_used(&self, agent_id: &str) -> Result<u64, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM events WHERE agent_id = ?1 AND event_type = '\"tool_started\"'",
            rusqlite::params![agent_id],
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event::*;
    use crate::storage::db::init_db_in_memory;

    fn make_test_event(id: &str, fingerprint_suffix: &str) -> (NormalizedEvent, String) {
        let event = NormalizedEvent {
            id: id.to_string(),
            version: "1.0".to_string(),
            ts: "2026-02-20T15:00:00Z".to_string(),
            event_type: EventType::AgentStarted,
            source: EventSource::Hook,
            workspace_id: "test-project".to_string(),
            terminal_session_id: "term-1".to_string(),
            run_id: None,
            session_id: Some("session-1".to_string()),
            agent_id: "agent-01".to_string(),
            target_agent_id: None,
            task_id: None,
            severity: Severity::Info,
            payload: serde_json::json!({}),
            thinking_text: None,
            raw: serde_json::json!({"type": "test"}),
        };
        let fingerprint = format!("fp-{}", fingerprint_suffix);
        (event, fingerprint)
    }

    #[test]
    fn test_insert_returns_true() {
        let db = init_db_in_memory().expect("db init");
        let repo = EventsRepo::new(db);
        let (event, fp) = make_test_event("evt-1", "1");
        let inserted = repo.insert(&event, &fp).expect("insert");
        assert!(inserted);
    }

    #[test]
    fn test_duplicate_fingerprint_returns_false() {
        let db = init_db_in_memory().expect("db init");
        let repo = EventsRepo::new(db);
        let (event, fp) = make_test_event("evt-1", "dup");
        repo.insert(&event, &fp).expect("first insert");

        let (event2, _) = make_test_event("evt-2", "ignored");
        let inserted = repo.insert(&event2, &fp).expect("second insert same fp");
        assert!(!inserted);
    }
}
