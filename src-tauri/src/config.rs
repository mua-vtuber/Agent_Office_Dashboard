use crate::error::{AppError, ConfigError};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub display: DisplayConfig,
    pub state_machine: StateMachineConfig,
    pub heartbeat: HeartbeatConfig,
    pub movement: MovementConfig,
    pub appearance: AppearanceConfig,
    pub resume: ResumeConfig,
    pub auth: AuthConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DisplayConfig {
    pub activity_zone_height_px: u32,
    pub taskbar_offset_px: u32,
    pub character_spacing_px: u32,
    pub group_spacing_px: u32,
    pub max_bubble_chars: usize,
    pub bubble_fade_ms: u64,
    pub idle_sway_px: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StateMachineConfig {
    pub fatal_keywords: Vec<String>,
    pub retryable_keywords: Vec<String>,
    pub fatal_consecutive_failures: u32,
    pub timer_transitions: TimerTransitionsConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct TimerTransitionsConfig {
    pub idle_to_resting_secs: u64,
    pub completed_to_disappear_secs: u64,
    pub chat_timeout_secs: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct HeartbeatConfig {
    pub interval_secs: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MovementConfig {
    pub walk_speed_px_per_sec: f64,
    pub arrival_distance_px: f64,
    pub behind_scale: f64,
    pub chat_queue_timeout_secs: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppearanceConfig {
    pub skin_saturation_min: f64,
    pub skin_saturation_max: f64,
    pub skin_lightness_min: f64,
    pub skin_lightness_max: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ResumeConfig {
    pub recent_events_limit: usize,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AuthConfig {
    pub token: String,
}

impl AppConfig {
    /// config.toml 파일에서 설정을 로드한다.
    /// 파일이 없거나 파싱 실패 시 에러를 반환한다 (기본값 폴백 없음).
    pub fn load(path: &Path) -> Result<Self, AppError> {
        let content = std::fs::read_to_string(path).map_err(|_| ConfigError::NotFound {
            path: path.display().to_string(),
        })?;

        let config: AppConfig =
            toml::from_str(&content).map_err(ConfigError::from)?;
        config.validate()?;
        Ok(config)
    }

    /// 설정값 검증. 잘못된 값이 있으면 에러 반환.
    fn validate(&self) -> Result<(), AppError> {
        if self.server.port == 0 {
            return Err(ConfigError::Validation {
                field: "server.port".into(),
                reason: "port must be > 0".into(),
            }
            .into());
        }

        if self.appearance.skin_lightness_min >= self.appearance.skin_lightness_max {
            return Err(ConfigError::Validation {
                field: "appearance.skin_lightness".into(),
                reason: "min must be less than max".into(),
            }
            .into());
        }

        if self.appearance.skin_saturation_min >= self.appearance.skin_saturation_max {
            return Err(ConfigError::Validation {
                field: "appearance.skin_saturation".into(),
                reason: "min must be less than max".into(),
            }
            .into());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_temp_config(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().expect("failed to create temp file");
        f.write_all(content.as_bytes())
            .expect("failed to write temp file");
        f
    }

    #[test]
    fn test_load_valid_config() {
        let config_str = include_str!("../config.toml");
        let f = write_temp_config(config_str);
        let config = AppConfig::load(f.path()).expect("should parse valid config");
        assert_eq!(config.server.port, 4820);
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.heartbeat.interval_secs, 10);
        assert_eq!(config.display.max_bubble_chars, 80);
        assert_eq!(config.state_machine.fatal_consecutive_failures, 3);
    }

    #[test]
    fn test_load_missing_file() {
        let result = AppConfig::load(Path::new("/nonexistent/config.toml"));
        assert!(result.is_err());
    }

    #[test]
    fn test_load_invalid_toml() {
        let f = write_temp_config("this is not valid toml [[[");
        let result = AppConfig::load(f.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_validation_port_zero() {
        let mut content = include_str!("../config.toml").to_string();
        content = content.replace("port = 4820", "port = 0");
        let f = write_temp_config(&content);
        let result = AppConfig::load(f.path());
        assert!(result.is_err());
    }
}
