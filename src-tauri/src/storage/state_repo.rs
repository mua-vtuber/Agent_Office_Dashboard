use crate::error::AppError;
use crate::models::agent::{AgentState, AgentStatus};
use crate::storage::db::DbPool;

pub struct StateRepo {
    db: DbPool,
}

impl StateRepo {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }

    pub fn upsert(&self, state: &AgentState) -> Result<(), AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let status_str = serde_json::to_string(&state.status)
            .map_err(|e| AppError::Normalize(e.to_string()))?;
        let prev_status_str = state.prev_status.as_ref()
            .map(|s| serde_json::to_string(s))
            .transpose()
            .map_err(|e| AppError::Normalize(e.to_string()))?;

        conn.execute(
            "INSERT INTO agent_state (agent_id, status, prev_status, thinking_text, current_task, workspace_id, since, last_event_ts, session_id, peer_agent_id, home_x)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(agent_id) DO UPDATE SET
               status = excluded.status,
               prev_status = excluded.prev_status,
               thinking_text = excluded.thinking_text,
               current_task = excluded.current_task,
               since = excluded.since,
               last_event_ts = excluded.last_event_ts,
               session_id = excluded.session_id,
               peer_agent_id = excluded.peer_agent_id",
            rusqlite::params![
                state.agent_id,
                status_str,
                prev_status_str,
                state.thinking_text,
                state.current_task,
                state.workspace_id,
                state.since,
                state.last_event_ts,
                state.session_id,
                state.peer_agent_id,
                state.home_x,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, agent_id: &str) -> Result<Option<AgentState>, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT agent_id, status, prev_status, thinking_text, current_task, workspace_id, since, last_event_ts, session_id, peer_agent_id, home_x
             FROM agent_state WHERE agent_id = ?1",
        )?;

        let result = stmt.query_row(rusqlite::params![agent_id], |row| {
            let status_str: String = row.get(1)?;
            let prev_status_str: Option<String> = row.get(2)?;
            Ok(AgentState {
                agent_id: row.get(0)?,
                status: serde_json::from_str(&status_str).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1, rusqlite::types::Type::Text, Box::new(e),
                    )
                })?,
                prev_status: prev_status_str
                    .map(|s| serde_json::from_str(&s))
                    .transpose()
                    .map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2, rusqlite::types::Type::Text, Box::new(e),
                        )
                    })?,
                thinking_text: row.get(3)?,
                current_task: row.get(4)?,
                workspace_id: row.get(5)?,
                since: row.get(6)?,
                last_event_ts: row.get(7)?,
                session_id: row.get(8)?,
                peer_agent_id: row.get(9)?,
                home_x: row.get(10)?,
            })
        });

        match result {
            Ok(state) => Ok(Some(state)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_all(&self) -> Result<Vec<AgentState>, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT agent_id, status, prev_status, thinking_text, current_task, workspace_id, since, last_event_ts, session_id, peer_agent_id, home_x
             FROM agent_state",
        )?;

        let states = stmt
            .query_map([], |row| {
                let status_str: String = row.get(1)?;
                let prev_status_str: Option<String> = row.get(2)?;
                Ok(AgentState {
                    agent_id: row.get(0)?,
                    status: serde_json::from_str(&status_str).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1, rusqlite::types::Type::Text, Box::new(e),
                        )
                    })?,
                    prev_status: prev_status_str
                        .map(|s| serde_json::from_str(&s))
                        .transpose()
                        .map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                2, rusqlite::types::Type::Text, Box::new(e),
                            )
                        })?,
                    thinking_text: row.get(3)?,
                    current_task: row.get(4)?,
                    workspace_id: row.get(5)?,
                    since: row.get(6)?,
                    last_event_ts: row.get(7)?,
                    session_id: row.get(8)?,
                    peer_agent_id: row.get(9)?,
                    home_x: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(states)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::init_db_in_memory;

    fn make_test_state(id: &str) -> AgentState {
        AgentState {
            agent_id: id.to_string(),
            status: AgentStatus::Idle,
            prev_status: None,
            thinking_text: None,
            current_task: None,
            workspace_id: "test-project".to_string(),
            since: "2026-02-20T15:00:00Z".to_string(),
            last_event_ts: "2026-02-20T15:00:00Z".to_string(),
            session_id: None,
            peer_agent_id: None,
            home_x: 0.5,
        }
    }

    #[test]
    fn test_upsert_and_get() {
        let db = init_db_in_memory().expect("db init");
        // agents 테이블에 먼저 에이전트 등록 필요 (FK)
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO agents (agent_id, display_name, workspace_id, first_seen_ts, last_active_ts) VALUES ('a1', 'a1', 'test-project', '2026-02-20T15:00:00Z', '2026-02-20T15:00:00Z')",
                [],
            ).unwrap();
        }

        let repo = StateRepo::new(db);
        repo.upsert(&make_test_state("a1")).expect("upsert");

        let state = repo.get("a1").expect("get").expect("should exist");
        assert_eq!(state.status, AgentStatus::Idle);
        assert_eq!(state.home_x, 0.5);
    }

    #[test]
    fn test_get_nonexistent() {
        let db = init_db_in_memory().expect("db init");
        let repo = StateRepo::new(db);
        let result = repo.get("nonexistent").expect("should not error");
        assert!(result.is_none());
    }
}
