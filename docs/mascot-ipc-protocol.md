# Agent Mascot - IPC Protocol Specification

## 1. 목적

Tauri의 Rust 백엔드와 WebView 프론트엔드 간의 통신 프로토콜을 정의한다.
두 가지 통신 방향이 있다:

- **Rust → WebView**: Tauri 이벤트 (`emit`)
- **WebView → Rust**: Tauri 명령 (`invoke`)

## 2. Rust → WebView 이벤트

### 2.1 이벤트 네이밍 규약

모든 이벤트는 `mascot://` 접두사를 사용한다.

### 2.2 이벤트 목록

#### `mascot://agent-appeared`

새로운 에이전트가 등장할 때 emit.

```typescript
type AgentAppearedPayload = {
    agent_id: string;
    display_name: string;
    role: 'manager' | 'worker' | 'specialist' | 'unknown';
    employment_type: 'employee' | 'contractor';
    workspace_id: string;
    status: AgentStatus;
    appearance: AppearanceProfile;
    ts: string;
};
```

#### `mascot://agent-update`

에이전트 상태가 변경될 때 emit.

```typescript
type AgentUpdatePayload = {
    agent_id: string;
    status: AgentStatus;
    prev_status: AgentStatus;
    thinking_text: string | null;
    current_task: string | null;
    workspace_id: string;
    peer_agent_id: string | null;   // 대화 상대 (chatting/walking 시)
    chat_message: string | null;    // 대화 내용 (chatting 시)
    ts: string;
};
```

#### `mascot://agent-departed`

에이전트가 퇴장할 때 (disappearing 완료 후) emit.

```typescript
type AgentDepartedPayload = {
    agent_id: string;
    ts: string;
};
```

#### `mascot://error`

Rust 측에서 비치명적 에러 발생 시 emit.

```typescript
type ErrorPayload = {
    source: string;       // 에러 발생 모듈 (예: "ingest", "state_machine")
    message: string;      // 에러 메시지
    ts: string;
};
```

#### `mascot://open-resume-modal`

시스템 트레이 메뉴에서 "에이전트 이력서" 클릭 시 emit.
페이로드 없음.

#### `mascot://settings-changed`

설정이 변경될 때 emit (트레이 메뉴에서 언어 변경 등).

```typescript
type SettingsChangedPayload = {
    key: string;
    value: unknown;
};
```

### 2.3 AgentStatus 타입

```typescript
type AgentStatus =
    | 'offline'
    | 'appearing'
    | 'idle'
    | 'working'
    | 'thinking'
    | 'pending_input'
    | 'failed'
    | 'completed'
    | 'resting'
    | 'startled'
    | 'walking'
    | 'chatting'
    | 'returning'
    | 'disappearing';
```

### 2.4 AppearanceProfile 타입

```typescript
type AppearanceProfile = {
    body_index: number;
    hair_index: number;
    outfit_index: number;
    accessory_index: number;   // 0 = 없음
    face_index: number;
    hair_hue: number;          // 0.0 ~ 360.0
    outfit_hue: number;        // 0.0 ~ 360.0
    skin_hue: number;          // 0.0 ~ 360.0
    skin_lightness: number;    // config 범위 내
};
```

## 3. WebView → Rust 명령 (invoke)

### 3.1 명령 목록

#### `get_all_agents`

현재 등록된 모든 에이전트와 상태를 반환.

```typescript
// 요청
invoke<MascotAgent[]>('get_all_agents');

// 응답
type MascotAgent = {
    agent_id: string;
    display_name: string;
    role: 'manager' | 'worker' | 'specialist' | 'unknown';
    employment_type: 'employee' | 'contractor';
    workspace_id: string;
    status: AgentStatus;
    thinking_text: string | null;
    current_task: string | null;
    appearance: AppearanceProfile;
    last_active_ts: string;
};
```

#### `get_agent_resume`

특정 에이전트의 상세 이력서 정보를 반환.

```typescript
// 요청
invoke<AgentResume>('get_agent_resume', { agentId: string });

// 응답
type AgentResume = {
    agent: MascotAgent;
    recent_events: ResumeEvent[];   // 최근 이벤트 (config로 개수 제한)
    total_tasks_completed: number;
    total_tools_used: number;
    first_seen_ts: string;
};

type ResumeEvent = {
    type: string;
    summary: string;
    ts: string;
};
```

#### `set_slot_counts`

WebView가 Spine 스켈레톤 로드 후, 스킨 슬롯 개수를 Rust에 전달.

```typescript
// 요청
invoke('set_slot_counts', {
    slotCounts: {
        body: number;
        hair: number;
        outfit: number;
        accessory: number;
        face: number;
    }
});

// 응답: void
```

#### `notify_animation_done`

WebView가 Spine 애니메이션 완료를 Rust에 알림 (synthetic 이벤트).

```typescript
// 요청
invoke('notify_animation_done', {
    agentId: string;
    animation: 'appear' | 'disappear' | 'celebrate' | 'startled';
});

// 응답: void
```

#### `notify_movement_done`

WebView가 캐릭터 이동 완료를 Rust에 알림 (synthetic 이벤트).

```typescript
// 요청
invoke('notify_movement_done', {
    agentId: string;
    movementType: 'arrive_at_peer' | 'arrive_at_home';
});

// 응답: void
```

#### `notify_chat_done`

WebView가 대화 말풍선 표시 완료를 Rust에 알림.

```typescript
// 요청
invoke('notify_chat_done', {
    agentId: string;
});

// 응답: void
```

#### `toggle_click_through`

투명 영역의 클릭 통과를 토글.

```typescript
// 요청
invoke('toggle_click_through', { ignore: boolean });

// 응답: void
```

#### `get_display_config`

화면 배치에 필요한 설정값을 반환.

```typescript
// 요청
invoke<DisplayConfig>('get_display_config');

// 응답
type DisplayConfig = {
    max_bubble_chars: number;
    bubble_fade_ms: number;
    character_spacing_px: number;
    group_spacing_px: number;
    activity_zone_height_px: number;
    taskbar_offset_px: number;
    idle_sway_px: number;
};
```

## 4. 에러 처리

### 4.1 invoke 에러

모든 invoke 명령은 Rust 측에서 `Result<T, AppError>`를 반환한다.
에러 시 Tauri가 자동으로 JS 측에 에러를 throw한다.

WebView 측 래퍼에서 모든 에러를 catch하여 error-store에 push한다:

```typescript
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return await invoke<T>(cmd, args);
    } catch (error) {
        useErrorStore.getState().push({
            source: `invoke:${cmd}`,
            message: String(error),
            ts: new Date().toISOString(),
        });
        throw error;
    }
}
```

### 4.2 이벤트 수신 에러

이벤트 페이로드 파싱 실패 시:
1. 콘솔에 에러 로그
2. error-store에 push
3. 해당 이벤트는 무시 (상태를 오염시키지 않음)

## 5. 초기화 시퀀스

앱 시작 시 WebView와 Rust 간 초기화 순서:

```
1. Tauri 앱 시작
2. Rust: config.toml 로드
3. Rust: SQLite 초기화 + 마이그레이션
4. Rust: axum HTTP 서버 시작
5. Rust: heartbeat 서비스 시작
6. Rust: 시스템 트레이 셋업
7. WebView 로드 시작
8. WebView: Spine 에셋 로드
9. WebView: extractSlotCounts() → invoke('set_slot_counts')
10. WebView: invoke('get_display_config') → 배치 설정 로드
11. WebView: invoke('get_all_agents') → 기존 에이전트 복원
12. WebView: Tauri 이벤트 리스너 등록
13. WebView: 각 에이전트에 대해 SpineCharacter 생성 + 스킨 적용
14. 준비 완료 — 이후 이벤트는 실시간 처리
```

## 6. 결정 로그

| 날짜 | 결정 | 이유 |
|------|------|------|
| 2026-02-20 | WebSocket 대신 Tauri IPC 사용 | 같은 프로세스 내 통신, WebSocket 불필요 |
| 2026-02-20 | `mascot://` 이벤트 접두사 | 다른 이벤트와 충돌 방지 |
| 2026-02-20 | SlotCounts를 WebView→Rust로 전달 | 스킨 개수를 하드코딩하지 않기 위해 |
| 2026-02-20 | synthetic 이벤트로 애니메이션 완료 통지 | Spine 타이밍을 Rust 상태에 정확히 동기화 |
