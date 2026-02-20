# Tauri v2 Scaffold + Rust Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tauri v2 기반 데스크탑 마스코트 앱의 프로젝트 구조를 세우고, Rust 핵심 모듈(config, error, models, DB, HTTP 서버)과 WebView 기반 구조를 완성한다.

**Architecture:** Tauri v2 단일 프로세스 앱. Rust 메인 프로세스에 axum HTTP 서버(hook 수신), SQLite(상태 저장), 상태 머신을 내장하고, WebView(React+PixiJS+Spine)에서 캐릭터를 렌더링한다. Rust→WebView는 Tauri 이벤트(`emit`), WebView→Rust는 Tauri 명령(`invoke`)으로 통신.

**Tech Stack:** Tauri v2, Rust (thiserror, serde, axum, rusqlite, tokio, toml), React 19, TypeScript strict, Vite, Zustand v5, i18next, PixiJS v8

**환경:** WSL2 Ubuntu 24.04, Node.js v24.13.1, pnpm 10.29.3, Rust 미설치 상태

**참조 문서:**
- `docs/mascot-architecture.md` — 모듈 책임, 디렉토리 구조
- `docs/mascot-product-spec.md` — 제품 요구사항, 화면 구성
- `docs/mascot-state-machine.md` — 14개 상태, 전이 규칙
- `docs/mascot-ipc-protocol.md` — IPC 프로토콜, 이벤트/명령 정의
- `docs/mascot-hooks-integration.md` — hook 연동, HTTP 엔드포인트
- `docs/mascot-spine-spec.md` — Spine 캐릭터 스펙, 외형 알고리즘

---

## Task 1: 개발 환경 설정

**목표:** Rust toolchain + Tauri v2 Linux 의존성 설치

**Step 1: Rust 설치**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

**Step 2: 설치 확인**

Run: `rustc --version && cargo --version`
Expected: `rustc 1.8x.x` 이상, `cargo 1.8x.x` 이상

**Step 3: Tauri v2 Linux 시스템 의존성 설치**

```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

**Step 4: Tauri CLI 설치**

```bash
cargo install tauri-cli --version "^2" --locked
```

**Step 5: 전체 확인**

Run: `cargo tauri --version`
Expected: `tauri-cli 2.x.x`

---

## Task 2: Tauri v2 프로젝트 생성

**목표:** create-tauri-app으로 React+TypeScript 템플릿 기반 프로젝트를 생성하고 빌드 가능 상태 확인

**Files:**
- Create: 프로젝트 루트에 Tauri v2 scaffold 전체

**Step 1: 프로젝트 생성**

프로젝트 루트(`/mnt/f/hayoung/git/Agent_Office_Dashboard/`)에서:

```bash
pnpm create tauri-app@latest agent-mascot-temp -- --template react-ts --manager pnpm
```

> 임시 디렉토리에 생성 후 필요한 파일을 현재 레포로 이동한다.

**Step 2: 생성된 파일을 현재 레포로 이동**

```bash
# src-tauri 디렉토리 이동
cp -r agent-mascot-temp/src-tauri ./src-tauri

# 프론트엔드 관련 파일 이동
cp agent-mascot-temp/package.json ./package.json
cp agent-mascot-temp/tsconfig.json ./tsconfig.json
cp agent-mascot-temp/tsconfig.node.json ./tsconfig.node.json 2>/dev/null || true
cp agent-mascot-temp/vite.config.ts ./vite.config.ts
cp agent-mascot-temp/index.html ./index.html
cp -r agent-mascot-temp/src ./src-webview-temp

# 임시 디렉토리 삭제
rm -rf agent-mascot-temp
```

**Step 3: pnpm install + 빌드 확인**

```bash
pnpm install
cargo tauri build --debug 2>&1 | tail -5
```

Expected: 빌드 성공 (첫 빌드는 Rust 컴파일로 오래 걸림)

> 빌드 실패 시: WSL2의 webkit2gtk 문제일 수 있음. 에러 메시지 확인 후 대응.

**Step 4: 커밋**

```bash
git add src-tauri/ package.json index.html vite.config.ts tsconfig*.json pnpm-lock.yaml
git commit -m "feat: initialize Tauri v2 project with React+TypeScript template"
```

---

## Task 3: 프로젝트 구조 재배치

**목표:** architecture.md §9의 디렉토리 구조에 맞게 파일을 재배치

**Files:**
- Create: `apps/webview/` 디렉토리 구조 전체
- Create: `src-tauri/src/` 내 모듈 디렉토리 구조
- Modify: `src-tauri/tauri.conf.json` — frontendDist 경로 변경
- Create: `pnpm-workspace.yaml`

**Step 1: WebView를 apps/webview/로 이동**

```bash
mkdir -p apps/webview/src
mv src-webview-temp/* apps/webview/src/ 2>/dev/null || true
rm -rf src-webview-temp
mv index.html apps/webview/
mv vite.config.ts apps/webview/
```

**Step 2: apps/webview/package.json 생성**

```json
{
  "name": "@agent-mascot/webview",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "i18next": "^24.0.0",
    "react-i18next": "^15.0.0",
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

**Step 3: 루트 package.json을 pnpm workspace root로 변환**

```json
{
  "name": "agent-mascot",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "cargo tauri dev",
    "build": "cargo tauri build",
    "webview:dev": "pnpm --filter @agent-mascot/webview dev",
    "webview:build": "pnpm --filter @agent-mascot/webview build"
  }
}
```

**Step 4: pnpm-workspace.yaml 생성**

```yaml
packages:
  - "apps/*"
```

**Step 5: Rust 모듈 디렉토리 구조 생성**

```bash
cd src-tauri/src
mkdir -p commands http models services storage tray
touch commands/mod.rs commands/agents.rs commands/window.rs
touch http/mod.rs http/server.rs http/ingest.rs
touch models/mod.rs models/agent.rs models/event.rs
touch services/mod.rs services/normalizer.rs services/state_machine.rs services/appearance.rs services/heartbeat.rs
touch storage/mod.rs storage/db.rs storage/agents_repo.rs storage/events_repo.rs storage/state_repo.rs
touch tray/mod.rs
touch config.rs error.rs
```

**Step 6: tauri.conf.json 수정 — frontendDist 경로를 apps/webview으로 변경**

`src-tauri/tauri.conf.json`의 `build` 섹션:

```json
{
  "build": {
    "beforeDevCommand": "pnpm --filter @agent-mascot/webview dev",
    "beforeBuildCommand": "pnpm --filter @agent-mascot/webview build",
    "frontendDist": "../apps/webview/dist",
    "devUrl": "http://localhost:1420"
  }
}
```

**Step 7: apps/webview/vite.config.ts 수정**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
```

**Step 8: WebView 디렉토리 세부 구조 생성**

```bash
cd apps/webview/src
mkdir -p tauri pixi components stores i18n types assets/spine
touch tauri/events.ts tauri/commands.ts
touch stores/agent-store.ts stores/ui-store.ts stores/error-store.ts
touch types/agent.ts types/event.ts types/ipc.ts
touch i18n/index.ts
```

**Step 9: pnpm install + 빌드 확인**

```bash
cd /mnt/f/hayoung/git/Agent_Office_Dashboard
pnpm install
pnpm webview:build
```

Expected: WebView 빌드 성공

**Step 10: 커밋**

```bash
git add apps/ src-tauri/ pnpm-workspace.yaml package.json
git commit -m "refactor: restructure project to match architecture spec"
```

---

## Task 4: Rust 에러 타입 정의

**목표:** 앱 전역 에러 타입 `AppError` 정의 (architecture.md §7.1)

**Files:**
- Modify: `src-tauri/Cargo.toml` — thiserror 의존성 추가
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/main.rs` — mod error 선언

**Step 1: Cargo.toml에 thiserror 추가**

`src-tauri/Cargo.toml`의 `[dependencies]`에:

```toml
thiserror = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

**Step 2: error.rs 작성**

```rust
use serde::Serialize;

/// config.toml 파싱/검증 에러
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("config file not found: {path}")]
    NotFound { path: String },

    #[error("config parse error: {0}")]
    Parse(#[from] toml::de::Error),

    #[error("config validation error: {field} — {reason}")]
    Validation { field: String, reason: String },
}

/// 앱 전역 에러 타입. 모든 모듈에서 공유.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("config load failed: {0}")]
    Config(#[from] ConfigError),

    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

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
```

**Step 3: main.rs에 모듈 선언 추가**

```rust
mod error;
```

**Step 4: 빌드 확인**

Run: `cd /mnt/f/hayoung/git/Agent_Office_Dashboard && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: 컴파일 성공 (rusqlite가 아직 없으므로 rusqlite import를 조건부 처리하거나, 이 시점에서 rusqlite 의존성도 함께 추가)

> 참고: rusqlite는 Task 7에서 추가하므로, 이 단계에서는 `Database` variant에 `#[from] rusqlite::Error` 대신 `Database(String)`으로 임시 처리하고, Task 7에서 변경한다.

임시 버전:
```rust
    #[error("database error: {0}")]
    Database(String),
```

**Step 5: 커밋**

```bash
git add src-tauri/Cargo.toml src-tauri/src/error.rs src-tauri/src/main.rs
git commit -m "feat: define AppError global error type with thiserror"
```

---

## Task 5: Config 시스템

**목표:** `config.toml` 파싱 → `AppConfig` 구조체 (architecture.md §6)

**Files:**
- Modify: `src-tauri/Cargo.toml` — toml 의존성 추가
- Create: `src-tauri/src/config.rs`
- Create: `src-tauri/config.toml` — 기본 설정 파일
- Modify: `src-tauri/src/main.rs` — mod config

**Step 1: Cargo.toml에 toml 추가**

```toml
toml = "0.8"
```

**Step 2: config.toml 작성**

`src-tauri/config.toml`:

```toml
[server]
host = "127.0.0.1"
port = 4820

[display]
activity_zone_height_px = 120
taskbar_offset_px = 48
character_spacing_px = 60
group_spacing_px = 150
max_bubble_chars = 80
bubble_fade_ms = 3000
idle_sway_px = 2

[state_machine]
fatal_keywords = ["permission denied", "not found", "ENOENT", "EACCES"]
retryable_keywords = ["timeout", "EAGAIN", "rate limit", "ECONNREFUSED"]
fatal_consecutive_failures = 3

[state_machine.timer_transitions]
idle_to_resting_secs = 120
completed_to_disappear_secs = 60
chat_timeout_secs = 5

[heartbeat]
interval_secs = 10

[movement]
walk_speed_px_per_sec = 150
arrival_distance_px = 30
behind_scale = 0.9
chat_queue_timeout_secs = 10

[appearance]
skin_saturation_min = 25.0
skin_saturation_max = 54.0
skin_lightness_min = 75.0
skin_lightness_max = 89.0

[resume]
recent_events_limit = 20

[auth]
token = ""
```

**Step 3: config.rs 작성**

```rust
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
        let content = std::fs::read_to_string(path).map_err(|_| {
            ConfigError::NotFound {
                path: path.display().to_string(),
            }
        })?;

        let config: AppConfig = toml::from_str(&content)?;
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
        f.write_all(content.as_bytes()).expect("failed to write");
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
```

**Step 4: Cargo.toml에 tempfile dev 의존성 추가**

```toml
[dev-dependencies]
tempfile = "3"
```

**Step 5: main.rs에 mod config 추가**

```rust
mod config;
mod error;
```

**Step 6: 테스트 실행**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- config 2>&1`
Expected: 4개 테스트 모두 PASS

**Step 7: 커밋**

```bash
git add src-tauri/Cargo.toml src-tauri/config.toml src-tauri/src/config.rs src-tauri/src/main.rs
git commit -m "feat: add config.toml loading with validation and tests"
```

---

## Task 6: 도메인 모델 정의

**목표:** Agent, AgentStatus, NormalizedEvent, AppearanceProfile 타입 정의 (architecture.md §3.1, state-machine.md §2-3, spine-spec.md §3)

**Files:**
- Create: `src-tauri/src/models/mod.rs`
- Create: `src-tauri/src/models/agent.rs`
- Create: `src-tauri/src/models/event.rs`
- Modify: `src-tauri/src/main.rs` — mod models

**Step 1: models/agent.rs 작성**

```rust
use serde::{Deserialize, Serialize};

/// 에이전트 역할
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Manager,
    Worker,
    Specialist,
    Unknown,
}

/// 고용 형태
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EmploymentType {
    Employee,
    Contractor,
}

/// 14개 에이전트 상태 (state-machine.md §2)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Offline,
    Appearing,
    Idle,
    Working,
    Thinking,
    PendingInput,
    Failed,
    Completed,
    Resting,
    Startled,
    Walking,
    Chatting,
    Returning,
    Disappearing,
}

/// 에이전트 상태 (state-machine.md §3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub agent_id: String,
    pub status: AgentStatus,
    pub thinking_text: Option<String>,
    pub current_task: Option<String>,
    pub workspace_id: String,
    pub since: String,
    pub last_event_ts: String,
    pub session_id: Option<String>,
    pub peer_agent_id: Option<String>,
    pub home_x: f64,
}

/// 외형 프로필 (spine-spec.md §3.3)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceProfile {
    pub body_index: usize,
    pub hair_index: usize,
    pub outfit_index: usize,
    pub accessory_index: usize,
    pub face_index: usize,
    pub hair_hue: f64,
    pub outfit_hue: f64,
    pub skin_hue: f64,
    pub skin_lightness: f64,
}

/// Spine 스킨 슬롯 개수 (WebView에서 수신)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SlotCounts {
    pub body: usize,
    pub hair: usize,
    pub outfit: usize,
    pub accessory: usize,
    pub face: usize,
}

/// 마스코트 에이전트 (IPC 전달용 전체 정보)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MascotAgent {
    pub agent_id: String,
    pub display_name: String,
    pub role: AgentRole,
    pub employment_type: EmploymentType,
    pub workspace_id: String,
    pub status: AgentStatus,
    pub thinking_text: Option<String>,
    pub current_task: Option<String>,
    pub appearance: AppearanceProfile,
    pub last_active_ts: String,
}
```

**Step 2: models/event.rs 작성**

```rust
use serde::{Deserialize, Serialize};

/// 정규화 이벤트 타입 카탈로그 (hooks-integration.md §7.2)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    // 에이전트 라이프사이클
    AgentStarted,
    AgentStopped,
    AgentBlocked,
    AgentUnblocked,
    // 작업 흐름
    TaskCreated,
    TaskStarted,
    TaskProgress,
    TaskCompleted,
    TaskFailed,
    // 도구 실행
    ToolStarted,
    ToolSucceeded,
    ToolFailed,
    // 시스템
    Heartbeat,
    Notification,
    SchemaError,
    // 상호작용 (synthetic)
    MessageSent,
    MessageReceived,
    // 애니메이션 완료 (synthetic from WebView)
    AppearDone,
    DisappearDone,
    StartledDone,
    ArrivAtPeer,
    ArriveAtHome,
    MessageDone,
}

/// 이벤트 소스
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventSource {
    Hook,
    Synthetic,
}

/// 심각도
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Debug,
    Info,
    Warn,
    Error,
}

/// 정규화된 이벤트 (hooks-integration.md §7.1)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedEvent {
    pub id: String,
    pub version: String,
    pub ts: String,
    pub event_type: EventType,
    pub source: EventSource,
    pub workspace_id: String,
    pub terminal_session_id: String,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub agent_id: String,
    pub target_agent_id: Option<String>,
    pub task_id: Option<String>,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub thinking_text: Option<String>,
    pub raw: serde_json::Value,
}
```

**Step 3: models/mod.rs 작성**

```rust
pub mod agent;
pub mod event;

pub use agent::*;
pub use event::*;
```

**Step 4: main.rs에 mod models 추가**

```rust
mod config;
mod error;
mod models;
```

**Step 5: 빌드 확인**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: 성공

**Step 6: 커밋**

```bash
git add src-tauri/src/models/
git commit -m "feat: define domain models — AgentStatus, NormalizedEvent, AppearanceProfile"
```

---

## Task 7: SQLite 기반 저장소

**목표:** rusqlite로 DB 연결, 마이그레이션, agents/events/agent_state 테이블 CRUD

**Files:**
- Modify: `src-tauri/Cargo.toml` — rusqlite 의존성
- Create: `src-tauri/src/storage/db.rs`
- Create: `src-tauri/src/storage/agents_repo.rs`
- Create: `src-tauri/src/storage/events_repo.rs`
- Create: `src-tauri/src/storage/state_repo.rs`
- Create: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/error.rs` — Database variant을 rusqlite::Error로 변경
- Modify: `src-tauri/src/main.rs` — mod storage

**Step 1: Cargo.toml에 rusqlite 추가**

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

**Step 2: error.rs의 Database variant 수정**

```rust
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
```

**Step 3: storage/db.rs 작성**

```rust
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
            agent_id TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            payload_json TEXT,
            thinking_text TEXT,
            raw_json TEXT,
            fingerprint TEXT UNIQUE
        );

        CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
        CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
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
```

**Step 4: storage/agents_repo.rs 작성**

```rust
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
```

**Step 5: storage/state_repo.rs 작성**

```rust
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
        let conn = self.db.lock().map_err(|e| AppError::Database(
            rusqlite::Error::InvalidParameterName(e.to_string()),
        ))?;
        let status_str = serde_json::to_string(&state.status)
            .map_err(|e| AppError::Normalize(e.to_string()))?;

        conn.execute(
            "INSERT INTO agent_state (agent_id, status, thinking_text, current_task, workspace_id, since, last_event_ts, session_id, peer_agent_id, home_x)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(agent_id) DO UPDATE SET
               status = excluded.status,
               thinking_text = excluded.thinking_text,
               current_task = excluded.current_task,
               since = excluded.since,
               last_event_ts = excluded.last_event_ts,
               session_id = excluded.session_id,
               peer_agent_id = excluded.peer_agent_id",
            rusqlite::params![
                state.agent_id,
                status_str,
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
        let conn = self.db.lock().map_err(|e| AppError::Database(
            rusqlite::Error::InvalidParameterName(e.to_string()),
        ))?;
        let mut stmt = conn.prepare(
            "SELECT agent_id, status, thinking_text, current_task, workspace_id, since, last_event_ts, session_id, peer_agent_id, home_x
             FROM agent_state WHERE agent_id = ?1",
        )?;

        let result = stmt.query_row(rusqlite::params![agent_id], |row| {
            let status_str: String = row.get(1)?;
            Ok(AgentState {
                agent_id: row.get(0)?,
                status: serde_json::from_str(&status_str).unwrap_or(AgentStatus::Offline),
                thinking_text: row.get(2)?,
                current_task: row.get(3)?,
                workspace_id: row.get(4)?,
                since: row.get(5)?,
                last_event_ts: row.get(6)?,
                session_id: row.get(7)?,
                peer_agent_id: row.get(8)?,
                home_x: row.get(9)?,
            })
        });

        match result {
            Ok(state) => Ok(Some(state)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_all(&self) -> Result<Vec<AgentState>, AppError> {
        let conn = self.db.lock().map_err(|e| AppError::Database(
            rusqlite::Error::InvalidParameterName(e.to_string()),
        ))?;
        let mut stmt = conn.prepare(
            "SELECT agent_id, status, thinking_text, current_task, workspace_id, since, last_event_ts, session_id, peer_agent_id, home_x
             FROM agent_state",
        )?;

        let states = stmt
            .query_map([], |row| {
                let status_str: String = row.get(1)?;
                Ok(AgentState {
                    agent_id: row.get(0)?,
                    status: serde_json::from_str(&status_str).unwrap_or(AgentStatus::Offline),
                    thinking_text: row.get(2)?,
                    current_task: row.get(3)?,
                    workspace_id: row.get(4)?,
                    since: row.get(5)?,
                    last_event_ts: row.get(6)?,
                    session_id: row.get(7)?,
                    peer_agent_id: row.get(8)?,
                    home_x: row.get(9)?,
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
```

**Step 6: storage/events_repo.rs 작성**

```rust
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
```

**Step 7: storage/mod.rs 작성**

```rust
pub mod db;
pub mod agents_repo;
pub mod events_repo;
pub mod state_repo;
```

**Step 8: main.rs에 mod storage 추가, 테스트 실행**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- storage 2>&1`
Expected: 모든 storage 테스트 PASS

**Step 9: 커밋**

```bash
git add src-tauri/src/storage/ src-tauri/src/error.rs src-tauri/Cargo.toml
git commit -m "feat: add SQLite storage layer — agents, events, state repos with tests"
```

---

## Task 8: axum HTTP 서버 (/health + /ingest 스텁)

**목표:** Rust 내장 axum 서버로 /health, /ingest 엔드포인트 제공 (hooks-integration.md §5)

**Files:**
- Modify: `src-tauri/Cargo.toml` — axum, tokio 의존성
- Create: `src-tauri/src/http/server.rs`
- Create: `src-tauri/src/http/ingest.rs`
- Create: `src-tauri/src/http/mod.rs`
- Modify: `src-tauri/src/main.rs` — mod http, 서버 시작

**Step 1: Cargo.toml에 axum + tokio 추가**

```toml
axum = "0.8"
tokio = { version = "1", features = ["full"] }
```

**Step 2: http/server.rs 작성**

```rust
use crate::config::ServerConfig;
use crate::error::AppError;
use crate::http::ingest::ingest_handler;
use axum::{routing::{get, post}, Router};
use std::net::SocketAddr;

async fn health_handler() -> &'static str {
    "ok"
}

pub fn create_router() -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/ingest", post(ingest_handler))
}

/// axum HTTP 서버를 시작한다. Tauri의 tokio runtime에서 spawn한다.
pub async fn start_http_server(config: &ServerConfig) -> Result<(), AppError> {
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e: std::net::AddrParseError| AppError::HttpServer(e.to_string()))?;

    let router = create_router();

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| AppError::HttpServer(e.to_string()))?;

    axum::serve(listener, router)
        .await
        .map_err(|e| AppError::HttpServer(e.to_string()))?;

    Ok(())
}
```

**Step 3: http/ingest.rs 작성 (스텁)**

```rust
use axum::http::StatusCode;
use axum::Json;

/// POST /ingest — hook payload 수신 (스텁: 수신만 하고 200 응답)
pub async fn ingest_handler(
    Json(payload): Json<serde_json::Value>,
) -> StatusCode {
    // TODO: Task 이후 단계에서 normalizer → state machine → storage → emit 파이프라인 구현
    tracing::info!("ingest received: {}", payload);
    StatusCode::OK
}
```

**Step 4: http/mod.rs 작성**

```rust
pub mod ingest;
pub mod server;
```

**Step 5: Cargo.toml에 tracing 추가**

```toml
tracing = "0.1"
tracing-subscriber = "0.3"
```

**Step 6: main.rs에 HTTP 서버 시작 추가**

main.rs의 Tauri setup 내에서:

```rust
mod config;
mod error;
mod http;
mod models;
mod storage;

use config::AppConfig;
use std::path::PathBuf;

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .setup(|app| {
            // config.toml 로드
            let config_path = app
                .path()
                .resource_dir()
                .map(|d| d.join("config.toml"))
                .unwrap_or_else(|_| PathBuf::from("config.toml"));

            let config = AppConfig::load(&config_path).map_err(|e| {
                eprintln!("Config load failed: {e}");
                e.to_string()
            })?;

            // HTTP 서버를 백그라운드 태스크로 시작
            let server_config = config.server.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http::server::start_http_server(&server_config).await {
                    eprintln!("HTTP server error: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 7: 빌드 확인**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10`
Expected: 컴파일 성공

**Step 8: 커밋**

```bash
git add src-tauri/src/http/ src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat: add axum HTTP server with /health and /ingest stub endpoints"
```

---

## Task 9: 투명 윈도우 설정

**목표:** Tauri v2 윈도우를 투명 오버레이로 설정 (product-spec.md §4.1)

**Files:**
- Modify: `src-tauri/tauri.conf.json` — 윈도우 설정
- Modify: `src-tauri/src/main.rs` — 윈도우 빌더 설정
- Modify: `src-tauri/capabilities/default.json` — 권한 설정

**Step 1: tauri.conf.json 윈도우 설정**

`src-tauri/tauri.conf.json`의 `app.windows` 배열:

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Agent Mascot",
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "fullscreen": true,
        "focus": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data:; script-src 'self'"
    }
  }
}
```

**Step 2: Tauri 기능 플래그 확인**

`src-tauri/Cargo.toml`에서 tauri의 features에 `tray-icon` 추가:

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

**Step 3: apps/webview/index.html에 투명 배경 CSS**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Mascot</title>
    <style>
      html, body, #root {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: transparent;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 4: 커밋**

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml apps/webview/index.html
git commit -m "feat: configure transparent always-on-top overlay window"
```

---

## Task 10: 시스템 트레이

**목표:** TrayIconBuilder로 트레이 메뉴 구성 (product-spec.md §4.3)

**Files:**
- Create: `src-tauri/src/tray/mod.rs`
- Modify: `src-tauri/src/main.rs` — 트레이 셋업 호출

**Step 1: tray/mod.rs 작성**

```rust
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, CheckMenuItemBuilder, SubmenuBuilder},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Manager,
};

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItemBuilder::with_id("show", "마스코트 표시").build(app)?;
    let resume_item = MenuItemBuilder::with_id("resume", "에이전트 이력서").build(app)?;

    let lang_ko = CheckMenuItemBuilder::with_id("lang_ko", "한국어")
        .checked(true)
        .build(app)?;
    let lang_en = CheckMenuItemBuilder::with_id("lang_en", "English")
        .checked(false)
        .build(app)?;
    let lang_submenu = SubmenuBuilder::with_id(app, "lang", "언어")
        .items(&[&lang_ko, &lang_en])
        .build()?;

    let autostart_item = CheckMenuItemBuilder::with_id("autostart", "자동 실행")
        .checked(false)
        .build(app)?;

    let quit_item = MenuItemBuilder::with_id("quit", "종료").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &resume_item])
        .separator()
        .item(&lang_submenu)
        .item(&autostart_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .menu_on_left_click(true)
        .tooltip("Agent Mascot")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "resume" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("mascot://open-resume-modal", ());
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
```

**Step 2: main.rs에 트레이 셋업 추가**

setup 클로저 내에서:

```rust
// 시스템 트레이
tray::setup_tray(app).map_err(|e| e.to_string())?;
```

**Step 3: 빌드 확인**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`
Expected: 성공

**Step 4: 커밋**

```bash
git add src-tauri/src/tray/ src-tauri/src/main.rs
git commit -m "feat: add system tray with Korean menu items"
```

---

## Task 11: WebView 기초 구조 (stores + types + i18n)

**목표:** Zustand 스토어, TypeScript 타입, i18next 설정 (architecture.md §3.2, ipc-protocol.md §2-3)

**Files:**
- Create: `apps/webview/src/types/agent.ts`
- Create: `apps/webview/src/types/event.ts`
- Create: `apps/webview/src/types/ipc.ts`
- Create: `apps/webview/src/stores/agent-store.ts`
- Create: `apps/webview/src/stores/error-store.ts`
- Create: `apps/webview/src/stores/ui-store.ts`
- Create: `apps/webview/src/i18n/index.ts`
- Create: `apps/webview/src/i18n/ko.json`
- Create: `apps/webview/src/i18n/en.json`
- Create: `apps/webview/src/tauri/commands.ts`
- Create: `apps/webview/src/tauri/events.ts`
- Create: `apps/webview/src/App.tsx`
- Create: `apps/webview/src/main.tsx`

**Step 1: TypeScript 타입 정의**

`apps/webview/src/types/agent.ts`:

```typescript
export type AgentStatus =
  | 'offline'
  | 'appearing'
  | 'idle'
  | 'working'
  | 'thinking'
  | 'pending_input'
  | 'failed'
  | 'completed'
  | 'resting'
  | 'startled'
  | 'walking'
  | 'chatting'
  | 'returning'
  | 'disappearing';

export type AgentRole = 'manager' | 'worker' | 'specialist' | 'unknown';
export type EmploymentType = 'employee' | 'contractor';

export interface AppearanceProfile {
  body_index: number;
  hair_index: number;
  outfit_index: number;
  accessory_index: number;
  face_index: number;
  hair_hue: number;
  outfit_hue: number;
  skin_hue: number;
  skin_lightness: number;
}

export interface MascotAgent {
  agent_id: string;
  display_name: string;
  role: AgentRole;
  employment_type: EmploymentType;
  workspace_id: string;
  status: AgentStatus;
  thinking_text: string | null;
  current_task: string | null;
  appearance: AppearanceProfile;
  last_active_ts: string;
}

export interface SlotCounts {
  body: number;
  hair: number;
  outfit: number;
  accessory: number;
  face: number;
}
```

`apps/webview/src/types/ipc.ts`:

```typescript
import type { AgentStatus, AppearanceProfile, MascotAgent } from './agent';

// Rust → WebView 이벤트 페이로드
export interface AgentAppearedPayload {
  agent_id: string;
  display_name: string;
  role: 'manager' | 'worker' | 'specialist' | 'unknown';
  employment_type: 'employee' | 'contractor';
  workspace_id: string;
  status: AgentStatus;
  appearance: AppearanceProfile;
  ts: string;
}

export interface AgentUpdatePayload {
  agent_id: string;
  status: AgentStatus;
  prev_status: AgentStatus;
  thinking_text: string | null;
  current_task: string | null;
  workspace_id: string;
  peer_agent_id: string | null;
  chat_message: string | null;
  ts: string;
}

export interface AgentDepartedPayload {
  agent_id: string;
  ts: string;
}

export interface ErrorPayload {
  source: string;
  message: string;
  ts: string;
}

export interface SettingsChangedPayload {
  key: string;
  value: unknown;
}

export interface DisplayConfig {
  max_bubble_chars: number;
  bubble_fade_ms: number;
  character_spacing_px: number;
  group_spacing_px: number;
  activity_zone_height_px: number;
  taskbar_offset_px: number;
  idle_sway_px: number;
}

export interface AgentResume {
  agent: MascotAgent;
  recent_events: ResumeEvent[];
  total_tasks_completed: number;
  total_tools_used: number;
  first_seen_ts: string;
}

export interface ResumeEvent {
  type: string;
  summary: string;
  ts: string;
}
```

**Step 2: Zustand 스토어**

`apps/webview/src/stores/agent-store.ts`:

```typescript
import { create } from 'zustand';
import type { MascotAgent, AgentStatus } from '../types/agent';

interface AgentStoreState {
  /** workspace_id → (agent_id → MascotAgent) */
  agentsByWorkspace: Map<string, Map<string, MascotAgent>>;

  addAgent: (agent: MascotAgent) => void;
  updateStatus: (agentId: string, status: AgentStatus, extra?: Partial<MascotAgent>) => void;
  removeAgent: (agentId: string) => void;
  getAllAgents: () => MascotAgent[];
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agentsByWorkspace: new Map(),

  addAgent: (agent) =>
    set((state) => {
      const next = new Map(state.agentsByWorkspace);
      const wsMap = new Map(next.get(agent.workspace_id) ?? []);
      wsMap.set(agent.agent_id, agent);
      next.set(agent.workspace_id, wsMap);
      return { agentsByWorkspace: next };
    }),

  updateStatus: (agentId, status, extra) =>
    set((state) => {
      const next = new Map(state.agentsByWorkspace);
      for (const [wsId, wsMap] of next) {
        if (wsMap.has(agentId)) {
          const updated = new Map(wsMap);
          const agent = updated.get(agentId)!;
          updated.set(agentId, { ...agent, status, ...extra });
          next.set(wsId, updated);
          break;
        }
      }
      return { agentsByWorkspace: next };
    }),

  removeAgent: (agentId) =>
    set((state) => {
      const next = new Map(state.agentsByWorkspace);
      for (const [wsId, wsMap] of next) {
        if (wsMap.has(agentId)) {
          const updated = new Map(wsMap);
          updated.delete(agentId);
          if (updated.size === 0) {
            next.delete(wsId);
          } else {
            next.set(wsId, updated);
          }
          break;
        }
      }
      return { agentsByWorkspace: next };
    }),

  getAllAgents: () => {
    const all: MascotAgent[] = [];
    for (const wsMap of get().agentsByWorkspace.values()) {
      for (const agent of wsMap.values()) {
        all.push(agent);
      }
    }
    return all;
  },
}));
```

`apps/webview/src/stores/error-store.ts`:

```typescript
import { create } from 'zustand';

export interface AppErrorEntry {
  source: string;
  message: string;
  ts: string;
}

interface ErrorStoreState {
  errors: AppErrorEntry[];
  push: (entry: AppErrorEntry) => void;
  dismiss: (index: number) => void;
  clear: () => void;
}

export const useErrorStore = create<ErrorStoreState>((set) => ({
  errors: [],
  push: (entry) => set((state) => ({ errors: [...state.errors, entry] })),
  dismiss: (index) =>
    set((state) => ({ errors: state.errors.filter((_, i) => i !== index) })),
  clear: () => set({ errors: [] }),
}));
```

`apps/webview/src/stores/ui-store.ts`:

```typescript
import { create } from 'zustand';
import type { DisplayConfig } from '../types/ipc';

interface UiStoreState {
  showResumeModal: boolean;
  displayConfig: DisplayConfig | null;
  setShowResumeModal: (show: boolean) => void;
  setDisplayConfig: (config: DisplayConfig) => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  showResumeModal: false,
  displayConfig: null,
  setShowResumeModal: (show) => set({ showResumeModal: show }),
  setDisplayConfig: (config) => set({ displayConfig: config }),
}));
```

**Step 3: Tauri IPC 래퍼**

`apps/webview/src/tauri/commands.ts`:

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { useErrorStore } from '../stores/error-store';
import type { MascotAgent, SlotCounts } from '../types/agent';
import type { DisplayConfig, AgentResume } from '../types/ipc';

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    useErrorStore.getState().push({
      source: `invoke:${cmd}`,
      message: String(error),
      ts: new Date().toISOString(),
    });
    throw error;
  }
}

export function getAllAgents(): Promise<MascotAgent[]> {
  return safeInvoke<MascotAgent[]>('get_all_agents');
}

export function getAgentResume(agentId: string): Promise<AgentResume> {
  return safeInvoke<AgentResume>('get_agent_resume', { agentId });
}

export function setSlotCounts(slotCounts: SlotCounts): Promise<void> {
  return safeInvoke<void>('set_slot_counts', { slotCounts });
}

export function notifyAnimationDone(agentId: string, animation: string): Promise<void> {
  return safeInvoke<void>('notify_animation_done', { agentId, animation });
}

export function notifyMovementDone(agentId: string, movementType: string): Promise<void> {
  return safeInvoke<void>('notify_movement_done', { agentId, movementType });
}

export function getDisplayConfig(): Promise<DisplayConfig> {
  return safeInvoke<DisplayConfig>('get_display_config');
}

export function toggleClickThrough(ignore: boolean): Promise<void> {
  return safeInvoke<void>('toggle_click_through', { ignore });
}
```

`apps/webview/src/tauri/events.ts`:

```typescript
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentAppearedPayload,
  AgentUpdatePayload,
  AgentDepartedPayload,
  ErrorPayload,
  SettingsChangedPayload,
} from '../types/ipc';

type EventCallback<T> = (payload: T) => void;

export async function onAgentAppeared(cb: EventCallback<AgentAppearedPayload>): Promise<UnlistenFn> {
  return listen<AgentAppearedPayload>('mascot://agent-appeared', (event) => cb(event.payload));
}

export async function onAgentUpdate(cb: EventCallback<AgentUpdatePayload>): Promise<UnlistenFn> {
  return listen<AgentUpdatePayload>('mascot://agent-update', (event) => cb(event.payload));
}

export async function onAgentDeparted(cb: EventCallback<AgentDepartedPayload>): Promise<UnlistenFn> {
  return listen<AgentDepartedPayload>('mascot://agent-departed', (event) => cb(event.payload));
}

export async function onError(cb: EventCallback<ErrorPayload>): Promise<UnlistenFn> {
  return listen<ErrorPayload>('mascot://error', (event) => cb(event.payload));
}

export async function onOpenResumeModal(cb: () => void): Promise<UnlistenFn> {
  return listen('mascot://open-resume-modal', () => cb());
}

export async function onSettingsChanged(cb: EventCallback<SettingsChangedPayload>): Promise<UnlistenFn> {
  return listen<SettingsChangedPayload>('mascot://settings-changed', (event) => cb(event.payload));
}
```

**Step 4: i18n 설정**

`apps/webview/src/i18n/ko.json`:

```json
{
  "tray": {
    "show": "마스코트 표시",
    "resume": "에이전트 이력서",
    "language": "언어",
    "autostart": "자동 실행",
    "quit": "종료"
  },
  "resume": {
    "title": "에이전트 이력서",
    "all": "전체",
    "employee": "정규직",
    "contractor": "계약직",
    "status": "상태",
    "task": "작업",
    "thinking": "생각"
  },
  "status": {
    "offline": "오프라인",
    "idle": "대기중",
    "working": "작업중",
    "thinking": "생각중",
    "pending_input": "입력 대기중",
    "failed": "실패",
    "completed": "완료",
    "resting": "휴식중",
    "startled": "깜짝!",
    "walking": "이동중",
    "chatting": "대화중",
    "returning": "복귀중"
  },
  "error": {
    "title": "오류",
    "dismiss": "닫기",
    "fatal": "치명적 오류가 발생했습니다"
  }
}
```

`apps/webview/src/i18n/en.json`:

```json
{
  "tray": {
    "show": "Show Mascot",
    "resume": "Agent Resume",
    "language": "Language",
    "autostart": "Auto Start",
    "quit": "Quit"
  },
  "resume": {
    "title": "Agent Resume",
    "all": "All",
    "employee": "Employee",
    "contractor": "Contractor",
    "status": "Status",
    "task": "Task",
    "thinking": "Thinking"
  },
  "status": {
    "offline": "Offline",
    "idle": "Idle",
    "working": "Working",
    "thinking": "Thinking",
    "pending_input": "Waiting for Input",
    "failed": "Failed",
    "completed": "Completed",
    "resting": "Resting",
    "startled": "Startled!",
    "walking": "Walking",
    "chatting": "Chatting",
    "returning": "Returning"
  },
  "error": {
    "title": "Error",
    "dismiss": "Dismiss",
    "fatal": "A fatal error occurred"
  }
}
```

`apps/webview/src/i18n/index.ts`:

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ko from './ko.json';
import en from './en.json';

i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
  },
  lng: 'ko',
  fallbackLng: 'ko',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
```

**Step 5: App.tsx + main.tsx 작성**

`apps/webview/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`apps/webview/src/App.tsx`:

```tsx
import { useEffect } from 'react';
import { useAgentStore } from './stores/agent-store';
import { useErrorStore } from './stores/error-store';
import { useUiStore } from './stores/ui-store';
import { getAllAgents, getDisplayConfig } from './tauri/commands';
import {
  onAgentAppeared,
  onAgentUpdate,
  onAgentDeparted,
  onError,
  onOpenResumeModal,
} from './tauri/events';

function App() {
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateStatus = useAgentStore((s) => s.updateStatus);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const pushError = useErrorStore((s) => s.push);
  const setDisplayConfig = useUiStore((s) => s.setDisplayConfig);
  const setShowResumeModal = useUiStore((s) => s.setShowResumeModal);

  useEffect(() => {
    // 초기화: 기존 에이전트 복원 + 설정 로드
    getAllAgents()
      .then((agents) => agents.forEach(addAgent))
      .catch(() => {});

    getDisplayConfig()
      .then(setDisplayConfig)
      .catch(() => {});

    // 이벤트 리스너 등록
    const unlisteners = Promise.all([
      onAgentAppeared((p) => {
        addAgent({
          agent_id: p.agent_id,
          display_name: p.display_name,
          role: p.role,
          employment_type: p.employment_type,
          workspace_id: p.workspace_id,
          status: p.status,
          thinking_text: null,
          current_task: null,
          appearance: p.appearance,
          last_active_ts: p.ts,
        });
      }),
      onAgentUpdate((p) => {
        updateStatus(p.agent_id, p.status, {
          thinking_text: p.thinking_text,
          current_task: p.current_task,
        });
      }),
      onAgentDeparted((p) => {
        removeAgent(p.agent_id);
      }),
      onError((p) => {
        pushError(p);
      }),
      onOpenResumeModal(() => {
        setShowResumeModal(true);
      }),
    ]);

    return () => {
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', background: 'transparent' }}>
      {/* PixiJS 캔버스가 여기에 마운트될 예정 */}
      {/* ErrorToast, ResumeModal 등 React 오버레이 컴포넌트 추가 예정 */}
    </div>
  );
}

export default App;
```

**Step 6: tsconfig.json strict 모드 확인**

`apps/webview/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"]
}
```

**Step 7: pnpm install + WebView 빌드 확인**

```bash
cd /mnt/f/hayoung/git/Agent_Office_Dashboard
pnpm install
pnpm webview:build
```

Expected: TypeScript 컴파일 + Vite 빌드 성공

**Step 8: 커밋**

```bash
git add apps/webview/
git commit -m "feat: add WebView foundation — stores, types, i18n, IPC wrappers"
```

---

## Task 12: Tauri IPC 명령 등록

**목표:** WebView에서 호출하는 Tauri invoke 명령을 Rust 측에 등록 (ipc-protocol.md §3)

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/agents.rs`
- Create: `src-tauri/src/commands/window.rs`
- Modify: `src-tauri/src/main.rs` — invoke_handler 등록
- Create: `src-tauri/src/services/mod.rs` (빈 모듈 선언)
- Create: `src-tauri/src/services/appearance.rs` (PRNG + 외형 생성)

**Step 1: services/appearance.rs 작성 (spine-spec.md §3)**

```rust
use crate::config::AppearanceConfig;
use crate::models::agent::{AppearanceProfile, SlotCounts};

pub fn hash_seed(agent_id: &str) -> u32 {
    let mut h: u32 = 0;
    for byte in agent_id.bytes() {
        h = h.wrapping_mul(31).wrapping_add(byte as u32);
    }
    h
}

pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut t = self.state ^ (self.state >> 15);
        t = t.wrapping_mul(1 | self.state);
        t = (t.wrapping_add(t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }

    pub fn next_index(&mut self, count: usize) -> usize {
        (self.next_f64() * count as f64) as usize
    }
}

pub fn generate_appearance(
    agent_id: &str,
    slot_counts: &SlotCounts,
    config: &AppearanceConfig,
) -> AppearanceProfile {
    let seed = hash_seed(agent_id);
    let mut rng = Mulberry32::new(seed);

    AppearanceProfile {
        body_index: rng.next_index(slot_counts.body.max(1)),
        hair_index: rng.next_index(slot_counts.hair.max(1)),
        outfit_index: rng.next_index(slot_counts.outfit.max(1)),
        accessory_index: rng.next_index(slot_counts.accessory + 1),
        face_index: rng.next_index(slot_counts.face.max(1)),
        hair_hue: rng.next_f64() * 360.0,
        outfit_hue: rng.next_f64() * 360.0,
        skin_hue: rng.next_f64() * 360.0,
        skin_lightness: config.skin_lightness_min
            + rng.next_f64() * (config.skin_lightness_max - config.skin_lightness_min),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_appearance() {
        let counts = SlotCounts {
            body: 3, hair: 6, outfit: 5, accessory: 3, face: 2,
        };
        let config = AppearanceConfig {
            skin_saturation_min: 25.0,
            skin_saturation_max: 54.0,
            skin_lightness_min: 75.0,
            skin_lightness_max: 89.0,
        };

        let a1 = generate_appearance("worker-01", &counts, &config);
        let a2 = generate_appearance("worker-01", &counts, &config);

        // 동일 agent_id → 동일 외형
        assert_eq!(a1.body_index, a2.body_index);
        assert_eq!(a1.hair_index, a2.hair_index);
        assert_eq!(a1.hair_hue, a2.hair_hue);
    }

    #[test]
    fn test_different_agents_different_appearance() {
        let counts = SlotCounts {
            body: 3, hair: 6, outfit: 5, accessory: 3, face: 2,
        };
        let config = AppearanceConfig {
            skin_saturation_min: 25.0,
            skin_saturation_max: 54.0,
            skin_lightness_min: 75.0,
            skin_lightness_max: 89.0,
        };

        let a1 = generate_appearance("worker-01", &counts, &config);
        let a2 = generate_appearance("worker-02", &counts, &config);

        // 다른 agent_id → 다른 seed → 높은 확률로 다른 외형
        // (해시 충돌이 아닌 한 다를 것)
        let same = a1.body_index == a2.body_index
            && a1.hair_index == a2.hair_index
            && a1.outfit_index == a2.outfit_index;
        assert!(!same, "different agents should have different appearances");
    }

    #[test]
    fn test_skin_lightness_in_range() {
        let counts = SlotCounts {
            body: 3, hair: 6, outfit: 5, accessory: 3, face: 2,
        };
        let config = AppearanceConfig {
            skin_saturation_min: 25.0,
            skin_saturation_max: 54.0,
            skin_lightness_min: 75.0,
            skin_lightness_max: 89.0,
        };

        for i in 0..100 {
            let a = generate_appearance(&format!("agent-{i}"), &counts, &config);
            assert!(a.skin_lightness >= 75.0 && a.skin_lightness <= 89.0,
                "skin_lightness {} out of range for agent-{}", a.skin_lightness, i);
        }
    }
}
```

**Step 2: services/mod.rs**

```rust
pub mod appearance;
pub mod heartbeat;
pub mod normalizer;
pub mod state_machine;
```

heartbeat.rs, normalizer.rs, state_machine.rs는 빈 파일로 생성:

```rust
// TODO: 다음 Phase에서 구현
```

**Step 3: commands/agents.rs 작성**

```rust
use crate::models::agent::{MascotAgent, SlotCounts};
use crate::config::DisplayConfig;
use crate::error::AppError;

#[tauri::command]
pub async fn get_all_agents() -> Result<Vec<MascotAgent>, AppError> {
    // TODO: storage에서 로드
    Ok(vec![])
}

#[tauri::command]
pub async fn get_agent_resume(agent_id: String) -> Result<serde_json::Value, AppError> {
    // TODO: storage에서 로드
    Ok(serde_json::json!(null))
}

#[tauri::command]
pub async fn set_slot_counts(slot_counts: SlotCounts) -> Result<(), AppError> {
    // TODO: 앱 상태에 저장
    tracing::info!("slot_counts received: {:?}", slot_counts);
    Ok(())
}

#[tauri::command]
pub async fn notify_animation_done(agent_id: String, animation: String) -> Result<(), AppError> {
    // TODO: synthetic 이벤트 처리
    tracing::info!("animation_done: {} - {}", agent_id, animation);
    Ok(())
}

#[tauri::command]
pub async fn notify_movement_done(agent_id: String, movement_type: String) -> Result<(), AppError> {
    // TODO: synthetic 이벤트 처리
    tracing::info!("movement_done: {} - {}", agent_id, movement_type);
    Ok(())
}

#[tauri::command]
pub async fn notify_chat_done(agent_id: String) -> Result<(), AppError> {
    tracing::info!("chat_done: {}", agent_id);
    Ok(())
}

#[tauri::command]
pub async fn get_display_config() -> Result<DisplayConfig, AppError> {
    // TODO: config에서 로드
    Ok(DisplayConfig {
        activity_zone_height_px: 120,
        taskbar_offset_px: 48,
        character_spacing_px: 60,
        group_spacing_px: 150,
        max_bubble_chars: 80,
        bubble_fade_ms: 3000,
        idle_sway_px: 2,
    })
}
```

**Step 4: commands/window.rs 작성**

```rust
use crate::error::AppError;

#[tauri::command]
pub async fn toggle_click_through(
    window: tauri::WebviewWindow,
    ignore: bool,
) -> Result<(), AppError> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| AppError::HttpServer(e.to_string()))?;
    Ok(())
}
```

**Step 5: commands/mod.rs**

```rust
pub mod agents;
pub mod window;
```

**Step 6: main.rs에 invoke_handler 등록**

```rust
mod commands;
mod config;
mod error;
mod http;
mod models;
mod services;
mod storage;
mod tray;

use config::AppConfig;
use std::path::PathBuf;

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .setup(|app| {
            let config_path = app
                .path()
                .resource_dir()
                .map(|d| d.join("config.toml"))
                .unwrap_or_else(|_| PathBuf::from("config.toml"));

            let config = AppConfig::load(&config_path).map_err(|e| {
                eprintln!("Config load failed: {e}");
                e.to_string()
            })?;

            let server_config = config.server.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http::server::start_http_server(&server_config).await {
                    eprintln!("HTTP server error: {e}");
                }
            });

            tray::setup_tray(app).map_err(|e| e.to_string())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agents::get_all_agents,
            commands::agents::get_agent_resume,
            commands::agents::set_slot_counts,
            commands::agents::notify_animation_done,
            commands::agents::notify_movement_done,
            commands::agents::notify_chat_done,
            commands::agents::get_display_config,
            commands::window::toggle_click_through,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 7: 빌드 + 테스트**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
cargo test --manifest-path src-tauri/Cargo.toml 2>&1
```

Expected: 빌드 성공, 모든 테스트 PASS

**Step 8: 커밋**

```bash
git add src-tauri/src/commands/ src-tauri/src/services/ src-tauri/src/main.rs
git commit -m "feat: register Tauri IPC commands and appearance service with PRNG"
```

---

## Task 13: Hook Forwarder 스크립트

**목표:** Claude Code hooks에서 호출하는 forward-to-mascot.mjs 작성 (hooks-integration.md §3)

**Files:**
- Create: `scripts/hooks/forward-to-mascot.mjs`

**Step 1: forward-to-mascot.mjs 작성**

```javascript
#!/usr/bin/env node

/**
 * Claude Code hook forwarder → Agent Mascot
 * stdin에서 hook payload를 받아 Agent Mascot HTTP 서버로 전달.
 * 앱이 실행 중이 아니면 자동 실행을 시도한다.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';

const COLLECTOR_URL = process.env.MASCOT_COLLECTOR_URL ?? 'http://127.0.0.1:4820';
const HEALTH_TIMEOUT_MS = 500;
const INGEST_TIMEOUT_MS = 5000;
const LAUNCH_WAIT_MAX_MS = 5000;
const LAUNCH_POLL_INTERVAL_MS = 500;

async function main() {
  // 1. stdin에서 payload 읽기
  let raw;
  try {
    const input = readFileSync(0, 'utf-8');
    raw = JSON.parse(input);
  } catch (err) {
    process.stderr.write(`[mascot-hook] stdin parse error: ${err.message}\n`);
    process.exit(1);
  }

  // 2. 메타데이터 추가
  const enriched = {
    ...raw,
    _meta: {
      workspace_id: raw._meta?.workspace_id ?? deriveWorkspaceId(),
      terminal_session_id:
        raw._meta?.terminal_session_id ?? process.env.TERM_SESSION_ID ?? 'unknown',
      collected_at: new Date().toISOString(),
      forwarder_version: '2.0.0',
    },
  };

  // 3. 앱 실행 확인 + 자동 실행
  await ensureAppRunning();

  // 4. POST /ingest
  try {
    const res = await fetch(`${COLLECTOR_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enriched),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      process.stderr.write(`[mascot-hook] ingest failed: ${res.status}\n`);
    }
  } catch (err) {
    process.stderr.write(`[mascot-hook] ingest error: ${err.message}\n`);
  }
}

function deriveWorkspaceId() {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return basename(process.env.CLAUDE_PROJECT_DIR);
  }
  return basename(process.cwd());
}

async function ensureAppRunning() {
  try {
    const res = await fetch(`${COLLECTOR_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (res.ok) return;
  } catch {
    // 앱 미실행
  }

  const appPath = process.env.MASCOT_APP_PATH ?? detectAppPath();
  if (!appPath) {
    process.stderr.write('[mascot-hook] app not found, cannot auto-launch\n');
    return;
  }

  try {
    const child = execFile(appPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    process.stderr.write(`[mascot-hook] launch error: ${err.message}\n`);
    return;
  }

  const maxAttempts = LAUNCH_WAIT_MAX_MS / LAUNCH_POLL_INTERVAL_MS;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, LAUNCH_POLL_INTERVAL_MS));
    try {
      const res = await fetch(`${COLLECTOR_URL}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.ok) return;
    } catch {
      // 아직 시작 안 됨
    }
  }

  process.stderr.write('[mascot-hook] app launch timeout\n');
}

function detectAppPath() {
  const { platform } = process;
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(
      `${process.env.LOCALAPPDATA}/Agent Mascot/agent-mascot.exe`,
      `${process.env.PROGRAMFILES}/Agent Mascot/agent-mascot.exe`,
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Agent Mascot.app/Contents/MacOS/agent-mascot',
      `${process.env.HOME}/Applications/Agent Mascot.app/Contents/MacOS/agent-mascot`,
    );
  } else {
    candidates.push(
      '/usr/bin/agent-mascot',
      `${process.env.HOME}/.local/bin/agent-mascot`,
      '/usr/local/bin/agent-mascot',
    );
  }

  return candidates.find((p) => existsSync(p)) ?? null;
}

main();
```

**Step 2: 커밋**

```bash
git add scripts/hooks/forward-to-mascot.mjs
git commit -m "feat: add hook forwarder script with auto-launch support"
```

---

## Task 14: 통합 빌드 검증 + 최종 커밋

**목표:** 전체 프로젝트 빌드 성공 확인, Rust 테스트 전체 통과 확인

**Step 1: Rust 전체 테스트**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1
```

Expected: config (4) + storage (3) + appearance (3) = 최소 10개 테스트 PASS

**Step 2: WebView 빌드**

```bash
pnpm webview:build
```

Expected: 성공

**Step 3: Tauri 전체 빌드 (debug)**

```bash
cargo tauri build --debug 2>&1 | tail -20
```

Expected: 빌드 성공 (WSL2에서 실행 가능한 바이너리 생성)

**Step 4: 최종 커밋 (필요 시)**

```bash
git add -A
git commit -m "chore: Phase 2 scaffold complete — Tauri v2 + Rust core + WebView foundation"
```

---

## 요약

| Task | 내용 | 산출물 |
|------|------|--------|
| 1 | 개발 환경 설정 | Rust + 시스템 의존성 |
| 2 | Tauri v2 프로젝트 생성 | create-tauri-app 기반 scaffold |
| 3 | 프로젝트 구조 재배치 | architecture.md 디렉토리 구조 |
| 4 | Rust 에러 타입 | `error.rs` — AppError + ConfigError |
| 5 | Config 시스템 | `config.rs` + `config.toml` + 4개 테스트 |
| 6 | 도메인 모델 | `models/` — AgentStatus(14개), NormalizedEvent |
| 7 | SQLite 저장소 | `storage/` — DB 초기화, 3개 repo, 3개 테스트 |
| 8 | HTTP 서버 | `http/` — /health + /ingest 스텁 |
| 9 | 투명 윈도우 | tauri.conf.json — 투명, 데코레이션 없음, always-on-top |
| 10 | 시스템 트레이 | `tray/` — 한국어 메뉴 5개 항목 |
| 11 | WebView 기초 | stores(3개), types(3개), i18n(ko/en), IPC 래퍼 |
| 12 | IPC 명령 등록 | `commands/` — 8개 invoke 핸들러 + appearance 서비스 |
| 13 | Hook Forwarder | `scripts/hooks/forward-to-mascot.mjs` |
| 14 | 통합 빌드 검증 | 전체 빌드 + 테스트 통과 |
