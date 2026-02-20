use crate::error::AppError;
use crate::models::agent::*;
use crate::storage::db::DbPool;

pub struct AgentsRepo {
    db: DbPool,
}

impl AgentsRepo {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }

    /// 에이전트를 저장하거나 갱신한다.
    /// 주의: first_seen_ts는 최초 INSERT 시에만 기록되며, ON CONFLICT에서는
    /// 갱신하지 않는다. 최초 insert 시 last_active_ts를 first_seen_ts로 사용하는
    /// 이유는 에이전트를 처음 인지한 시점 = 해당 이벤트의 타임스탬프이기 때문이다.
    pub fn upsert(&self, agent: &MascotAgent) -> Result<(), AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let appearance_json = serde_json::to_string(&agent.appearance)
            .map_err(|e| AppError::Normalize(e.to_string()))?;

        conn.execute(
            "INSERT INTO agents (agent_id, display_name, role, employment_type, workspace_id, appearance_json, first_seen_ts, last_active_ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(agent_id) DO UPDATE SET
               display_name = excluded.display_name,
               last_active_ts = excluded.last_active_ts,
               appearance_json = excluded.appearance_json",
            rusqlite::params![
                agent.agent_id,
                agent.display_name,
                serde_json::to_string(&agent.role).map_err(|e| AppError::Normalize(e.to_string()))?,
                serde_json::to_string(&agent.employment_type).map_err(|e| AppError::Normalize(e.to_string()))?,
                agent.workspace_id,
                appearance_json,
                agent.last_active_ts,
                agent.last_active_ts,
            ],
        )?;
        Ok(())
    }

    /// 모든 에이전트를 조회한다.
    /// 주의: status, thinking_text, current_task는 agents 테이블에 없으므로
    /// 기본값이 설정된다. 호출자는 StateRepo에서 AgentState를 조회하여
    /// 이 필드들을 덮어써야 한다.
    pub fn get_all(&self) -> Result<Vec<MascotAgent>, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT agent_id, display_name, role, employment_type, workspace_id, appearance_json, last_active_ts
             FROM agents",
        )?;

        let agents = stmt
            .query_map([], |row| {
                let role_str: String = row.get(2)?;
                let emp_str: String = row.get(3)?;
                let appearance_str: String = row.get(5)?;

                Ok(MascotAgent {
                    agent_id: row.get(0)?,
                    display_name: row.get(1)?,
                    role: serde_json::from_str(&role_str).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2, rusqlite::types::Type::Text, Box::new(e),
                        )
                    })?,
                    employment_type: serde_json::from_str(&emp_str).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3, rusqlite::types::Type::Text, Box::new(e),
                        )
                    })?,
                    workspace_id: row.get(4)?,
                    status: AgentStatus::Offline,
                    thinking_text: None,
                    current_task: None,
                    appearance: serde_json::from_str(&appearance_str).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            5, rusqlite::types::Type::Text, Box::new(e),
                        )
                    })?,
                    last_active_ts: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(agents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::init_db_in_memory;

    fn make_test_agent(id: &str) -> MascotAgent {
        MascotAgent {
            agent_id: id.to_string(),
            display_name: id.to_string(),
            role: AgentRole::Worker,
            employment_type: EmploymentType::Contractor,
            workspace_id: "test-project".to_string(),
            status: AgentStatus::Idle,
            thinking_text: None,
            current_task: None,
            appearance: AppearanceProfile {
                body_index: 0, hair_index: 1, outfit_index: 0,
                accessory_index: 0, face_index: 0,
                hair_hue: 120.0, outfit_hue: 240.0, skin_hue: 30.0, skin_lightness: 80.0,
            },
            last_active_ts: "2026-02-20T15:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_upsert_and_get_all() {
        let db = init_db_in_memory().expect("db init");
        let repo = AgentsRepo::new(db);

        repo.upsert(&make_test_agent("agent-01")).expect("upsert");
        repo.upsert(&make_test_agent("agent-02")).expect("upsert");

        let agents = repo.get_all().expect("get_all");
        assert_eq!(agents.len(), 2);
    }
}
