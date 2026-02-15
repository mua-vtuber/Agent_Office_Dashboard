# Follow-up Fix Plan (v3 — 후속 과제)

작성일: 2026-02-15
근거: `docs/design-docs-fix-plan.md` 후속 과제 4건 (#21, #22, #23, #26)
원칙:
1. 코드 품질 > 작업량/난이도
2. 구조적 효율 — 의존성 방향을 따라 하위 계층부터 수정
3. 동적 값 사용 — 하드코딩 금지, 세팅/환경변수에서 읽기
4. 폴백 대신 오류 — 문제 발생 시 사용자에게 명시적 오류 노출

---

## 범위

v2 플랜에서 "본 플랜 범위 밖"으로 분류한 후속 과제 4건.

| # | 이슈 | 심각도 | 현재 상태 |
|---|------|--------|-----------|
| #21 | 인증 미들웨어 | CRITICAL | 전 엔드포인트 무인증, 문서에만 `Bearer $DASHBOARD_TOKEN` 기재 |
| #22 | 이동 속도 설정 연동 | MINOR | OfficePage `MOVE_SPEED = 120` 하드코딩 |
| #23 | fingerprint 기반 에이전트 식별 | MAJOR | `makeId()`가 payload 해시만 사용, 중복 제거 미구현 |
| #26 | seed-mock 스크립트 갱신 | MAJOR | 5건 기본 이벤트만 전송, 신규 테이블(agents/tasks/sessions) 미반영 |

---

## 의존성 그래프

```
Layer 0 (Schema)  : #22 Settings 스키마 확장 (move_speed_px_per_sec)
Layer 1 (Infra)   : #21 인증 미들웨어
Layer 2 (Logic)   : #23 Fingerprint 식별 + 이벤트 중복 제거
Layer 3 (Tooling) : #26 seed-mock 갱신 (인증 토큰 포함)
```

> **핵심 인사이트**: #21(인증)이 먼저 구현되면, #26(seed-mock)이 인증 헤더를 포함해야 한다.
> #22(Settings 확장)는 스키마 변경이므로 가장 먼저 처리한다.
> #23(fingerprint)은 normalizer 로직 변경이므로 단독 진행 가능하지만, seed-mock으로 검증하려면 #26 이전에 완료해야 한다.

---

## Step 1: Settings 스키마 확장 — 이동 속도 연동 (#22)

### 1-A. 스키마에 `move_speed_px_per_sec` 추가

**파일**: `packages/shared-schema/src/settings.ts`

`operations` 섹션에 이동 속도 필드를 추가한다.

```typescript
operations: z.object({
  // ... 기존 필드 ...
  move_speed_px_per_sec: z.number().int().min(30).max(300),
}),
```

**기본값**: `defaultSettings.operations.move_speed_px_per_sec = 120`

### 1-B. OfficePage에서 동적 속도 적용

**파일**: `apps/frontend/src/pages/OfficePage.tsx`

현재:
```typescript
const MOVE_SPEED = 120; // 하드코딩
```

변경 후:
```typescript
// PixiJS init 이전에 settings를 fetch하여 속도를 설정
const [moveSpeed, setMoveSpeed] = useState(120);

useEffect(() => {
  void (async () => {
    try {
      const res = await fetch(`${BACKEND_ORIGIN}/api/settings/app`);
      if (res.ok) {
        const json = (await res.json()) as {
          value?: { operations?: { move_speed_px_per_sec?: number } }
        };
        const speed = json.value?.operations?.move_speed_px_per_sec;
        if (typeof speed === "number" && speed >= 30) setMoveSpeed(speed);
      }
    } catch { /* settings 로드 실패 시 기본값 유지 */ }
  })();
}, []);

// Ticker에서 moveSpeed 사용
const step = Math.min(1, (moveSpeed * dt) / dist);
```

**주의**: `moveSpeed` state가 변경되면 PixiJS ticker의 클로저가 최신 값을 참조해야 한다. `useRef`로 최신 속도를 추적한다.

```typescript
const speedRef = useRef(120);
speedRef.current = moveSpeed;

// ticker 내부:
const step = Math.min(1, (speedRef.current * dt) / dist);
```

### 1-C. animation_speed ↔ move_speed 연동 (선택)

`general.animation_speed`를 속도 승수(multiplier)로 매핑할 수 있다.

```typescript
const speedMultiplier: Record<string, number> = {
  slow: 0.6,
  normal: 1.0,
  fast: 1.5,
};
```

그러나 이는 두 설정(`animation_speed`와 `move_speed_px_per_sec`)이 동일 값을 제어하는 충돌을 만든다.

**결정**: `move_speed_px_per_sec`가 절대값을 제어하고, `animation_speed`는 CSS 애니메이션(paper, zzz 등) 속도만 제어한다. 관심사를 분리한다.

**설계 근거**:
- 하드코딩(120px/s) 제거 → 원칙 3 준수
- 설정 변경만으로 이동 속도 조절 가능
- `animation_speed`와 `move_speed`의 관심사 분리로 예측 불가능한 동작 방지

---

## Step 2: 인증 미들웨어 (#21)

### 2-A. 환경 변수 + config 확장

**파일**: `apps/backend/src/config.ts`

```typescript
export const config = {
  // ... 기존 필드 ...
  authToken: process.env.DASHBOARD_TOKEN ?? "",
};
```

`DASHBOARD_TOKEN`이 빈 문자열이면 인증 비활성화(개발 모드). 서버 시작 시 경고 로그를 출력한다.

### 2-B. 인증 미들웨어 구현

**파일 추가**: `apps/backend/src/middleware/auth.ts`

```typescript
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { config } from "../config";

export function authGuard(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  // 인증 토큰 미설정 → 개발 모드 (경고는 서버 시작 시 1회)
  if (!config.authToken) {
    done();
    return;
  }

  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    void reply.code(401).send({
      ok: false,
      error: "Authorization header required: Bearer <token>",
    });
    return;
  }

  const token = header.slice(7);
  if (token !== config.authToken) {
    void reply.code(403).send({
      ok: false,
      error: "Invalid token",
    });
    return;
  }

  done();
}
```

**설계 결정 — 왜 JWT가 아닌 Bearer 정적 토큰인가?**

이 대시보드는 **내부 도구**(system-architecture.md §9)이다. 사용자 계정/세션 관리가 필요하지 않으며, 접근 제어만 필요하다. 정적 Bearer 토큰은:
- 구현 복잡도가 낮다 (원칙 1: 코드 품질 우선)
- 추가 의존성 불필요 (jsonwebtoken 등)
- Hook curl 명령에 `$DASHBOARD_TOKEN`으로 직접 삽입 가능

### 2-C. 라우트 등록 시 미들웨어 적용

**파일**: `apps/backend/src/index.ts`

```typescript
import { authGuard } from "./middleware/auth";

// 서버 시작 시 경고
if (!config.authToken) {
  app.log.warn("DASHBOARD_TOKEN not set — authentication disabled (development mode)");
}

// /api/health는 인증 없이 접근 가능 (로드밸런서/모니터링용)
app.get("/api/health", async () => ({ ok: true }));

// 나머지 라우트에 인증 가드 적용
app.addHook("preHandler", (request, reply, done) => {
  // /api/health는 이미 등록됨 → 여기서 건너뜀
  if (request.url === "/api/health") {
    done();
    return;
  }
  authGuard(request, reply, done);
});
```

**주의**: `addHook("preHandler")`는 모든 라우트에 적용된다. `/api/health`만 예외 처리한다.

### 2-D. WebSocket 인증

**파일**: `apps/backend/src/index.ts`

WS 업그레이드 시 query parameter로 토큰을 검증한다.

```typescript
app.server.on("upgrade", (request, socket, head) => {
  if (request.url?.startsWith("/ws") !== true) {
    socket.destroy();
    return;
  }

  // 토큰 설정 시 WS 인증도 적용
  if (config.authToken) {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token");
    if (token !== config.authToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleConnection(ws as Parameters<typeof handleConnection>[0]);
    wss.emit("connection", ws, request);
  });
});
```

### 2-E. 프론트엔드 인증 헤더 추가

**파일**: `apps/frontend/src/lib/constants.ts`

```typescript
export const AUTH_TOKEN: string = import.meta.env.VITE_DASHBOARD_TOKEN ?? "";
```

**파일**: `apps/frontend/src/lib/api.ts`

```typescript
import { BACKEND_ORIGIN, AUTH_TOKEN } from "./constants";

function authHeaders(): HeadersInit {
  if (!AUTH_TOKEN) return {};
  return { Authorization: `Bearer ${AUTH_TOKEN}` };
}

export async function fetchSnapshot(): Promise<unknown> {
  const res = await fetch(`${BACKEND_ORIGIN}/api/snapshot`, {
    headers: authHeaders(),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Authentication failed — check VITE_DASHBOARD_TOKEN");
  }
  if (!res.ok) throw new Error("failed to fetch snapshot");
  return res.json();
}
```

**모든 `fetch()` 호출부에 `authHeaders()` 적용**: DashboardPage.tsx, OfficePage.tsx, AgentsPage.tsx, SettingsPage.tsx에서 `fetch()` 호출 시 `headers` 옵션에 `authHeaders()`를 추가한다.

### 2-F. WS URL에 토큰 파라미터 추가

**파일**: `apps/frontend/src/lib/constants.ts`

```typescript
export const WS_URL: string = (() => {
  const base = import.meta.env.VITE_WS_URL
    ?? BACKEND_ORIGIN.replace(/^http/, "ws") + "/ws";
  if (!AUTH_TOKEN) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(AUTH_TOKEN)}`;
})();
```

### 2-G. Hook 템플릿에 인증 헤더 추가

**파일**: `apps/backend/src/routes/integration.ts`

```typescript
function hookTemplate(): string {
  const origin = `http://127.0.0.1:${config.port}`;
  const curlCmd = () =>
    `curl -s -m 2 -X POST ${origin}/ingest/hooks`
    + ` -H 'Content-Type: application/json'`
    + ` -H 'Authorization: Bearer $DASHBOARD_TOKEN'`
    + ` -d \\"$(cat)\\" || true`;
  // ...
}
```

이미 문서(`hooks-onboarding.md`, `클로드의 추가의견.md`)에 `$DASHBOARD_TOKEN`이 기재되어 있으므로, 코드를 문서에 맞춘다.

### 2-H. CORS origin 제한

**파일**: `apps/backend/src/config.ts`

```typescript
export const config = {
  // ...
  corsOrigin: process.env.CORS_ORIGIN ?? true,  // true = 모든 origin (개발), 문자열 = 특정 origin
};
```

**파일**: `apps/backend/src/index.ts`

```typescript
await app.register(cors, {
  origin: config.corsOrigin,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});
```

**설계 근거**:
- 문서(system-architecture.md §9)에 명시된 인증 요구사항을 코드로 구현
- Bearer 정적 토큰 → 내부 도구 수준에 적합한 복잡도
- 개발 모드(토큰 미설정)를 지원하되, 경고 로그로 가시화 (원칙 4)
- Hook 템플릿이 `$DASHBOARD_TOKEN` 환경변수를 참조하므로 설정이 일관적
- WS 인증은 query parameter 방식 — WebSocket은 커스텀 헤더를 지원하지 않음

---

## Step 3: Fingerprint 기반 에이전트 식별 + 이벤트 중복 제거 (#23)

### 3-A. 이벤트 fingerprint 생성

**파일**: `apps/backend/src/services/normalizer.ts`

`makeId()` 함수를 fingerprint 기반으로 변경한다. `event-schema.md`의 사양:

> fingerprint = `session_id + tool_name + ts_bucket + payload_hash`

```typescript
function makeFingerprint(
  sessionId: string,
  toolName: string,
  ts: string,
  payload: unknown,
): string {
  // ts_bucket: 같은 초(second)에 발생한 동일 이벤트를 중복으로 판정
  const tsBucket = ts.slice(0, 19); // "2026-02-15T12:34:56"
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 12);
  const raw = `${sessionId}|${toolName}|${tsBucket}|${payloadHash}`;
  return `evt_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}
```

`normalizeHookEvent()` 내에서 사용:

```typescript
const ts = nowIso();
const id = makeFingerprint(sessionId, toolName, ts, input);
```

### 3-B. 이벤트 중복 제거

**파일**: `apps/backend/src/storage/events-repo.ts`

중복 이벤트 삽입을 방지하는 체크 추가:

```typescript
const checkExistsStmt = db.prepare("SELECT 1 FROM events WHERE id = ?");

export function eventExists(id: string): boolean {
  return checkExistsStmt.get(id) !== undefined;
}
```

**파일**: `apps/backend/src/routes/ingest.ts`

```typescript
import { eventExists, insertEvent } from "../storage/events-repo";

// normalizeHookEvent 후:
const event = normalizeHookEvent(body);

if (eventExists(event.id)) {
  return reply.code(200).send({
    ok: true,
    event_id: event.id,
    deduplicated: true,
  });
}

insertEvent(event);
// ... 나머지 처리
```

**설계 결정**: 중복 이벤트에 200을 반환한다(에러가 아님). Hook caller 입장에서 "이미 처리됨"은 성공과 동일하다. 422를 반환하면 caller가 불필요한 재시도를 할 수 있다.

### 3-C. 에이전트 자동 등록

**파일**: `apps/backend/src/routes/ingest.ts`

현재 에이전트가 DB에 없으면 `getAgent()`이 null을 반환하고, 좌석 좌표가 0으로 설정된다. 새 에이전트를 자동 등록한다:

```typescript
let agentRow = getAgent(event.agent_id);
if (!agentRow) {
  // 처음 본 에이전트 → 자동 등록
  const isLeader = event.agent_id.endsWith("/leader");
  upsertAgent({
    agent_id: event.agent_id,
    display_name: event.agent_id.split("/").at(-1) ?? event.agent_id,
    role: isLeader ? "manager" : "worker",
    employment_type: "contractor",  // 런타임 발견 → 계약직
    is_persisted: false,
    source: "runtime_agent",
    avatar_id: null,
    seat_x: 0,
    seat_y: 0,
    active: true,
  });
  agentRow = getAgent(event.agent_id);
  app.log.info({ agent_id: event.agent_id }, "auto-registered new agent");
}
```

**설계 근거**:
- fingerprint 기반 ID로 동일 이벤트 중복 방지 (event-schema.md 사양 준수)
- ts_bucket을 초 단위로 설정하여 1초 이내 동일 이벤트를 중복으로 처리
- 에이전트 자동 등록으로 처음 보는 에이전트도 즉시 추적 가능
- 자동 등록된 에이전트는 `source: "runtime_agent"`, `employment_type: "contractor"`로 명시

---

## Step 4: seed-mock 스크립트 갱신 (#26)

### 4-A. 스크립트 전면 재작성

**파일**: `apps/backend/scripts/seed-mock.ts`

현재 스크립트는 5개 기본 이벤트만 전송한다. 신규 테이블 + 인증을 반영하여 전면 재작성한다.

```typescript
/* eslint-disable no-console */
import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = process.env.BACKEND_URL ?? "http://localhost:4800";
const token = process.env.DASHBOARD_TOKEN ?? "";

const headers: Record<string, string> = {
  "content-type": "application/json",
};
if (token) headers["authorization"] = `Bearer ${token}`;

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
}

async function put(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
}
```

### 4-B. 시나리오: 에이전트 5명, 작업 3개, 다양한 상태

```typescript
const WORKSPACE = "demo-project";
const TERMINAL = "term-1";
const RUN = "run-001";

// 1. Settings 초기화 (속도 설정 포함)
await put("/api/settings/app", {
  value: {
    ...defaultSettings,
    operations: {
      ...defaultSettings.operations,
      move_speed_px_per_sec: 120,
    },
  },
});
console.log("✓ settings initialized");

// 2. 이벤트 시퀀스 — 다양한 상태 전이를 생성
const scenario = [
  // 리더 시작
  { event_name: "SubagentStart", session_id: "sess_1",
    agent_name: "leader", team_name: WORKSPACE,
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // 워커 4명 시작
  ...["alice", "bob", "carol", "dave"].map((name) => ({
    event_name: "SubagentStart", session_id: `sess_${name}`,
    agent_name: name, team_name: WORKSPACE,
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN,
  })),

  // 리더가 작업 생성
  { event_name: "PreToolUse", session_id: "sess_1",
    agent_name: "leader", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { title: "Implement auth module" },
    task_id: "task-1",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // alice 작업 시작
  { event_name: "PostToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "started" }, error: null,
    task_id: "task-1",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // alice 도구 사용
  { event_name: "PreToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Bash", tool_input: { command: "npm test" },
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
  { event_name: "PostToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Bash", tool_input: { command: "npm test" }, error: null,
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // bob 작업 시작 + 실패
  { event_name: "PostToolUse", session_id: "sess_bob",
    agent_name: "bob", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "started" }, error: null,
    task_id: "task-2",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
  { event_name: "PostToolUse", session_id: "sess_bob",
    agent_name: "bob", team_name: WORKSPACE,
    tool_name: "Bash", tool_input: {},
    error: "permission denied: /etc/shadow",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // carol은 작업 완료
  { event_name: "PostToolUse", session_id: "sess_carol",
    agent_name: "carol", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "started" }, error: null,
    task_id: "task-3",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
  { event_name: "PostToolUse", session_id: "sess_carol",
    agent_name: "carol", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "completed" }, error: null,
    task_id: "task-3",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // dave는 Notification (blocked)
  { event_name: "Notification", session_id: "sess_dave",
    agent_name: "dave", team_name: WORKSPACE,
    level: "warn",
    summary: "Waiting for user approval",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // alice 작업 완료
  { event_name: "PostToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "completed" }, error: null,
    task_id: "task-1",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
];

for (const event of scenario) {
  await post("/ingest/hooks", event);
  console.log(`✓ ${event.event_name} → ${event.agent_name}`);
  await sleep(500);
}

console.log("\n=== seed-mock complete ===");
console.log("Expected states:");
console.log("  leader : idle (started, no task assigned)");
console.log("  alice  : completed → roaming/breakroom/resting (post_complete_policy)");
console.log("  bob    : failed (permission denied)");
console.log("  carol  : completed → roaming/breakroom/resting");
console.log("  dave   : pending_input (Notification blocked)");
```

### 4-C. 실행 방법

```bash
# 인증 없이 (개발)
pnpm --filter @aod/backend seed:mock

# 인증 있을 때
DASHBOARD_TOKEN=my-secret pnpm --filter @aod/backend seed:mock
```

**설계 근거**:
- 5개 에이전트가 idle, working, failed, completed, pending_input 등 다양한 상태를 커버
- 인증 헤더를 `DASHBOARD_TOKEN` 환경변수에서 읽어 Step 2와 일관성 유지
- 각 이벤트에 `workspace_id`, `terminal_session_id`, `run_id`를 명시 → 스코프 기반 필터링 검증 가능
- `task_id`를 포함하여 활성 작업 테이블(DashboardPage) 검증 가능
- 이벤트 간 500ms 딜레이로 타임스탬프 분포 확보

---

## 실행 순서 요약

| 순서 | Step | 해소 이슈 | 주요 변경 파일 |
|------|------|-----------|----------------|
| 1 | Settings 확장 | #22 | `shared-schema/settings.ts`, `OfficePage.tsx` |
| 2 | 인증 미들웨어 | #21 | 신규 `middleware/auth.ts`, `config.ts`, `index.ts`, `constants.ts`, `api.ts`, `integration.ts` |
| 3 | Fingerprint + 중복 제거 | #23 | `normalizer.ts`, `events-repo.ts`, `ingest.ts` |
| 4 | seed-mock 갱신 | #26 | `scripts/seed-mock.ts` |

---

## 적용 원칙 검증

| 원칙 | 적용 방식 |
|------|-----------|
| 코드 품질 우선 | Bearer 정적 토큰으로 최소 복잡도 인증, fingerprint 로직을 normalizer에 집중 |
| 구조적 효율 | Schema → Infra → Logic → Tooling 순서, 하위 변경이 상위의 전제 조건 |
| 동적 값 사용 | 이동 속도를 settings에서 읽기, 인증 토큰은 환경변수, CORS origin은 환경변수 |
| 오류 > 폴백 | 토큰 불일치 시 401/403 반환, 토큰 미설정 시 경고 로그, WS 인증 실패 시 연결 거부 |
