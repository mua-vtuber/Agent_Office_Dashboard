# State Machine Spec

## 1. 목적
오피스 탭의 캐릭터 움직임과 대시보드 상태를 동일한 규칙으로 동기화한다.

## 2. 에이전트 상태 정의
- `idle`: 대기 상태, 좌석에 위치
- `working`: 작업 수행 중, 좌석에 위치 (머리 위 작업 종이 이펙트)
- `handoff`: 지시/보고를 위해 이동 중
- `meeting`: 대화/지시 교환 중
- `returning`: 좌석으로 복귀 중
- `pending_input`: 사용자 입력/외부 응답 대기
- `failed`: 복구 전까지 진행 불가한 실패
- `completed`: 작업 완료 직후 분기 상태
- `roaming`: 사무실 내 순찰 이동
- `breakroom`: 탕비실 체류
- `resting`: 좌석 수면(`Zzz`)
- `offline`: 세션 비활성

## 3. 상태 속성
- `position`: 현재 좌표(x, y)
- `home_position`: 좌석 좌표
- `target_position`: 이동 목적지
- `facing`: 시선 방향(left/right/up/down)
- `since`: 상태 진입 시각
- `context`: task_id, peer_agent_id 등

## 4. 전이 규칙

### 4.1 기본 전이
- `idle -> working`
  - trigger: `task_started`
- `working -> completed`
  - trigger: `task_completed`
- `completed -> roaming|breakroom|resting`
  - trigger: `post_complete_policy`
- `working -> failed`
  - trigger: `task_failed` 또는 `tool_failed`(치명)
  - motion: 절규/패닉 모션
- `working -> pending_input`
  - trigger: `tool_failed`(입력 재시도 가능) 또는 외부 대기
- `pending_input -> working`
  - trigger: `agent_unblocked`
- `failed -> working`
  - trigger: `agent_unblocked` 또는 재시도 성공
- `idle -> breakroom|resting`
  - trigger: 장시간 유휴(설정 임계치 초과)
- `roaming|breakroom|resting -> returning`
  - trigger: `task_started`
- `roaming|breakroom|resting -> handoff`
  - trigger: `manager_assign` (본인이 대상)

### 4.2 지시/보고 전이
- `manager_assign` 수신 시:
  - manager: `idle|working -> handoff`
  - worker:
    - `idle`면 `handoff`
    - `working`이면 기본 정책 `queue`로 신규 task를 대기열에 적재
    - `working` 상태 선점은 `priority=high`일 때만 허용(옵션)
  - 두 에이전트의 목적지는 고정 미팅 스팟 `meeting_spot_id`로 결정
- `agent_acknowledged` 수신 시:
  - worker가 지시를 인지했음을 대시보드에 반영하고 `handoff` 준비 상태 표시
- 두 에이전트 모두 목적지 도착 시:
  - manager: `meeting`
  - worker: `meeting`
- `meeting_ended` 또는 timeout 시:
  - manager: `returning`
  - worker:
    - 할당받은 작업 있으면 `returning -> working`
    - 없으면 `returning -> idle`

### 4.3 복귀 전이
- `returning`에서 `home_position` 도착 시:
  - context의 task 상태에 따라 `working` 또는 `idle`

### 4.4 치명/재시도 실패 분류 기준
- `working -> failed` (치명적)
  - `task_failed` 명시 수신
  - `tool_failed` 오류 문자열에 `permission denied`, `not found`, `ENOENT` 포함
  - 동일 작업에서 동일 도구 3회 연속 실패
- `working -> pending_input` (재시도 가능)
  - `tool_failed` 오류 문자열에 `timeout`, `EAGAIN`, `rate limit` 포함
  - 동일 도구 1~2회 실패 단계
- 판정 불가 기본값:
  - `pending_input`으로 분류(낙관적 처리), 후속 실패 누적으로 `failed` 승격

### 4.5 전이 매트릭스 (MVP)
| 현재 상태 | 이벤트 | 다음 상태 | 조건 |
|---|---|---|---|
| idle | task_started | working | |
| idle | manager_assign | handoff | 본인이 대상 |
| idle | timer:idle_timeout | breakroom | `idle_to_breakroom_seconds` 초과 |
| idle | timer:idle_timeout | resting | `idle_to_resting_seconds` 초과 |
| working | task_completed | completed | |
| working | task_failed | failed | |
| working | tool_failed | failed | 치명적 기준 충족 |
| working | tool_failed | pending_input | 재시도 가능 |
| working | manager_assign | working | 기본은 큐 적재(상태 불변) |
| working | manager_assign | handoff | `priority=high` 선점 |
| completed | post_complete_policy | roaming/breakroom/resting | 가중치 정책 |
| completed | task_started | working | 큐 대기 작업 존재 |
| handoff | arrive_at_meeting | meeting | 참여자 도착 완료 |
| handoff | timer:handoff_timeout | meeting | 10초 초과 강제 |
| meeting | meeting_ended | returning | |
| meeting | timer:meeting_timeout | returning | 15초 초과 |
| returning | arrive_at_home | working | 할당 작업 있음 |
| returning | arrive_at_home | idle | 할당 작업 없음 |
| pending_input | agent_unblocked | working | |
| failed | agent_unblocked | working | |
| roaming | task_started | returning | 좌석 복귀 후 작업 |
| roaming | manager_assign | handoff | meeting spot 이동 |
| breakroom | task_started | returning | 좌석 복귀 후 작업 |
| breakroom | manager_assign | handoff | meeting spot 이동 |
| breakroom | timer:breakroom_timeout | idle | 20분 초과 |
| resting | task_started | returning | 좌석 복귀 후 작업 |
| resting | manager_assign | handoff | meeting spot 이동 |
| offline | agent_started | idle | |
| * | agent_stopped | offline | 모든 상태 공통 |
| * | heartbeat | (불변) | `last_event_ts`만 갱신 |

매트릭스에 없는 `(state,event)` 조합은 no-op 처리하고 `transition_ignored` 로그를 남긴다.

## 5. 동시 이벤트 처리 정책
- 우선순위:
  1. `offline`
  2. `failed`
  3. `pending_input`
  4. `meeting/handoff/returning`
  5. `working`
  6. `idle`
- 동일 시각 충돌 시 우선순위 높은 상태를 채택

## 6. 타임아웃 정책
- `handoff` 최대 10초
  - 초과 시 `meeting` 강제 진입 또는 `returning` fallback
- `meeting` 최대 15초
  - 초과 시 자동 `meeting_ended` synthetic 이벤트 발행
- `pending_input` 60초 이상 지속 시 경고 이벤트 발행
- `failed` 30초 이상 지속 시 경고 이벤트 발행
- `breakroom` 20분 이상 체류 시 상태 재평가

## 7. 보간/애니메이션 규칙
- 이동 보간: linear 또는 ease-in-out
- 속도: 기본 120 px/s
- 충돌 회피: MVP에서는 비활성(겹침 허용)
- 시선 처리:
  - 이동 시 진행 방향
  - meeting 시 상대 에이전트를 바라봄

## 8. 에러 처리
- 매트릭스에 없는 `(state,event)` 조합:
  - no-op 처리 후 `transition_ignored` 로그 기록
- 전이 규칙 위반(불가능한 상태/필수 컨텍스트 누락):
  - 상태는 유지하고 `transition_error` 로그 기록
- 에이전트 누락:
  - synthetic `agent_registered` 후 기본 좌석 할당(설정값)

## 9. 상태머신 의사코드
```text
onEvent(event):
  normalized = normalize(event)
  current = state[normalized.agent_id]
  if not inTransitionMatrix(current, normalized):
    emit(transition_ignored)
    return
  next = reduce(current, normalized)
  if isValidTransition(current, next):
    state[agent] = next
    emit(state_update)
  else:
    emit(transition_error)
```

## 10. 테스트 시나리오
- 단일 작업 시작/완료
- 지시 -> meeting -> 복귀 -> 작업
- 작업 중 도구 실패 -> pending_input/failed -> 복구
- manager/worker 동시 지시 이벤트 충돌
- task_completed 후 roaming/breakroom/resting 분기 검증
- failed 상태 절규 모션, working 상태 종이 이펙트, resting 상태 `Zzz` 검증
