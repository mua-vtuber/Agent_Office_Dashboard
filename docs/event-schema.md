# Event Schema

## 1. 목적
모든 입력 이벤트를 하나의 표준 포맷으로 정규화하여,
- 대시보드 조회
- 오피스 연출 상태 전이
- 장애 분석
에 공통 사용한다.

## 2. 표준 이벤트 포맷
```json
{
  "id": "evt_20260213_000001",
  "version": "1.1",
  "ts": "2026-02-13T14:45:00.123Z",
  "type": "manager_assign",
  "source": "hook",
  "workspace_id": "repo_agent-office-dashboard",
  "terminal_session_id": "term_a1b2c3",
  "run_id": "run_20260213_01",
  "session_id": "sess_abc",
  "agent_id": "manager_1",
  "target_agent_id": "worker_2",
  "task_id": "task_77",
  "severity": "info",
  "locale": "ko-KR",
  "payload": {
    "summary": "Refactor auth middleware"
  },
  "raw": {
    "provider": "claude_code",
    "event_name": "SubagentStart"
  }
}
```

## 3. 필드 정의
- `id` string: 전역 고유 ID
- `version` string: 스키마 버전 (`1.1`)
- `ts` string: ISO-8601 UTC 타임스탬프
- `type` enum: 정규화 이벤트 타입
- `source` enum: `hook | sdk | synthetic`
- `workspace_id` string: 프로젝트/레포 단위 식별자
- `terminal_session_id` string: 터미널 인스턴스 식별자
- `run_id` string: 실행 단위 식별자(같은 세션 내 복수 실행 구분)
- `session_id` string: 상위 세션 식별자(호환 유지)
- `agent_id` string: 이벤트 주체
- `target_agent_id` string|null: 상대 주체
- `task_id` string|null: 관련 작업
- `severity` enum: `debug | info | warn | error`
- `locale` string: 이벤트 생성 시점 언어 태그(예: `ko-KR`, `en-US`)
- `payload` object: 타입별 추가 데이터
- `raw` object: 원본 추적용 최소 정보

## 4. 이벤트 타입 카탈로그 (v1.1)
- 에이전트 라이프사이클
  - `agent_started`
  - `agent_stopped`
  - `agent_blocked`
  - `agent_unblocked`
- 작업 흐름
  - `task_created`
  - `manager_assign`
  - `agent_acknowledged`
  - `task_started`
  - `task_progress`
  - `task_completed`
  - `task_failed`
- 협업/대화
  - `meeting_requested`
  - `meeting_started`
  - `meeting_ended`
- 도구 실행
  - `tool_started`
  - `tool_succeeded`
  - `tool_failed`
- 시스템
  - `heartbeat`
  - `schema_error`

## 5. 입력 매핑 규칙 예시
- `SubagentStart` -> `agent_started`
- `SubagentStop` -> `agent_stopped`
- `PreToolUse` -> `tool_started`
- `PostToolUse` + success -> `tool_succeeded`
- `PostToolUse` + failure -> `tool_failed`
- Manager 지시 수신 확인 -> `agent_acknowledged`
- `agent_blocked`는 호환용 입력 이벤트이며 상태머신 적용 시 `pending_input` 또는 `failed`로 변환한다.

## 5.1 Hook 원본 페이로드 계약 (MVP 가정)
- SubagentStart (예시 필드)
  - `session_id`, `agent_name`, `agent_type`, `parent_session_id`, `team_name`, `prompt`
- SubagentStop
  - `session_id`, `agent_name`, `agent_type`, `parent_session_id`, `team_name`, `result`
- PreToolUse
  - `session_id`, `tool_name`, `tool_input`
- PostToolUse
  - `session_id`, `tool_name`, `tool_input`, `tool_result`, `error`
- Notification
  - `session_id`, `message`, `level`
- Stop
  - `session_id`, `reason`, `summary`

원본 구조는 provider 업데이트에 따라 변할 수 있으므로, `raw` 필드에 원본을 보존하고 `normalize`에서 버전별 변환기를 둔다.

## 5.2 팀 상호작용 시맨틱 추출 규칙
- `PreToolUse`에서 `tool_name` + `tool_input`을 파싱해 업무 의미 이벤트를 만든다.
  - 예: `TaskCreate` -> `task_created`, `TaskUpdate(status=completed)` -> `task_completed`
- `SubagentStart`/`SubagentStop`는 에이전트 시작/종료의 확정 이벤트로 우선한다.
- 동일 의미 이벤트가 중복 감지되면 우선순위:
  1. SubagentStart/Stop (확정)
  2. PreToolUse 기반 추정 이벤트
  3. synthetic 보완 이벤트

## 5.3 식별자 매핑 규칙
- 기본 `agent_id`:
  - 팀 에이전트: `team_name/agent_name`
  - 메인 리더: `team_name/leader`
- `session_id`는 내부 추적용으로 사용하고 UI 기본 표시명은 `agent_name`을 사용한다.
- `workspace_id`/`terminal_session_id` 누락 시 서버에서 보정한다.

## 6. 검증 규칙
- 공통:
  - `id`, `version`, `ts`, `type`, `source`, `workspace_id`, `terminal_session_id`, `agent_id`는 필수
  - `ts`는 UTC ISO 형식
- 타입별:
  - `manager_assign`는 `target_agent_id`, `task_id`, `payload.summary` 필수
  - `agent_acknowledged`는 `target_agent_id`, `task_id` 필수
  - `task_*`는 `task_id` 필수
  - `tool_*`는 `payload.tool_name` 필수
  - `tool_failed`는 `payload.tool_name`, `payload.exit_code`, `payload.error_message` 필수

## 7. 순서/중복 처리
- 수신 순서 != 실제 발생 순서 가능
- 정렬 기준: `ts`, 동률 시 `id`
- 중복 이벤트는 `id` 기준 upsert/skip
- 동일 `terminal_session_id` 내에서 `run_id`로 실행 단위 그룹화
- hook 원본에 고유 ID가 없을 수 있으므로 fingerprint(`session_id + tool_name + ts bucket + payload hash`)로 중복 제거한다.

## 7.1 heartbeat 발행 주체
- `heartbeat`는 서버 synthetic 이벤트로 발행한다.
- 발행 주기:
  - 서버 -> 클라이언트 연결 heartbeat: `settings.heartbeat_interval_sec`
  - 에이전트 활성 heartbeat: 마지막 이벤트 시각 기반으로 서버가 합성
- Hook 입력원은 heartbeat를 직접 보내지 않아도 된다.

## 8. 호환성 전략
- minor 확장: 새 optional 필드 추가
- major 변경: `version` 상승 + 변환기 제공
- 구버전 클라이언트는 알 수 없는 필드 무시

## 9. 샘플 이벤트

### 9.1 지시 이벤트
```json
{
  "id": "evt_assign_1",
  "version": "1.1",
  "ts": "2026-02-13T15:00:00.000Z",
  "type": "manager_assign",
  "source": "synthetic",
  "workspace_id": "repo_agent-office-dashboard",
  "terminal_session_id": "term_a1b2c3",
  "run_id": "run_1",
  "session_id": "sess_1",
  "agent_id": "manager_1",
  "target_agent_id": "worker_1",
  "task_id": "task_101",
  "severity": "info",
  "locale": "ko-KR",
  "payload": {"summary": "Fix flaky test"},
  "raw": {"provider": "dashboard"}
}
```

### 9.2 도구 실패 이벤트
```json
{
  "id": "evt_tool_fail_1",
  "version": "1.1",
  "ts": "2026-02-13T15:03:10.000Z",
  "type": "tool_failed",
  "source": "hook",
  "workspace_id": "repo_agent-office-dashboard",
  "terminal_session_id": "term_a1b2c3",
  "run_id": "run_1",
  "session_id": "sess_1",
  "agent_id": "worker_1",
  "target_agent_id": null,
  "task_id": "task_101",
  "severity": "error",
  "locale": "ko-KR",
  "payload": {
    "tool_name": "bash",
    "exit_code": 1,
    "error_message": "command failed"
  },
  "raw": {"provider": "claude_code", "event_name": "PostToolUse"}
}
```
