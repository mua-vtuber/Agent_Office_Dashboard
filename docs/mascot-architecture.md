# Agent Mascot - System Architecture

## 1. 개요

Agent Mascot은 Tauri v2 기반 데스크탑 앱으로, Rust 백엔드와 WebView 프론트엔드로 구성된다.
Claude Code hooks에서 이벤트를 수신하여 데스크탑 위에 캐릭터를 렌더링한다.

## 2. 아키텍처 다이어그램

```
┌─ Claude Code ─────────────────────────────────────────────┐
│                                                           │
│  [에이전트 실행] → hook 발화 (SubagentStart, PostToolUse..)│
│       │                                                   │
│       ▼                                                   │
│  forward-to-mascot.mjs (stdin → HTTP POST)                │
│       │                                                   │
│       │  ① /health 체크 → 앱 미실행 시 spawn              │
│       │  ② POST /ingest (JSON payload)                    │
│       │                                                   │
└───────┼───────────────────────────────────────────────────┘
        │
        ▼
┌─ Tauri App ───────────────────────────────────────────────┐
│                                                           │
│  ┌─ Rust Main Process ─────────────────────────────────┐  │
│  │                                                     │  │
│  │  ┌─ HTTP Server (axum) ──┐                          │  │
│  │  │  POST /ingest         │                          │  │
│  │  │  GET  /health         │                          │  │
│  │  └──────────┬────────────┘                          │  │
│  │             │                                       │  │
│  │             ▼                                       │  │
│  │  ┌─ Normalizer ─────────┐                           │  │
│  │  │  hook payload →      │                           │  │
│  │  │  NormalizedEvent     │                           │  │
│  │  └──────────┬───────────┘                           │  │
│  │             │                                       │  │
│  │             ▼                                       │  │
│  │  ┌─ State Machine ──────┐  ┌─ SQLite ────────────┐ │  │
│  │  │  current + event →   │→ │  agents             │ │  │
│  │  │  next state          │  │  events             │ │  │
│  │  └──────────┬───────────┘  │  agent_state        │ │  │
│  │             │              │  settings            │ │  │
│  │             │              └──────────────────────┘ │  │
│  │             ▼                                       │  │
│  │  app_handle.emit("mascot://agent-update", payload)  │  │
│  │                                                     │  │
│  │  ┌─ Heartbeat ──────────┐                           │  │
│  │  │  타이머 기반 전이     │                           │  │
│  │  │  (간격: config)       │                           │  │
│  │  └──────────────────────┘                           │  │
│  │                                                     │  │
│  │  ┌─ System Tray ────────┐                           │  │
│  │  │  표시/숨김, 이력서,   │                           │  │
│  │  │  언어, 자동실행, 종료 │                           │  │
│  │  └──────────────────────┘                           │  │
│  │                                                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ WebView (React + PixiJS + Spine) ──────────────────┐  │
│  │                                                     │  │
│  │  Tauri Event Listener                               │  │
│  │       │                                             │  │
│  │       ▼                                             │  │
│  │  ┌─ Zustand Stores ────┐                            │  │
│  │  │  agent-store        │                            │  │
│  │  │  (workspace별 Map)  │                            │  │
│  │  │  ui-store           │                            │  │
│  │  │  error-store        │                            │  │
│  │  └──────────┬──────────┘                            │  │
│  │             │                                       │  │
│  │             ▼                                       │  │
│  │  ┌─ PixiJS Stage ──────────────────────────────┐    │  │
│  │  │                                             │    │  │
│  │  │  CharacterManager                           │    │  │
│  │  │    ├─ WorkspaceGroup "my-project"           │    │  │
│  │  │    │    ├─ WorkspaceLabel                   │    │  │
│  │  │    │    ├─ SpineCharacter (agent-01)        │    │  │
│  │  │    │    │    ├─ SpeechBubble                │    │  │
│  │  │    │    │    └─ NameLabel                   │    │  │
│  │  │    │    └─ SpineCharacter (agent-02)        │    │  │
│  │  │    └─ WorkspaceGroup "api-server"           │    │  │
│  │  │         └─ ...                              │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  │                                                     │  │
│  │  ┌─ React Overlay ─────────────────────────────┐    │  │
│  │  │  TrayIcon (우상단)                          │    │  │
│  │  │  ResumeModal (조건부)                       │    │  │
│  │  │  ErrorToast / ErrorOverlay                  │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  │                                                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## 3. 모듈 책임

### 3.1 Rust Main Process

| 모듈 | 파일 | 책임 |
|------|------|------|
| config | `config.rs` | `config.toml` 로드 및 검증. 모든 설정값의 단일 소스. |
| error | `error.rs` | 앱 전역 에러 타입 (`thiserror`). 모든 모듈이 공유. |
| http/server | `http/server.rs` | axum HTTP 서버 시작. host/port는 config에서 로드. |
| http/ingest | `http/ingest.rs` | `POST /ingest` 핸들러. normalize → state machine → storage → emit. |
| models | `models/*.rs` | 도메인 타입 정의. Agent, NormalizedEvent, AgentState. serde 직렬화. |
| normalizer | `services/normalizer.rs` | hook raw payload → NormalizedEvent 변환. 시맨틱 타입 추출, 핑거프린트 중복 제거. |
| state_machine | `services/state_machine.rs` | (현재상태, 이벤트) → 다음상태. 전이 규칙은 config에서 로드. |
| appearance | `services/appearance.rs` | agent_id → Mulberry32 PRNG → 스킨 조합 결정. |
| heartbeat | `services/heartbeat.rs` | 타이머 기반 상태 전이. 간격은 config에서 로드. |
| storage | `storage/*.rs` | SQLite CRUD. rusqlite. 마이그레이션 실패 시 에러 다이얼로그. |
| commands | `commands/*.rs` | Tauri invoke 핸들러. WebView → Rust 요청 처리. |
| tray | `tray/*.rs` | 시스템 트레이 메뉴 구성 및 이벤트 처리. |

### 3.2 WebView

| 모듈 | 파일 | 책임 |
|------|------|------|
| tauri/events | `tauri/events.ts` | Tauri 이벤트 구독 래퍼. 타입 안전한 리스너. |
| tauri/commands | `tauri/commands.ts` | Tauri invoke 래퍼. 에러 시 error-store에 push. |
| stores | `stores/*.ts` | Zustand 상태 관리. workspace별 에이전트 Map. |
| pixi/CharacterManager | `pixi/CharacterManager.ts` | Spine 캐릭터 인스턴스 라이프사이클. workspace별 그룹핑 및 배치. |
| pixi/SpineCharacter | `pixi/SpineCharacter.ts` | 단일 캐릭터. 스킨 적용, 애니메이션 전환. |
| pixi/SpeechBubble | `pixi/SpeechBubble.ts` | 말풍선. thinking/작업 내용 표시. |
| pixi/WorkspaceLabel | `pixi/WorkspaceLabel.ts` | 프로젝트 이름 라벨 (길드명). |
| components/ResumeModal | `components/ResumeModal.tsx` | 에이전트 이력서 모달. |
| components/ErrorToast | `components/ErrorToast.tsx` | 에러 토스트 (비치명적 에러). |
| components/ErrorOverlay | `components/ErrorOverlay.tsx` | 에러 오버레이 (치명적 에러). |

## 4. 의존성 방향

```
config ← 모든 모듈이 참조
error  ← 모든 모듈이 참조
models ← services, storage, commands, http
storage ← services (normalizer, heartbeat), http (ingest)
services ← http (ingest), commands
commands ← main (invoke handler 등록)
http ← main (서버 시작)
tray ← main (트레이 셋업)
```

**순환 의존성 금지.** 하위 모듈이 상위 모듈을 참조하지 않는다.

## 5. 프로세스 모델

```
[Tauri Main Process]  ── 단일 프로세스
  ├─ Main Thread: Tauri 이벤트 루프, 윈도우 관리, 트레이
  ├─ Tokio Runtime Thread: axum HTTP 서버
  ├─ Heartbeat Thread: 타이머 기반 상태 전이
  └─ WebView Thread: Chromium/WebView2 렌더링
       └─ JS Main Thread: React + PixiJS + Spine
```

모든 것이 하나의 프로세스 안에서 동작한다. 별도 서버 프로세스 없음.

## 6. 설정 관리

### 6.1 설정 소스
- `config.toml`: 앱 데이터 디렉토리에 위치. 모든 수치/동작 설정의 단일 소스.
- SQLite `settings` 테이블: 런타임에 변경되는 설정 (언어, 자동실행 등).
- Spine 스켈레톤 데이터: 스킨 슬롯 수는 런타임에 Spine 파일에서 읽어옴.

### 6.2 설정 로드 순서
1. `config.toml` 파싱 → `AppConfig` 구조체
2. 파싱 실패 시 에러 다이얼로그 + 앱 종료 (기본값으로 가리지 않음)
3. SQLite `settings` 테이블에서 사용자 설정 로드
4. WebView 초기화 후 Spine 스켈레톤에서 슬롯 메타데이터 수신

### 6.3 하드코딩 금지 원칙
코드에 숫자 리터럴, 문자열 리터럴이 직접 들어가지 않는다.
모든 설정 가능한 값은 `AppConfig` 필드로 정의되고, `config.toml`에서 로드된다.

예외:
- 프로토콜 상수 (HTTP 상태 코드, JSON 키 이름 등)
- Tauri API 호출에 필요한 고정 문자열 (이벤트 이름 접두사 등)

## 7. 에러 처리 전략

### 7.1 Rust 측

```rust
// 앱 전역 에러 타입
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
}
```

- 모든 함수는 `Result<T, AppError>` 반환
- `.unwrap()`, `.expect()` 사용 금지
- `?` 연산자로 에러 전파
- 최상위(main, command handler)에서 에러를 Tauri 다이얼로그 또는 WebView 이벤트로 변환

### 7.2 WebView 측

```typescript
// Tauri invoke 래퍼
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    useErrorStore.getState().push({
      source: cmd,
      message: String(error),
      ts: new Date().toISOString(),
    });
    throw error; // 호출자가 처리할 수 있도록 다시 throw
  }
}
```

- 에러를 삼키지 않는다
- error-store에 push → ErrorToast가 자동 표시
- 치명적 에러 (Spine 로드 실패 등)는 ErrorOverlay로 전체 화면 차단

## 8. 보안

- HTTP 서버는 `127.0.0.1`에만 바인드 (외부 접근 차단)
- hook forwarder는 로컬에서만 POST
- SQLite 파일은 앱 데이터 디렉토리에 저장 (사용자 권한)
- WebView CSP: `default-src 'self'; img-src 'self' data:; script-src 'self'`
- 인증 토큰은 선택적 (config.toml에서 설정 시 HTTP/IPC에 적용)

## 9. 디렉토리 구조

```
agent-mascot/
  Cargo.toml                    # Rust workspace root
  package.json                  # pnpm workspace root
  pnpm-workspace.yaml
  docs/                         # 스펙 문서
  scripts/hooks/
    forward-to-mascot.mjs       # Claude Code hook 포워더
  src-tauri/
    Cargo.toml
    tauri.conf.json
    config.toml
    src/
      main.rs
      config.rs
      error.rs
      commands/
        mod.rs
        agents.rs
        window.rs
      http/
        mod.rs
        server.rs
        ingest.rs
      models/
        mod.rs
        agent.rs
        event.rs
      services/
        mod.rs
        normalizer.rs
        state_machine.rs
        appearance.rs
        heartbeat.rs
      storage/
        mod.rs
        db.rs
        agents_repo.rs
        events_repo.rs
        state_repo.rs
      tray/
        mod.rs
  apps/webview/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      tauri/
        events.ts
        commands.ts
      pixi/
        MascotStage.tsx
        SpineCharacter.ts
        SpeechBubble.ts
        WorkspaceLabel.ts
        PoofEffect.ts
        CharacterManager.ts
      components/
        ResumeModal.tsx
        ResumeCard.tsx
        AgentBadge.tsx
        TrayIcon.tsx
        ErrorToast.tsx
        ErrorOverlay.tsx
      stores/
        agent-store.ts
        ui-store.ts
        error-store.ts
      i18n/
        index.ts
        ko.json
        en.json
      types/
        agent.ts
        event.ts
        ipc.ts
      assets/
        spine/                  # Spine export 파일 (사용자 제공)
```

## 10. 결정 로그

| 날짜 | 결정 | 이유 |
|------|------|------|
| 2026-02-20 | 백엔드를 Electron main process 대신 Tauri Rust에 내장 | 별도 서버 프로세스 불필요, 단일 앱으로 모든 것이 동작 |
| 2026-02-20 | axum HTTP 서버 선택 | Tokio 기반, 가볍고 Rust 생태계 표준 |
| 2026-02-20 | 레이어 기반 모듈 구조 채택 | 핵심 흐름이 파이프라인형이라 레이어 분리가 더 명확 |
| 2026-02-20 | WebSocket 대신 Tauri IPC 사용 | 같은 프로세스 내 통신이므로 WebSocket 불필요 |
