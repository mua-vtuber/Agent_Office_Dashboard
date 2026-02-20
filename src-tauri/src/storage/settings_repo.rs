use crate::error::AppError;
use crate::storage::db::DbPool;

pub struct SettingsRepo {
    db: DbPool,
}

impl SettingsRepo {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let result = stmt.query_row(rusqlite::params![key], |row| row.get(0));

        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delete(&self, key: &str) -> Result<bool, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
        let rows = conn.execute("DELETE FROM settings WHERE key = ?1", rusqlite::params![key])?;
        Ok(rows > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::init_db_in_memory;

    #[test]
    fn test_get_nonexistent_returns_none() {
        let db = init_db_in_memory().expect("db init");
        let repo = SettingsRepo::new(db);
        let result = repo.get("nonexistent").expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn test_set_and_get() {
        let db = init_db_in_memory().expect("db init");
        let repo = SettingsRepo::new(db);
        repo.set("lang", "ko").expect("set");
        let val = repo.get("lang").expect("get").expect("should exist");
        assert_eq!(val, "ko");
    }

    #[test]
    fn test_set_overwrites() {
        let db = init_db_in_memory().expect("db init");
        let repo = SettingsRepo::new(db);
        repo.set("lang", "ko").expect("set");
        repo.set("lang", "en").expect("overwrite");
        let val = repo.get("lang").expect("get").expect("should exist");
        assert_eq!(val, "en");
    }

    #[test]
    fn test_delete() {
        let db = init_db_in_memory().expect("db init");
        let repo = SettingsRepo::new(db);
        repo.set("key", "val").expect("set");
        let deleted = repo.delete("key").expect("delete");
        assert!(deleted);
        assert!(repo.get("key").expect("get").is_none());
    }
}
