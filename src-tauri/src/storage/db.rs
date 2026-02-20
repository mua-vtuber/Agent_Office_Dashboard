use crate::error::AppError;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub type DbPool = Arc<Mutex<Connection>>;

/// SQLite 연결을 열고 마이그레이션을 실행한다.
pub fn init_db(db_path: &Path) -> Result<DbPool, AppError> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    run_migrations(&conn)?;

    Ok(Arc::new(Mutex::new(conn)))
}

/// 인메모리 DB (테스트용)
#[cfg(test)]
pub fn init_db_in_memory() -> Result<DbPool, AppError> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    run_migrations(&conn)?;
    Ok(Arc::new(Mutex::new(conn)))
}

fn run_migrations(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS agents (
            agent_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'unknown',
            employment_type TEXT NOT NULL DEFAULT 'contractor',
            workspace_id TEXT NOT NULL,
            appearance_json TEXT,
            first_seen_ts TEXT NOT NULL,
            last_active_ts TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_state (
            agent_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'offline',
            prev_status TEXT,
            thinking_text TEXT,
            current_task TEXT,
            workspace_id TEXT NOT NULL,
            since TEXT NOT NULL,
            last_event_ts TEXT NOT NULL,
            session_id TEXT,
            peer_agent_id TEXT,
            home_x REAL NOT NULL DEFAULT 0.0,
            FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            ts TEXT NOT NULL,
            event_type TEXT NOT NULL,
            source TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            terminal_session_id TEXT NOT NULL,
            run_id TEXT,
            session_id TEXT,
            agent_id TEXT NOT NULL,
            target_agent_id TEXT,
            task_id TEXT,
            severity TEXT NOT NULL DEFAULT 'info',
            payload_json TEXT,
            thinking_text TEXT,
            raw_json TEXT,
            fingerprint TEXT UNIQUE
        );

        CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
        CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
        CREATE INDEX IF NOT EXISTS idx_agent_state_workspace ON agent_state(workspace_id);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_db_in_memory() {
        let db = init_db_in_memory().expect("should init in-memory db");
        let conn = db.lock().expect("should lock");
        let count: i64 = conn
            .query_row("SELECT count(*) FROM agents", [], |row| row.get(0))
            .expect("should query");
        assert_eq!(count, 0);
    }
}
