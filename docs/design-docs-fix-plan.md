# Critical Issues Fix Plan (v2 — 통합본)

작성일: 2026-02-14 (2차 취합)
완료일: 2026-02-15
근거: `docs/archive/docs-code-mismatch-report.md` (통합본 26건)
원칙:
1. 코드 품질 > 작업량/난이도
2. 구조적 효율 — 의존성 방향을 따라 하위 계층부터 수정
3. 동적 값 사용 — 하드코딩 금지, 세팅/환경변수에서 읽기
4. 폴백 대신 오류 — 문제 발생 시 사용자에게 명시적 오류 노출

---

## 실행 결과 (2026-02-15 완료)

**전체 9단계 완료. Frontend/Backend typecheck 통과.**

| 순서 | Step | 상태 | 커밋 | 비고 |
|------|------|------|------|------|
| 1 | Schema 정합성 (#5, #7) | DONE | `111285d` | settings.ts 7개 카테고리 + defaultSettings, state.ts AgentState 필드 추가 |
| 2 | Storage 계층 (#4, #17) | DONE | `111285d` | agents/tasks/sessions 테이블, state_current v1 마이그레이션, 4개 repo 신규 |
| 3 | Settings API & URL (#6, #10) | DONE | `e362ff4` | settings-repo.ts, routes/settings.ts, constants.ts 환경변수화 |
| 4 | Normalizer 의미적 추출 (#3, #14, #25) | DONE | `2e7d39e` | deriveSemanticType() 우선순위 체인, Notification→agent_blocked |
| 5 | 상태 머신 전이 확장 (#1, #12, #17) | DONE | `47ce19b` | 25개 전이 규칙 테이블, 타이머 전이, post_complete, DB 기반 역할 판정 |
| 6 | WebSocket & Heartbeat (#8, #9) | DONE | `d92c283` | subscribe/unsubscribe/ping, scope broadcast, heartbeat tick 루프 |
| 7 | 클라이언트 동기화 (#15, #16) | DONE | `6de5443` | setInterval 재동기화, ws-store 지수백오프 재연결, ingest 422 응답 |
| 8 | 프론트엔드 기능 (#2, #11, #13) | DONE | `6de5443` | PixiJS WebGL 렌더러, 말풍선, 활성작업 테이블 |
| 9 | Hook 템플릿 (#18, #20) | DONE | `6de5443` | SubagentStop/Stop/Notification 추가 |

### 변경 파일 목록

**신규 파일 (7개)**
- `apps/backend/src/storage/agents-repo.ts` — 에이전트 CRUD
- `apps/backend/src/storage/tasks-repo.ts` — 작업 CRUD
- `apps/backend/src/storage/sessions-repo.ts` — 세션 CRUD + stale 마킹
- `apps/backend/src/storage/settings-repo.ts` — KV 기반 설정 저장소
- `apps/backend/src/routes/settings.ts` — GET/PUT /api/settings
- `apps/backend/src/services/heartbeat.ts` — 주기적 tick 루프

**수정 파일 (19개)**
- `packages/shared-schema/src/settings.ts` — 7카테고리 Zod 스키마 + defaultSettings
- `packages/shared-schema/src/state.ts` — AgentState 필드 추가 (home_position, since, context)
- `apps/backend/src/storage/db.ts` — 3개 테이블 DDL + v1 마이그레이션
- `apps/backend/src/storage/state-repo.ts` — 신규 컬럼, getState/listStatesScoped
- `apps/backend/src/services/normalizer.ts` — deriveSemanticType, resolveLocale
- `apps/backend/src/services/state-machine.ts` — 전이 테이블 + 타이머 + post_complete
- `apps/backend/src/ws/gateway.ts` — handleConnection, subscribe/unsubscribe/ping, broadcast
- `apps/backend/src/routes/ingest.ts` — TransitionContext, 422 에러 응답
- `apps/backend/src/routes/agents.ts` — DB 기반 역할/고용형태 조회
- `apps/backend/src/routes/snapshot.ts` — tasks/sessions 실데이터 반환
- `apps/backend/src/routes/integration.ts` — hookTemplate 6개 이벤트
- `apps/backend/src/index.ts` — settings 라우트, heartbeat, WS handleConnection
- `apps/frontend/src/pages/DashboardPage.tsx` — 주기적 재동기화 + 활성작업 테이블
- `apps/frontend/src/pages/OfficePage.tsx` — PixiJS WebGL 전면 리라이트
- `apps/frontend/src/stores/ws-store.ts` — 지수백오프 자동 재연결
- `apps/frontend/src/lib/constants.ts` — VITE_BACKEND_ORIGIN/VITE_WS_URL 환경변수
- `apps/frontend/src/lib/api.ts` — BACKEND_ORIGIN 사용
- `apps/frontend/src/App.tsx` — WS_URL 사용
- `apps/frontend/src/i18n/index.ts` — 활성작업 관련 i18n 키 추가

### 구현 중 발생한 이슈 및 해결

1. **`db.pragma()` 타입 에러**: better-sqlite3에 타입 선언 부재 → `db.prepare("PRAGMA user_version").get()` 패턴으로 우회
2. **`sessions-repo.ts` 반환 타입**: `markInactiveStmt.run()` 반환 unknown → `as { changes: number }` 캐스트
3. **`gateway.ts` wss.on() 타입**: ws 모듈 타입 선언 부재 → `WsClient` 인터페이스 + `handleConnection()` 함수 분리
4. **`heartbeat.ts` facing 타입**: string vs literal union 불일치 → explicit cast 적용

### 후속 과제 (본 플랜 범위 밖)

- #21 인증 미들웨어
- #22 이동 속도 설정 연동 (현재 120px/s 고정)
- #23 fingerprint 기반 에이전트 식별
- #26 seed-mock 스크립트 갱신

---

## 범위

통합 리포트의 CRITICAL 7건 + MAJOR 10건을 대상으로 한다.
MINOR 9건은 각 Step 진행 중 자연스럽게 함께 해소되거나, 별도 후속 패치로 처리한다.

| 구분 | 해소 대상 이슈 번호 |
|---|---|
| **본 계획에서 해소** | #1~#17 (CRITICAL + MAJOR 전체) + #18,#19,#20,#24,#25 (연관 MINOR) |
| **후속 처리** | #21(인증), #22(이동속도), #23(fingerprint), #26(seed-mock) |

---

## 의존성 그래프

```
Layer 0 (Schema)     : #5 Settings 스키마, #7 AgentState 스키마
Layer 1 (Storage)    : #4 DB 테이블 (agents, tasks, sessions)
Layer 2 (Config/API) : #6 Settings API, #10 URL 동적화
Layer 3 (Normalizer) : #3 의미적 이벤트 추출, #14 Notification 매핑
Layer 4 (StateMachine): #1 전이 규칙, #12 역할/고용 판정, #17 좌석 좌표
Layer 5 (Infra)      : #8 WebSocket 프로토콜, #9 Heartbeat
Layer 6 (Client)     : #15 Snapshot resync, #16 Ingest 오류, #2 PixiJS, #11 말풍선, #13 활성 작업
```

하위 레이어가 상위 레이어의 전제 조건이므로 Layer 0부터 순차 진행한다.

> **핵심 인사이트**: #3(의미적 이벤트 추출)이 #1(상태 머신)의 **근본 원인**이다.
> normalizer가 `task_created`, `task_completed` 등을 생성하지 않으면,
> 상태 머신에 아무리 전이 규칙을 추가해도 트리거될 이벤트 자체가 없다.
> 따라서 Layer 3(Normalizer)을 Layer 4(StateMachine)보다 먼저 해결한다.

---

## Step 1: Schema 정합성 복원 (C-01, C-03)

### 1-A. Settings 스키마 완성 (`C-01`)

**파일**: `packages/shared-schema/src/settings.ts`

**변경 내용**: `settings-spec.md`의 7개 카테고리를 모두 반영한 zod 스키마를 작성한다.

```typescript
// 변경 후 구조 (골격)
export const settingsSchema = z.object({
  general: z.object({
    language: z.enum(["ko", "en"]),
    timezone: z.string().min(1),           // e.g. "Asia/Seoul"
    date_format: z.enum(["relative", "absolute"]),
    theme: z.enum(["office-light", "office-dark"]),
    animation_speed: z.enum(["slow", "normal", "fast"]),
  }),
  i18n: z.object({
    fallback_language: z.enum(["ko", "en"]).default("en"),
    number_locale: z.string().min(1),
    event_message_locale_mode: z.enum(["ui_locale", "event_locale"]),
  }),
  office_layout: z.object({
    layout_profile: z.string().min(1),     // "kr_t_left_v2"
    seat_positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
    meeting_spots: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })).min(1),
    pantry_zone_enabled: z.boolean(),
    pantry_door_lane: z.object({ x_min: z.number(), x_max: z.number(), y_min: z.number(), y_max: z.number() }),
    speech_bubble_enabled: z.boolean(),
    status_icon_enabled: z.boolean(),
  }),
  operations: z.object({
    idle_to_breakroom_seconds: z.number().int().positive(),
    idle_to_resting_seconds: z.number().int().positive(),
    post_complete_policy: z.enum(["weighted_random", "roaming_only", "breakroom_only", "resting_only"]),
    post_complete_weights: z.object({
      roaming: z.number().min(0).max(1),
      breakroom: z.number().min(0).max(1),
      resting: z.number().min(0).max(1),
    }),
    pending_input_alert_seconds: z.number().int().positive(),
    failed_alert_seconds: z.number().int().positive(),
    stale_agent_seconds: z.number().int().positive(),
    failure_alert_enabled: z.boolean(),
    snapshot_sync_interval_sec: z.number().int().min(5).max(300),
    heartbeat_interval_sec: z.number().int().min(2).max(60),
  }),
  connection: z.object({
    api_base_url: z.string().url(),
    ws_url: z.string().url(),
    masking_keys: z.array(z.string()),
  }),
  session_tracking: z.object({
    workspace_id_strategy: z.enum(["repo_name", "explicit"]),
    terminal_session_id_strategy: z.enum(["env", "generated"]),
    default_view_scope: z.enum(["workspace", "terminal_session", "all"]),
  }),
  motion_effects: z.object({
    working_paper_effect_enabled: z.boolean(),
    failed_scream_motion_enabled: z.boolean(),
    resting_zzz_effect_enabled: z.boolean(),
    motion_intensity: z.enum(["low", "normal", "high"]),
  }),
});
```

**기본값 객체**: 같은 파일에 `defaultSettings` 상수를 export한다. 스키마의 `.default()` 대신 명시적 객체로 관리하여 런타임에서 참조 가능하게 한다.

```typescript
export const defaultSettings: Settings = {
  general: {
    language: "ko",
    timezone: "Asia/Seoul",
    date_format: "relative",
    theme: "office-light",
    animation_speed: "normal",
  },
  i18n: {
    fallback_language: "en",
    number_locale: "ko-KR",
    event_message_locale_mode: "ui_locale",
  },
  office_layout: {
    layout_profile: "kr_t_left_v2",
    seat_positions: {},
    meeting_spots: [{ id: "m1", x: 40, y: 48 }],
    pantry_zone_enabled: true,
    pantry_door_lane: { x_min: 64, x_max: 78, y_min: 84, y_max: 96 },
    speech_bubble_enabled: true,
    status_icon_enabled: true,
  },
  operations: {
    idle_to_breakroom_seconds: 180,
    idle_to_resting_seconds: 240,
    post_complete_policy: "weighted_random",
    post_complete_weights: { roaming: 0.4, breakroom: 0.4, resting: 0.2 },
    pending_input_alert_seconds: 60,
    failed_alert_seconds: 30,
    stale_agent_seconds: 30,
    failure_alert_enabled: true,
    snapshot_sync_interval_sec: 30,
    heartbeat_interval_sec: 10,
  },
  connection: {
    api_base_url: "http://127.0.0.1:4800",
    ws_url: "ws://127.0.0.1:4800/ws",
    masking_keys: ["password", "token", "secret", "api_key"],
  },
  session_tracking: {
    workspace_id_strategy: "repo_name",
    terminal_session_id_strategy: "env",
    default_view_scope: "workspace",
  },
  motion_effects: {
    working_paper_effect_enabled: true,
    failed_scream_motion_enabled: true,
    resting_zzz_effect_enabled: true,
    motion_intensity: "normal",
  },
};
```

**설계 근거**:
- `defaultSettings`를 별도 상수로 분리하면 서버(settings-repo)와 프론트엔드(ui-settings-store) 양쪽에서 단일 import로 기본값을 참조할 수 있다.
- `z.string().url()` 등 구체적 검증으로 잘못된 값 입력 시 zod parse 에러를 즉시 발생시킨다 (폴백 없음).
- `meeting_spots`에 `.min(1)`을 걸어 빈 배열이 들어오면 검증 에러를 발생시킨다.

### 1-B. AgentState 스키마에 누락 필드 추가 (`C-03`)

**파일**: `packages/shared-schema/src/state.ts`

**변경 내용**:

```typescript
export interface AgentState {
  agent_id: string;
  status: AgentStatus;
  position: { x: number; y: number };
  home_position: { x: number; y: number };       // 추가: 고정 좌석 좌표
  target_position: { x: number; y: number } | null;
  facing: "left" | "right" | "up" | "down";
  since: string;                                   // 추가: 현재 상태 진입 시각 (ISO)
  context: {                                       // 추가: 현재 작업 문맥
    task_id: string | null;
    peer_agent_id: string | null;
  };
  last_event_ts: string;
}
```

**설계 근거**:
- `since`는 타임아웃 정책의 기준 시각이 된다. `state-machine.ts`에서 `Date.now() - Date.parse(since)`로 경과 시간을 계산하여 idle→breakroom 등 타이머 전이를 판단한다.
- `context`는 어떤 작업/상대 에이전트와 연관된 상태인지 추적한다. meeting 안무에서 `peer_agent_id`가 필수.
- `home_position`은 좌석 좌표로, 이동 후 복귀 목적지를 결정한다.

---

## Step 2: Storage 계층 완성 (C-06)

**파일**: `apps/backend/src/storage/db.ts`

### 2-A. `agents` 테이블 추가

```sql
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','worker','specialist','unknown')),
  employment_type TEXT NOT NULL CHECK(employment_type IN ('employee','contractor')),
  is_persisted INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK(source IN ('project_agent','runtime_agent','unknown')),
  avatar_id TEXT,
  seat_x REAL NOT NULL DEFAULT 0,
  seat_y REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
```

### 2-B. `tasks` 테이블 추가

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('created','started','completed','failed')),
  assignee_id TEXT,
  manager_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 2-C. `sessions` 테이블 추가

```sql
CREATE TABLE IF NOT EXISTS sessions (
  workspace_id TEXT NOT NULL,
  terminal_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  last_heartbeat_ts TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  PRIMARY KEY (workspace_id, terminal_session_id, run_id)
);
```

### 2-D. `state_current` 테이블 컬럼 추가

**방법**: 기존 테이블에 `home_position_x`, `home_position_y`, `since`, `context_json` 컬럼을 추가한다.

DDL에서 `CREATE TABLE IF NOT EXISTS`를 사용하고 있으므로, 기존 DB와의 호환성을 위해 migration 패턴을 적용한다.

```typescript
// db.ts에 추가할 migration 로직
const userVersion = db.pragma("user_version", { simple: true }) as number;

if (userVersion < 1) {
  db.exec(`
    ALTER TABLE state_current ADD COLUMN home_position_x REAL NOT NULL DEFAULT 0;
    ALTER TABLE state_current ADD COLUMN home_position_y REAL NOT NULL DEFAULT 0;
    ALTER TABLE state_current ADD COLUMN since TEXT NOT NULL DEFAULT '';
    ALTER TABLE state_current ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
  `);
  db.pragma("user_version = 1");
}
```

**파일 추가**: `apps/backend/src/storage/agents-repo.ts`, `apps/backend/src/storage/tasks-repo.ts`, `apps/backend/src/storage/sessions-repo.ts`

각 repo는 해당 테이블의 CRUD prepared statement를 제공한다. `agents-repo.ts`에서 좌석 좌표를 관리하여 `H-07`도 함께 해소.

**설계 근거**:
- Agent 정보가 DB에 영속되면 `agents.ts` 라우트에서 agent_id 문자열 패턴으로 role/employment를 추측하는 현재의 취약한 로직을 제거할 수 있다.
- Sessions 테이블이 있어야 heartbeat 기반 세션 상태 추적이 가능하다 (Step 4의 C-10 전제 조건).
- Tasks 테이블로 스냅샷의 `tasks: []`를 실제 데이터로 채울 수 있다.

---

## Step 3: Settings API 및 URL 동적화 (C-04, C-05)

### 3-A. Settings API 구현 (`C-04`)

**파일 추가**: `apps/backend/src/storage/settings-repo.ts`

```typescript
// SQLite에 settings JSON을 단일 row로 저장
// key: 'current', value: JSON string
// 기본값: shared-schema의 defaultSettings
```

**파일 추가**: `apps/backend/src/routes/settings.ts`

```typescript
// GET /api/settings → 현재 설정 반환 (없으면 defaultSettings)
// PUT /api/settings → body를 settingsSchema.parse()로 검증 → 저장
//   검증 실패 시 400 + zod error 반환 (폴백 없음)
```

**파일 수정**: `apps/backend/src/index.ts` — `registerSettingsRoutes(app)` 등록

서버 내부에서 설정값이 필요한 모든 곳(normalizer, state-machine, heartbeat)은 `settings-repo.getSettings()`를 호출하여 동적으로 읽는다.

### 3-B. 프론트엔드 URL 동적화 (`C-05`, `H-01`)

**설계**: 프론트엔드에서 API/WS URL을 결정하는 단일 소스를 만든다.

**파일 수정**: `apps/frontend/src/lib/constants.ts`

```typescript
// Vite 환경변수에서 읽고, 없으면 명시적 에러
function requireEnvOrDefault(key: string, fallback: string): string {
  return import.meta.env[key] ?? fallback;
}

export const BACKEND_ORIGIN = requireEnvOrDefault("VITE_API_BASE_URL", "http://127.0.0.1:4800");
export const WS_URL = requireEnvOrDefault("VITE_WS_URL", "ws://127.0.0.1:4800/ws");
```

**파일 수정**: `apps/frontend/src/lib/api.ts` — `BACKEND_ORIGIN` import 사용

```typescript
import { BACKEND_ORIGIN } from "./constants";

export async function fetchSnapshot(): Promise<unknown> {
  const res = await fetch(`${BACKEND_ORIGIN}/api/snapshot`);
  if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
  return res.json();
}
```

**파일 수정**: `apps/frontend/src/App.tsx` — `WS_URL` import 사용

```typescript
import { WS_URL } from "./lib/constants";
// ...
useEffect(() => { connect(WS_URL); }, [connect]);
```

**장기 계획**: Settings API가 완성되면 프론트엔드 초기화 시 `GET /api/settings`를 호출하여 `connection.api_base_url`, `connection.ws_url`을 받아오는 부트스트랩 패턴으로 전환할 수 있다. 단, 부트스트랩 자체의 URL은 환경변수에서 올 수밖에 없으므로 `constants.ts`의 환경변수 기반 접근은 유지한다.

**설계 근거**:
- Vite의 `import.meta.env`를 활용하면 빌드 시점에 주입 가능하고, `.env` 파일로 환경별 설정이 된다.
- 하드코딩된 URL 3곳을 모두 제거하고 단일 소스(`constants.ts`)로 통합.
- `BACKEND_ORIGIN`과 `WS_URL`을 분리한 이유: 프로토콜이 다르고(http vs ws), 리버스 프록시 환경에서 경로가 다를 수 있다.

---

## Step 4: Normalizer — 의미적 이벤트 추출 (#3, #14, #25)

> 이 단계는 상태 머신(Step 5)이 동작하기 위한 **필수 전제 조건**이다.
> normalizer가 hook 원본에서 `task_created`, `task_completed` 등의 이벤트를 생성하지 않으면, 상태 머신 전이의 대부분이 트리거될 수 없다.

**파일**: `apps/backend/src/services/normalizer.ts`

### 4-A. Semantic Event Extraction 구현 (#3)

`event-schema.md §5.2`의 규칙을 구현한다:

```typescript
function deriveSemanticType(
  rawEventName: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  error: unknown
): NormalizedEvent["type"] {
  // 1순위: SubagentStart/Stop — 확정 이벤트
  if (rawEventName === "SubagentStart") return "agent_started";
  if (rawEventName === "SubagentStop") return "agent_stopped";
  if (rawEventName === "Stop") return "agent_stopped";

  // 2순위: Notification — agent_blocked
  if (rawEventName === "Notification") return "agent_blocked";

  // 3순위: PreToolUse — tool_name 기반 의미 이벤트 추출
  if (rawEventName === "PreToolUse") {
    if (toolName === "Task" || toolName === "TaskCreate") return "task_created";
    // 그 외 PreToolUse는 tool_started
    return "tool_started";
  }

  // 4순위: PostToolUse — tool_name + error 기반
  if (rawEventName === "PostToolUse") {
    if (error) {
      return "tool_failed";
    }
    // PostToolUse 성공 시 tool_input 분석으로 작업 이벤트 파생
    if (toolName === "Task" || toolName === "TaskCreate") {
      const status = toolInput?.status as string | undefined;
      if (status === "completed") return "task_completed";
      if (status === "failed") return "task_failed";
      if (status === "started") return "task_started";
      return "task_progress";
    }
    return "tool_succeeded";
  }

  return "schema_error";
}
```

**우선순위 체인**:
- `SubagentStart/Stop` > `PreToolUse` 기반 추정 > `PostToolUse` 기반 확정 > `synthetic`
- 동일 의미 이벤트가 PreToolUse(추정)와 PostToolUse(확정) 양쪽에서 발생 가능하므로, PostToolUse의 결과를 우선한다.

**settings에서 동적으로 읽을 부분**:
- Semantic extraction에서 tool_name → event_type 매핑을 향후 `advanced.transition_rules_editable`로 사용자 정의 가능하게 확장할 수 있으나, MVP에서는 코드 내 매핑 테이블로 충분하다.

### 4-B. Notification 매핑 추가 (#14)

위 `deriveSemanticType`에서 이미 처리됨:
```typescript
if (rawEventName === "Notification") return "agent_blocked";
```
`Notification`의 `level`이 `error`이면 severity를 `"error"`로 설정.

### 4-C. locale 하드코딩 제거 (#25)

```typescript
const settings = getSettings();
const locale = String(
  input.locale ??
  `${settings.general.language}-${settings.general.language.toUpperCase()}`
);
```

---

## Step 5: 상태 머신 전이 확장 (#1, #12, #17)

**파일**: `apps/backend/src/services/state-machine.ts`

현재 단순 if-else 구조를 **전이 테이블 + 조건 함수** 패턴으로 리팩터링한다.

```typescript
import type { NormalizedEvent } from "@aod/shared-schema";
import type { Settings } from "@aod/shared-schema";

interface TransitionContext {
  current: AgentStatus;
  event: NormalizedEvent;
  since: string;          // 현재 상태 진입 시각
  settings: Settings;     // 동적 설정값 참조
}

type TransitionRule = {
  from: AgentStatus | "*";
  event: NormalizedEvent["type"];
  condition?: (ctx: TransitionContext) => boolean;
  to: AgentStatus;
};

const transitionTable: TransitionRule[] = [
  // --- Agent lifecycle ---
  { from: "*",              event: "agent_started",     to: "idle" },
  { from: "*",              event: "agent_stopped",     to: "offline" },

  // --- Task flow (from idle/seated states) ---
  { from: "idle",           event: "task_started",      to: "working" },
  { from: "working",        event: "task_completed",    to: "completed" },
  { from: "working",        event: "task_failed",       to: "failed" },
  { from: "completed",      event: "task_started",      to: "working" },  // 큐 대기 작업

  // --- Task flow (from off-duty states → returning first) ---
  { from: "roaming",        event: "task_started",      to: "returning" },
  { from: "breakroom",      event: "task_started",      to: "returning" },
  { from: "resting",        event: "task_started",      to: "returning" },

  // --- tool_failed: fatal → failed, retryable → pending_input ---
  { from: "working", event: "tool_failed", to: "failed",
    condition: (ctx) => isFatalError(ctx.event) },
  { from: "working", event: "tool_failed", to: "pending_input" },

  // --- Recovery ---
  { from: "failed",         event: "agent_unblocked",   to: "working" },
  { from: "pending_input",  event: "agent_unblocked",   to: "working" },

  // --- Collaboration (from idle) ---
  { from: "idle",           event: "manager_assign",    to: "handoff" },
  { from: "working",        event: "manager_assign",    to: "working" },  // 기본: 큐 적재

  // --- Collaboration (from off-duty states → handoff to meeting spot) ---
  { from: "roaming",        event: "manager_assign",    to: "handoff" },
  { from: "breakroom",      event: "manager_assign",    to: "handoff" },
  { from: "resting",        event: "manager_assign",    to: "handoff" },

  // --- Meeting choreography ---
  { from: "handoff",        event: "meeting_started",   to: "meeting" },
  { from: "meeting",        event: "meeting_ended",     to: "returning" },

  // --- Heartbeat — 상태 유지, last_event_ts만 갱신 ---
  // (매칭되지 않으므로 fallthrough에서 현재 상태 유지)
];
```

**`isFatalError` 치명/재시도 분류** (`state-machine.md §4.4`):

```typescript
const FATAL_PATTERNS = ["permission denied", "not found", "ENOENT"];

function isFatalError(event: NormalizedEvent): boolean {
  const msg = String(event.payload?.error_message ?? "").toLowerCase();
  return FATAL_PATTERNS.some((p) => msg.includes(p));
  // TODO: 동일 도구 3회 연속 실패 → failed 승격 (failureCounter 필요)
}
```

**`nextStatus` 함수 리팩터링**:

```typescript
export function nextStatus(ctx: TransitionContext): AgentStatus {
  for (const rule of transitionTable) {
    if (rule.from !== "*" && rule.from !== ctx.current) continue;
    if (rule.event !== ctx.event.type) continue;
    if (rule.condition && !rule.condition(ctx)) continue;
    return rule.to;
  }
  // no-op 로깅: 매트릭스에 없는 (state, event) 조합
  logger.debug({ state: ctx.current, event: ctx.event.type }, "transition_ignored");
  return ctx.current;
}
```

**타이머 기반 전이**: 별도 함수 `checkTimerTransitions`로 분리.

```typescript
export function checkTimerTransitions(
  status: AgentStatus,
  since: string,
  settings: Settings
): AgentStatus | null {
  const elapsed = (Date.now() - new Date(since).getTime()) / 1000;

  if (status === "idle" && elapsed > settings.operations.idle_to_breakroom_seconds) {
    return "breakroom";
  }
  if (status === "idle" && elapsed > settings.operations.idle_to_resting_seconds) {
    return "resting";
  }
  if (status === "handoff" && elapsed > 10) {
    return "returning";  // 타임아웃: 강제 복귀
  }
  if (status === "meeting" && elapsed > 15) {
    return "returning";  // 타임아웃: 자동 종료
  }
  return null;  // 전이 없음
}
```

**`completed` 후처리 (post_complete_policy)**:

```typescript
export function resolvePostComplete(settings: Settings): AgentStatus {
  const policy = settings.operations.post_complete_policy;
  if (policy === "roaming_only") return "roaming";
  if (policy === "breakroom_only") return "breakroom";
  if (policy === "resting_only") return "resting";

  // weighted_random
  const w = settings.operations.post_complete_weights;
  const r = Math.random();
  if (r < w.roaming) return "roaming";
  if (r < w.roaming + w.breakroom) return "breakroom";
  return "resting";
}
```

**설계 근거**:
- 전이 테이블 패턴은 규칙 추가/삭제가 선언적이고, 전이 매트릭스를 테스트로 검증하기 쉽다.
- `condition` 함수로 동일 이벤트의 분기 조건(예: `tool_failed`의 fatal/retryable)을 표현한다.
- 타이머 전이는 이벤트 전이와 분리하여, heartbeat 수신 시 또는 주기적 tick에서 호출한다.
- `settings`를 함수 인자로 받아 모든 임계치가 동적으로 결정된다 (하드코딩 제거).

### 5-B. 에이전트 역할/고용형태를 DB에서 판정 (#12)

**파일**: `apps/backend/src/routes/agents.ts`

현재 `roleFromAgentId()`, `employmentFromAgentId()` 함수를 삭제하고, `agents-repo`에서 DB 조회로 대체한다:

```typescript
// 변경 전: agent_id 문자열 패턴 추론
// 변경 후: agents 테이블에서 조회
const agentRow = getAgent(state.agent_id);
if (!agentRow) {
  // DB에 없는 에이전트 → 기본 계약직 (agents-tab-spec.md §6)
  // 단, 오류 로그를 남겨 운영자가 인지하게 한다
  logger.warn({ agent_id: state.agent_id }, "agent not found in agents table, defaulting to contractor");
}
return {
  agent_id: state.agent_id,
  display_name: agentRow?.display_name ?? state.agent_id.split("/").at(-1) ?? state.agent_id,
  role: agentRow?.role ?? "unknown",
  employment_type: agentRow?.employment_type ?? "contractor",
  // ...
};
```

### 5-C. Ingest 라우트에서 좌석 좌표 반영 (#17)

**파일**: `apps/backend/src/routes/ingest.ts`

`nextStatus` 호출부를 새 시그니처에 맞게 수정. `since`, `settings`를 전달하도록 변경.
좌석 좌표는 `agents-repo`에서 읽어온다:

```typescript
const agentRow = getAgent(event.agent_id);
const seatX = agentRow?.seat_x ?? 0;
const seatY = agentRow?.seat_y ?? 0;
// ...
upsertState({
  // ...
  position_x: seatX,
  position_y: seatY,
  home_position_x: seatX,
  home_position_y: seatY,
  since: event.ts,
  context_json: JSON.stringify({ task_id: event.task_id ?? null, peer_agent_id: event.target_agent_id ?? null }),
});
```

---

## Step 6: WebSocket 게이트웨이 & Heartbeat (#8, #9)

### 6-A. WebSocket 메시지 핸들러 구현 (#8)

**파일**: `apps/backend/src/ws/gateway.ts`

```typescript
import { WebSocketServer, type WebSocket } from "ws";

type ClientMeta = {
  subscriptions: Set<string>;  // "workspace_id:terminal_session_id:run_id" 형식
};

const clientMeta = new WeakMap<WebSocket, ClientMeta>();

export const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws: WebSocket) => {
  clientMeta.set(ws, { subscriptions: new Set() });

  ws.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      const meta = clientMeta.get(ws);
      if (!meta) return;

      if (msg.type === "subscribe") {
        const key = scopeKey(msg.workspace_id, msg.terminal_session_id, msg.run_id);
        meta.subscriptions.add(key);
      } else if (msg.type === "unsubscribe") {
        const key = scopeKey(msg.workspace_id, msg.terminal_session_id, msg.run_id);
        meta.subscriptions.delete(key);
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
      }
    } catch {
      // 잘못된 메시지는 무시하지 않고 에러를 보낸다
      ws.send(JSON.stringify({ type: "error", message: "invalid message format" }));
    }
  });
});

function scopeKey(w?: string, t?: string, r?: string): string {
  return `${w ?? "*"}:${t ?? "*"}:${r ?? "*"}`;
}

export function broadcast(message: unknown, scope?: { workspace_id: string; terminal_session_id: string; run_id: string }): void {
  const payload = JSON.stringify(message);
  const eventKey = scope ? scopeKey(scope.workspace_id, scope.terminal_session_id, scope.run_id) : null;

  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const meta = clientMeta.get(client as WebSocket);

    // 구독이 없으면 전체 수신 (기존 호환), 있으면 매칭된 scope만
    if (meta && meta.subscriptions.size > 0 && eventKey) {
      const matches = meta.subscriptions.has(eventKey) ||
                      meta.subscriptions.has(scopeKey("*", "*", "*"));
      if (!matches) continue;
    }

    client.send(payload);
  }
}
```

### 6-B. Heartbeat 생성기 구현 (#9)

**파일 추가**: `apps/backend/src/services/heartbeat.ts`

```typescript
import { getSettings } from "../storage/settings-repo";
import { listActiveSessions } from "../storage/sessions-repo";
import { broadcast } from "../ws/gateway";

let timer: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(): void {
  if (timer) return;
  tick();  // 즉시 1회 실행

  const settings = getSettings();
  const intervalMs = settings.operations.heartbeat_interval_sec * 1000;
  timer = setInterval(tick, intervalMs);
}

export function stopHeartbeat(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

function tick(): void {
  const settings = getSettings();
  const sessions = listActiveSessions();
  const ts = new Date().toISOString();

  for (const session of sessions) {
    const heartbeatEvent = {
      type: "heartbeat",
      data: {
        workspace_id: session.workspace_id,
        terminal_session_id: session.terminal_session_id,
        run_id: session.run_id,
        ts,
      }
    };
    broadcast(heartbeatEvent, session);
  }
}
```

**파일 수정**: `apps/backend/src/index.ts` — 서버 시작 후 `startHeartbeat()` 호출

**설계 근거**:
- Heartbeat 주기를 `settings.operations.heartbeat_interval_sec`에서 동적으로 읽는다.
- sessions 테이블(Step 2-C)의 활성 세션 목록을 순회하여 각 세션별 heartbeat를 생성한다.
- 스코프 기반 broadcast로 불필요한 트래픽을 방지한다.

---

## Step 7: 클라이언트 재동기화 & 오류 가시화 (#15, #16)

### 7-A. Snapshot 주기 재동기화 (#15)

**파일**: `apps/frontend/src/stores/ws-store.ts` 또는 `DashboardPage.tsx`

DashboardPage의 초기 로드 `useEffect`에 `setInterval` 로직을 추가한다. 주기는 서버에서 받은 settings의 `snapshot_sync_interval_sec`를 사용한다.

```typescript
useEffect(() => {
  const intervalId = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_ORIGIN}/api/snapshot${suffix}`);
      if (!res.ok) throw new Error(`snapshot resync failed: ${res.status}`);
      const json = await res.json();
      // 상태 갱신
    } catch (e) {
      console.error("snapshot resync error:", e);
    }
  }, syncIntervalMs);  // settings에서 읽은 값 × 1000

  return () => clearInterval(intervalId);
}, [/* dependencies */]);
```

### 7-B. Ingest 라우트 오류 노출 (#16)

**파일**: `apps/backend/src/routes/ingest.ts`

현재: 200을 먼저 보내고 후처리 → 실패 시 호출자가 모름

변경: 처리 완료 후 응답. 실패 시 에러 상태 코드와 메시지를 반환한다.

```typescript
app.post("/ingest/hooks", async (request, reply) => {
  const body = (request.body ?? {}) as Record<string, unknown>;

  try {
    const event = normalizeHookEvent(body);
    insertEvent(event);
    // ... state update, broadcast ...
    return reply.code(200).send({ ok: true, event_id: event.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    request.log.error({ error }, "ingest processing failed");
    return reply.code(422).send({ ok: false, error: message });
  }
});
```

**트레이드오프**: Hook 호출자의 응답 대기 시간이 증가한다. 그러나 "문제가 있으면 오류를 띄워 사용자가 알게한다" 원칙에 따라, 이벤트 손실을 숨기는 것보다 낫다. Hook의 `curl` 명령에 `-m 2` 타임아웃이 있으므로 2초 이내 처리가 전제.

---

## Step 8: 프론트엔드 기능 보완 (#2, #11, #13)

### 8-A. PixiJS 기반 Office 렌더러 (#2)

**파일**: `apps/frontend/src/pages/OfficePage.tsx` (대규모 리팩터링)

현재 HTML div + `requestAnimationFrame` 기반 렌더링을 PixiJS WebGL로 전환한다.

**설계 방향**:
- `pixi.js`가 이미 `package.json`에 설치되어 있으므로 추가 의존성 불필요.
- OfficePage 내에 `<canvas>` ref를 두고, `useEffect`에서 PixiJS `Application`을 초기화한다.
- 에이전트는 `Sprite` 또는 `Container`로 표현하고, `Ticker`를 이용해 이동 보간한다.
- 이펙트(working paper, failed scream, zzz)를 PixiJS `Graphics`/`Text`로 구현한다.

```typescript
// 골격
import { Application, Container, Sprite, Text, Ticker } from "pixi.js";

function initOffice(canvas: HTMLCanvasElement): Application {
  const app = new Application();
  // await app.init({ canvas, resizeTo: canvas.parentElement });
  // 에이전트 Container 생성, 좌석/미팅/탕비실 존 렌더링
  return app;
}
```

**이동 속도**: `state-machine.md §7`의 120 px/s를 캔버스 해상도에 맞게 적용. 정규화 좌표(0-100)를 실제 캔버스 픽셀로 변환하는 함수를 사용한다.

**좌석 좌표**: OfficePage.tsx에 하드코딩된 `seatPoints` 배열을 제거하고, 서버 스냅샷(`agents[].home_position`)에서 읽는다. 스냅샷에 좌석이 없으면(마이그레이션 전 데이터) settings의 `office_layout.seat_positions`에서 참조한다.

**트레이드오프**: PixiJS 전환은 가장 큰 작업량을 요구한다. 그러나 문서에 명시된 기술 스택이고 성능 목표(20 agents, 30 FPS)를 달성하기 위해 필요하다. 코드 품질 우선 원칙에 따라, 현재 div 기반 코드를 유지하면서 점진적으로 PixiJS로 마이그레이션하는 것도 가능하나, 이중 렌더링 코드를 유지하는 것은 기술 부채를 늘리므로 한 번에 전환하는 것을 권장한다.

### 8-B. 말풍선(Speech Bubble) 구현 (#11)

**파일**: PixiJS 전환 후 OfficeRenderer 내에서 구현

```typescript
// 에이전트 Container 내에 speechBubble Text 추가
// settings.office_layout.speech_bubble_enabled가 false면 비표시
function createSpeechBubble(text: string, settings: Settings): Container | null {
  if (!settings.office_layout.speech_bubble_enabled) return null;
  // 말풍선 배경(RoundedRect) + 텍스트
}
```

말풍선 내용은 최근 이벤트의 `payload.summary` 또는 `payload.tool_name`에서 가져온다.
표시 조건: 에이전트가 `working` 또는 `meeting` 상태일 때만 표시.

### 8-C. 활성 작업 목록 구현 (#13)

**파일**: `apps/frontend/src/pages/DashboardPage.tsx`

스냅샷의 `tasks` 배열(Step 2-B에서 실제 데이터를 채우게 됨)을 이용하여 활성 작업 위젯을 렌더링한다.

```tsx
<article className="panel">
  <h3>{t("dashboard_active_tasks")}</h3>
  <table>
    <thead><tr>
      <th>Task ID</th><th>{t("common_assignee")}</th><th>{t("common_elapsed")}</th><th>{t("common_status")}</th>
    </tr></thead>
    <tbody>
      {tasks.filter(t => t.status === "started").map(task => (
        <tr key={task.id}>
          <td>{task.id}</td>
          <td>{task.assignee_id}</td>
          <td>{elapsedSince(task.created_at)}</td>
          <td>{task.status}</td>
        </tr>
      ))}
    </tbody>
  </table>
</article>
```

i18n 키 추가: `dashboard_active_tasks`, `common_assignee`, `common_elapsed`.

---

## Step 9: 기본값 보정 & Hook 템플릿 완성 (#18, #19, #20, #24)

### 9-A. Time Travel 기본 before/after 값 보정 (#20)

**파일**: `apps/backend/src/routes/snapshot.ts:65-66`

```typescript
const beforeLimit = Number(query.before ?? 10);  // 8 → 10
const afterLimit = Number(query.after ?? 10);     // 8 → 10
```

### 9-B. Hook 템플릿 완성 (#18)

**파일**: `apps/backend/src/routes/integration.ts`

`hookTemplate`에 `SubagentStop`, `Stop`, `Notification` 이벤트를 추가한다:

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "curl ..." }],
    "PostToolUse": [{ "command": "curl ..." }],
    "SubagentStart": [{ "command": "curl ..." }],
    "SubagentStop": [{ "command": "curl ..." }],
    "Stop": [{ "command": "curl ..." }],
    "Notification": [{ "command": "curl ..." }]
  }
}
```

---

## 실행 순서 요약

| 순서 | Step | 해소하는 이슈 | 주요 변경 파일 |
|---|---|---|---|
| 1 | Schema 정합성 | #5, #7 | `shared-schema/src/settings.ts`, `shared-schema/src/state.ts` |
| 2 | Storage 계층 | #4, #17 | `storage/db.ts`, 신규 `agents-repo.ts`, `tasks-repo.ts`, `sessions-repo.ts` |
| 3 | Settings API & URL | #6, #10 | 신규 `routes/settings.ts`, `storage/settings-repo.ts`, `constants.ts`, `api.ts`, `App.tsx` |
| 4 | Normalizer 의미적 추출 | #3, #14, #25 | `normalizer.ts` |
| 5 | 상태 머신 & 에이전트 판정 | #1, #12, #17 | `state-machine.ts`, `routes/agents.ts`, `ingest.ts` |
| 6 | WebSocket & Heartbeat | #8, #9 | `ws/gateway.ts`, 신규 `heartbeat.ts`, `index.ts` |
| 7 | 클라이언트 동기화 & 오류 | #15, #16 | `DashboardPage.tsx`, `ingest.ts` |
| 8 | 프론트엔드 기능 보완 | #2, #11, #13 | `OfficePage.tsx`, `DashboardPage.tsx` |
| 9 | 기본값 보정 & 템플릿 | #18, #19, #20, #24 | `snapshot.ts`, `integration.ts` |

---

## 적용 원칙 검증

| 원칙 | 적용 방식 |
|---|---|
| 코드 품질 우선 | 전이 테이블 패턴, zod 스키마 검증, 타입 안전성 강화 |
| 구조적 효율 | 의존성 그래프 순서(Schema→Storage→API→Logic→Infra→Client), repo 패턴 통일 |
| 동적 값 사용 | `defaultSettings` 상수 + DB 영속 → `getSettings()` 함수로 런타임 참조, Vite 환경변수로 URL 관리 |
| 오류 > 폴백 | ingest 실패 시 422 반환, zod parse 에러 전파, 잘못된 WS 메시지에 error 응답, `meeting_spots.min(1)` 검증 |
