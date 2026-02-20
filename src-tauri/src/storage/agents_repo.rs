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

    pub fn upsert(&self, agent: &MascotAgent) -> Result<(), AppError> {
        let conn = self.db.lock().map_err(|e| AppError::Database(
            rusqlite::Error::InvalidParameterName(e.to_string()),
        ))?;
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

    pub fn get_all(&self) -> Result<Vec<MascotAgent>, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::Database(
            rusqlite::Error::InvalidParameterName(e.to_string()),
        ))?;
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
                    role: serde_json::from_str(&role_str).unwrap_or(AgentRole::Unknown),
                    employment_type: serde_json::from_str(&emp_str)
                        .unwrap_or(EmploymentType::Contractor),
                    workspace_id: row.get(4)?,
                    status: AgentStatus::Offline,
                    thinking_text: None,
                    current_task: None,
                    appearance: serde_json::from_str(&appearance_str)
                        .unwrap_or_else(|_| AppearanceProfile {
                            body_index: 0, hair_index: 0, outfit_index: 0,
                            accessory_index: 0, face_index: 0,
                            hair_hue: 0.0, outfit_hue: 0.0, skin_hue: 0.0, skin_lightness: 80.0,
                        }),
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
