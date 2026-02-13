# Hook Payload Samples

Claude Code Hook 이벤트의 실제 페이로드 원본 샘플 모음 (42건).
`/ingest/hooks` 엔드포인트에 도착하는 형태 기준으로 작성.

## 시나리오

### Run 1 (`run-2026-02-13-001`) — feature-auth 팀 작업
- **Terminal**: `term-a1b2c3d4`
- **Team**: `feature-auth`
- **Agents**: leader, researcher, coder, tester, explorer (coder의 하위 에이전트)
- **흐름**: researcher 탐색 → coder 구현 → tester 검증
- **특이사항**: Edit 실패 후 재시도, Bash 타임아웃, tester max_turns 도달

### Run 2 (`run-2026-02-13-002`) — hotfix-db 긴급 수정
- **Terminal**: `term-e5f6g7h8` (다른 터미널)
- **Team**: `hotfix-db`
- **Agents**: leader, hotfix-coder, reviewer
- **특이사항**: permission denied 에러, 사용자 인터럽트로 세션 종료

## 디렉토리 구조

```
hook-samples/
├── SubagentStart/    # 에이전트 시작 (6건)
├── SubagentStop/     # 에이전트 종료 (5건)
├── PreToolUse/       # 도구 호출 전 (12건)
├── PostToolUse/      # 도구 호출 후 (12건)
├── Stop/             # 세션 종료 (4건)
└── Notification/     # 알림 (3건)
```

## 파일 형식

```jsonc
{
  "_meta": {                          // 수집 메타데이터 (대시보드용)
    "collected_at": "ISO-8601",       // 수집 시각
    "workspace": "repo-name",        // 워크스페이스
    "terminal_session": "term-id",   // 터미널 세션
    "run": "run-id",                 // 실행 ID
    "description": "설명"            // 케이스 설명
  },
  "event_name": "PreToolUse",        // 이벤트 유형 (normalizer가 참조)
  "session_id": "uuid",             // Claude Code 세션 ID
  // ... 이벤트별 필드
}
```

## 이벤트별 요약

### SubagentStart (6건)
| # | 파일 | 에이전트 | 특이사항 |
|---|------|---------|---------|
| 1 | 001-researcher-start | researcher | 팀 첫 번째 에이전트 |
| 2 | 002-coder-start | coder | researcher 완료 후 시작 |
| 3 | 003-tester-start | tester | 검증용 에이전트 |
| 4 | 004-explorer-quick-search | explorer | 중첩 에이전트 (coder→explorer) |
| 5 | 005-run2-hotfix-coder | hotfix-coder | 다른 팀/터미널/run |
| 6 | 006-run2-reviewer | reviewer | Plan 타입 에이전트 |

### SubagentStop (5건)
| # | 파일 | 결과 | 특이사항 |
|---|------|------|---------|
| 1 | 001-researcher-complete | completed | 정상 완료 |
| 2 | 002-coder-complete | completed | 정상 완료 |
| 3 | 003-tester-error-stop | max_turns_reached | 턴 한도 초과 |
| 4 | 004-explorer-fast-complete | completed | 중첩 에이전트 빠른 완료 |
| 5 | 005-run2-hotfix-coder-done | completed | 다른 run의 정상 완료 |

### PreToolUse (12건)
| # | 파일 | 도구 | 시맨틱 추출 |
|---|------|------|-----------|
| 1 | 001-bash-npm-test | Bash | tool_started |
| 2 | 002-read-file | Read | tool_started |
| 3 | 003-write-new-file | Write | tool_started |
| 4 | 004-edit-existing | Edit | tool_started |
| 5 | 005-grep-search | Grep | tool_started |
| 6 | 006-glob-find-files | Glob | tool_started |
| 7 | 007-task-spawn-subagent | Task | → agent_started 추정 |
| 8 | 008-sendmessage-dm | SendMessage | → manager_assign 추정 |
| 9 | 009-taskcreate | TaskCreate | → task_created 추정 |
| 10 | 010-taskupdate-complete | TaskUpdate | → task_completed 추정 |
| 11 | 011-webfetch | WebFetch | tool_started |
| 12 | 012-bash-install-dep | Bash | tool_started (패키지 설치) |

### PostToolUse (12건)
| # | 파일 | 결과 | 특이사항 |
|---|------|------|---------|
| 1 | 001-bash-test-pass | 성공 | 테스트 4건 통과 |
| 2 | 002-bash-test-fail | 실패 | exit code 1, 2건 실패 |
| 3 | 003-read-success | 성공 | 파일 읽기 |
| 4 | 004-write-success | 성공 | 파일 생성 |
| 5 | 005-edit-fail-not-found | 실패 | old_string 매칭 실패 (재시도 가능) |
| 6 | 006-edit-success-retry | 성공 | 005의 재시도 성공 |
| 7 | 007-grep-matches | 성공 | 검색 결과 없음 (에러 아님) |
| 8 | 008-task-delegation-success | 성공 | 서브에이전트 위임 완료 |
| 9 | 009-bash-timeout | 실패 | 60초 타임아웃 |
| 10 | 010-sendmessage-success | 성공 | DM 전달 |
| 11 | 011-bash-permission-denied | 실패 | 권한 거부 (치명적) |
| 12 | 012-glob-results | 성공 | 파일 목록 반환 |

### Stop (4건)
| # | 파일 | 이유 | 특이사항 |
|---|------|------|---------|
| 1 | 001-normal-completion | completed | 모든 작업 완료 |
| 2 | 002-user-interrupt | user_interrupt | Ctrl+C |
| 3 | 003-max-turns | max_turns_reached | 턴 한도 도달 |
| 4 | 004-error-crash | error | 컨텍스트 초과 |

### Notification (3건)
| # | 파일 | 레벨 | 특이사항 |
|---|------|------|---------|
| 1 | 001-info-task-done | info | 에이전트 작업 완료 알림 |
| 2 | 002-warn-approaching-limit | warn | 컨텍스트 85% 경고 |
| 3 | 003-error-agent-failed | error | 에이전트 비정상 종료 |

## 검수 결과
- [x] 42건 전부 JSON 파싱 가능
- [x] 원본 필드 누락 없이 저장
- [x] 성공/실패 케이스 포함 (성공 26건, 실패 8건, 기타 8건)
- [x] 다중 에이전트 케이스 포함 (7개 에이전트, 중첩 포함)
- [x] 다중 run 케이스 포함 (2개 run, 2개 터미널)
- [x] 재시도 케이스 포함 (Edit fail → retry success)

## 참고 문서
- [event-schema.md](../event-schema.md) — 정규화 규칙, 입력 매핑 (Section 5)
- [hooks-onboarding.md](../hooks-onboarding.md) — Hook 설정 가이드
- [클로드의 추가의견.md](../클로드의%20추가의견.md) — Section 2: 실제 페이로드 구조
