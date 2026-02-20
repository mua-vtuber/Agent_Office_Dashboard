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
        let conn = self.db.lock().map_err(|e| AppError::Database(
            rusqlite::Error::InvalidParameterName(e.to_string()),
        ))?;

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
