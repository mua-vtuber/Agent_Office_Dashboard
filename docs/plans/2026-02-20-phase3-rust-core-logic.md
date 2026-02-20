# Phase 3: Rust Core Logic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Phase 2에서 만든 스텁 서비스들(normalizer, state_machine, heartbeat)과 스텁 커맨드 7개를 실제 구현하여, hook 이벤트 수신 → 정규화 → 상태 전이 → WebView emit까지 end-to-end 파이프라인을 완성한다.

**Architecture:** axum HTTP `/ingest` 엔드포인트가 hook payload를 수신하면, Normalizer가 NormalizedEvent로 변환하고, State Machine이 에이전트 상태를 전이하고, Storage에 저장하고, Tauri emit으로 WebView에 통보한다. Heartbeat 서비스가 주기적으로 타이머 기반 전이(idle→resting, completed→disappearing, chatting→returning)를 수행한다.

**Tech Stack:** Tauri v2, Rust, axum 0.8, rusqlite 0.32 (bundled), chrono 0.4, tokio 1, serde, thiserror 2

**참조 스펙:**
- `docs/mascot-state-machine.md` — 14개 상태, ~30 전이 규칙, 타이머 전이
- `docs/mascot-hooks-integration.md` — hook 매핑, 정규화, 핑거프린트, 10단계 파이프라인
- `docs/mascot-ipc-protocol.md` — 6개 Rust→WebView 이벤트, 8개 WebView→Rust 커맨드

---

## Task 1: 모델 업데이트 + DB 마이그레이션 + chrono 의존성

현재 누락된 EventType 변형(ThinkingUpdated), AgentState.prev_status 필드, events 테이블 컬럼들을 추가한다.

**Files:**
- Modify: `src-tauri/Cargo.toml` — chrono 의존성 추가
- Modify: `src-tauri/src/models/event.rs:6-36` — ThinkingUpdated 추가
- Modify: `src-tauri/src/models/agent.rs:42-54` — prev_status 필드 추가
- Modify: `src-tauri/src/storage/db.rs:29-84` — 마이그레이션 업데이트

**Step 1: chrono 의존성 추가**

`src-tauri/Cargo.toml` [dependencies] 섹션에 추가:

```toml
chrono = { version = "0.4", features = ["serde"] }
```

**Step 2: EventType에 ThinkingUpdated 추가**

`src-tauri/src/models/event.rs` EventType enum에 추가:

```rust
// 도구 실행 아래에 추가
// 확장 사고
ThinkingUpdated,
```

state-machine.md §4.1에서 `thinking_updated` 이벤트가 사용되지만 현재 enum에 없음.

**Step 3: AgentState에 prev_status 추가**

`src-tauri/src/models/agent.rs` AgentState 구조체:

```rust
pub struct AgentState {
    pub agent_id: String,
    pub status: AgentStatus,
    pub prev_status: Option<AgentStatus>,  // walking/returning 전의 상태 (복귀 시 복원)
    pub thinking_text: Option<String>,
    pub current_task: Option<String>,
    pub workspace_id: String,
    pub since: String,
    pub last_event_ts: String,
    pub session_id: Option<String>,
    pub peer_agent_id: Option<String>,
    pub home_x: f64,
}
```

ipc-protocol.md §2.2 `mascot://agent-update`에 `prev_status`가 필요하고, state-machine.md §4.1 `returning → arrive_at_home → (이전 상태)` 복원에 필요.

**Step 4: DB 마이그레이션 업데이트**

`src-tauri/src/storage/db.rs` run_migrations()에서 events 테이블에 누락된 컬럼과 agent_state에 prev_status 추가:

```rust
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
```

변경 사항:
- `agent_state`: `prev_status TEXT` 컬럼 추가
- `events`: `run_id`, `session_id`, `target_agent_id`, `task_id` 컬럼 추가
- `events`: `idx_events_type` 인덱스 추가

**Step 5: 기존 테스트 업데이트 + 실행**

StateRepo 테스트의 `make_test_state()`에 `prev_status: None` 추가.

Run: `export PATH="/home/taniar/.cargo/bin:$PATH:/usr/bin" && cd /mnt/f/hayoung/git/Agent_Office_Dashboard/src-tauri && cargo test`
Expected: 모든 기존 테스트 통과

**Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/models/event.rs src-tauri/src/models/agent.rs src-tauri/src/storage/db.rs src-tauri/src/storage/state_repo.rs
git commit -m "feat(phase3): add ThinkingUpdated event, prev_status field, events table columns"
```

---

## Task 2: AppState 구조체 + lib.rs 와이어링

공유 애플리케이션 상태(AppState)를 정의하고, lib.rs에서 DB 초기화, managed state 등록, HTTP 서버에 상태 전달, heartbeat 스폰을 와이어링한다.

**Files:**
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/http/server.rs`
- Modify: `src-tauri/src/http/mod.rs`

**Step 1: AppState 구조체 생성**

Create `src-tauri/src/state.rs`:

```rust
use crate::config::AppConfig;
use crate::models::agent::SlotCounts;
use crate::storage::db::DbPool;
use std::sync::{Arc, Mutex};

/// 앱 전역 공유 상태.
/// Tauri managed state + axum 라우터 양쪽에서 사용한다.
#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub config: Arc<AppConfig>,
    pub slot_counts: Arc<Mutex<SlotCounts>>,
}
```

**Step 2: lib.rs에 mod state 추가 + DB 초기화 + managed state 등록**

`src-tauri/src/lib.rs` 전체 재작성:

```rust
mod commands;
mod config;
mod error;
mod http;
mod models;
mod services;
mod state;
mod storage;
mod tray;

pub use config::AppConfig;
pub use error::{AppError, ConfigError};
pub use state::AppState;

use models::agent::SlotCounts;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .setup(|app| {
            // 1. config.toml 로드
            let config_path = app
                .path()
                .resource_dir()
                .map(|d| d.join("config.toml"))
                .unwrap_or_else(|e| {
                    tracing::warn!("resource_dir() failed ({e}), falling back to ./config.toml");
                    std::path::PathBuf::from("config.toml")
                });

            let config = AppConfig::load(&config_path).map_err(|e| {
                eprintln!("Config load failed: {e}");
                e.to_string()
            })?;

            // 2. SQLite 초기화
            let db_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir() failed: {e}"))?;
            std::fs::create_dir_all(&db_dir)
                .map_err(|e| format!("failed to create data dir: {e}"))?;
            let db_path = db_dir.join("mascot.db");
            let db = storage::db::init_db(&db_path)
                .map_err(|e| format!("DB init failed: {e}"))?;

            // 3. AppState 생성 + managed state 등록
            let app_state = AppState {
                db: db.clone(),
                config: Arc::new(config.clone()),
                slot_counts: Arc::new(Mutex::new(SlotCounts::default())),
            };
            app.manage(app_state.clone());

            // 4. HTTP 서버 시작 (AppState + AppHandle 전달)
            let server_config = config.server.clone();
            let server_state = app_state.clone();
            let server_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http::server::start_http_server(
                    &server_config,
                    server_state,
                    server_handle,
                ).await {
                    tracing::error!("HTTP server error: {e}");
                }
            });

            // 5. Heartbeat 서비스 시작
            let heartbeat_state = app_state.clone();
            let heartbeat_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                services::heartbeat::run_heartbeat(heartbeat_state, heartbeat_handle).await;
            });

            // 6. 시스템 트레이
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
        .expect("Fatal: failed to start tauri application");
}
```

**Step 3: HTTP 서버에 상태 전달**

`src-tauri/src/http/server.rs` 수정:

```rust
use crate::config::ServerConfig;
use crate::error::AppError;
use crate::http::ingest::ingest_handler;
use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;

async fn health_handler() -> &'static str {
    "ok"
}

/// axum 라우터의 공유 상태. AppState + Tauri AppHandle.
#[derive(Clone)]
pub struct IngestState {
    pub app_state: AppState,
    pub app_handle: tauri::AppHandle,
}

pub fn create_router(state: IngestState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/ingest", post(ingest_handler))
        .with_state(state)
}

/// axum HTTP 서버를 시작한다. Tauri의 tokio runtime에서 spawn한다.
pub async fn start_http_server(
    config: &ServerConfig,
    app_state: AppState,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e: std::net::AddrParseError| AppError::HttpServer(e.to_string()))?;

    let ingest_state = IngestState {
        app_state,
        app_handle,
    };
    let router = create_router(ingest_state);

    tracing::info!("HTTP server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| AppError::HttpServer(e.to_string()))?;

    axum::serve(listener, router)
        .await
        .map_err(|e| AppError::HttpServer(e.to_string()))?;

    Ok(())
}
```

**Step 4: ingest.rs 시그니처 임시 업데이트**

`src-tauri/src/http/ingest.rs`를 axum State 추출 시그니처로 업데이트 (본격 구현은 Task 8):

```rust
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use crate::http::server::IngestState;

/// POST /ingest -- hook payload 수신 (스텁: 수신만 하고 200 응답)
pub async fn ingest_handler(
    State(_state): State<IngestState>,
    Json(payload): Json<serde_json::Value>,
) -> StatusCode {
    // TODO: Task 8에서 10단계 파이프라인 구현
    tracing::info!("ingest received: {}", payload);
    StatusCode::OK
}
```

**Step 5: heartbeat.rs 임시 시그니처 업데이트**

`src-tauri/src/services/heartbeat.rs`를 컴파일 가능한 스텁으로:

```rust
use crate::state::AppState;

/// Heartbeat 서비스 메인 루프. Task 7에서 본격 구현.
pub async fn run_heartbeat(_state: AppState, _app_handle: tauri::AppHandle) {
    tracing::info!("heartbeat service started (stub)");
    // TODO: Task 7에서 tokio::time::interval 루프 구현
    std::future::pending::<()>().await;
}
```

**Step 6: 빌드 확인**

Run: `export PATH="/home/taniar/.cargo/bin:$PATH:/usr/bin" && cd /mnt/f/hayoung/git/Agent_Office_Dashboard/src-tauri && cargo build`
Expected: 컴파일 성공

Run: `cargo test`
Expected: 모든 테스트 통과

**Step 7: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs src-tauri/src/http/server.rs src-tauri/src/http/ingest.rs src-tauri/src/services/heartbeat.rs
git commit -m "feat(phase3): add AppState, wire DB init + managed state + HTTP server state"
```

---

## Task 3: Settings Repo

트레이 메뉴의 언어/자동실행 설정을 저장할 settings 테이블 CRUD를 구현한다.

**Files:**
- Create: `src-tauri/src/storage/settings_repo.rs`
- Modify: `src-tauri/src/storage/mod.rs`

**Step 1: Failing test 작성**

Create `src-tauri/src/storage/settings_repo.rs`:

```rust
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
```

**Step 2: mod.rs에 추가**

`src-tauri/src/storage/mod.rs`:

```rust
pub mod db;
pub mod agents_repo;
pub mod events_repo;
pub mod settings_repo;
pub mod state_repo;
```

**Step 3: 테스트 실행**

Run: `cargo test settings_repo`
Expected: 4/4 통과

**Step 4: Commit**

```bash
git add src-tauri/src/storage/settings_repo.rs src-tauri/src/storage/mod.rs
git commit -m "feat(phase3): add SettingsRepo with get/set/delete + tests"
```

---

## Task 4: Storage Repo 확장

AgentsRepo에 get_by_id(), EventsRepo에 새 컬럼 INSERT + 쿼리 메서드, StateRepo에 prev_status 처리를 추가한다.

**Files:**
- Modify: `src-tauri/src/storage/agents_repo.rs`
- Modify: `src-tauri/src/storage/events_repo.rs`
- Modify: `src-tauri/src/storage/state_repo.rs`

**Step 1: AgentsRepo.get_by_id() 추가**

`src-tauri/src/storage/agents_repo.rs`에 메서드 추가:

```rust
pub fn get_by_id(&self, agent_id: &str) -> Result<Option<MascotAgent>, AppError> {
    let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT agent_id, display_name, role, employment_type, workspace_id, appearance_json, last_active_ts
         FROM agents WHERE agent_id = ?1",
    )?;

    let result = stmt.query_row(rusqlite::params![agent_id], |row| {
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
    });

    match result {
        Ok(agent) => Ok(Some(agent)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
```

테스트 추가:

```rust
#[test]
fn test_get_by_id() {
    let db = init_db_in_memory().expect("db init");
    let repo = AgentsRepo::new(db);

    repo.upsert(&make_test_agent("agent-01")).expect("upsert");

    let found = repo.get_by_id("agent-01").expect("get").expect("should exist");
    assert_eq!(found.agent_id, "agent-01");

    let not_found = repo.get_by_id("nonexistent").expect("get");
    assert!(not_found.is_none());
}
```

**Step 2: EventsRepo.insert() 확장 — 새 컬럼 포함**

`src-tauri/src/storage/events_repo.rs` insert() SQL을 업데이트:

```rust
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
        "INSERT OR IGNORE INTO events (id, version, ts, event_type, source, workspace_id,
         terminal_session_id, run_id, session_id, agent_id, target_agent_id, task_id,
         severity, payload_json, thinking_text, raw_json, fingerprint)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        rusqlite::params![
            event.id,
            event.version,
            event.ts,
            event_type_str,
            source_str,
            event.workspace_id,
            event.terminal_session_id,
            event.run_id,
            event.session_id,
            event.agent_id,
            event.target_agent_id,
            event.task_id,
            severity_str,
            payload_json,
            event.thinking_text,
            raw_json,
            fingerprint,
        ],
    )?;

    Ok(rows > 0)
}
```

**Step 3: EventsRepo 쿼리 메서드 추가**

ipc-protocol.md §3.1 `get_agent_resume`에 필요한 쿼리들:

```rust
/// 에이전트의 최근 이벤트 조회 (이력서용)
pub fn get_recent_by_agent(
    &self,
    agent_id: &str,
    limit: usize,
) -> Result<Vec<ResumeEvent>, AppError> {
    let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT event_type, payload_json, ts FROM events
         WHERE agent_id = ?1
         ORDER BY ts DESC LIMIT ?2",
    )?;

    let events = stmt
        .query_map(rusqlite::params![agent_id, limit as i64], |row| {
            let event_type_str: String = row.get(0)?;
            let payload_str: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let ts: String = row.get(2)?;

            // 이벤트 타입에서 요약 생성
            let summary = extract_summary_from_type(&event_type_str, &payload_str);

            Ok(ResumeEvent {
                event_type: event_type_str,
                summary,
                ts,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(events)
}

/// 완료된 작업 수 카운트
pub fn count_completed_tasks(&self, agent_id: &str) -> Result<u64, AppError> {
    let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM events WHERE agent_id = ?1 AND event_type = '\"task_completed\"'",
        rusqlite::params![agent_id],
        |row| row.get(0),
    )?;
    Ok(count as u64)
}

/// 사용한 도구 수 카운트
pub fn count_tools_used(&self, agent_id: &str) -> Result<u64, AppError> {
    let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM events WHERE agent_id = ?1 AND event_type = '\"tool_started\"'",
        rusqlite::params![agent_id],
        |row| row.get(0),
    )?;
    Ok(count as u64)
}
```

ResumeEvent 구조체를 `models/event.rs`에 추가:

```rust
/// 이력서용 이벤트 요약 (ipc-protocol.md §3.1)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeEvent {
    pub event_type: String,
    pub summary: String,
    pub ts: String,
}
```

`events_repo.rs`에 summary 헬퍼 (파일 상단에):

```rust
fn extract_summary_from_type(event_type: &str, payload_str: &str) -> String {
    let payload: serde_json::Value = serde_json::from_str(payload_str).unwrap_or_default();
    let tool_name = payload.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
    match event_type {
        "\"task_completed\"" => "작업 완료".to_string(),
        "\"task_started\"" => "작업 시작".to_string(),
        "\"tool_started\"" => format!("도구 실행: {tool_name}"),
        "\"tool_succeeded\"" => format!("도구 성공: {tool_name}"),
        "\"tool_failed\"" => format!("도구 실패: {tool_name}"),
        "\"agent_started\"" => "에이전트 시작".to_string(),
        "\"agent_stopped\"" => "에이전트 종료".to_string(),
        _ => event_type.trim_matches('"').to_string(),
    }
}
```

**Step 4: StateRepo에 prev_status 처리 추가**

`src-tauri/src/storage/state_repo.rs`의 upsert, get, get_all에서 prev_status를 포함하도록 수정.

upsert():
```rust
pub fn upsert(&self, state: &AgentState) -> Result<(), AppError> {
    let conn = self.db.lock().map_err(|e| AppError::LockPoisoned(e.to_string()))?;
    let status_str = serde_json::to_string(&state.status)
        .map_err(|e| AppError::Normalize(e.to_string()))?;
    let prev_status_str = state.prev_status.as_ref()
        .map(|s| serde_json::to_string(s).map_err(|e| AppError::Normalize(e.to_string())))
        .transpose()?;

    conn.execute(
        "INSERT INTO agent_state (agent_id, status, prev_status, thinking_text, current_task,
         workspace_id, since, last_event_ts, session_id, peer_agent_id, home_x)
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
```

get() row mapper에 prev_status 파싱 추가:
```rust
let prev_status_str: Option<String> = row.get(2)?;
// ...
prev_status: prev_status_str
    .map(|s| serde_json::from_str(&s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            2, rusqlite::types::Type::Text, Box::new(e),
        )
    }))
    .transpose()?,
```

SELECT 컬럼 순서 업데이트 — agent_id(0), status(1), prev_status(2), thinking_text(3), current_task(4), workspace_id(5), since(6), last_event_ts(7), session_id(8), peer_agent_id(9), home_x(10)

**Step 5: 테스트 실행**

Run: `cargo test`
Expected: 기존 + 신규 테스트 모두 통과

**Step 6: Commit**

```bash
git add src-tauri/src/storage/agents_repo.rs src-tauri/src/storage/events_repo.rs src-tauri/src/storage/state_repo.rs src-tauri/src/models/event.rs
git commit -m "feat(phase3): extend repos with get_by_id, resume queries, prev_status support"
```

---

## Task 5: Normalizer 서비스

hooks-integration.md §5.3~§7에 따라 hook payload를 NormalizedEvent로 변환하는 normalizer를 구현한다.

**Files:**
- Rewrite: `src-tauri/src/services/normalizer.rs`

**핵심 로직:**
- Hook 타입별 매핑 (SubagentStart → agent_started 등)
- PreToolUse 시맨틱 추출 (TaskCreate → task_created 등)
- 핑거프린트 생성 (session_id + tool_name + ts_bucket + payload_hash)
- 이벤트 ID 생성 (evt_{timestamp}_{seq})
- Thinking 텍스트 추출

**Step 1: Failing test 작성**

테스트 먼저 작성:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_normalize_subagent_start() {
        let raw = json!({
            "hook_type": "SubagentStart",
            "session_id": "sess-1",
            "agent_name": "worker-01",
            "agent_type": "general-purpose",
            "team_name": "my-project",
            "prompt": "do something",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::AgentStarted);
        assert_eq!(event.agent_id, "my-project/worker-01");
        assert_eq!(event.workspace_id, "my-project");
        assert_eq!(event.source, EventSource::Hook);
    }

    #[test]
    fn test_normalize_subagent_stop() {
        let raw = json!({
            "hook_type": "SubagentStop",
            "session_id": "sess-1",
            "agent_name": "worker-01",
            "team_name": "my-project",
            "result": "completed",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::AgentStopped);
    }

    #[test]
    fn test_normalize_pre_tool_use_basic() {
        let raw = json!({
            "hook_type": "PreToolUse",
            "session_id": "sess-1",
            "tool_name": "Read",
            "tool_input": {"file_path": "/some/file"},
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::ToolStarted);
    }

    #[test]
    fn test_normalize_pre_tool_use_task_update_completed() {
        let raw = json!({
            "hook_type": "PreToolUse",
            "session_id": "sess-1",
            "tool_name": "TaskUpdate",
            "tool_input": {"taskId": "1", "status": "completed"},
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::TaskCompleted);
    }

    #[test]
    fn test_normalize_post_tool_use_success() {
        let raw = json!({
            "hook_type": "PostToolUse",
            "session_id": "sess-1",
            "tool_name": "Read",
            "tool_result": "file contents",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::ToolSucceeded);
    }

    #[test]
    fn test_normalize_post_tool_use_failure() {
        let raw = json!({
            "hook_type": "PostToolUse",
            "session_id": "sess-1",
            "tool_name": "Bash",
            "error": "command failed",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::ToolFailed);
    }

    #[test]
    fn test_normalize_stop_event() {
        let raw = json!({
            "hook_type": "Stop",
            "session_id": "sess-1",
            "reason": "completed",
            "summary": "task done",
            "_meta": {
                "workspace_id": "my-project",
                "terminal_session_id": "term-1",
                "collected_at": "2026-02-20T15:00:00Z"
            }
        });

        let event = normalize(&raw).expect("should normalize");
        assert_eq!(event.event_type, EventType::AgentStopped);
    }

    #[test]
    fn test_normalize_missing_hook_type() {
        let raw = json!({"some": "data"});
        let result = normalize(&raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_fingerprint_deterministic() {
        let fp1 = generate_fingerprint("sess-1", "Read", "2026-02-20T15:00:00Z", &json!({}));
        let fp2 = generate_fingerprint("sess-1", "Read", "2026-02-20T15:00:00Z", &json!({}));
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_fingerprint_different_inputs() {
        let fp1 = generate_fingerprint("sess-1", "Read", "2026-02-20T15:00:00Z", &json!({}));
        let fp2 = generate_fingerprint("sess-2", "Read", "2026-02-20T15:00:00Z", &json!({}));
        assert_ne!(fp1, fp2);
    }

    #[test]
    fn test_agent_id_derivation() {
        // 팀 에이전트: {team_name}/{agent_name}
        assert_eq!(
            derive_agent_id(Some("my-team"), Some("worker-01"), Some("sess-1")),
            "my-team/worker-01"
        );

        // 팀 이름만: leader
        assert_eq!(
            derive_agent_id(Some("my-team"), None, Some("sess-1")),
            "my-team/leader"
        );

        // 팀 없음: session_id 사용
        assert_eq!(
            derive_agent_id(None, None, Some("sess-1")),
            "sess-1"
        );
    }
}
```

**Step 2: 구현**

```rust
use crate::error::AppError;
use crate::models::event::*;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};

static EVENT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 전역 고유 이벤트 ID 생성
fn generate_event_id() -> String {
    let ts = chrono::Utc::now().format("%Y%m%d%H%M%S");
    let seq = EVENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("evt_{ts}_{seq:06}")
}

/// 핑거프린트 생성 (hooks-integration.md §7.6)
/// fingerprint = hash(session_id + tool_name + ts_bucket + payload_hash)
pub fn generate_fingerprint(
    session_id: &str,
    tool_name: &str,
    ts: &str,
    payload: &serde_json::Value,
) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    session_id.hash(&mut hasher);
    tool_name.hash(&mut hasher);
    // ts_bucket: 1초 단위 절삭 (최소 19자: "2026-02-20T15:00:00")
    let ts_bucket = if ts.len() >= 19 { &ts[..19] } else { ts };
    ts_bucket.hash(&mut hasher);
    let payload_str = payload.to_string();
    payload_str.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// agent_id 도출 (hooks-integration.md §7.3)
pub fn derive_agent_id(
    team_name: Option<&str>,
    agent_name: Option<&str>,
    session_id: Option<&str>,
) -> String {
    match (team_name, agent_name) {
        (Some(team), Some(name)) => format!("{team}/{name}"),
        (Some(team), None) => format!("{team}/leader"),
        (None, Some(name)) => name.to_string(),
        (None, None) => session_id.unwrap_or("unknown").to_string(),
    }
}

/// hook payload → NormalizedEvent 변환 (hooks-integration.md §5.3~§7)
pub fn normalize(raw: &serde_json::Value) -> Result<NormalizedEvent, AppError> {
    let hook_type = raw
        .get("hook_type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Normalize("missing hook_type field".into()))?;

    let meta = raw.get("_meta").cloned().unwrap_or_else(|| serde_json::json!({}));
    let workspace_id = meta
        .get("workspace_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let terminal_session_id = meta
        .get("terminal_session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let ts = meta
        .get("collected_at")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let session_id = raw.get("session_id").and_then(|v| v.as_str());
    let team_name = raw.get("team_name").and_then(|v| v.as_str());
    let agent_name = raw.get("agent_name").and_then(|v| v.as_str());

    let agent_id = derive_agent_id(team_name, agent_name, session_id);

    let (event_type, severity, payload, target_agent_id, task_id) =
        map_hook_type(hook_type, raw)?;

    let tool_name = raw
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let fingerprint_payload = raw.get("tool_input").unwrap_or(&serde_json::json!({}));

    Ok(NormalizedEvent {
        id: generate_event_id(),
        version: "1.1".to_string(),
        ts,
        event_type,
        source: EventSource::Hook,
        workspace_id: workspace_id.to_string(),
        terminal_session_id: terminal_session_id.to_string(),
        run_id: raw.get("run_id").and_then(|v| v.as_str()).map(String::from),
        session_id: session_id.map(String::from),
        agent_id,
        target_agent_id,
        task_id,
        severity,
        payload,
        thinking_text: extract_thinking(raw),
        raw: raw.clone(),
    })
}

/// hook_type → (EventType, Severity, payload, target_agent_id, task_id) 매핑
fn map_hook_type(
    hook_type: &str,
    raw: &serde_json::Value,
) -> Result<(EventType, Severity, serde_json::Value, Option<String>, Option<String>), AppError> {
    match hook_type {
        "SubagentStart" => Ok((
            EventType::AgentStarted,
            Severity::Info,
            serde_json::json!({
                "agent_type": raw.get("agent_type").and_then(|v| v.as_str()).unwrap_or(""),
                "prompt_preview": raw.get("prompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.chars().take(200).collect::<String>())
                    .unwrap_or_default(),
            }),
            None,
            None,
        )),
        "SubagentStop" => Ok((
            EventType::AgentStopped,
            Severity::Info,
            serde_json::json!({
                "result": raw.get("result").and_then(|v| v.as_str()).unwrap_or(""),
            }),
            None,
            None,
        )),
        "Stop" => Ok((
            EventType::AgentStopped,
            Severity::Info,
            serde_json::json!({
                "reason": raw.get("reason").and_then(|v| v.as_str()).unwrap_or(""),
                "summary": raw.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
            }),
            None,
            None,
        )),
        "PreToolUse" => normalize_pre_tool_use(raw),
        "PostToolUse" => normalize_post_tool_use(raw),
        "Notification" => Ok((
            EventType::Notification,
            match raw.get("level").and_then(|v| v.as_str()) {
                Some("error") => Severity::Error,
                Some("warn") => Severity::Warn,
                Some("debug") => Severity::Debug,
                _ => Severity::Info,
            },
            serde_json::json!({
                "message": raw.get("message").and_then(|v| v.as_str()).unwrap_or(""),
            }),
            None,
            None,
        )),
        other => Err(AppError::Normalize(format!("unknown hook_type: {other}"))),
    }
}

/// PreToolUse 시맨틱 추출 (hooks-integration.md §6.1)
fn normalize_pre_tool_use(
    raw: &serde_json::Value,
) -> Result<(EventType, Severity, serde_json::Value, Option<String>, Option<String>), AppError> {
    let tool_name = raw
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tool_input = raw.get("tool_input").cloned().unwrap_or_else(|| serde_json::json!({}));

    let (event_type, task_id) = match tool_name {
        "TaskCreate" => (EventType::TaskCreated, None),
        "TaskUpdate" => {
            let status = tool_input.get("status").and_then(|v| v.as_str());
            let tid = tool_input
                .get("taskId")
                .and_then(|v| v.as_str())
                .map(String::from);
            match status {
                Some("completed") => (EventType::TaskCompleted, tid),
                Some("in_progress") => (EventType::TaskStarted, tid),
                _ => (EventType::TaskProgress, tid),
            }
        }
        _ => (EventType::ToolStarted, None),
    };

    Ok((
        event_type,
        Severity::Info,
        serde_json::json!({
            "tool_name": tool_name,
            "tool_input": tool_input,
        }),
        None,
        task_id,
    ))
}

/// PostToolUse 매핑: error 필드 존재 시 ToolFailed, 아니면 ToolSucceeded
fn normalize_post_tool_use(
    raw: &serde_json::Value,
) -> Result<(EventType, Severity, serde_json::Value, Option<String>, Option<String>), AppError> {
    let tool_name = raw
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let has_error = raw.get("error").is_some()
        && !raw.get("error").map_or(true, |v| v.is_null());

    if has_error {
        let error_msg = raw
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        Ok((
            EventType::ToolFailed,
            Severity::Warn,
            serde_json::json!({
                "tool_name": tool_name,
                "error_message": error_msg,
                "exit_code": raw.get("exit_code").and_then(|v| v.as_i64()),
            }),
            None,
            None,
        ))
    } else {
        Ok((
            EventType::ToolSucceeded,
            Severity::Info,
            serde_json::json!({
                "tool_name": tool_name,
            }),
            None,
            None,
        ))
    }
}

/// thinking/extended_thinking 텍스트 추출 (hooks-integration.md §6.2)
fn extract_thinking(raw: &serde_json::Value) -> Option<String> {
    raw.get("thinking")
        .and_then(|v| v.as_str())
        .or_else(|| raw.get("extended_thinking").and_then(|v| v.as_str()))
        .map(String::from)
}
```

**Step 3: 테스트 실행**

Run: `cargo test normalizer`
Expected: 11/11 통과

**Step 4: Commit**

```bash
git add src-tauri/src/services/normalizer.rs
git commit -m "feat(phase3): implement normalizer with hook mapping, fingerprint, semantic extraction"
```

---

## Task 6: State Machine 서비스

state-machine.md §4의 ~30개 전이 규칙 + §4.3 치명/재시도 실패 분류를 구현한다.

**Files:**
- Rewrite: `src-tauri/src/services/state_machine.rs`

**Step 1: Failing test 작성**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::agent::*;
    use crate::models::event::*;

    fn test_config() -> StateMachineConfig {
        StateMachineConfig {
            fatal_keywords: vec![
                "permission denied".into(), "not found".into(),
                "ENOENT".into(), "EACCES".into(),
            ],
            retryable_keywords: vec![
                "timeout".into(), "EAGAIN".into(),
                "rate limit".into(), "ECONNREFUSED".into(),
            ],
            fatal_consecutive_failures: 3,
            timer_transitions: TimerTransitionsConfig {
                idle_to_resting_secs: 120,
                completed_to_disappear_secs: 60,
                chat_timeout_secs: 5,
            },
        }
    }

    fn make_state(status: AgentStatus) -> AgentState {
        AgentState {
            agent_id: "test-agent".into(),
            status,
            prev_status: None,
            thinking_text: None,
            current_task: None,
            workspace_id: "test".into(),
            since: "2026-02-20T15:00:00Z".into(),
            last_event_ts: "2026-02-20T15:00:00Z".into(),
            session_id: None,
            peer_agent_id: None,
            home_x: 0.5,
        }
    }

    fn make_event(event_type: EventType) -> NormalizedEvent {
        NormalizedEvent {
            id: "evt-1".into(),
            version: "1.1".into(),
            ts: "2026-02-20T15:01:00Z".into(),
            event_type,
            source: EventSource::Hook,
            workspace_id: "test".into(),
            terminal_session_id: "term-1".into(),
            run_id: None,
            session_id: None,
            agent_id: "test-agent".into(),
            target_agent_id: None,
            task_id: None,
            severity: Severity::Info,
            payload: serde_json::json!({}),
            thinking_text: None,
            raw: serde_json::json!({}),
        }
    }

    // === 기본 라이프사이클 ===

    #[test]
    fn test_offline_to_appearing() {
        let mut state = make_state(AgentStatus::Offline);
        let event = make_event(EventType::AgentStarted);
        let result = on_event(&event, &mut state, &test_config(), 0);
        assert!(matches!(result, TransitionResult::Changed { .. }));
        assert_eq!(state.status, AgentStatus::Appearing);
    }

    #[test]
    fn test_appearing_to_idle() {
        let mut state = make_state(AgentStatus::Appearing);
        let event = make_event(EventType::AppearDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Idle);
    }

    #[test]
    fn test_idle_to_working() {
        let mut state = make_state(AgentStatus::Idle);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_working_to_thinking() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ThinkingUpdated);
        event.thinking_text = Some("hmm...".into());
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Thinking);
        assert_eq!(state.thinking_text.as_deref(), Some("hmm..."));
    }

    #[test]
    fn test_working_to_completed() {
        let mut state = make_state(AgentStatus::Working);
        let event = make_event(EventType::TaskCompleted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Completed);
    }

    #[test]
    fn test_working_to_failed_fatal_keyword() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "permission denied"});
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Failed);
    }

    #[test]
    fn test_working_to_pending_input_retryable() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "timeout occurred"});
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::PendingInput);
    }

    #[test]
    fn test_working_to_failed_consecutive() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "some unknown error"});
        // consecutive_failures >= fatal_consecutive_failures (3)
        on_event(&event, &mut state, &test_config(), 3);
        assert_eq!(state.status, AgentStatus::Failed);
    }

    #[test]
    fn test_working_to_pending_input_unknown() {
        let mut state = make_state(AgentStatus::Working);
        let mut event = make_event(EventType::ToolFailed);
        event.payload = serde_json::json!({"error_message": "some unknown error"});
        // consecutive_failures < fatal_consecutive_failures (3)
        on_event(&event, &mut state, &test_config(), 1);
        assert_eq!(state.status, AgentStatus::PendingInput);
    }

    #[test]
    fn test_universal_agent_stopped() {
        for status in [
            AgentStatus::Idle, AgentStatus::Working, AgentStatus::Thinking,
            AgentStatus::Resting, AgentStatus::Chatting,
        ] {
            let mut state = make_state(status);
            let event = make_event(EventType::AgentStopped);
            on_event(&event, &mut state, &test_config(), 0);
            assert_eq!(state.status, AgentStatus::Disappearing);
        }
    }

    #[test]
    fn test_disappearing_to_offline() {
        let mut state = make_state(AgentStatus::Disappearing);
        let event = make_event(EventType::DisappearDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Offline);
    }

    // === 졸기 / 깨어남 ===

    #[test]
    fn test_resting_task_started_startled() {
        let mut state = make_state(AgentStatus::Resting);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Startled);
    }

    #[test]
    fn test_startled_done_to_working_with_task() {
        let mut state = make_state(AgentStatus::Startled);
        state.current_task = Some("do something".into());
        let event = make_event(EventType::StartledDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_startled_done_to_idle_without_task() {
        let mut state = make_state(AgentStatus::Startled);
        state.current_task = None;
        let event = make_event(EventType::StartledDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Idle);
    }

    // === 대화 ===

    #[test]
    fn test_idle_message_sent_to_walking() {
        let mut state = make_state(AgentStatus::Idle);
        let mut event = make_event(EventType::MessageSent);
        event.target_agent_id = Some("other-agent".into());
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Walking);
        assert_eq!(state.prev_status, Some(AgentStatus::Idle));
        assert_eq!(state.peer_agent_id.as_deref(), Some("other-agent"));
    }

    #[test]
    fn test_walking_arrive_at_peer_to_chatting() {
        let mut state = make_state(AgentStatus::Walking);
        let event = make_event(EventType::ArriveAtPeer);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Chatting);
    }

    #[test]
    fn test_chatting_message_done_to_returning() {
        let mut state = make_state(AgentStatus::Chatting);
        let event = make_event(EventType::MessageDone);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Returning);
    }

    #[test]
    fn test_returning_arrive_home_restores_prev_status() {
        let mut state = make_state(AgentStatus::Returning);
        state.prev_status = Some(AgentStatus::Working);
        let event = make_event(EventType::ArriveAtHome);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
        assert!(state.prev_status.is_none());
        assert!(state.peer_agent_id.is_none());
    }

    // === no-op ===

    #[test]
    fn test_noop_transition() {
        let mut state = make_state(AgentStatus::Offline);
        let event = make_event(EventType::ToolStarted);
        let result = on_event(&event, &mut state, &test_config(), 0);
        assert!(matches!(result, TransitionResult::NoOp));
        assert_eq!(state.status, AgentStatus::Offline);
    }

    #[test]
    fn test_heartbeat_updates_timestamp_only() {
        let mut state = make_state(AgentStatus::Working);
        let event = make_event(EventType::Heartbeat);
        let result = on_event(&event, &mut state, &test_config(), 0);
        assert!(matches!(result, TransitionResult::NoOp));
        assert_eq!(state.status, AgentStatus::Working);
        assert_eq!(state.last_event_ts, "2026-02-20T15:01:00Z");
    }

    // === 복귀 전이 ===

    #[test]
    fn test_pending_input_to_working() {
        let mut state = make_state(AgentStatus::PendingInput);
        let event = make_event(EventType::AgentUnblocked);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_failed_to_working() {
        let mut state = make_state(AgentStatus::Failed);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_completed_to_working() {
        let mut state = make_state(AgentStatus::Completed);
        let event = make_event(EventType::TaskStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }

    #[test]
    fn test_thinking_to_working() {
        let mut state = make_state(AgentStatus::Thinking);
        let event = make_event(EventType::ToolStarted);
        on_event(&event, &mut state, &test_config(), 0);
        assert_eq!(state.status, AgentStatus::Working);
    }
}
```

**Step 2: 구현**

```rust
use crate::config::StateMachineConfig;
use crate::models::agent::{AgentState, AgentStatus};
use crate::models::event::{EventType, NormalizedEvent};

/// 전이 결과
#[derive(Debug)]
pub enum TransitionResult {
    /// 상태가 변경됨
    Changed {
        prev_status: AgentStatus,
        new_status: AgentStatus,
    },
    /// 상태 변경 없음 (매트릭스에 없는 조합 or heartbeat)
    NoOp,
}

/// 이벤트를 처리하여 에이전트 상태를 전이한다 (state-machine.md §4)
pub fn on_event(
    event: &NormalizedEvent,
    state: &mut AgentState,
    config: &StateMachineConfig,
    consecutive_failures: u32,
) -> TransitionResult {
    let prev = state.status.clone();

    // last_event_ts는 항상 갱신
    state.last_event_ts = event.ts.clone();

    // Heartbeat: 타임스탬프만 갱신, 상태 불변
    if event.event_type == EventType::Heartbeat {
        return TransitionResult::NoOp;
    }

    // 전역: agent_stopped → disappearing (모든 상태에서, offline 제외)
    if event.event_type == EventType::AgentStopped && prev != AgentStatus::Offline {
        return apply_transition(state, AgentStatus::Disappearing, &event.ts, &prev);
    }

    // 전이 매트릭스 조회
    if let Some(next) = find_transition(&prev, &event.event_type, event, config, consecutive_failures) {
        // 특수 처리: walking 전 prev_status 저장
        if next == AgentStatus::Walking {
            state.prev_status = Some(prev.clone());
            state.peer_agent_id = event.target_agent_id.clone();
        }

        // thinking 텍스트 갱신
        if event.thinking_text.is_some() {
            state.thinking_text = event.thinking_text.clone();
        }

        // 작업 요약 갱신
        if let Some(tool_name) = event.payload.get("tool_name").and_then(|v| v.as_str()) {
            state.current_task = Some(tool_name.to_string());
        }

        return apply_transition(state, next, &event.ts, &prev);
    }

    // 특수: startled + startled_done (조건부 전이)
    if prev == AgentStatus::Startled && event.event_type == EventType::StartledDone {
        let next = if state.current_task.is_some() {
            AgentStatus::Working
        } else {
            AgentStatus::Idle
        };
        return apply_transition(state, next, &event.ts, &prev);
    }

    // 특수: returning + arrive_at_home (prev_status 복원)
    if prev == AgentStatus::Returning && event.event_type == EventType::ArriveAtHome {
        let next = state.prev_status.clone().unwrap_or(AgentStatus::Idle);
        state.prev_status = None;
        state.peer_agent_id = None;
        return apply_transition(state, next, &event.ts, &prev);
    }

    // no-op
    tracing::debug!(
        "transition_ignored: agent={} {:?} + {:?}",
        state.agent_id,
        prev,
        event.event_type,
    );
    TransitionResult::NoOp
}

/// 전이 매트릭스 (state-machine.md §4.1)
fn find_transition(
    current: &AgentStatus,
    event_type: &EventType,
    event: &NormalizedEvent,
    config: &StateMachineConfig,
    consecutive_failures: u32,
) -> Option<AgentStatus> {
    use AgentStatus::*;
    use EventType::*;

    match (current, event_type) {
        // === 기본 전이 ===
        (Offline, AgentStarted) => Some(Appearing),
        (Appearing, AppearDone) => Some(Idle),

        (Idle, TaskStarted) => Some(Working),
        (Idle, ToolStarted) => Some(Working),
        (Idle, MessageSent) => Some(Walking),

        (Working, ThinkingUpdated) => Some(Thinking),
        (Working, TaskCompleted) => Some(Completed),
        (Working, TaskFailed) => Some(Failed),
        (Working, ToolFailed) => Some(classify_failure(event, config, consecutive_failures)),
        (Working, ToolStarted) => Some(Working),
        (Working, ToolSucceeded) => Some(Working),
        (Working, MessageSent) => Some(Walking),

        (Thinking, ToolStarted) => Some(Working),
        (Thinking, TaskCompleted) => Some(Completed),
        (Thinking, TaskFailed) => Some(Failed),
        (Thinking, ThinkingUpdated) => Some(Thinking),

        (PendingInput, AgentUnblocked) => Some(Working),
        (PendingInput, TaskStarted) => Some(Working),

        (Failed, AgentUnblocked) => Some(Working),
        (Failed, TaskStarted) => Some(Working),

        (Completed, TaskStarted) => Some(Working),

        (Disappearing, DisappearDone) => Some(Offline),

        // === 졸기 / 깨어남 ===
        (Resting, TaskStarted) => Some(Startled),
        (Resting, MessageReceived) => Some(Startled),
        (Resting, MessageSent) => Some(Startled),

        // startled_done과 arrive_at_home은 on_event()에서 특수 처리

        // === 대화 ===
        (Walking, ArriveAtPeer) => Some(Chatting),
        (Chatting, MessageDone) => Some(Returning),

        _ => None,
    }
}

/// 치명/재시도 실패 분류 (state-machine.md §4.3)
fn classify_failure(
    event: &NormalizedEvent,
    config: &StateMachineConfig,
    consecutive_failures: u32,
) -> AgentStatus {
    let error_message = event
        .payload
        .get("error_message")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let lower_msg = error_message.to_lowercase();

    // 치명적 키워드 검사
    for keyword in &config.fatal_keywords {
        if lower_msg.contains(&keyword.to_lowercase()) {
            return AgentStatus::Failed;
        }
    }

    // 연속 실패 횟수 초과
    if consecutive_failures >= config.fatal_consecutive_failures {
        return AgentStatus::Failed;
    }

    // 재시도 가능 키워드 검사 (또는 판정 불가 기본값)
    // 둘 다 해당 없으면 낙관적 처리 → pending_input
    AgentStatus::PendingInput
}

/// 상태 전이 적용
fn apply_transition(
    state: &mut AgentState,
    next_status: AgentStatus,
    ts: &str,
    prev: &AgentStatus,
) -> TransitionResult {
    let prev_clone = prev.clone();
    state.status = next_status.clone();
    state.since = ts.to_string();

    TransitionResult::Changed {
        prev_status: prev_clone,
        new_status: next_status,
    }
}
```

**Step 3: 테스트 실행**

Run: `cargo test state_machine`
Expected: 22+개 테스트 통과

**Step 4: Commit**

```bash
git add src-tauri/src/services/state_machine.rs
git commit -m "feat(phase3): implement state machine with ~30 transition rules + failure classification"
```

---

## Task 7: Heartbeat 서비스

state-machine.md §5에 따라 주기적으로 에이전트 상태를 검사하여 타이머 기반 전이를 수행한다.

**Files:**
- Rewrite: `src-tauri/src/services/heartbeat.rs`

**타이머 전이 규칙:**
- `idle` + `idle_to_resting_secs` 초과 → `resting`
- `completed` + `completed_to_disappear_secs` 초과 → `disappearing`
- `chatting` + `chat_timeout_secs` 초과 → `returning`

**Step 1: 구현**

```rust
use crate::state::AppState;
use crate::models::agent::AgentStatus;
use crate::storage::state_repo::StateRepo;
use tauri::Emitter;

/// Heartbeat 서비스 메인 루프 (state-machine.md §5)
/// config.heartbeat.interval_secs 간격으로 에이전트 상태를 검사하여 타이머 전이 수행.
pub async fn run_heartbeat(state: AppState, app_handle: tauri::AppHandle) {
    let interval_secs = state.config.heartbeat.interval_secs;
    let timer_config = &state.config.state_machine.timer_transitions;

    let idle_to_resting = timer_config.idle_to_resting_secs;
    let completed_to_disappear = timer_config.completed_to_disappear_secs;
    let chat_timeout = timer_config.chat_timeout_secs;

    tracing::info!(
        "heartbeat service started (interval={}s, idle→rest={}s, completed→disappear={}s, chat_timeout={}s)",
        interval_secs, idle_to_resting, completed_to_disappear, chat_timeout,
    );

    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(interval_secs));

    loop {
        interval.tick().await;

        let now = chrono::Utc::now();
        let state_repo = StateRepo::new(state.db.clone());

        let agents = match state_repo.get_all() {
            Ok(agents) => agents,
            Err(e) => {
                tracing::error!("heartbeat: failed to get agent states: {e}");
                continue;
            }
        };

        for mut agent in agents {
            let elapsed_secs = match parse_elapsed_secs(&agent.since, &now) {
                Some(secs) => secs,
                None => {
                    tracing::warn!(
                        "heartbeat: failed to parse since={} for agent={}",
                        agent.since, agent.agent_id,
                    );
                    continue;
                }
            };

            let (should_transition, new_status) = match agent.status {
                AgentStatus::Idle if elapsed_secs >= idle_to_resting => {
                    (true, AgentStatus::Resting)
                }
                AgentStatus::Completed if elapsed_secs >= completed_to_disappear => {
                    (true, AgentStatus::Disappearing)
                }
                AgentStatus::Chatting if elapsed_secs >= chat_timeout => {
                    (true, AgentStatus::Returning)
                }
                _ => (false, agent.status.clone()),
            };

            if should_transition {
                let prev_status = agent.status.clone();
                let ts = now.to_rfc3339();

                agent.status = new_status.clone();
                agent.since = ts.clone();
                agent.last_event_ts = ts.clone();

                if let Err(e) = state_repo.upsert(&agent) {
                    tracing::error!(
                        "heartbeat: failed to update state for agent={}: {e}",
                        agent.agent_id,
                    );
                    continue;
                }

                tracing::info!(
                    "heartbeat: timer transition agent={} {:?} → {:?}",
                    agent.agent_id, prev_status, new_status,
                );

                // Tauri 이벤트 emit (ipc-protocol.md §2.2)
                let update_payload = serde_json::json!({
                    "agent_id": agent.agent_id,
                    "status": new_status,
                    "prev_status": prev_status,
                    "thinking_text": agent.thinking_text,
                    "current_task": agent.current_task,
                    "workspace_id": agent.workspace_id,
                    "peer_agent_id": agent.peer_agent_id,
                    "chat_message": null,
                    "ts": agent.since,
                });

                if let Err(e) = app_handle.emit("mascot://agent-update", &update_payload) {
                    tracing::error!("heartbeat: failed to emit agent-update: {e}");
                }
            }
        }
    }
}

/// ISO-8601 타임스탬프에서 현재까지 경과 초 계산
fn parse_elapsed_secs(since: &str, now: &chrono::DateTime<chrono::Utc>) -> Option<u64> {
    let since_dt = chrono::DateTime::parse_from_rfc3339(since).ok()?;
    let duration = *now - since_dt.with_timezone(&chrono::Utc);
    Some(duration.num_seconds().max(0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_elapsed_secs() {
        let now = chrono::Utc::now();
        let since = (now - chrono::Duration::seconds(120)).to_rfc3339();
        let elapsed = parse_elapsed_secs(&since, &now).expect("should parse");
        assert!(elapsed >= 119 && elapsed <= 121, "elapsed={elapsed}");
    }

    #[test]
    fn test_parse_elapsed_secs_invalid() {
        let now = chrono::Utc::now();
        assert!(parse_elapsed_secs("not-a-date", &now).is_none());
    }

    #[test]
    fn test_parse_elapsed_secs_future() {
        let now = chrono::Utc::now();
        let future = (now + chrono::Duration::seconds(60)).to_rfc3339();
        let elapsed = parse_elapsed_secs(&future, &now).expect("should parse");
        assert_eq!(elapsed, 0, "future timestamp should clamp to 0");
    }
}
```

**Step 2: 테스트 실행**

Run: `cargo test heartbeat`
Expected: 3/3 통과

**Step 3: Commit**

```bash
git add src-tauri/src/services/heartbeat.rs
git commit -m "feat(phase3): implement heartbeat service with timer-based transitions"
```

---

## Task 8: Ingest 파이프라인

hooks-integration.md §5.3의 10단계 파이프라인을 구현한다.

**Files:**
- Rewrite: `src-tauri/src/http/ingest.rs`

**파이프라인:**
1. JSON 파싱 (axum이 처리)
2. normalizer.normalize(payload) → NormalizedEvent
3. 핑거프린트 중복 검사
4. events 테이블에 INSERT
5. 에이전트 미등록 시 자동 등록
6. state_machine.on_event(current, event) → next
7. agent_state 테이블 UPDATE
8. appearance.generate_appearance(agent_id, slot_counts)
9. Tauri 이벤트 emit
10. 200 응답

**Step 1: 구현**

```rust
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use crate::http::server::IngestState;
use crate::models::agent::*;
use crate::models::event::*;
use crate::services::{appearance, normalizer, state_machine};
use crate::storage::agents_repo::AgentsRepo;
use crate::storage::events_repo::EventsRepo;
use crate::storage::state_repo::StateRepo;
use tauri::Emitter;

/// POST /ingest -- hook payload 수신 → 10단계 파이프라인 (hooks-integration.md §5.3)
pub async fn ingest_handler(
    State(ingest): State<IngestState>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    // Step 1: JSON 파싱은 axum이 처리 (실패 시 400 자동 반환)

    // Step 2: 정규화
    let event = match normalizer::normalize(&payload) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("ingest: normalization failed: {e}");
            return (StatusCode::BAD_REQUEST, format!("normalization failed: {e}"));
        }
    };

    let state = &ingest.app_state;
    let app_handle = &ingest.app_handle;

    // Step 3: 핑거프린트 중복 검사
    let tool_name = event.payload
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let fingerprint = normalizer::generate_fingerprint(
        event.session_id.as_deref().unwrap_or(""),
        tool_name,
        &event.ts,
        &event.payload,
    );

    let events_repo = EventsRepo::new(state.db.clone());

    // Step 4: events 테이블에 INSERT (중복이면 skip)
    match events_repo.insert(&event, &fingerprint) {
        Ok(false) => {
            tracing::debug!("ingest: duplicate event (fingerprint={})", fingerprint);
            return (StatusCode::OK, "duplicate, skipped".to_string());
        }
        Ok(true) => {}
        Err(e) => {
            tracing::error!("ingest: event insert failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("storage error: {e}"));
        }
    }

    // Step 5: 에이전트 미등록 시 자동 등록
    let agents_repo = AgentsRepo::new(state.db.clone());
    let state_repo = StateRepo::new(state.db.clone());
    let is_new_agent = ensure_agent_registered(
        &agents_repo,
        &state_repo,
        &event,
        state,
    );

    // Step 6: 상태 전이
    let mut agent_state = match state_repo.get(&event.agent_id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            // 방금 등록된 에이전트의 초기 상태
            AgentState {
                agent_id: event.agent_id.clone(),
                status: AgentStatus::Offline,
                prev_status: None,
                thinking_text: None,
                current_task: None,
                workspace_id: event.workspace_id.clone(),
                since: event.ts.clone(),
                last_event_ts: event.ts.clone(),
                session_id: event.session_id.clone(),
                peer_agent_id: None,
                home_x: 0.0,
            }
        }
        Err(e) => {
            tracing::error!("ingest: state get failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("state error: {e}"));
        }
    };

    let transition_result = state_machine::on_event(
        &event,
        &mut agent_state,
        &state.config.state_machine,
        0, // TODO: consecutive failures 추적은 Phase 4에서 구현
    );

    // Step 7: agent_state 테이블 UPDATE
    if let Err(e) = state_repo.upsert(&agent_state) {
        tracing::error!("ingest: state upsert failed: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("state error: {e}"));
    }

    // Step 8 & 9: Tauri 이벤트 emit
    match transition_result {
        state_machine::TransitionResult::Changed { prev_status, new_status } => {
            // 새 에이전트 등장
            if is_new_agent || (prev_status == AgentStatus::Offline && new_status == AgentStatus::Appearing) {
                let slot_counts = state.slot_counts.lock()
                    .map(|s| s.clone())
                    .unwrap_or_default();
                let appearance = appearance::generate_appearance(
                    &event.agent_id,
                    &slot_counts,
                    &state.config.appearance,
                );

                let appeared_payload = serde_json::json!({
                    "agent_id": event.agent_id,
                    "display_name": event.agent_id.split('/').last().unwrap_or(&event.agent_id),
                    "role": "worker",
                    "employment_type": "contractor",
                    "workspace_id": event.workspace_id,
                    "status": new_status,
                    "appearance": appearance,
                    "ts": event.ts,
                });

                if let Err(e) = app_handle.emit("mascot://agent-appeared", &appeared_payload) {
                    tracing::error!("ingest: emit agent-appeared failed: {e}");
                }
            }

            // 퇴장
            if new_status == AgentStatus::Offline {
                let departed_payload = serde_json::json!({
                    "agent_id": event.agent_id,
                    "ts": event.ts,
                });
                if let Err(e) = app_handle.emit("mascot://agent-departed", &departed_payload) {
                    tracing::error!("ingest: emit agent-departed failed: {e}");
                }
            } else {
                // 상태 변경
                let update_payload = serde_json::json!({
                    "agent_id": event.agent_id,
                    "status": new_status,
                    "prev_status": prev_status,
                    "thinking_text": agent_state.thinking_text,
                    "current_task": agent_state.current_task,
                    "workspace_id": event.workspace_id,
                    "peer_agent_id": agent_state.peer_agent_id,
                    "chat_message": extract_chat_message(&event),
                    "ts": event.ts,
                });
                if let Err(e) = app_handle.emit("mascot://agent-update", &update_payload) {
                    tracing::error!("ingest: emit agent-update failed: {e}");
                }
            }
        }
        state_machine::TransitionResult::NoOp => {
            // 상태 변경 없음, emit 불필요
        }
    }

    // Step 10: 200 응답
    (StatusCode::OK, "ok".to_string())
}

/// 에이전트 미등록 시 자동 등록. 등록했으면 true 반환.
fn ensure_agent_registered(
    agents_repo: &AgentsRepo,
    state_repo: &StateRepo,
    event: &NormalizedEvent,
    state: &crate::state::AppState,
) -> bool {
    match agents_repo.get_by_id(&event.agent_id) {
        Ok(Some(_)) => false,
        Ok(None) => {
            // 신규 에이전트 등록
            let slot_counts = state.slot_counts.lock()
                .map(|s| s.clone())
                .unwrap_or_default();
            let appearance = appearance::generate_appearance(
                &event.agent_id,
                &slot_counts,
                &state.config.appearance,
            );

            let display_name = event.agent_id
                .split('/')
                .last()
                .unwrap_or(&event.agent_id)
                .to_string();

            let agent = MascotAgent {
                agent_id: event.agent_id.clone(),
                display_name,
                role: AgentRole::Worker,
                employment_type: EmploymentType::Contractor,
                workspace_id: event.workspace_id.clone(),
                status: AgentStatus::Offline,
                thinking_text: None,
                current_task: None,
                appearance,
                last_active_ts: event.ts.clone(),
            };

            if let Err(e) = agents_repo.upsert(&agent) {
                tracing::error!("ingest: agent upsert failed: {e}");
                return false;
            }

            // 초기 상태 저장
            let initial_state = AgentState {
                agent_id: event.agent_id.clone(),
                status: AgentStatus::Offline,
                prev_status: None,
                thinking_text: None,
                current_task: None,
                workspace_id: event.workspace_id.clone(),
                since: event.ts.clone(),
                last_event_ts: event.ts.clone(),
                session_id: event.session_id.clone(),
                peer_agent_id: None,
                home_x: 0.0,
            };

            if let Err(e) = state_repo.upsert(&initial_state) {
                tracing::error!("ingest: initial state upsert failed: {e}");
            }

            tracing::info!("ingest: registered new agent: {}", event.agent_id);
            true
        }
        Err(e) => {
            tracing::error!("ingest: agent lookup failed: {e}");
            false
        }
    }
}

/// chatting 상태에서 대화 메시지 추출
fn extract_chat_message(event: &NormalizedEvent) -> Option<String> {
    event.payload
        .get("message")
        .and_then(|v| v.as_str())
        .map(String::from)
}
```

**Step 2: 빌드 확인**

Run: `cargo build`
Expected: 컴파일 성공

**Step 3: Commit**

```bash
git add src-tauri/src/http/ingest.rs
git commit -m "feat(phase3): implement 10-step ingest pipeline with normalizer + state machine + emit"
```

---

## Task 9: IPC 커맨드 실제 구현

7개 스텁 커맨드를 Tauri managed state로 실제 구현한다.

**Files:**
- Rewrite: `src-tauri/src/commands/agents.rs`
- Modify: `src-tauri/src/commands/window.rs` — 에러 변형 수정

**Step 1: agents.rs 전체 재작성**

```rust
use crate::config::DisplayConfig;
use crate::error::AppError;
use crate::models::agent::*;
use crate::models::event::*;
use crate::services::{appearance, state_machine};
use crate::state::AppState;
use crate::storage::agents_repo::AgentsRepo;
use crate::storage::events_repo::EventsRepo;
use crate::storage::state_repo::StateRepo;
use tauri::Emitter;

/// 모든 에이전트 + 현재 상태를 반환 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn get_all_agents(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MascotAgent>, AppError> {
    let agents_repo = AgentsRepo::new(state.db.clone());
    let state_repo = StateRepo::new(state.db.clone());

    let mut agents = agents_repo.get_all()?;
    let states = state_repo.get_all()?;

    // agents에 현재 상태 덮어쓰기
    for agent in &mut agents {
        if let Some(s) = states.iter().find(|s| s.agent_id == agent.agent_id) {
            agent.status = s.status.clone();
            agent.thinking_text = s.thinking_text.clone();
            agent.current_task = s.current_task.clone();
        }
    }

    Ok(agents)
}

/// 에이전트 이력서 정보 반환 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn get_agent_resume(
    state: tauri::State<'_, AppState>,
    agent_id: String,
) -> Result<serde_json::Value, AppError> {
    let agents_repo = AgentsRepo::new(state.db.clone());
    let events_repo = EventsRepo::new(state.db.clone());
    let state_repo = StateRepo::new(state.db.clone());

    let agent = match agents_repo.get_by_id(&agent_id)? {
        Some(mut a) => {
            // 현재 상태 반영
            if let Some(s) = state_repo.get(&agent_id)? {
                a.status = s.status;
                a.thinking_text = s.thinking_text;
                a.current_task = s.current_task;
            }
            a
        }
        None => return Ok(serde_json::json!(null)),
    };

    let recent_events = events_repo.get_recent_by_agent(
        &agent_id,
        state.config.resume.recent_events_limit,
    )?;
    let total_tasks_completed = events_repo.count_completed_tasks(&agent_id)?;
    let total_tools_used = events_repo.count_tools_used(&agent_id)?;

    // first_seen_ts는 agents 테이블의 first_seen_ts와 동일 (last_active_ts로 저장)
    // TODO: agents 테이블에서 first_seen_ts 별도 조회 필요 시 repo 확장
    let resume = serde_json::json!({
        "agent": agent,
        "recent_events": recent_events,
        "total_tasks_completed": total_tasks_completed,
        "total_tools_used": total_tools_used,
        "first_seen_ts": agent.last_active_ts,
    });

    Ok(resume)
}

/// WebView에서 Spine 스켈레톤 로드 후 슬롯 개수 전달 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn set_slot_counts(
    state: tauri::State<'_, AppState>,
    slot_counts: SlotCounts,
) -> Result<(), AppError> {
    let mut counts = state
        .slot_counts
        .lock()
        .map_err(|e| AppError::LockPoisoned(e.to_string()))?;
    *counts = slot_counts.clone();
    tracing::info!("slot_counts updated: {:?}", slot_counts);
    Ok(())
}

/// WebView가 Spine 애니메이션 완료를 알림 (synthetic 이벤트)
#[tauri::command]
pub async fn notify_animation_done(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    agent_id: String,
    animation: String,
) -> Result<(), AppError> {
    let event_type = match animation.as_str() {
        "appear" => EventType::AppearDone,
        "disappear" => EventType::DisappearDone,
        "startled" => EventType::StartledDone,
        other => {
            tracing::debug!("notify_animation_done: unhandled animation '{other}' for {agent_id}");
            return Ok(());
        }
    };

    process_synthetic_event(&state, &app_handle, &agent_id, event_type).await
}

/// WebView가 캐릭터 이동 완료를 알림 (synthetic 이벤트)
#[tauri::command]
pub async fn notify_movement_done(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    agent_id: String,
    movement_type: String,
) -> Result<(), AppError> {
    let event_type = match movement_type.as_str() {
        "arrive_at_peer" => EventType::ArriveAtPeer,
        "arrive_at_home" => EventType::ArriveAtHome,
        other => {
            tracing::debug!("notify_movement_done: unhandled type '{other}' for {agent_id}");
            return Ok(());
        }
    };

    process_synthetic_event(&state, &app_handle, &agent_id, event_type).await
}

/// WebView가 대화 말풍선 표시 완료를 알림
#[tauri::command]
pub async fn notify_chat_done(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    agent_id: String,
) -> Result<(), AppError> {
    process_synthetic_event(&state, &app_handle, &agent_id, EventType::MessageDone).await
}

/// 화면 배치 설정 반환 (ipc-protocol.md §3.1)
#[tauri::command]
pub async fn get_display_config(
    state: tauri::State<'_, AppState>,
) -> Result<DisplayConfig, AppError> {
    Ok(state.config.display.clone())
}

/// synthetic 이벤트를 처리하여 상태 전이 + emit 수행
async fn process_synthetic_event(
    state: &AppState,
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    event_type: EventType,
) -> Result<(), AppError> {
    let state_repo = StateRepo::new(state.db.clone());

    let mut agent_state = match state_repo.get(agent_id)? {
        Some(s) => s,
        None => {
            tracing::warn!("synthetic event for unknown agent: {agent_id}");
            return Ok(());
        }
    };

    let ts = chrono::Utc::now().to_rfc3339();
    let synthetic_event = NormalizedEvent {
        id: format!("syn_{}", chrono::Utc::now().format("%Y%m%d%H%M%S%f")),
        version: "1.1".to_string(),
        ts: ts.clone(),
        event_type,
        source: EventSource::Synthetic,
        workspace_id: agent_state.workspace_id.clone(),
        terminal_session_id: "webview".to_string(),
        run_id: None,
        session_id: agent_state.session_id.clone(),
        agent_id: agent_id.to_string(),
        target_agent_id: None,
        task_id: None,
        severity: Severity::Debug,
        payload: serde_json::json!({}),
        thinking_text: None,
        raw: serde_json::json!({}),
    };

    let result = state_machine::on_event(
        &synthetic_event,
        &mut agent_state,
        &state.config.state_machine,
        0,
    );

    state_repo.upsert(&agent_state)?;

    if let state_machine::TransitionResult::Changed { prev_status, new_status } = result {
        // 퇴장 완료 (disappear_done → offline)
        if new_status == AgentStatus::Offline {
            let payload = serde_json::json!({
                "agent_id": agent_id,
                "ts": ts,
            });
            let _ = app_handle.emit("mascot://agent-departed", &payload);
        } else {
            let payload = serde_json::json!({
                "agent_id": agent_id,
                "status": new_status,
                "prev_status": prev_status,
                "thinking_text": agent_state.thinking_text,
                "current_task": agent_state.current_task,
                "workspace_id": agent_state.workspace_id,
                "peer_agent_id": agent_state.peer_agent_id,
                "chat_message": null,
                "ts": ts,
            });
            let _ = app_handle.emit("mascot://agent-update", &payload);
        }
    }

    Ok(())
}
```

**Step 2: window.rs 에러 변형 수정**

현재 `toggle_click_through`에서 `AppError::HttpServer`를 사용하는 것은 부적절. 전용 변형이 없으므로 임시로 유지하되 TODO 코멘트:

```rust
use crate::error::AppError;

#[tauri::command]
pub async fn toggle_click_through(
    window: tauri::WebviewWindow,
    ignore: bool,
) -> Result<(), AppError> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
    Ok(())
}
```

**Step 3: 빌드 확인**

Run: `cargo build`
Expected: 컴파일 성공

**Step 4: Commit**

```bash
git add src-tauri/src/commands/agents.rs src-tauri/src/commands/window.rs
git commit -m "feat(phase3): implement all IPC commands with managed state + synthetic event processing"
```

---

## Task 10: 트레이 메뉴 핸들러

언어 토글(한국어/English)과 자동 실행 토글을 settings DB와 연결한다.

**Files:**
- Modify: `src-tauri/src/tray/mod.rs`

**Step 1: 구현**

트레이 메뉴 이벤트 핸들러에 lang/autostart 로직 추가:

```rust
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use crate::state::AppState;
use crate::storage::settings_repo::SettingsRepo;

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // 초기 설정값 로드
    let initial_lang = {
        let state: tauri::State<'_, AppState> = app.state();
        let repo = SettingsRepo::new(state.db.clone());
        repo.get("lang").unwrap_or(None).unwrap_or_else(|| "ko".to_string())
    };

    let initial_autostart = {
        let state: tauri::State<'_, AppState> = app.state();
        let repo = SettingsRepo::new(state.db.clone());
        repo.get("autostart").unwrap_or(None).unwrap_or_else(|| "false".to_string()) == "true"
    };

    // ── 일반 메뉴 항목 ──
    let show_item = MenuItemBuilder::with_id("show", "마스코트 표시").build(app)?;
    let resume_item = MenuItemBuilder::with_id("resume", "에이전트 이력서").build(app)?;

    // ── 언어 서브메뉴 ──
    let lang_ko = CheckMenuItemBuilder::with_id("lang_ko", "한국어")
        .checked(initial_lang == "ko")
        .build(app)?;
    let lang_en = CheckMenuItemBuilder::with_id("lang_en", "English")
        .checked(initial_lang == "en")
        .build(app)?;
    let lang_submenu = SubmenuBuilder::with_id(app, "lang", "언어")
        .items(&[&lang_ko, &lang_en])
        .build()?;

    // ── 자동 실행 ──
    let autostart_item = CheckMenuItemBuilder::with_id("autostart", "자동 실행")
        .checked(initial_autostart)
        .build(app)?;

    // ── 종료 ──
    let quit_item = MenuItemBuilder::with_id("quit", "종료").build(app)?;

    // ── 전체 메뉴 조립 ──
    let menu = MenuBuilder::new(app)
        .items(&[&show_item, &resume_item])
        .separator()
        .item(&lang_submenu)
        .item(&autostart_item)
        .separator()
        .item(&quit_item)
        .build()?;

    // 클로저에서 사용할 CheckMenuItem 클론
    let lang_ko_clone = lang_ko.clone();
    let lang_en_clone = lang_en.clone();
    let autostart_clone = autostart_item.clone();

    // ── 트레이 아이콘 생성 ──
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Agent Mascot")
        .on_menu_event(move |app_handle, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "resume" => {
                    let _ = app_handle.emit("mascot://open-resume-modal", ());
                }
                "lang_ko" => {
                    let _ = lang_ko_clone.set_checked(true);
                    let _ = lang_en_clone.set_checked(false);
                    save_setting(app_handle, "lang", "ko");
                    let _ = app_handle.emit("mascot://settings-changed", serde_json::json!({
                        "key": "lang",
                        "value": "ko"
                    }));
                }
                "lang_en" => {
                    let _ = lang_ko_clone.set_checked(false);
                    let _ = lang_en_clone.set_checked(true);
                    save_setting(app_handle, "lang", "en");
                    let _ = app_handle.emit("mascot://settings-changed", serde_json::json!({
                        "key": "lang",
                        "value": "en"
                    }));
                }
                "autostart" => {
                    let is_checked = autostart_clone.is_checked().unwrap_or(false);
                    // 토글: 현재 checked 상태의 반대로 설정
                    let new_val = if is_checked { "false" } else { "true" };
                    let _ = autostart_clone.set_checked(!is_checked);
                    save_setting(app_handle, "autostart", new_val);
                    let _ = app_handle.emit("mascot://settings-changed", serde_json::json!({
                        "key": "autostart",
                        "value": !is_checked
                    }));
                }
                "quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// settings DB에 값 저장
fn save_setting(app_handle: &tauri::AppHandle, key: &str, value: &str) {
    let state: tauri::State<'_, AppState> = app_handle.state();
    let repo = SettingsRepo::new(state.db.clone());
    if let Err(e) = repo.set(key, value) {
        tracing::error!("failed to save setting {key}={value}: {e}");
    }
}
```

**Step 2: 빌드 확인**

Run: `cargo build`
Expected: 컴파일 성공

**Step 3: Commit**

```bash
git add src-tauri/src/tray/mod.rs
git commit -m "feat(phase3): implement tray menu lang/autostart handlers with settings DB"
```

---

## Task 11: 통합 빌드 + 테스트

전체 Rust 테스트 실행 + 릴리스 빌드 + WebView 빌드를 검증한다.

**Files:** (없음 — 검증만)

**Step 1: Rust 전체 테스트**

Run: `export PATH="/home/taniar/.cargo/bin:$PATH:/usr/bin" && cd /mnt/f/hayoung/git/Agent_Office_Dashboard/src-tauri && cargo test`
Expected: 모든 테스트 통과 (기존 13개 + normalizer 11개 + state_machine 22개 + heartbeat 3개 + settings_repo 4개 + repo확장 2개 ≈ 55+개)

**Step 2: Rust 빌드**

Run: `cargo build`
Expected: 컴파일 성공, 경고 최소화

**Step 3: WebView 빌드**

Run: `cd /mnt/f/hayoung/git/Agent_Office_Dashboard/apps/webview && pnpm run webview:build`
Expected: 빌드 성공

**Step 4: 최종 확인사항**

- [ ] `.unwrap()` 사용 없음 (테스트 코드 제외)
- [ ] 모든 에러가 `AppError`로 전파됨
- [ ] 하드코딩된 값 없음 — 모든 설정이 config.toml에서 로드
- [ ] silent fallback 없음 — 에러 시 tracing 로그 또는 에러 반환
- [ ] EventType에 ThinkingUpdated 포함
- [ ] AgentState에 prev_status 포함
- [ ] events 테이블에 run_id, session_id, target_agent_id, task_id 컬럼 존재

**Step 5: Commit (필요 시)**

빌드/테스트 중 발견된 수정사항이 있으면 커밋.

---

## 의존성 그래프

```
Task 1 (모델+DB) ──────┬──────────────────────────────────────────────┐
                       │                                              │
Task 2 (AppState+lib) ─┤                                              │
                       │                                              │
Task 3 (SettingsRepo) ─┤   ← 독립, Task 1 이후 병렬 가능             │
                       │                                              │
Task 4 (Repo 확장) ────┤   ← Task 1 이후                             │
                       │                                              │
Task 5 (Normalizer) ───┤   ← Task 1 이후, Task 3/4와 병렬 가능       │
                       │                                              │
Task 6 (StateMachine) ─┤   ← Task 1 이후, Task 3/4/5와 병렬 가능     │
                       │                                              │
Task 7 (Heartbeat) ────┤   ← Task 2, 6 필요                          │
                       │                                              │
Task 8 (Ingest) ───────┤   ← Task 2, 4, 5, 6 필요                    │
                       │                                              │
Task 9 (Commands) ─────┤   ← Task 2, 4 필요                          │
                       │                                              │
Task 10 (Tray) ────────┤   ← Task 2, 3 필요                          │
                       │                                              │
Task 11 (Integration) ─┘   ← 전부 완료 후                            │
```

**병렬 가능 그룹:**
- Task 1 완료 후: Tasks 3, 4, 5, 6 병렬 가능
- Tasks 2+4 완료 후: Tasks 7, 8, 9 순차 또는 병렬
- Tasks 2+3 완료 후: Task 10

---

## Phase 3 완료 후 상태

Phase 3이 완료되면:
- hook payload → NormalizedEvent → 상태 전이 → WebView emit **end-to-end 파이프라인** 완성
- 14개 상태의 ~30개 전이 규칙 구현
- 타이머 기반 전이 (idle→resting, completed→disappearing, chatting→returning)
- 에이전트 자동 등록 + 외형 생성
- IPC 커맨드 8개 모두 실제 동작
- 트레이 메뉴 언어/자동실행 토글

**Phase 4 (WebView Rendering)에서:**
- PixiJS v8 + spine-pixi 캐릭터 렌더링
- CharacterManager, SpineCharacter, SpeechBubble 구현
- 이동 시스템 (walking/returning 애니메이션)
- ResumeModal, ErrorToast UI 컴포넌트
