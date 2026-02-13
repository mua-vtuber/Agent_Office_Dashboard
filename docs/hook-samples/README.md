# Hook Samples Intake

목적:
- Claude Code에서 실제 훅 payload를 수집해 normalize 규칙을 실데이터 기준으로 보정한다.

## 수집 가이드
- 최소: 20건
- 권장: 50건 이상
- 이벤트 다양성:
  - `PreToolUse`
  - `PostToolUse` (성공/실패 모두)
  - `SubagentStart`
  - `Stop` 또는 종료 계열 이벤트

## 파일 구조
- 파일명 규칙:
  - `YYYYMMDD-HHMMSS-<event_name>-<seq>.json`
- 예시:
  - `20260213-183000-PreToolUse-001.json`
  - `20260213-183002-PostToolUse-002.json`

## JSON 형식
- 원본 payload를 가공 없이 그대로 저장.
- 예시:
```json
{
  "event_name": "PreToolUse",
  "session_id": "sess_xxx",
  "team_name": "demo",
  "agent_name": "worker-1",
  "tool_name": "Bash"
}
```

## 메타 정보
- 각 파일에 아래 키가 있으면 유지:
  - `workspace_id`
  - `terminal_session_id`
  - `run_id`
  - `session_id`
- 없다면 별도 `manifest.md`에 파일별로 메모:
  - 수집 시각
  - 실행 환경
  - 성공/실패 여부

## 검수 체크리스트
- [ ] JSON 파싱 가능
- [ ] 원본 필드 누락 없이 저장
- [ ] 성공/실패 케이스 포함
- [ ] 다중 에이전트 케이스 포함
- [ ] 다중 run 케이스 포함
