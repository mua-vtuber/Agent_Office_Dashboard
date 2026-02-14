# Documentation ↔ Code Mismatch Report (통합본)

작성일: 2026-02-14 (2차 취합)
목적: 설계 문서(docs/)와 실제 구현(apps/, packages/) 사이의 불일치를 식별하고 심각도별로 분류한다.
방법: 독립 2회 분석 결과를 교차 검증·취합하여 누락 없이 정리한다.

---

## 분류 기준

| 심각도 | 정의 |
|---|---|
| **CRITICAL** | 문서 핵심 의도가 구현에 전혀 반영되지 않음. 데이터 계약 위반, 기능 불능, 상태 무결성 훼손. |
| **MAJOR** | 부분 구현이지만 핵심 기능/로직이 누락. 운영에 직접적 영향. |
| **MINOR** | 세부 사양이 다소 다르거나 미구현. 기능은 동작하나 사양 불일치. |

---

## 요약 테이블

| # | 영역 | 심각도 | 관련 문서 | 관련 코드 |
|---|------|--------|----------|----------|
| 1 | 상태머신 전이 규칙 대폭 미구현 | CRITICAL | state-machine.md | services/state-machine.ts |
| 2 | PixiJS 미사용 — HTML div 기반 렌더링 | CRITICAL | system-architecture.md, product-spec.md, performance-targets.md | pages/OfficePage.tsx |
| 3 | 의미적 이벤트 추출(Semantic Event Extraction) 미구현 | CRITICAL | event-schema.md §5.2 | services/normalizer.ts |
| 4 | DB 테이블 3개 누락 (agents, tasks, sessions) | CRITICAL | system-architecture.md §7 | storage/db.ts |
| 5 | Settings 스키마 불완전 (3/8 카테고리만 구현) | CRITICAL | settings-spec.md | shared-schema/settings.ts |
| 6 | Settings REST API 미구현 | CRITICAL | system-architecture.md §6 | (없음) |
| 7 | AgentState 스키마 누락 필드 (home_position, since, context) | CRITICAL | state-machine.md §3 | shared-schema/state.ts, storage/db.ts |
| 8 | WebSocket 프로토콜 불완전 | MAJOR | system-architecture.md §6.3-6.4 | ws/gateway.ts, stores/ws-store.ts |
| 9 | Heartbeat 시스템 미구현 | MAJOR | event-schema.md §7.1, system-architecture.md | (없음) |
| 10 | 프론트엔드 API/WS URL 하드코딩 | MAJOR | settings-spec.md (connection 카테고리) | lib/api.ts, lib/constants.ts, App.tsx |
| 11 | 말풍선(speech bubble) 미구현 | MAJOR | product-spec.md §7.1 | pages/OfficePage.tsx |
| 12 | 에이전트 역할/고용형태 판정 로직 오류 | MAJOR | agents-tab-spec.md §6 | routes/agents.ts |
| 13 | 활성 작업 목록 미구현 | MAJOR | product-spec.md §7.2 | pages/DashboardPage.tsx |
| 14 | Normalizer에 Notification hook 매핑 누락 | MAJOR | event-schema.md §5.1 | services/normalizer.ts |
| 15 | Snapshot 주기 재동기화 미구현 | MAJOR | system-architecture.md, session-routing.md §7 | stores/ws-store.ts, DashboardPage.tsx |
| 16 | Ingest 라우트가 처리 전 200 응답 반환 | MAJOR | (설계 원칙: 오류 가시화) | routes/ingest.ts |
| 17 | 서버 좌석 좌표 미할당 — state_current에 항상 (0,0) | MAJOR | office-layout-spec.md | routes/ingest.ts |
| 18 | Hook 템플릿 SubagentStop/Stop/Notification 누락 | MINOR | event-schema.md, hooks-onboarding.md | routes/integration.ts |
| 19 | Snapshot API 응답 불완전 | MINOR | system-architecture.md §6.4 | routes/snapshot.ts |
| 20 | Time Travel 기본 윈도우 차이 (±8 vs ±10) | MINOR | time-travel-spec.md | routes/snapshot.ts |
| 21 | 인증/보안 미구현 | MINOR(MVP) | system-architecture.md §9 | (없음) |
| 22 | 이동 속도 차이 (28/42 vs 120 px/s) | MINOR | state-machine.md §7 | pages/OfficePage.tsx |
| 23 | 중복 이벤트 fingerprint 방식 차이 | MINOR | event-schema.md §7 | services/normalizer.ts, storage/events-repo.ts |
| 24 | theme 필드 enum 미검증 | MINOR | settings-spec.md | shared-schema/settings.ts |
| 25 | locale 필드 "ko-KR" 하드코딩 | MINOR | event-schema.md §3 | services/normalizer.ts |
| 26 | Seed mock 시나리오 문서 사양과 불일치 | MINOR | implementation-plan.md | scripts/seed-mock.ts |

---

## CRITICAL 상세

### 1. 상태머신 전이 규칙 대폭 미구현

**문서**: `state-machine.md` 전이 매트릭스(§4.5)에 30개 이상의 전이 규칙 정의.
**코드**: `apps/backend/src/services/state-machine.ts` — 8개 조건문만 존재.

누락된 전이 목록:

| 문서에 정의된 전이 | 구현 여부 |
|---|---|
| `offline → idle` (agent_started) | **미구현** — agent_started 이벤트 핸들링 없음 |
| `pending_input → working` (agent_unblocked) | **미구현** — agent_unblocked 자체를 처리하지 않음 |
| `failed → working` (agent_unblocked) | **미구현** |
| `idle → breakroom` (timer:idle_timeout) | **미구현** — 타이머 기반 전이 시스템 자체가 없음 |
| `idle → resting` (timer:idle_timeout) | **미구현** |
| `completed → roaming/breakroom/resting` (post_complete_policy) | **미구현** — weighted_random 정책 없음 |
| `completed → working` (큐 대기 작업) | **미구현** — 작업 큐 없음 |
| `handoff → meeting` (arrive_at_meeting) | **미구현** — 위치 기반 전이 없음 |
| `returning → working/idle` (arrive_at_home) | **미구현** |
| `roaming/breakroom/resting → returning` (task_started) | **미구현** — task_started가 상태 무관하게 항상 `working` 반환 |
| `roaming/breakroom/resting → handoff` (manager_assign) | **미구현** — manager_assign은 working/non-working만 분기 |
| `breakroom → idle` (timer:breakroom_timeout 20분) | **미구현** |
| `* → offline` (agent_stopped) | 구현됨 ✓ |
| `handoff timeout → meeting 강제` (10초) | **미구현** |
| `meeting timeout → returning` (15초) | **미구현** |

**치명/재시도 분류 미구현**:
- 문서: `tool_failed` 시 에러 문자열 분석으로 `failed`(치명) vs `pending_input`(재시도) 분류
  - 치명: `permission denied`, `not found`, `ENOENT`, 동일 도구 3회 연속 실패
  - 재시도: `timeout`, `EAGAIN`, `rate limit`, 1~2회 실패
- 코드: `tool_failed` → 항상 `pending_input` (분류 없음)

**no-op 로깅 미구현**:
- 문서: 매트릭스에 없는 (state, event) 조합은 `transition_ignored` 로그 기록
- 코드: 알 수 없는 조합은 단순히 현재 상태 반환, 로그 없음

**동시 이벤트 우선순위 미구현**:
- 문서: offline > failed > pending_input > meeting/handoff/returning > working > idle
- 코드: 우선순위 로직 없음

---

### 2. PixiJS 미사용 — HTML/CSS div 기반 렌더링

**문서**:
- `system-architecture.md §2`: "Frontend: ... PixiJS"
- `product-spec.md §7.1`: 캐릭터 애니메이션, 이동 보간, 이펙트
- `performance-targets.md §2`: "20 agents 기준 평균 FPS ≥ 30"
- `open-questions.md §7`: "확정됨: PixiJS"

**코드**: `apps/frontend/src/pages/OfficePage.tsx`
- PixiJS는 `package.json` 의존성에 설치됨 (`"pixi.js": "^8.4.1"`), 코드에서 **전혀 import/사용하지 않음**
- `<div className="office-canvas">` 안에 `position: absolute` div로 에이전트 렌더링
- `requestAnimationFrame`으로 React state 기반 이동 보간 (DOM 조작)
- **영향**: 20 에이전트에서 DOM 노드 조작이 PixiJS WebGL 대비 현저히 느림. 성능 목표(20 agents, 30 FPS) 달성 어려울 수 있음.

---

### 3. 의미적 이벤트 추출(Semantic Event Extraction) 미구현

**문서**: `event-schema.md §5.2`
- `PreToolUse`에서 `tool_name` + `tool_input` 파싱하여 업무 의미 이벤트 생성
  - 예: `TaskCreate` → `task_created`, `TaskUpdate(status=completed)` → `task_completed`
- 우선순위: SubagentStart/Stop > PreToolUse 기반 추정 > synthetic 보완

**코드**: `services/normalizer.ts`
- `PreToolUse` → 항상 `tool_started`로만 변환
- `tool_name`이 `TaskCreate`이든 `Bash`이든 구분 없음
- **영향**: `task_created`, `task_started`, `task_completed`, `task_progress`, `manager_assign`, `agent_acknowledged` 등의 이벤트가 hook 입력으로부터 **절대 생성되지 않음**
- 이 이벤트 타입들은 스키마에 정의되어 있으나, normalizer가 생성하지 않으므로 상태머신 전이의 대부분이 트리거될 수 없음

---

### 4. DB 테이블 3개 누락

**문서**: `system-architecture.md §7.1` — 5개 테이블 정의

| 테이블 | 문서 정의 | 구현 |
|--------|----------|------|
| `events` | ✓ | ✓ |
| `state_current` | ✓ | ✓ (단, 컬럼 부족 — #7 참조) |
| `agents` | id, role, display_name, employment_type, is_persisted, source, avatar_id, seat_x, seat_y, active | **미구현** |
| `tasks` | id, title, status, assignee_id, manager_id, created_at, updated_at | **미구현** |
| `sessions` | workspace_id, terminal_session_id, run_id, last_heartbeat_ts, status | **미구현** |

**영향**:
- 에이전트 메타데이터(역할, 고용형태, 좌석 좌표, 아바타)를 저장할 곳이 없어 하드코딩된 추론에 의존 (#12)
- 작업 추적이 없어 Dashboard의 "활성 작업 목록" 구현 불가 (#13)
- 세션 상태(heartbeat, active/inactive) 추적 불가 (#9)

---

### 5. Settings 스키마 불완전

**문서**: `settings-spec.md` — 8개 범주, 60+ 설정 항목
**코드**: `packages/shared-schema/src/settings.ts` — 3개 범주, ~10개 항목만

누락된 범주/항목:

| 범주 | 문서 항목 | 스키마 구현 |
|------|----------|------------|
| general | language, timezone, date_format, theme, animation_speed | 부분 (theme이 `z.string()`, enum 검증 없음) |
| i18n | fallback_language, number_locale, event_message_locale_mode | **전체 누락** |
| office_layout | layout_profile, seat_positions, meeting_spots, pantry_zone_enabled, pantry_door_lane, speech_bubble_enabled, status_icon_enabled | **부분 누락** |
| operations | idle_to_breakroom_seconds, idle_to_resting_seconds, post_complete_policy, post_complete_weights, pending_input_alert_seconds, failed_alert_seconds, stale_agent_seconds, failure_alert_enabled, snapshot_sync_interval_sec, heartbeat_interval_sec | **부분 누락** |
| connection | api_base_url, ws_url, ingest_token_ref, masking_keys | **전체 누락** |
| session_tracking | workspace_id_strategy, terminal_session_id_strategy, default_view_scope | **전체 누락** |
| motion_effects | working_paper_effect_enabled, failed_scream_motion_enabled, resting_zzz_effect_enabled, motion_intensity | **전체 누락** |
| advanced | transition_rules_editable, event_sampling_noncritical, rate_limit_per_session_per_sec | **전체 누락** |

---

### 6. Settings REST API 미구현

**문서**: `system-architecture.md §6.1` — `GET /api/settings`, `PUT /api/settings`
**코드**: 엔드포인트 없음. 라우트 파일 없음. `index.ts`에 등록 없음. settings-repo 없음.
**영향**: 프론트엔드는 `localStorage`에만 설정 저장. 서버 설정(운영 임계치, 연결 URL, 레이아웃) API 읽기/쓰기 불가.

---

### 7. AgentState 스키마 누락 필드

**문서**: `state-machine.md §3` — position, home_position, target_position, facing, since, context (task_id, peer_agent_id)

**코드**: `packages/shared-schema/src/state.ts`
```
AgentState: agent_id, status, position, target_position, facing, last_event_ts
```
- `home_position` 없음 → 복귀 전이 시 좌석 좌표를 알 수 없음
- `since` 없음 → 타이머 기반 전이(idle timeout 등) 구현 불가
- `context` 없음 → 현재 작업/상대 에이전트 정보 없음

**DB**: `state_current` 테이블에도 해당 컬럼 없음.

---

## MAJOR 상세

### 8. WebSocket 프로토콜 불완전

**문서**: `system-architecture.md §6.3-6.4`

| 기능 | 문서 | 구현 |
|------|------|------|
| Server→Client: `event` | ✓ | ✓ |
| Server→Client: `state_update` | ✓ | ✓ |
| Server→Client: `snapshot` (연결 시) | ✓ | **미구현** |
| Server→Client: `heartbeat` | ✓ | **미구현** |
| Client→Server: `subscribe` (scope 필터) | ✓ | **미구현** |
| Client→Server: `unsubscribe` | ✓ | **미구현** |
| Client→Server: `ping` | ✓ | **미구현** |
| 재연결 시 snapshot + delta | ✓ | **미구현** |

`ws/gateway.ts`는 12줄의 단순 브로드캐스트만 구현:
- 모든 클라이언트에 모든 이벤트를 무조건 전송 (scope 필터 없음)
- 연결 시 snapshot 전송 없음
- heartbeat 없음

프론트엔드 `ws-store.ts`:
- 재연결 로직 없음 — `close` 이벤트 시 `disconnected` 상태로만 전환
- exponential backoff 없음

---

### 9. Heartbeat 시스템 미구현

**문서**:
- `event-schema.md §7.1`: 서버가 heartbeat 합성 이벤트 발행
- `settings-spec.md §2.6`: `heartbeat_interval_sec` 기본 10초

**코드**: heartbeat 관련 코드 없음. 이벤트 타입 enum에만 정의됨.
**영향**: stale/비활성 세션 감지 불가. 상태 머신 타임아웃 정책이 heartbeat 의존하나 미동작.

---

### 10. 프론트엔드 API/WS URL 하드코딩

**문서**: `settings-spec.md` — `api_base_url`, `ws_url`은 connection 설정으로 관리

**코드 불일치**:
- `lib/api.ts:2,8` — `"http://localhost:4800"` (하드코딩, `BACKEND_ORIGIN` 상수 미사용)
- `lib/constants.ts:1` — `BACKEND_ORIGIN = "http://127.0.0.1:4800"` (하드코딩)
- `App.tsx:27` — `"ws://127.0.0.1:4800/ws"` (하드코딩)

`api.ts`는 `localhost`, 나머지는 `127.0.0.1` → origin 불일치로 CORS 문제 가능.
**영향**: 백엔드가 다른 호스트/포트에서 실행되면 대시보드 동작 불가.

---

### 11. 말풍선(Speech Bubble) 미구현

**문서**: `product-spec.md §7.1` — "간단한 말풍선(요약 텍스트)" **필수 기능**
**코드**: `OfficePage.tsx` — 에이전트 이름(`agent-name`) 표시만 존재. 작업 요약/이벤트 메시지 말풍선 없음.
`settings-spec.md`에 `speech_bubble_enabled` 옵션 있으나 미구현.

---

### 12. 에이전트 역할/고용형태 판정 로직 오류

**문서**: `agents-tab-spec.md §6`
- `is_persisted=true` 또는 `source=project_agent` → `정직원` (employee)
- `is_persisted=false` 또는 `source=runtime_agent` → `계약직` (contractor)

**코드**: `routes/agents.ts:11-17`
```typescript
function roleFromAgentId(agentId: string): "manager" | "worker" {
  return agentId.endsWith("/leader") ? "manager" : "worker";
}
function employmentFromAgentId(agentId: string): "employee" | "contractor" {
  return agentId.endsWith("/leader") ? "employee" : "contractor";
}
```
문제점:
1. 역할: agent_id 문자열 패턴(`/leader`)으로만 판정 → `specialist`, `unknown` 불가
2. 고용형태: "leader = employee, 나머지 = contractor" 고정 → `is_persisted`/`source` 기반 판정과 완전히 다름
3. `agents` 테이블이 없으므로 실제 메타데이터에 접근 불가 (#4 의존)

---

### 13. 활성 작업 목록 미구현

**문서**: `product-spec.md §7.2` — "활성 작업 목록(task_id, 담당자, 경과 시간)" **필수 기능**
**코드**: `DashboardPage.tsx` — 에이전트 상태 카드 ✓, 이벤트 타임라인 ✓, 활성 작업 목록 **없음**
`tasks` 테이블도 없고 작업 추적 자체가 구현되지 않음 (#4 의존).

---

### 14. Normalizer에 Notification hook 매핑 누락

**문서**: `event-schema.md §5.1` — Hook 페이로드 계약에 `Notification` (`session_id`, `message`, `level`) 포함
**코드**: `normalizer.ts` — `Notification` 매핑 없음 → `schema_error`로 폴스루
**영향**: Claude Code hooks의 Notification 이벤트가 `schema_error`로 변환되어 알림 데이터 손실.

---

### 15. Snapshot 주기 재동기화 미구현

**문서**: `system-architecture.md §3.8` — "30초 주기 snapshot 재동기화"
`settings-spec.md §2.4` — `snapshot_sync_interval_sec: 30`
**코드**: Dashboard/Office 페이지 마운트 시 1회 fetch, 이후 WebSocket에만 의존. 주기적 재동기화 없음.
**영향**: WS 이벤트 누락 시 프론트엔드 상태가 서버와 영구 괴리.

---

### 16. Ingest 라우트가 처리 전 200 응답 반환

**코드**: `routes/ingest.ts:13` — `reply.code(200).send({ ok: true })` 후 try/catch에서 후처리
**영향**: 정규화/저장 실패 시 hook 호출자는 200을 받지만 이벤트 소실. 오류가 숨겨짐.
**원칙 위반**: "문제가 있으면 오류를 띄워 사용자가 알게 한다"

---

### 17. 서버 좌석 좌표 미할당 — state_current에 항상 (0,0)

**문서**: `office-layout-spec.md` — 에이전트에 `kr_t_left_v2` 레이아웃 기반 고정 좌석 좌표 할당
**코드**: `routes/ingest.ts:29-30` — 항상 `position_x: 0, position_y: 0`
**참고**: OfficePage.tsx 프론트엔드는 자체적으로 `seatPoints` 배열을 하드코딩하여 우회하고 있으나, 이는 서버 권위적 상태 모델과 불일치.

---

## MINOR 상세

### 18. Hook 템플릿 SubagentStop/Stop/Notification 누락

**문서**: `event-schema.md §5` — SubagentStop → `agent_stopped`, Stop → `agent_stopped`, Notification → 알림
**코드**: `integration.ts` hookTemplate — `PreToolUse`, `PostToolUse`, `SubagentStart`만 포함
**영향**: 에이전트 종료·알림 이벤트가 수집되지 않음.

### 19. Snapshot API 응답 불완전

**문서**: `system-architecture.md §6.4` — `{ agents, tasks, sessions, settings, server_ts }`
**코드**: `snapshot.ts:30-37`
- `tasks: []` (항상 빈 배열)
- `sessions: []` (항상 빈 배열)
- `settings: {}` (항상 빈 객체)
- `recent_events` (문서에 없는 추가 필드)

### 20. Time Travel 기본 윈도우 차이

**문서**: `time-travel-spec.md §2` — 기본 ±10개 이벤트
**코드**: `snapshot.ts:65-66` — 기본 ±8개

### 21. 인증/보안 미구현 (MVP)

**문서**: `system-architecture.md §9` — ingest 토큰 보호, settings 관리자 권한, 민감 payload 마스킹
**코드**: 모든 endpoint에 인증 없음, 마스킹 없음
**분류**: 내부 MVP이므로 MINOR, 그러나 문서와 불일치.

### 22. 이동 속도 차이

**문서**: `state-machine.md §7` — "속도: 기본 120 px/s"
**코드**: `OfficePage.tsx:189` — 일반 28, 미팅 42 (퍼센트 좌표 기준)
**참고**: 문서는 캔버스 픽셀 기준, 코드는 0-100 정규화 좌표 기준이므로 단위가 다를 수 있음.

### 23. 중복 이벤트 fingerprint 방식 차이

**문서**: `event-schema.md §7` — `session_id + tool_name + ts bucket + payload hash`
**코드**: `normalizer.ts:10` — 전체 payload + timestamp의 SHA-256 → `INSERT OR REPLACE`
**차이**: 문서의 "ts bucket" 개념 없음.

### 24. theme 필드 enum 미검증

**문서**: `settings-spec.md` — `theme: office-light | office-dark`
**코드**: `settings.ts:8` — `theme: z.string()` (자유 문자열)

### 25. locale 필드 "ko-KR" 하드코딩

**문서**: `event-schema.md §3` — `locale`은 이벤트 생성 시점 언어 태그
**코드**: `normalizer.ts:43` — `locale: "ko-KR"` 고정
**영향**: 다국어 환경에서 이벤트 로케일이 항상 한국어로 고정.

### 26. Seed mock 시나리오 문서 사양과 불일치

**문서**: `implementation-plan.md` — 4개 시나리오 (기본 작업, 할당 플로우, 실패 복구, 연속 실패), `--agents`/`--interval-ms` 옵션
**코드**: `seed-mock.ts` — 단순 5개 이벤트 시퀀스만 존재

---

## 집계

| 심각도 | 건수 |
|---|---|
| CRITICAL | 7 |
| MAJOR | 10 |
| MINOR | 9 |
| **합계** | **26** |

---

## 가장 영향이 큰 불일치 Top 5

1. **상태머신** (#1) — 문서의 핵심인 전이 규칙이 8개 조건문으로 단순화됨. 타이머, 위치 기반, 치명/재시도 분류, 우선순위 모두 미구현.
2. **의미적 이벤트 추출** (#3) — normalizer가 hook에서 `task_created`, `task_completed` 등을 생성하지 않아, 상태머신 전이의 대부분이 트리거될 수 없음. **상태머신과 직접 연결된 근본 원인**.
3. **PixiJS 미사용** (#2) — 의존성은 설치했으나 실제로 HTML div + CSS 기반. 성능 목표(20 agents, 30 FPS) 달성 어려울 수 있음.
4. **DB/작업 추적 없음** (#4) — agents, tasks, sessions 테이블 미구현으로 운영 대시보드의 핵심 기능(에이전트 관리, 활성 작업 목록, 세션 추적) 불가.
5. **Settings 계층 전체 미비** (#5, #6) — 스키마 3/8, API 없음. 서버 운영 파라미터가 모두 하드코딩이거나 무시됨.
