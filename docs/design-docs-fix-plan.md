# Critical Issues Fix Plan

작성일: 2026-02-14
근거: `docs/archive/docs-code-mismatch-report.md`
원칙:
1. 코드 품질 > 작업량/난이도
2. 구조적 효율 — 의존성 방향을 따라 하위 계층부터 수정
3. 동적 값 사용 — 하드코딩 금지, 세팅/환경변수에서 읽기
4. 폴백 대신 오류 — 문제 발생 시 사용자에게 명시적 오류 노출

---

## 의존성 그래프

```
Layer 0 (Schema)     : C-01, C-03
Layer 1 (Storage)    : C-06
Layer 2 (Config/API) : C-04, C-05
Layer 3 (Logic)      : C-02, C-07, H-02, H-03, H-04
Layer 4 (Infra)      : C-08, C-10
Layer 5 (Client)     : C-09, H-01, H-06, H-07
```

하위 레이어가 상위 레이어의 전제 조건이므로 Layer 0부터 순차 진행한다.

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

## Step 4: 상태 머신 & Normalizer 로직 보강 (C-02, C-07, H-02, H-03, H-04)

### 4-A. Normalizer에 `Notification` 매핑 추가 (`C-07`)

**파일**: `apps/backend/src/services/normalizer.ts`

```typescript
// 추가할 매핑:
else if (rawEventName === "Notification") type = "agent_blocked";
// Notification의 level이 error이면 severity를 "error"로 설정
```

`event-schema.md`에 `Notification`에 대한 명시적 매핑 타입이 없으므로, 문서에서 가장 의미적으로 가까운 `agent_blocked`로 매핑한다. `Notification`은 사용자에게 알림을 보내는 이벤트이므로, 에이전트가 외부 입력을 기다리는 상황을 나타낸다.

추가로 `locale` 하드코딩(`"ko-KR"`) 제거 → settings-repo에서 `general.language` 또는 hook payload의 locale 값을 사용:

```typescript
const settings = getSettings();
const locale = String(input.locale ?? `${settings.general.language}-${settings.general.language.toUpperCase()}`);
```

### 4-B. 상태 머신 전이 확장 (`C-02`, `H-02`, `H-03`, `H-04`)

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
  // Agent lifecycle
  { from: "*",              event: "agent_started",     to: "idle" },
  { from: "*",              event: "agent_stopped",     to: "offline" },

  // Task flow
  { from: "idle",           event: "task_started",      to: "working" },
  { from: "working",        event: "task_completed",    to: "completed" },
  { from: "working",        event: "task_failed",       to: "failed" },

  // tool_failed: fatal → failed, retryable → pending_input
  { from: "working", event: "tool_failed", to: "failed",
    condition: (ctx) => ctx.event.severity === "error" },
  { from: "working", event: "tool_failed", to: "pending_input" },

  // Recovery
  { from: "failed",         event: "agent_unblocked",   to: "working" },
  { from: "pending_input",  event: "agent_unblocked",   to: "working" },

  // Collaboration
  { from: "idle",           event: "manager_assign",    to: "handoff" },
  { from: "working",        event: "manager_assign",    to: "working" },  // 작업중이면 유지
  { from: "handoff",        event: "meeting_started",   to: "meeting" },
  { from: "meeting",        event: "meeting_ended",     to: "returning" },

  // Heartbeat — 상태 유지, last_event_ts만 갱신
  { from: "*",              event: "heartbeat",         to: "idle",
    condition: () => false },  // 매치되지 않도록 — 아래 fallthrough에서 현재 상태 유지
];
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
  // 매칭 규칙 없으면 현재 상태 유지
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

### 4-C. Ingest 라우트에서 state-machine 호출 시그니처 업데이트

**파일**: `apps/backend/src/routes/ingest.ts`

`nextStatus` 호출부를 새 시그니처에 맞게 수정. `since`, `settings`를 전달하도록 변경.

좌석 좌표는 `agents-repo`에서 읽어온다 (H-07 해소):

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

## Step 5: WebSocket 게이트웨이 & Heartbeat (C-08, C-10)

### 5-A. WebSocket 메시지 핸들러 구현 (`C-08`)

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

### 5-B. Heartbeat 생성기 구현 (`C-10`)

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

## Step 6: 클라이언트 재동기화 & 오류 가시화 (C-09, H-06)

### 6-A. Snapshot 주기 재동기화 (`C-09`)

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

### 6-B. Ingest 라우트 오류 노출 (`H-06`)

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

## Step 7: Event context 기본값 보정 & Hook 템플릿 완성 (H-05, M-03)

### 7-A. Time Travel 기본 before/after 값 보정 (`H-05`)

**파일**: `apps/backend/src/routes/snapshot.ts:65-66`

```typescript
const beforeLimit = Number(query.before ?? 10);  // 8 → 10
const afterLimit = Number(query.after ?? 10);     // 8 → 10
```

### 7-B. Hook 템플릿 완성 (`M-03`)

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
| 1 | Schema 정합성 | C-01, C-03 | `shared-schema/src/settings.ts`, `shared-schema/src/state.ts` |
| 2 | Storage 계층 | C-06, H-07 | `storage/db.ts`, 신규 `agents-repo.ts`, `tasks-repo.ts`, `sessions-repo.ts` |
| 3 | Settings API & URL | C-04, C-05, H-01 | 신규 `routes/settings.ts`, `storage/settings-repo.ts`, `constants.ts`, `api.ts`, `App.tsx` |
| 4 | 상태 머신 & Normalizer | C-02, C-07, H-02, H-03, H-04, M-05 | `state-machine.ts`, `normalizer.ts`, `ingest.ts` |
| 5 | WebSocket & Heartbeat | C-08, C-10 | `ws/gateway.ts`, 신규 `heartbeat.ts`, `index.ts` |
| 6 | 클라이언트 동기화 & 오류 | C-09, H-06 | `DashboardPage.tsx`, `ingest.ts` |
| 7 | 기본값 보정 & 템플릿 | H-05, M-03 | `snapshot.ts`, `integration.ts` |

---

## 적용 원칙 검증

| 원칙 | 적용 방식 |
|---|---|
| 코드 품질 우선 | 전이 테이블 패턴, zod 스키마 검증, 타입 안전성 강화 |
| 구조적 효율 | 의존성 그래프 순서(Schema→Storage→API→Logic→Infra→Client), repo 패턴 통일 |
| 동적 값 사용 | `defaultSettings` 상수 + DB 영속 → `getSettings()` 함수로 런타임 참조, Vite 환경변수로 URL 관리 |
| 오류 > 폴백 | ingest 실패 시 422 반환, zod parse 에러 전파, 잘못된 WS 메시지에 error 응답, `meeting_spots.min(1)` 검증 |
