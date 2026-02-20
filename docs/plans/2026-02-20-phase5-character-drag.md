# Phase 5: 캐릭터 드래그 이동 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 사용자가 마스코트 캐릭터를 마우스로 잡아서 원하는 위치로 드래그할 수 있게 한다.

**Architecture:** click-through 오버레이에서 마우스 이벤트를 받을 수 없으므로, Rust가 Windows API (`GetCursorPos`)로 커서 위치를 폴링하고 WebView에서 보낸 캐릭터 히트존과 비교한다. 커서가 캐릭터 위에 오면 click-through를 일시 해제하여 WebView가 포인터 이벤트를 받을 수 있게 하고, 드래그 처리 후 다시 click-through를 활성화한다.

**Tech Stack:** Rust (windows-sys, tokio), TypeScript (PixiJS v8 pointer events), Tauri v2 IPC/Events

---

## 사전 요구사항

### Spine 에셋 업데이트 (사용자 작업)

Spine Editor에서 `grabbed` 애니메이션을 추가한 후 `apps/webview/public/spine/`에 다시 내보내기한다.

- **애니메이션 이름:** `grabbed` (루프)
- **연출 제안:** 놀란 표정 + 다리 오므린 포즈 (잡혀 올려진 느낌)
- **내보내기 후 파일:** `character.json`, `character.atlas`, `character.png` 교체

---

## Task 1: DragConfig 추가

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/config.toml`

**Step 1: config.rs에 DragConfig 구조체 추가**

```rust
// config.rs — AppConfig 필드 목록 끝에 추가
#[derive(Debug, Deserialize, Clone)]
pub struct DragConfig {
    pub poll_interval_ms: u64,
    pub hit_padding_px: i32,
    pub snap_to_ground: bool,
    pub return_to_home_on_release: bool,
}
```

`AppConfig`에 필드 추가:
```rust
pub struct AppConfig {
    // ... 기존 필드들 ...
    pub drag: DragConfig,
}
```

**Step 2: config.toml에 [drag] 섹션 추가**

```toml
[drag]
poll_interval_ms = 16
hit_padding_px = 10
snap_to_ground = true
return_to_home_on_release = false
```

- `poll_interval_ms = 16` → ~60fps 커서 폴링
- `hit_padding_px = 10` → 히트존을 캐릭터 바운딩박스보다 10px 더 넓게
- `snap_to_ground = true` → 드래그 중에도 Y축은 바닥 고정
- `return_to_home_on_release = false` → 놓은 위치에 유지 (true면 원래 자리로 복귀)

**Step 3: 테스트 실행**

Run: `cargo test -p agent-mascot`
Expected: `test_load_valid_config` 등 기존 테스트가 새 config 필드 포함 확인

**Step 4: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/config.toml
git commit -m "feat(phase5): add DragConfig to config.toml"
```

---

## Task 2: windows-sys 의존성 + get_cursor_pos 커맨드

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands/window.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Cargo.toml에 windows-sys 추가 (Windows 전용)**

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows-sys = { version = "0.59", features = [
    "Win32_UI_WindowsAndMessaging",
    "Win32_Foundation",
] }
```

**Step 2: get_cursor_pos 커맨드 구현**

```rust
// src-tauri/src/commands/window.rs

/// 현재 글로벌 커서 위치를 물리 픽셀 좌표로 반환한다 (Windows 전용).
#[tauri::command]
pub async fn get_cursor_pos() -> Result<(i32, i32), AppError> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut pt = POINT { x: 0, y: 0 };
        let success = unsafe { GetCursorPos(&mut pt) };
        if success == 0 {
            return Err(AppError::Io(std::io::Error::last_os_error()));
        }
        Ok((pt.x, pt.y))
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS 폴백 — 드래그 비활성화
        Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "cursor polling is only supported on Windows",
        )))
    }
}
```

**Step 3: lib.rs에 커맨드 등록**

```rust
// invoke_handler에 추가:
commands::window::get_cursor_pos,
```

**Step 4: 빌드 확인**

Run: `cargo build`
Expected: 컴파일 성공

**Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/window.rs src-tauri/src/lib.rs
git commit -m "feat(phase5): add get_cursor_pos command with windows-sys"
```

---

## Task 3: 커서 폴링 서비스 (Rust → WebView 이벤트)

**Files:**
- Create: `src-tauri/src/services/cursor_poll.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/state.rs`

**Step 1: AppState에 폴링 활성 플래그 추가**

```rust
// state.rs — AppState에 추가
pub cursor_polling_active: Arc<std::sync::atomic::AtomicBool>,
```

초기값은 `AtomicBool::new(false)`.

**Step 2: cursor_poll.rs 서비스 구현**

```rust
// src-tauri/src/services/cursor_poll.rs
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

/// 히트존 정보. WebView에서 set_hit_zones 커맨드로 전달받는다.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HitZone {
    pub agent_id: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// 커서 폴링 루프.
/// poll_interval_ms 간격으로 GetCursorPos를 호출하고,
/// 히트존과 비교하여 hover 상태를 WebView에 알린다.
pub async fn run_cursor_poll(
    app_handle: tauri::AppHandle,
    active: Arc<AtomicBool>,
    poll_interval_ms: u64,
    hit_zones: Arc<std::sync::Mutex<Vec<HitZone>>>,
    hit_padding: i32,
) {
    let interval = tokio::time::Duration::from_millis(poll_interval_ms);
    let mut prev_hovered: Option<String> = None;

    loop {
        if !active.load(Ordering::Relaxed) {
            tokio::time::sleep(interval).await;
            continue;
        }

        let cursor = get_cursor_position();
        let zones = hit_zones.lock().unwrap_or_else(|e| e.into_inner()).clone();

        let mut current_hovered: Option<String> = None;
        for zone in &zones {
            if cursor.0 >= zone.x - hit_padding
                && cursor.0 <= zone.x + zone.width + hit_padding
                && cursor.1 >= zone.y - hit_padding
                && cursor.1 <= zone.y + zone.height + hit_padding
            {
                current_hovered = Some(zone.agent_id.clone());
                break;
            }
        }

        // hover 상태 변경 시에만 이벤트 발송
        if current_hovered != prev_hovered {
            let payload = serde_json::json!({
                "hovered_agent_id": current_hovered,
                "cursor_x": cursor.0,
                "cursor_y": cursor.1,
            });
            let _ = app_handle.emit("mascot://cursor-hover", &payload);
            prev_hovered = current_hovered;
        }

        tokio::time::sleep(interval).await;
    }
}

#[cfg(target_os = "windows")]
fn get_cursor_position() -> (i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut pt) };
    (pt.x, pt.y)
}

#[cfg(not(target_os = "windows"))]
fn get_cursor_position() -> (i32, i32) {
    (0, 0)
}
```

**Step 3: set_cursor_polling + set_hit_zones 커맨드 추가**

```rust
// src-tauri/src/commands/window.rs에 추가

#[tauri::command]
pub async fn set_cursor_polling(
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<(), AppError> {
    state.cursor_polling_active.store(enabled, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn set_hit_zones(
    state: tauri::State<'_, AppState>,
    zones: Vec<crate::services::cursor_poll::HitZone>,
) -> Result<(), AppError> {
    let mut locked = state.hit_zones.lock().map_err(|e| {
        AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    *locked = zones;
    Ok(())
}
```

`AppState`에 `hit_zones: Arc<Mutex<Vec<HitZone>>>` 필드 추가.

**Step 4: lib.rs에서 폴링 서비스 spawn + 커맨드 등록**

heartbeat 서비스 spawn 패턴과 동일하게 `run_cursor_poll`을 spawn한다.
`set_cursor_polling`, `set_hit_zones` 커맨드를 `invoke_handler`에 등록.

**Step 5: 빌드 + 테스트**

Run: `cargo build && cargo test`
Expected: 컴파일 성공, 기존 56개 테스트 통과

**Step 6: Commit**

```bash
git add src-tauri/src/services/cursor_poll.rs src-tauri/src/services/mod.rs \
        src-tauri/src/commands/window.rs src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(phase5): add cursor polling service with hit zone detection"
```

---

## Task 4: notify_drag_drop 커맨드 (위치 저장)

**Files:**
- Modify: `src-tauri/src/commands/agents.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: notify_drag_drop 커맨드 구현**

```rust
// src-tauri/src/commands/agents.rs에 추가

/// 드래그 완료 시 캐릭터의 새 home_x를 DB에 저장한다.
#[tauri::command]
pub async fn notify_drag_drop(
    state: tauri::State<'_, AppState>,
    agent_id: String,
    new_home_x: f64,
) -> Result<(), AppError> {
    let state_repo = StateRepo::new(state.db.clone());
    if let Ok(Some(mut agent_state)) = state_repo.get(&agent_id) {
        agent_state.home_x = new_home_x;
        state_repo.upsert(&agent_state)?;
    }
    Ok(())
}
```

**Step 2: lib.rs에 커맨드 등록**

```rust
commands::agents::notify_drag_drop,
```

**Step 3: 빌드 + 테스트**

Run: `cargo build && cargo test`

**Step 4: Commit**

```bash
git add src-tauri/src/commands/agents.rs src-tauri/src/lib.rs
git commit -m "feat(phase5): add notify_drag_drop command for position persistence"
```

---

## Task 5: IPC 래퍼 + 이벤트 리스너 (WebView)

**Files:**
- Modify: `apps/webview/src/tauri/commands.ts`
- Modify: `apps/webview/src/tauri/events.ts`
- Modify: `apps/webview/src/types/ipc.ts`

**Step 1: IPC 타입 정의**

```typescript
// types/ipc.ts에 추가

export interface HitZone {
  agent_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CursorHoverPayload {
  hovered_agent_id: string | null;
  cursor_x: number;
  cursor_y: number;
}
```

**Step 2: commands.ts에 래퍼 추가**

```typescript
export function setCursorPolling(enabled: boolean): Promise<void> {
  return safeInvoke<void>('set_cursor_polling', { enabled });
}

export function setHitZones(zones: HitZone[]): Promise<void> {
  return safeInvoke<void>('set_hit_zones', { zones });
}

export function notifyDragDrop(agentId: string, newHomeX: number): Promise<void> {
  return safeInvoke<void>('notify_drag_drop', { agentId, newHomeX });
}
```

**Step 3: events.ts에 커서 hover 리스너 추가**

```typescript
export async function onCursorHover(
  cb: EventCallback<CursorHoverPayload>,
): Promise<UnlistenFn> {
  return listen<CursorHoverPayload>('mascot://cursor-hover', (event) => cb(event.payload));
}
```

**Step 4: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add apps/webview/src/tauri/commands.ts apps/webview/src/tauri/events.ts \
        apps/webview/src/types/ipc.ts
git commit -m "feat(phase5): add drag IPC wrappers and cursor-hover event listener"
```

---

## Task 6: SpineCharacter 드래그 메서드

**Files:**
- Modify: `apps/webview/src/pixi/SpineCharacter.ts`
- Modify: `apps/webview/src/pixi/constants.ts`

**Step 1: constants.ts에 grabbed 애니메이션 등록**

```typescript
// LOOPING_ANIMATIONS에 추가
LOOPING_ANIMATIONS.add('grabbed');  // 기존 Set에 add하거나 초기값에 포함

// Z_INDEX에 추가
export const Z_INDEX = {
  BEHIND: -1,
  NORMAL: 0,
  DRAGGED: 10,   // 드래그 중인 캐릭터는 최상위
  BUBBLE: 5,
  LABEL: 3,
} as const;
```

**Step 2: SpineCharacter에 드래그 관련 메서드 추가**

```typescript
// SpineCharacter.ts에 추가

private _isDragged = false;

get isDragged(): boolean {
  return this._isDragged;
}

/** 드래그 시작 — grabbed 애니메이션 재생, zIndex 최상위 */
startDrag(): void {
  this._isDragged = true;
  this._isMoving = false; // 이동 중이었다면 중단
  this.container.zIndex = Z_INDEX.DRAGGED;

  // grabbed 애니메이션이 있으면 재생, 없으면 현재 유지
  const grabAnim = this.spine.skeleton.data.findAnimation('grabbed');
  if (grabAnim) {
    this.spine.state.setAnimation(0, 'grabbed', true);
  }
}

/** 드래그 종료 — 이전 상태 애니메이션 복원, zIndex 정상화 */
endDrag(): void {
  this._isDragged = false;
  this.container.zIndex = Z_INDEX.NORMAL;
  this.transitionTo(this._currentStatus);
}

/**
 * 물리 픽셀 좌표 기준 바운딩 박스 반환.
 * DragController가 Rust에 히트존으로 전달할 때 사용.
 */
getPhysicalBounds(dpr: number): { x: number; y: number; width: number; height: number } {
  const b = this.container.getBounds();
  return {
    x: Math.round(b.x * dpr),
    y: Math.round(b.y * dpr),
    width: Math.round(b.width * dpr),
    height: Math.round(b.height * dpr),
  };
}
```

**Step 3: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add apps/webview/src/pixi/SpineCharacter.ts apps/webview/src/pixi/constants.ts
git commit -m "feat(phase5): add drag methods and grabbed animation to SpineCharacter"
```

---

## Task 7: CharacterManager 드래그 지원

**Files:**
- Modify: `apps/webview/src/pixi/CharacterManager.ts`

**Step 1: 퍼블릭 메서드 추가**

```typescript
/**
 * 모든 캐릭터의 히트존을 물리 픽셀 좌표로 반환.
 * DragController가 Rust에 전달할 때 사용.
 */
getHitZones(dpr: number): Array<{ agent_id: string; x: number; y: number; width: number; height: number }> {
  const zones: Array<{ agent_id: string; x: number; y: number; width: number; height: number }> = [];
  for (const [agentId, entry] of this.characters) {
    const bounds = entry.character.getPhysicalBounds(dpr);
    zones.push({ agent_id: agentId, ...bounds });
  }
  return zones;
}

/**
 * 특정 캐릭터의 진행 중인 이동을 취소한다.
 * 드래그 시작 시 walking/returning 중이면 중단해야 한다.
 */
cancelMovement(agentId: string): void {
  this.movingAgents.delete(agentId);

  if (this.movingAgents.size === 0 && this.tickerCallback) {
    this.stage.app.ticker.remove(this.tickerCallback);
    this.tickerCallback = null;
  }
}

/**
 * 캐릭터의 homeX를 업데이트한다.
 * 드래그 드롭 후 새 위치를 반영할 때 사용.
 */
setCharacterHomeX(agentId: string, newX: number): void {
  const entry = this.characters.get(agentId);
  if (!entry) return;
  entry.character.homeX = newX;
}
```

**Step 2: recalculatePositions에서 드래그 중인 캐릭터 제외**

`recalculatePositions()` 내부에서 `entry.character.isDragged`인 캐릭터는 위치를 변경하지 않도록 가드:

```typescript
// recalculatePositions() 내 루프에서:
if (!entry.character.isDragged) {
  entry.character.homeX = charX;
  entry.character.container.y = groundY;
}

// 버블도 드래그 중이면 캐릭터 실제 위치 기준:
entry.bubble.container.x = entry.character.isDragged
  ? entry.character.container.x
  : charX;
```

**Step 3: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add apps/webview/src/pixi/CharacterManager.ts
git commit -m "feat(phase5): add drag support methods to CharacterManager"
```

---

## Task 8: DragController 구현

**Files:**
- Create: `apps/webview/src/pixi/DragController.ts`
- Modify: `apps/webview/src/pixi/index.ts`

**Step 1: DragController 클래스 작성**

```typescript
// apps/webview/src/pixi/DragController.ts

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  toggleClickThrough,
  setCursorPolling,
  setHitZones,
  notifyDragDrop,
} from '../tauri/commands';
import type { CursorHoverPayload, HitZone, DisplayConfig } from '../types/ipc';
import { MascotStage } from './MascotStage';
import { CharacterManager } from './CharacterManager';
import { SpineCharacter } from './SpineCharacter';

/**
 * 캐릭터 드래그 이동을 관리하는 컨트롤러.
 *
 * 동작 흐름:
 * 1. enable() 호출 → 커서 폴링 시작 + 히트존 전송
 * 2. Rust가 커서-히트존 비교 → mascot://cursor-hover 이벤트 발송
 * 3. hover 감지 → click-through 일시 해제
 * 4. 사용자 pointerdown → 드래그 시작 (grabbed 애니메이션)
 * 5. pointermove → 캐릭터 이동
 * 6. pointerup → 드래그 종료 → 위치 저장 → click-through 복원
 */
export class DragController {
  private readonly stage: MascotStage;
  private readonly manager: CharacterManager;
  private readonly displayConfig: DisplayConfig;

  private unlistenHover: UnlistenFn | null = null;
  private hitZoneInterval: ReturnType<typeof setInterval> | null = null;

  /** 현재 hover 중인 캐릭터 */
  private hoveredCharacter: SpineCharacter | null = null;
  /** 현재 드래그 중인 캐릭터 */
  private draggedCharacter: SpineCharacter | null = null;
  /** 드래그 시작 시 커서-캐릭터 오프셋 */
  private dragOffsetX = 0;

  /** 바인딩된 이벤트 핸들러 참조 (제거용) */
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;

  private snapToGround: boolean;
  private returnToHome: boolean;

  constructor(
    stage: MascotStage,
    manager: CharacterManager,
    displayConfig: DisplayConfig,
    options: { snapToGround: boolean; returnToHome: boolean },
  ) {
    this.stage = stage;
    this.manager = manager;
    this.displayConfig = displayConfig;
    this.snapToGround = options.snapToGround;
    this.returnToHome = options.returnToHome;

    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
  }

  /**
   * 드래그 시스템 활성화.
   * 커서 폴링 시작 + 히트존 주기적 전송 + hover 이벤트 구독.
   */
  async enable(): Promise<void> {
    // 1. 캔버스에 포인터 이벤트 리스너 등록
    const canvas = this.stage.app.canvas as HTMLCanvasElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);

    // 2. Rust 커서 폴링 시작
    await setCursorPolling(true);

    // 3. 히트존 주기적 전송 (500ms마다 — 캐릭터 이동에 따라 갱신)
    this.sendHitZones();
    this.hitZoneInterval = setInterval(() => this.sendHitZones(), 500);

    // 4. hover 이벤트 구독
    this.unlistenHover = await listen<CursorHoverPayload>(
      'mascot://cursor-hover',
      (event) => this.handleCursorHover(event.payload),
    );
  }

  /** 히트존을 Rust에 전송 */
  private sendHitZones(): void {
    const dpr = window.devicePixelRatio;
    const zones = this.manager.getHitZones(dpr);
    void setHitZones(zones);
  }

  /** Rust에서 hover 상태 변경 알림 수신 */
  private handleCursorHover(payload: CursorHoverPayload): void {
    // 드래그 중이면 무시 (이미 click-through 해제 상태)
    if (this.draggedCharacter) return;

    if (payload.hovered_agent_id) {
      // 캐릭터 위에 커서 → click-through 해제
      if (!this.hoveredCharacter) {
        void toggleClickThrough(false);
      }
      this.hoveredCharacter = this.findCharacter(payload.hovered_agent_id);
    } else {
      // 캐릭터 밖으로 커서 이탈 → click-through 복원
      if (this.hoveredCharacter) {
        void toggleClickThrough(true);
        this.hoveredCharacter = null;
      }
    }
  }

  /** pointerdown: 드래그 시작 */
  private handlePointerDown(e: PointerEvent): void {
    if (!this.hoveredCharacter) return;

    const character = this.hoveredCharacter;
    this.draggedCharacter = character;

    // 진행 중인 이동 취소
    this.manager.cancelMovement(character.agentId);

    // 드래그 오프셋 계산 (CSS 픽셀)
    this.dragOffsetX = e.clientX - character.container.x;

    // grabbed 애니메이션 시작
    character.startDrag();

    // 포인터 캡처
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  /** pointermove: 드래그 중 캐릭터 이동 */
  private handlePointerMove(e: PointerEvent): void {
    if (!this.draggedCharacter) return;

    const newX = e.clientX - this.dragOffsetX;
    this.draggedCharacter.container.x = newX;

    if (!this.snapToGround) {
      this.draggedCharacter.container.y = e.clientY;
    }

    // 버블도 따라가도록 — CharacterManager에서 처리할 수도 있지만
    // 여기서 직접 처리 (실시간 반응 필요)
  }

  /** pointerup: 드래그 종료 */
  private handlePointerUp(_e: PointerEvent): void {
    if (!this.draggedCharacter) return;

    const character = this.draggedCharacter;
    const droppedX = character.container.x;

    // grabbed 애니메이션 종료, 이전 상태 복원
    character.endDrag();

    if (this.returnToHome) {
      // 원래 자리로 복귀
      character.container.x = character.homeX;
    } else {
      // 놓은 위치를 새 homeX로 저장
      this.manager.setCharacterHomeX(character.agentId, droppedX);
      void notifyDragDrop(character.agentId, droppedX);
    }

    // Y 위치 바닥으로 복원 (snap_to_ground)
    if (this.snapToGround) {
      character.container.y = this.stage.groundY;
    }

    this.draggedCharacter = null;

    // click-through 복원
    void toggleClickThrough(true);
    this.hoveredCharacter = null;

    // 히트존 즉시 갱신
    this.sendHitZones();
  }

  /** agentId로 SpineCharacter 찾기 */
  private findCharacter(agentId: string): SpineCharacter | null {
    // CharacterManager에 getCharacter 메서드 필요
    // Task 7에서 추가됨
    const zones = this.manager.getHitZones(1); // 내부 조회용
    // 실제로는 CharacterManager에 getCharacter(agentId) 메서드를 추가해야 함
    return null; // placeholder — Task 7에서 getCharacter 메서드 추가 후 연결
  }

  /** 드래그 시스템 비활성화 및 정리 */
  async destroy(): Promise<void> {
    // 포인터 이벤트 해제
    const canvas = this.stage.app.canvas as HTMLCanvasElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);

    // 히트존 전송 중단
    if (this.hitZoneInterval) {
      clearInterval(this.hitZoneInterval);
      this.hitZoneInterval = null;
    }

    // hover 이벤트 구독 해제
    if (this.unlistenHover) {
      this.unlistenHover();
      this.unlistenHover = null;
    }

    // 커서 폴링 중단
    await setCursorPolling(false);
  }
}
```

참고: `findCharacter` 메서드는 `CharacterManager`에 `getCharacter(agentId): SpineCharacter | null` 퍼블릭 메서드가 필요하다. Task 7에서 이미 추가되지만, 여기서도 명시적으로 연결해야 한다.

**Step 2: CharacterManager에 getCharacter 메서드 추가**

```typescript
// CharacterManager.ts에 추가
getCharacter(agentId: string): SpineCharacter | null {
  const entry = this.characters.get(agentId);
  return entry?.character ?? null;
}
```

**Step 3: DragController.findCharacter 연결**

```typescript
private findCharacter(agentId: string): SpineCharacter | null {
  return this.manager.getCharacter(agentId);
}
```

**Step 4: index.ts에 export 추가**

```typescript
export { DragController } from './DragController';
```

**Step 5: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add apps/webview/src/pixi/DragController.ts apps/webview/src/pixi/index.ts \
        apps/webview/src/pixi/CharacterManager.ts
git commit -m "feat(phase5): implement DragController with hover detection and drag loop"
```

---

## Task 9: App.tsx 통합

**Files:**
- Modify: `apps/webview/src/App.tsx`

**Step 1: DragController 임포트 및 초기화**

```typescript
import { MascotStage, CharacterManager, DragController } from './pixi';

// refs 추가
const dragRef = useRef<DragController | null>(null);
```

초기화 함수 내, click-through 설정 후:

```typescript
// 4. 클릭 통과 활성화
await toggleClickThrough(true);
if (destroyed) return [];

// 5. 드래그 컨트롤러 초기화
const dragController = new DragController(stage, manager, displayConfig, {
  snapToGround: true,       // TODO: config에서 읽어오기 (DragConfig IPC 추가 필요)
  returnToHome: false,
});
await dragController.enable();
if (destroyed) {
  await dragController.destroy();
  return [];
}
dragRef.current = dragController;
```

**Step 2: 클린업에 DragController.destroy() 추가**

```typescript
return () => {
  destroyed = true;

  // DragController 정리
  if (dragRef.current) {
    void dragRef.current.destroy();
    dragRef.current = null;
  }

  // CharacterManager 정리 ...
  // MascotStage 정리 ...
};
```

**Step 3: DragConfig를 Rust에서 받아오도록 개선 (선택)**

`get_display_config` 커맨드의 응답에 `DragConfig`을 포함하거나, 별도 `get_drag_config` 커맨드를 추가한다. 이는 "no hardcoding" 원칙을 따르기 위함.

**Step 4: TypeScript 빌드 + Rust 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Run: `cargo build`

**Step 5: Commit**

```bash
git add apps/webview/src/App.tsx
git commit -m "feat(phase5): integrate DragController into App initialization"
```

---

## Task 10: 수동 테스트

**Step 1: 앱 실행**

```powershell
cd F:\hayoung\git\Agent_Office_Dashboard
pnpm dev
```

**Step 2: 에이전트 생성**

```powershell
Invoke-RestMethod -Uri http://localhost:4820/ingest -Method POST -ContentType "application/json" -Body '{"hook_type":"PreToolUse","session_id":"drag-test","tool_name":"Write","input":{"file_path":"/tmp/test.ts"}}'
```

**Step 3: 드래그 테스트 체크리스트**

- [ ] 캐릭터 위에 커서 올리면 커서 모양이 바뀌거나 반응 (click-through 해제 확인)
- [ ] 캐릭터를 클릭하면 grabbed 애니메이션 재생 (또는 Spine에 없으면 기존 유지)
- [ ] 마우스를 움직이면 캐릭터가 따라옴
- [ ] Y축은 바닥에 고정 (snap_to_ground = true)
- [ ] 마우스를 놓으면 캐릭터가 놓은 위치에 유지
- [ ] 드래그 후 다시 클릭 통과가 정상 작동
- [ ] 캐릭터 밖 영역은 클릭이 통과됨
- [ ] 앱 재시작 후 이전에 드롭한 위치가 유지됨 (home_x DB 저장)

**Step 4: 확인 후 최종 커밋**

```bash
git add -A
git commit -m "feat(phase5): character drag complete — manual test passed"
```

---

## 아키텍처 요약

```
┌──────────────────────────────────────────────────────────┐
│ Rust (Tauri Backend)                                     │
│                                                          │
│  cursor_poll service ──(16ms)──> GetCursorPos            │
│       │                          vs HitZones             │
│       └─── hover 변경 시 ──> emit "mascot://cursor-hover"│
│                                                          │
│  set_hit_zones  ◄── WebView가 500ms마다 히트존 전송      │
│  toggle_click_through ◄── hover/drag 상태에 따라 토글    │
│  notify_drag_drop ◄── 드롭 시 새 home_x 저장            │
└──────────────────────────────────────────────────────────┘
                          │ IPC / Events
┌──────────────────────────────────────────────────────────┐
│ WebView (PixiJS + React)                                 │
│                                                          │
│  DragController                                          │
│    ├── onCursorHover → toggleClickThrough(false/true)    │
│    ├── pointerdown → startDrag() + grabbed 애니메이션    │
│    ├── pointermove → 캐릭터 위치 업데이트                │
│    └── pointerup → endDrag() + notifyDragDrop()          │
│                                                          │
│  CharacterManager                                        │
│    ├── getHitZones() → 히트존 데이터 생성                │
│    ├── cancelMovement() → 이동 중단                      │
│    └── setCharacterHomeX() → 새 위치 반영                │
└──────────────────────────────────────────────────────────┘
```

## 주의사항

1. **좌표계 변환**: GetCursorPos는 물리 픽셀, PixiJS는 CSS 픽셀. `devicePixelRatio`로 변환 필요.
2. **recalculatePositions 가드**: 드래그된 캐릭터는 자동 레이아웃에서 제외해야 한다.
3. **이동 중 드래그**: walking/returning 중인 캐릭터도 드래그 가능해야 한다. `cancelMovement` 호출 필수.
4. **성능**: 히트존 전송 (500ms) + 커서 폴링 (16ms)은 가벼운 IPC. 프레임 드롭 주의 불필요.
5. **grabbed 애니메이션 없을 때**: `findAnimation('grabbed')`가 null이면 현재 애니메이션 유지. 앱이 크래시하지 않도록 안전하게 처리되어 있다.
