# Documentation ↔ Code Mismatch Report

작성일: 2026-02-14
목적: 설계 문서(docs/)와 실제 구현(apps/, packages/) 사이의 불일치를 식별하고 심각도별로 분류한다.

---

## 분류 기준

| 심각도 | 정의 |
|---|---|
| **CRITICAL** | 데이터 계약 위반, 기능 불능, 상태 무결성 훼손. 즉시 수정 필요. |
| **HIGH** | 주요 기능 누락 또는 잘못된 동작. 운영에 영향. |
| **MEDIUM** | 부분 구현 또는 사양과 다른 기본값. 기능은 동작하나 사양 불일치. |

---

## CRITICAL 이슈

### C-01: Settings 스키마 심각하게 불완전

- **문서**: `settings-spec.md` — 7개 카테고리, 60+ 설정값 (general, i18n, office_layout, operations, connection, session_tracking, motion_effects, advanced)
- **코드**: `packages/shared-schema/src/settings.ts` — 3개 카테고리(general, office_layout, operations), ~10개 설정값만 존재
- **누락된 카테고리**: `i18n`, `connection`, `session_tracking`, `motion_effects`, `advanced`
- **누락된 필드**:
  - `general`: `theme` — enum 검증 없이 `z.string()` (문서: `office-light | office-dark`)
  - `office_layout`: `seat_positions`, `meeting_spots`, `pantry_door_lane`, `speech_bubble_enabled`, `status_icon_enabled`
  - `operations`: `post_complete_policy`, `post_complete_weights`, `stale_agent_seconds`, `failure_alert_enabled`, `heartbeat_interval_sec`
- **영향**: 서버가 전체 설정 계약을 제공·검증 불가. 운영 동작(타이머, 임계치)이 설정에서 읽히지 않음.

### C-02: 상태 머신에 핵심 전이 누락

- **문서**: `state-machine.md` — 12개 상태, 30+ 전이, 타임아웃 정책, 동시 이벤트 우선순위
- **코드**: `apps/backend/src/services/state-machine.ts` — 8개 기본 전이만 존재
- **누락된 전이**:
  - `idle → breakroom` (`timer:idle_timeout`, 조건: idle > `idle_to_breakroom_seconds`)
  - `idle → resting` (`timer:idle_timeout`, 조건: idle > `idle_to_resting_seconds`)
  - `completed → roaming|breakroom|resting` (`post_complete_policy` 가중치 기반)
  - `returning → working|idle` (`arrive_at_home`)
  - `handoff → meeting` (`arrive_at_meeting`, 양측 도착 시)
  - `failed|pending_input → working` (`agent_unblocked`)
  - `agent_started → idle` (초기 상태 설정)
- **누락된 메커니즘**:
  - 타임아웃 정책 (handoff 10s, meeting 15s, pending_input 60s+, failed 30s+)
  - 동시 이벤트 우선순위 순서
  - `since` 타임스탬프 기반 시간 경과 계산
- **영향**: 에이전트가 `roaming`, `breakroom`, `resting` 상태로 절대 전이 불가. 회의 안무 미완성. 상태가 stuck 가능.

### C-03: AgentState 스키마에 `home_position`, `since`, `context` 누락

- **문서**: `state-machine.md` — 상태 속성: `position`, `home_position`, `target_position`, `facing`, `since`, `context` (task_id, peer_agent_id)
- **코드**: `packages/shared-schema/src/state.ts` — `home_position`, `since`, `context` 없음
- **DB**: `state_current` 테이블 — `home_position_x/y`, `since`, `context_json` 컬럼 없음
- **영향**: 좌석↔미팅 포인트 이동 애니메이션 불가. 에이전트별 작업 문맥 추적 불가. 시간 기반 전이 계산 불가.

### C-04: Settings API 엔드포인트 미구현

- **문서**: `system-architecture.md` — `GET /api/settings`, `PUT /api/settings`
- **코드**: 라우트 파일 없음, `index.ts`에 등록 없음, settings-repo 없음
- **영향**: 프론트엔드 SettingsPage는 localStorage 로컬 설정만 관리. 서버 설정(운영 임계치, 연결 URL, 레이아웃 프로필)을 API로 읽기/쓰기 불가.

### C-05: 프론트엔드 API URL 하드코딩

- **문서**: `settings-spec.md` — `api_base_url`, `ws_url`은 connection 설정으로 관리
- **코드 불일치**:
  - `apps/frontend/src/lib/api.ts:2,8` — `"http://localhost:4800"` (하드코딩, 상수 미사용)
  - `apps/frontend/src/lib/constants.ts:1` — `BACKEND_ORIGIN = "http://127.0.0.1:4800"` (하드코딩)
  - `apps/frontend/src/App.tsx:27` — `"ws://127.0.0.1:4800/ws"` (하드코딩)
- **영향**: 백엔드가 다른 호스트/포트에서 실행되면 대시보드 동작 불가. `api.ts`와 `App.tsx`가 다른 URL 사용 (`localhost` vs `127.0.0.1`) → CORS 문제 가능.

### C-06: DB 스키마에 `agents`, `tasks`, `sessions` 테이블 누락

- **문서**: `system-architecture.md` — 데이터베이스에 `agents`, `tasks`, `sessions`, `events`, `state_current` 5개 테이블
- **코드**: `apps/backend/src/storage/db.ts` — `events`와 `state_current` 2개 테이블만 존재
- **영향**:
  - Agent 데이터(display_name, role, employment_type, avatar_id, 좌석 좌표) 영속성 없음 → `agent_id` 문자열 패턴에서 즉석 파생
  - Tasks 영속성 없음 → 스냅샷 응답에 항상 `tasks: []`
  - Sessions 영속성 없음 → heartbeat 기반 세션 활성/비활성 추적 불가

### C-07: Normalizer에 `Notification` hook 이벤트 매핑 누락

- **문서**: `event-schema.md` — Hook 페이로드 계약에 `Notification` 이벤트 포함 (`session_id`, `message`, `level`)
- **코드**: `apps/backend/src/services/normalizer.ts` — `Notification` 매핑 없음 → `schema_error`로 폴스루
- **영향**: Claude Code hooks의 Notification 이벤트가 `schema_error`로 변환되어 알림 데이터 손실.

### C-08: WebSocket 게이트웨이에 `subscribe`/`unsubscribe`/`ping` 미처리

- **문서**: `system-architecture.md` — Client→Server WS 메시지: `subscribe`, `unsubscribe`, `ping`
- **코드**: `apps/backend/src/ws/gateway.ts` — `broadcast()` 함수만 존재. 수신 메시지 핸들러 없음.
- **영향**: 모든 클라이언트가 모든 이벤트를 수신 (스코프 필터링 없음). workspace/terminal/run 선택 구독 불가. ping/pong keepalive 없음.

### C-09: Snapshot 주기 재동기화 미구현

- **문서**: `system-architecture.md`, `session-routing.md` — 30초 주기 snapshot resync
- **문서**: `settings-spec.md` — `snapshot_sync_interval_sec: 30` (설정 가능)
- **코드**: DashboardPage에서 마운트 시 1회 스냅샷 로드만 수행. 주기적 재동기화 없음.
- **영향**: WebSocket이 이벤트를 놓치면 프론트엔드 상태가 서버와 영구적으로 괴리. 페이지 새로고침 전까지 복구 불가.

### C-10: Heartbeat 시스템 미구현

- **문서**: `event-schema.md` — `heartbeat` 이벤트는 서버에서 `settings.heartbeat_interval_sec` 주기로 생성
- **문서**: `session-routing.md` — 10초 heartbeat로 세션 활성 유지
- **코드**: heartbeat 생성 코드 없음. 이벤트 타입 enum에만 존재.
- **영향**: stale/비활성 세션 감지 불가. 상태 머신 타임아웃 정책이 heartbeat 의존 → 전부 미동작.

---

## HIGH 이슈

### H-01: `api.ts`가 `BACKEND_ORIGIN` 상수를 사용하지 않음

- **파일**: `apps/frontend/src/lib/api.ts:2,8` — `"http://localhost:4800"` 직접 사용
- **비교**: `apps/frontend/src/lib/constants.ts:1` — `BACKEND_ORIGIN = "http://127.0.0.1:4800"` 정의됨
- **영향**: origin 불일치로 CORS 문제 가능. 이중 유지보수 부담.

### H-02: `tool_failed`가 항상 `pending_input`으로만 전이

- **문서**: `state-machine.md` — `tool_failed` → `failed` (치명적) 또는 `pending_input` (재시도 가능), 조건 분기
- **코드**: `apps/backend/src/services/state-machine.ts:10` — 무조건 `"pending_input"` 반환
- **영향**: 치명적 도구 실패가 `failed` 상태로 분류되지 않음. 장애 가시성 저하.

### H-03: `agent_started` 이벤트가 상태를 변경하지 않음

- **문서**: `state-machine.md` — `agent_started` → `idle`
- **코드**: `state-machine.ts` — `agent_started` 핸들러 없음, 현재 상태 그대로 반환
- **영향**: 새 에이전트의 초기 상태가 명시적으로 설정되지 않음.

### H-04: `agent_unblocked` 이벤트 미처리

- **문서**: `state-machine.md` — `failed|pending_input → working` on `agent_unblocked`
- **코드**: `state-machine.ts` — `agent_unblocked` 핸들러 없음
- **영향**: `failed`/`pending_input` 상태에 갇힌 에이전트가 자동 복구 불가.

### H-05: Event context API 기본 before/after 값 불일치

- **문서**: `time-travel-spec.md` — 기본 ±10 이벤트
- **코드**: `apps/backend/src/routes/snapshot.ts:65-66` — 기본 ±8 이벤트
- **영향**: 사양 위반. Time Travel 컨텍스트가 문서보다 2개 적은 이벤트를 보여줌.

### H-06: Ingest 라우트가 처리 전 200 응답 반환

- **코드**: `apps/backend/src/routes/ingest.ts:13` — `reply.code(200).send({ ok: true })` 후 try/catch
- **문서 원칙**: "문제가 있으면 오류를 띄워 사용자가 알게한다"
- **영향**: 정규화/저장 실패 시 hook 호출자는 200을 받지만 이벤트 소실. 오류가 숨겨짐.

### H-07: 좌석 위치 미할당 — 항상 (0,0)

- **문서**: `office-layout-spec.md` — 에이전트에 `kr_t_left_v2` 레이아웃 기반 고정 좌석 좌표 할당
- **코드**: `apps/backend/src/routes/ingest.ts:29-30` — 항상 `position_x: 0, position_y: 0`
- **영향**: 오피스 시각화에서 모든 에이전트가 원점에 표시.

---

## MEDIUM 이슈

### M-01: Snapshot 응답에 `settings` 항상 빈 객체

- **문서**: `system-architecture.md` — snapshot에 현재 설정 포함
- **코드**: `snapshot.ts:34` — `settings: {}` 고정
- **영향**: 클라이언트가 스냅샷에서 설정을 읽을 수 없음.

### M-02: `theme` 필드가 enum이 아닌 `z.string()`

- **문서**: `settings-spec.md` — `theme: office-light | office-dark`
- **코드**: `settings.ts:8` — `theme: z.string()` (자유 문자열)
- **영향**: 유효하지 않은 테마 값이 검증 없이 허용됨.

### M-03: Hook 템플릿에 `SubagentStop`, `Stop`, `Notification` hook 누락

- **문서**: `event-schema.md` — `SubagentStop`, `Stop`, `Notification` hook 이벤트
- **코드**: `integration.ts` hookTemplate — `PreToolUse`, `PostToolUse`, `SubagentStart`만 포함
- **영향**: 에이전트 종료·알림 이벤트가 수집되지 않음.

### M-04: Seed mock 시나리오 문서 사양과 불일치

- **문서**: `implementation-plan.md` — 4개 시나리오 (기본 작업, 할당 플로우, 실패 복구, 연속 실패)
- **코드**: `seed-mock.ts` — 단순 5개 이벤트 시퀀스만 존재, 시나리오 분리 없음, `--agents`/`--interval-ms` 옵션 없음
- **영향**: 테스트 커버리지 부족.

### M-05: `locale` 필드 하드코딩

- **문서**: `event-schema.md` — `locale` 필드는 hook 원본의 로케일 또는 서버 설정에서 결정
- **코드**: `normalizer.ts:43` — `locale: "ko-KR"` 하드코딩
- **영향**: 다국어 환경에서 이벤트 로케일이 항상 한국어로 고정.

---

## 요약

| 심각도 | 건수 |
|---|---|
| CRITICAL | 10 |
| HIGH | 7 |
| MEDIUM | 5 |
| **합계** | **22** |
