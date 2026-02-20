use serde::Serialize;

/// config.toml 파싱/검증 에러
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config file not found: {path}")]
    NotFound { path: String },

    #[error("config parse error: {0}")]
    Parse(#[from] toml::de::Error),

    #[error("config validation error: {field} - {reason}")]
    Validation { field: String, reason: String },
}

/// 앱 전역 에러 타입. 모든 모듈에서 공유.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("config load failed: {0}")]
    Config(#[from] ConfigError),

    // TODO(task-7): replace String with #[from] rusqlite::Error
    #[error("database error: {0}")]
    Database(String),

    #[error("http server error: {0}")]
    HttpServer(String),

    #[error("normalization failed: {0}")]
    Normalize(String),

    #[error("state transition error: {0}")]
    StateTransition(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Tauri invoke 에러 응답용 직렬화.
/// Tauri v2에서 명령 에러는 Serialize를 구현해야 한다.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
