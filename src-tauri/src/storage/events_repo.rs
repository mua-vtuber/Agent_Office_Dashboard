use crate::error::AppError;
use crate::models::event::NormalizedEvent;
use crate::storage::db::DbPool;

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
            "INSERT OR IGNORE INTO events (id, version, ts, event_type, source, workspace_id, terminal_session_id, agent_id, severity, payload_json, thinking_text, raw_json, fingerprint)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                event.id,
                event.version,
                event.ts,
                event_type_str,
                source_str,
                event.workspace_id,
                event.terminal_session_id,
                event.agent_id,
                severity_str,
                payload_json,
                event.thinking_text,
                raw_json,
                fingerprint,
            ],
        )?;

        Ok(rows > 0)
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
