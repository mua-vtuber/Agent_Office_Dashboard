# Time Travel Debugging Spec

## 1. 목적
실패/지연 이벤트가 발생했을 때, 해당 시점 전후 맥락을 즉시 재구성해 원인 분석 시간을 단축한다.

## 2. 범위
- v1.1 범위:
  - 특정 이벤트 선택 시 주변 이벤트(기본 ±10개) 하이라이트
  - 선택 이벤트 시점의 에이전트 상태 스냅샷 표시
  - workspace/session/run 스코프 유지
- v2 확장:
  - 타임라인 재생(Play/Pause)
  - 상태 프레임 단위 스크럽

## 3. 사용자 흐름
1. Dashboard 타임라인에서 `task_failed` 또는 `tool_failed` 클릭
2. 우측 패널에 "Time Travel" 뷰 오픈
3. 기준 이벤트 전후 이벤트 목록 표시
4. 선택 시점의 에이전트 상태(위치, 상태, task)를 렌더
5. 필요 시 run 전체로 범위를 확장

## 4. API 초안
- `GET /api/events/:event_id/context?before=10&after=10`
- `GET /api/state/at?ts=...&workspace_id=...&terminal_session_id=...&run_id=...`

응답 예시:
```json
{
  "pivot_event_id": "evt_tool_fail_1",
  "before": ["..."],
  "pivot": {"id": "evt_tool_fail_1", "type": "tool_failed"},
  "after": ["..."],
  "state_at_ts": {
    "agents": [
      {"agent_id": "worker_1", "status": "failed", "task_id": "task_101"}
    ]
  }
}
```

## 5. UI 요구사항
- 타임라인에서 pivot 이벤트 강조
- before/after 구간 색상 구분
- state snapshot 카드(에이전트별)
- "현재 라이브로 복귀" 버튼

## 6. 성능 기준
- context 조회 p95 <= 300ms (이벤트 10k 기준)
- state-at-ts 조회 p95 <= 500ms

## 7. 저장/인덱스 요구
- events 인덱스: `(workspace_id, terminal_session_id, run_id, ts)`
- state 스냅샷 전략:
  - 옵션 A: 주기적 체크포인트
  - 옵션 B: 이벤트 리플레이 + 캐시

## 8. 권한/보안
- 조회는 read 권한 사용자 허용
- payload 마스킹 정책을 그대로 적용

## 9. 릴리즈 순서
1. v1.1: context 이벤트 조회 + 하이라이트
2. v1.1: state-at-ts 카드
3. v2: 재생형 타임라인
