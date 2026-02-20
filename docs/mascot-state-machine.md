# Agent Mascot - State Machine Specification

## 1. 목적

에이전트의 현재 상태를 추적하고, 이벤트에 따라 상태를 전이하며, 해당 상태에 맞는 캐릭터 애니메이션을 결정한다.

기존 Office Dashboard의 12개 상태에서 사무실 공간 관련 상태를 제거하고, 마스코트에 필요한 등장/퇴장/상호작용 상태를 추가했다.

## 2. 상태 정의

| 상태 | 설명 | Spine 애니메이션 | 루프 |
|------|------|------------------|------|
| `offline` | 세션 비활성. 화면에 표시되지 않음. | (없음) | - |
| `appearing` | 등장 중. 뿅 이펙트 재생. | `appear` | one-shot |
| `idle` | 대기 상태. 작업 없이 서있음. | `idle` | loop |
| `working` | 작업 수행 중. 도구 실행 또는 코드 작성. | `working` | loop |
| `thinking` | 확장 사고(extended thinking) 중. | `thinking` | loop |
| `pending_input` | 사용자 입력 또는 외부 응답 대기. | `thinking` | loop |
| `failed` | 복구 전까지 진행 불가. | `failed` | one-shot + hold |
| `completed` | 작업 완료! 폴짝폴짝 기쁨 표현 후 대기. | `celebrate` → `idle` | one-shot → loop |
| `resting` | 할 일 없이 졸고 있음. 💤 | `resting` | loop |
| `startled` | 졸다가 화들짝 깨어남! | `startled` | one-shot |
| `walking` | 다른 에이전트에게 다가가는 중. | `walking` | loop |
| `chatting` | 다른 에이전트와 대화 중. | `chatting` | loop |
| `returning` | 대화 끝나고 자기 자리로 복귀 중. | `walking` | loop |
| `disappearing` | 퇴장 중. 뿅 이펙트 역재생. | `disappear` | one-shot |

### 제거된 상태 (Office 전용)
- `handoff`: 사무실 미팅 스팟 이동 → `walking`으로 단순화
- `meeting`: 미팅 룸 개념 → `chatting`으로 단순화
- `roaming`: 사무실 순찰 → 불필요
- `breakroom`: 탕비실 체류 → `resting`으로 대체

## 3. 상태 속성

```rust
pub struct AgentState {
    pub agent_id: String,
    pub status: AgentStatus,
    pub thinking_text: Option<String>,    // 확장 사고 내용
    pub current_task: Option<String>,     // 현재 작업 요약
    pub workspace_id: String,             // 소속 프로젝트
    pub since: String,                    // 상태 진입 시각 (ISO-8601)
    pub last_event_ts: String,            // 마지막 이벤트 시각
    pub session_id: Option<String>,       // 터미널 세션 ID
    pub peer_agent_id: Option<String>,    // 대화 상대 에이전트 ID
    pub home_x: f64,                      // 기본 X 위치 (활동 영역 내 퍼센트)
}
```

`position`/`target_position`은 상태로 관리하지 않는다 — WebView의 CharacterManager가 상태 전이를 보고 이동 애니메이션을 직접 결정한다. `home_x`만 저장하여 복귀 위치를 알 수 있게 한다.

## 4. 전이 규칙

### 4.1 전이 매트릭스

#### 기본 전이

| 현재 상태 | 이벤트 | 다음 상태 | 조건 |
|-----------|--------|-----------|------|
| `offline` | `agent_started` | `appearing` | |
| `appearing` | `appear_done` | `idle` | synthetic: 등장 애니메이션 완료 |
| `idle` | `task_started` | `working` | |
| `idle` | `tool_started` | `working` | |
| `idle` | `timer:idle_to_resting` | `resting` | config `idle_to_resting_secs` 초과 |
| `working` | `thinking_updated` | `thinking` | thinking 텍스트가 존재할 때 |
| `working` | `task_completed` | `completed` | |
| `working` | `task_failed` | `failed` | |
| `working` | `tool_failed` | `failed` | 치명적 기준 충족 (아래 §4.3 참조) |
| `working` | `tool_failed` | `pending_input` | 재시도 가능 기준 (아래 §4.3 참조) |
| `working` | `tool_started` | `working` | 상태 유지, `current_task` 갱신 |
| `working` | `tool_succeeded` | `working` | 상태 유지, `current_task` 갱신 |
| `thinking` | `tool_started` | `working` | thinking 종료, 도구 실행 시작 |
| `thinking` | `task_completed` | `completed` | |
| `thinking` | `task_failed` | `failed` | |
| `thinking` | `thinking_updated` | `thinking` | thinking 텍스트 갱신 |
| `pending_input` | `agent_unblocked` | `working` | |
| `pending_input` | `task_started` | `working` | |
| `failed` | `agent_unblocked` | `working` | |
| `failed` | `task_started` | `working` | |
| `completed` | `task_started` | `working` | 새 작업 시작 |
| `completed` | `timer:completed_timeout` | `disappearing` | config `completed_to_disappear_secs` 초과 |
| `disappearing` | `disappear_done` | `offline` | synthetic: 퇴장 애니메이션 완료 |
| `*` | `agent_stopped` | `disappearing` | 모든 상태에서 공통 |
| `*` | `heartbeat` | (불변) | `last_event_ts`만 갱신 |

#### 졸기 / 깨어남 전이

| 현재 상태 | 이벤트 | 다음 상태 | 조건 |
|-----------|--------|-----------|------|
| `resting` | `task_started` | `startled` | 잠자다가 작업 할당 → 화들짝! |
| `resting` | `message_received` | `startled` | 리더가 메시지 보냄 → 화들짝! |
| `resting` | `agent_stopped` | `disappearing` | |
| `startled` | `startled_done` | `working` | synthetic: startled 애니메이션 완료 후 바로 일 시작 |
| `startled` | `startled_done` | `idle` | 작업 없으면 idle로 |

#### 대화(상호작용) 전이

| 현재 상태 | 이벤트 | 다음 상태 | 조건 |
|-----------|--------|-----------|------|
| `idle` | `message_sent` | `walking` | 말할 게 있으면 상대에게 다가감. `peer_agent_id` 설정. |
| `working` | `message_sent` | `walking` | 작업 중에도 메시지 보내면 다가감 |
| `walking` | `arrive_at_peer` | `chatting` | synthetic: 상대 위치 도착 |
| `chatting` | `message_done` | `returning` | 대화 끝, 돌아감. 또는 config `chat_timeout_secs` 초과 |
| `chatting` | `timer:chat_timeout` | `returning` | config `chat_timeout_secs` 초과 시 강제 복귀 |
| `returning` | `arrive_at_home` | (이전 상태) | synthetic: 자기 자리 도착. working이었으면 working, idle이었으면 idle |
| `resting` | `message_sent` | `startled` | 졸다가 보낼 말이 생기면 → 깨어남 → walking |

### 4.2 매트릭스에 없는 조합

매트릭스에 정의되지 않은 `(현재상태, 이벤트)` 조합은:
1. 상태를 변경하지 않는다 (no-op)
2. `transition_ignored` 로그를 기록한다
3. `last_event_ts`는 갱신한다

### 4.3 치명/재시도 실패 분류

`tool_failed` 이벤트 수신 시 에러 메시지를 기반으로 분류한다.

**치명적 (→ `failed`)**:
- 에러 메시지에 다음 키워드 포함: `permission denied`, `not found`, `ENOENT`, `EACCES`
- `task_failed` 이벤트 명시 수신
- 동일 작업에서 동일 도구 연속 실패 횟수가 config `fatal_consecutive_failures` 이상

**재시도 가능 (→ `pending_input`)**:
- 에러 메시지에 다음 키워드 포함: `timeout`, `EAGAIN`, `rate limit`, `ECONNREFUSED`
- 연속 실패 횟수가 config `fatal_consecutive_failures` 미만

**판정 불가 기본값**: `pending_input` (낙관적 처리)

키워드 목록은 하드코딩하지 않고 config에서 로드한다:

```toml
[state_machine]
fatal_keywords = ["permission denied", "not found", "ENOENT", "EACCES"]
retryable_keywords = ["timeout", "EAGAIN", "rate limit", "ECONNREFUSED"]
fatal_consecutive_failures = 3
```

## 5. 타이머 기반 전이

heartbeat 서비스가 주기적으로 실행하며, 특정 상태에서 일정 시간이 지나면 자동으로 전이한다.

타이머 규칙은 config에서 정의한다:

```toml
[state_machine.timer_transitions]
idle_to_resting_secs = 120          # 2분 유휴 → 졸기
completed_to_disappear_secs = 60    # 완료 후 1분 → 퇴장
chat_timeout_secs = 5               # 대화 최대 5초 후 자동 복귀

[heartbeat]
interval_secs = 10                  # heartbeat 체크 간격
```

### 타이머 전이 처리

```
매 heartbeat 간격마다:
  for each agent in agent_state:
    elapsed = now - agent.since
    for each timer_rule in config.timer_transitions:
      if agent.status == timer_rule.from && elapsed > timer_rule.after_secs:
        transition(agent, timer_rule.to)
        emit("mascot://agent-update", agent)
```

## 6. Synthetic 이벤트

WebView에서 생성하여 Rust로 전달하는 이벤트:

| 이벤트 | 발생 시점 | 처리 |
|--------|-----------|------|
| `appear_done` | Spine `appear` 애니메이션 완료 | `appearing → idle` |
| `disappear_done` | Spine `disappear` 애니메이션 완료 | `disappearing → offline` |
| `startled_done` | Spine `startled` 애니메이션 완료 | `startled → working/idle` |
| `arrive_at_peer` | 이동 중 상대 에이전트 위치 도착 | `walking → chatting` |
| `arrive_at_home` | 복귀 중 자기 자리 도착 | `returning → (이전 상태)` |
| `message_done` | 대화 말풍선 표시 완료 | `chatting → returning` |

이 이벤트들은 WebView에서 `invoke('notify_animation_done', { agent_id, animation })` 또는 `invoke('notify_movement_done', { agent_id, movement_type })` 형태로 Rust에 전달한다.

## 7. 동시 이벤트 처리

동일 에이전트에 대해 짧은 시간 내 여러 이벤트가 도착할 수 있다.

처리 규칙:
1. 이벤트는 도착 순서대로 순차 처리한다 (Rust 측 agent별 lock)
2. 동일 시각 이벤트 충돌 시 우선순위:
   - `agent_stopped` > `failed` > `pending_input` > `working` > `thinking` > `idle`
3. 빠른 연속 이벤트 (100ms 이내)는 WebView 측에서 debounce하여 마지막 상태만 애니메이션 전환

## 8. 상태 → 애니메이션 매핑

```typescript
const STATUS_TO_ANIMATION: Record<AgentStatus, string> = {
  offline:       '',           // 렌더링 안 함
  appearing:     'appear',
  idle:          'idle',
  working:       'working',
  thinking:      'thinking',
  pending_input: 'thinking',   // thinking과 동일 애니메이션, 말풍선 내용으로 구분
  failed:        'failed',
  completed:     'celebrate',  // 폴짝폴짝 기쁨 → idle로 자동 전환
  resting:       'resting',    // 졸기 💤
  startled:      'startled',   // 화들짝!
  walking:       'walking',    // 다른 에이전트에게 다가가기
  chatting:      'chatting',   // 대화 중
  returning:     'walking',    // 자리로 복귀 (walking과 동일 애니메이션)
  disappearing:  'disappear',
};

const LOOPING_ANIMATIONS = new Set(['idle', 'working', 'thinking', 'resting', 'chatting', 'walking']);
```

## 9. 상태별 말풍선 표시

| 상태 | 말풍선 내용 | 표시 여부 |
|------|-------------|-----------|
| `idle` | (없음) | 숨김 |
| `working` | `current_task` 요약 | 표시 |
| `thinking` | `thinking_text` | 표시 |
| `pending_input` | "입력 대기중..." + 에러 메시지 | 표시 |
| `failed` | 에러 메시지 | 표시 |
| `completed` | "완료!" | 일시 표시 후 숨김 |
| `resting` | 💤 (또는 Zzz) | 표시 (작게) |
| `startled` | ❗ | 일시 표시 |
| `walking` | (없음) | 숨김 |
| `chatting` | 메시지 내용 (SendMessage payload) | 표시 (대화 말풍선) |
| `returning` | (없음) | 숨김 |
| `appearing` / `disappearing` | (없음) | 숨김 |

## 10. 이동 시스템 (상호작용)

### 10.1 개요

캐릭터는 대화를 위해 상대에게 **다가갔다가 자기 자리로 돌아올 수 있다**.
A* pathfinding 같은 복잡한 경로 탐색은 없다 — 활동 영역이 1차원(X축)이므로 단순 선형 이동이다.

### 10.2 이동 규칙

- **말을 하고 싶은 쪽이 듣는 쪽에게 다가간다** (화자 → 청자)
- 이동 속도: config `walk_speed_px_per_sec`
- 도착 판정: 상대 캐릭터 옆 `arrival_distance_px` 이내 도착 시 `arrive_at_peer` 발생

### 10.3 다른 캐릭터 사이를 지나갈 때

화자(A)가 청자(C)에게 이동할 때 중간에 다른 캐릭터(B)가 있는 경우:

```
이동 전:    A     B     C
                 ↑
              (사이에 있음)

이동 중:    .  A  B     C      ← A가 B 뒤로(z-index 낮춰서) 지나감
              (뒤로 통과)

도착:             B  A↔C       ← A가 C 옆에 도착, 대화 시작
```

**뒤로 지나가기 (z-order)**:
1. 이동 시작 시 이동하는 캐릭터의 z-index를 낮춘다 (다른 캐릭터들 뒤에 렌더링)
2. 선택적으로 scale을 약간 줄여서(0.9배) 원근감을 준다
3. 상대 위치에 도착하면 z-index를 원래대로 복원하고 scale도 복원한다

```typescript
// CharacterManager에서 처리
function onWalkingStart(walker: SpineCharacter) {
    walker.spine.zIndex = Z_INDEX_BEHIND;    // 다른 캐릭터 뒤로
    walker.spine.scale.set(0.9);             // 약간 작게 (원근감)
}

function onArriveAtPeer(walker: SpineCharacter) {
    walker.spine.zIndex = Z_INDEX_NORMAL;    // z-index 복원
    walker.spine.scale.set(1.0);             // 크기 복원
}
```

### 10.4 대화 연출

```
1. 화자가 청자 옆에 도착
2. 두 캐릭터가 서로 마주봄 (facing 방향 전환)
3. 화자의 말풍선에 메시지 내용 표시
4. config `chat_timeout_secs` 후 또는 `message_done` 이벤트 시:
   - 화자가 자기 자리로 복귀 (returning)
   - 복귀 시에도 z-index를 낮춰서 뒤로 이동
5. 자기 자리 도착 → arrive_at_home → 이전 상태 복원
```

### 10.5 facing 방향

- 이동 방향에 따라 캐릭터를 좌우 반전:
  - 오른쪽으로 이동 → `scaleX = 1` (기본)
  - 왼쪽으로 이동 → `scaleX = -1` (반전)
- chatting 중: 서로를 바라봄
- idle/working/resting: 기본 방향 (오른쪽)

### 10.6 동시 대화 처리

같은 시간에 여러 에이전트가 대화를 시도할 수 있다:
- 한 에이전트는 동시에 하나의 대화만 가능
- 이미 chatting/walking/returning 중인 에이전트에게 대화 요청이 오면, 요청한 쪽의 walking을 지연 (queue)
- 대기 시간이 config `chat_queue_timeout_secs`를 초과하면 대화를 건너뜀

### 10.7 config

```toml
[movement]
walk_speed_px_per_sec = 150     # 이동 속도
arrival_distance_px = 30        # 도착 판정 거리
behind_scale = 0.9              # 뒤로 지나갈 때 스케일
chat_timeout_secs = 5           # 대화 최대 시간
chat_queue_timeout_secs = 10    # 대화 대기 최대 시간
```

## 11. 의사코드

```rust
fn on_event(event: &NormalizedEvent, state: &mut AgentState, config: &AppConfig) -> Result<Option<AgentState>, AppError> {
    let current = &state.status;
    let transition = find_transition(current, &event.event_type, config)?;

    match transition {
        Some(next_status) => {
            state.status = next_status;
            state.since = event.ts.clone();
            state.last_event_ts = event.ts.clone();

            // thinking 텍스트 갱신
            if let Some(thinking) = &event.thinking {
                state.thinking_text = Some(thinking.clone());
            }

            // 작업 요약 갱신
            if let Some(task) = &event.task_summary {
                state.current_task = Some(task.clone());
            }

            Ok(Some(state.clone()))
        }
        None => {
            // no-op: 매트릭스에 없는 조합
            log::debug!("transition_ignored: {:?} + {:?}", current, event.event_type);
            state.last_event_ts = event.ts.clone();
            Ok(None)
        }
    }
}
```

## 12. 테스트 시나리오

### 기본 라이프사이클
1. 에이전트 시작 → appearing → idle (등장 완료)
2. idle → working (task_started) → completed (task_completed) → disappearing (타이머) → offline
3. working → failed (치명적 tool_failed) → working (agent_unblocked)
4. working → pending_input (재시도 가능 tool_failed) → working (agent_unblocked)
5. working → thinking (thinking_updated) → working (tool_started)
6. 모든 상태에서 agent_stopped → disappearing → offline
7. 매트릭스에 없는 조합 → no-op + transition_ignored 로그

### 졸기 / 깨어남
8. idle 2분 경과 → resting (졸기 시작, 💤)
9. resting 중 task_started 수신 → startled (화들짝!) → working
10. resting 중 message_received → startled → idle

### 대화 상호작용
11. 리더가 워커에게 메시지 → 리더: walking (워커에게 다가감) → chatting → returning → 원래 상태
12. 이동 중 다른 캐릭터 사이를 지나감 → z-index 낮춰서 뒤로 통과
13. 졸고 있는 워커에게 리더가 접근 → 워커 startled → 리더 도착 → chatting
14. 동시 대화 시도 → 먼저 요청한 쪽이 우선, 나머지는 queue에서 대기
15. 대화 타임아웃 → chat_timeout_secs 초과 시 자동 복귀

## 13. 결정 로그

| 날짜 | 결정 | 이유 |
|------|------|------|
| 2026-02-20 | Office 12개 → 마스코트 14개 상태 | 사무실 공간 제거 + 졸기/깨어남/대화 상호작용 추가 |
| 2026-02-20 | `appearing`/`disappearing` 추가 | 등장/퇴장 애니메이션 동안의 중간 상태 필요 |
| 2026-02-20 | `thinking` 상태 추가 | 확장 사고와 도구 실행을 시각적으로 구분 |
| 2026-02-20 | `resting`/`startled` 추가 | idle 에이전트가 졸다가 일 받으면 화들짝 깨어남 |
| 2026-02-20 | `walking`/`chatting`/`returning` 추가 | 에이전트 간 대화 시 다가갔다 돌아오는 상호작용 |
| 2026-02-20 | 다른 캐릭터 사이 이동 시 뒤로 통과 | 앞으로 지나가면 시끄러움, 뒤가 자연스러움 |
| 2026-02-20 | 치명/재시도 키워드를 config에서 로드 | 하드코딩 금지 원칙 |
| 2026-02-20 | synthetic 이벤트로 애니메이션/이동 완료 통지 | WebView 타이밍을 Rust 상태에 동기화 |
