# 드래그 물리 개선 v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** X 경계 튕김, 바닥 X 관성, 실시간 Spine 바운드 충돌 밀기를 구현한다.

**Architecture:** DragConfig에 bounce_factor/collision_padding/push_strength를 추가하고, DragController의 물리 계산을 개선한다. 실시간 충돌은 getBounds() 기반 AABB로 매 프레임 체크하며, 밀린 캐릭터는 관성(vx + friction)으로 자연 감속한다.

**Tech Stack:** Rust (config), TypeScript (PixiJS getBounds, DragController)

**Design Doc:** `docs/plans/2026-02-22-drag-physics-v2-design.md`

---

## Task 1: Config 필드 추가 (Rust + TypeScript)

**Files:**
- Modify: `src-tauri/src/config.rs:82-89`
- Modify: `src-tauri/config.toml:45-50`
- Modify: `src-tauri/src/commands/agents.rs:14-32, 184-201`
- Modify: `apps/webview/src/types/ipc.ts:43-61`

**Step 1: config.rs DragConfig에 3개 필드 추가**

`src-tauri/src/config.rs`의 DragConfig(line 82-89)에 추가:

```rust
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DragConfig {
    pub poll_interval_ms: u64,
    pub hit_padding_px: i32,
    pub gravity: f64,
    pub friction: f64,
    pub max_throw_speed: f64,
    pub velocity_samples: usize,
    pub bounce_factor: f64,
    pub collision_padding: f64,
    pub push_strength: f64,
}
```

**Step 2: config.rs validate()에 검증 추가**

`velocity_samples` 검증(line 195-201) 뒤, `Ok(())` 앞에 추가:

```rust
if self.drag.bounce_factor < 0.0 || self.drag.bounce_factor > 1.0 {
    return Err(ConfigError::Validation {
        field: "drag.bounce_factor".into(),
        reason: "must be in range [0.0, 1.0]".into(),
    }
    .into());
}

if self.drag.push_strength <= 0.0 {
    return Err(ConfigError::Validation {
        field: "drag.push_strength".into(),
        reason: "must be > 0".into(),
    }
    .into());
}
```

**Step 3: config.toml에 값 추가**

`src-tauri/config.toml`의 [drag] 섹션 끝에 추가:

```toml
bounce_factor = 0.5
collision_padding = 5.0
push_strength = 8.0
```

**Step 4: DisplayConfigResponse에 필드 추가**

`src-tauri/src/commands/agents.rs`의 DisplayConfigResponse(line 31) 뒤에 추가:

```rust
    pub drag_bounce_factor: f64,
    pub drag_collision_padding: f64,
    pub drag_push_strength: f64,
```

get_display_config(line 199) 뒤에 추가:

```rust
        drag_bounce_factor: dr.bounce_factor,
        drag_collision_padding: dr.collision_padding,
        drag_push_strength: dr.push_strength,
```

**Step 5: TypeScript DisplayConfig에 필드 추가**

`apps/webview/src/types/ipc.ts`의 DisplayConfig(line 60) 뒤에 추가:

```typescript
  drag_bounce_factor: number;
  drag_collision_padding: number;
  drag_push_strength: number;
```

**Step 6: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 7: Commit**

```
feat(drag): add bounce_factor, collision_padding, push_strength config
```

---

## Task 2: X 경계 튕김 구현

**Files:**
- Modify: `apps/webview/src/pixi/DragController.ts:301-317, 326-338`

**Step 1: bounceX 헬퍼 메서드 추가**

DragController 클래스에 `computeReleaseVelocity` 메서드(line 390) 앞에 추가:

```typescript
  // ---------------------------------------------------------------------------
  // Wall bounce
  // ---------------------------------------------------------------------------

  /**
   * X 벽 충돌 체크 + 튕김 처리.
   * Spine 바운드 기준으로 화면 밖이면 안쪽으로 보정하고 vx를 반전.
   */
  private bounceX(character: SpineCharacter): void {
    const bounds = character.container.getBounds();
    const screenW = window.innerWidth;
    const bounce = this.config.drag_bounce_factor;

    if (bounds.x < 0) {
      // 왼쪽 벽 — 바운드 왼쪽이 화면 밖
      character.container.x -= bounds.x; // 안쪽으로 보정
      this.vx = Math.abs(this.vx) * bounce;
    } else if (bounds.x + bounds.width > screenW) {
      // 오른쪽 벽 — 바운드 오른쪽이 화면 밖
      character.container.x -= (bounds.x + bounds.width - screenW);
      this.vx = -Math.abs(this.vx) * bounce;
    }
  }
```

**Step 2: flying의 X 경계 처리를 bounceX로 교체**

`tickPhysics`의 flying 블록(line 310-317)에서 기존 X 경계 코드:

```typescript
      // X 화면 경계
      if (character.container.x <= 0) {
        character.container.x = 0;
        this.vx = 0;
      } else if (character.container.x >= window.innerWidth) {
        character.container.x = window.innerWidth;
        this.vx = 0;
      }
```

변경:

```typescript
      // X 벽 튕김
      this.bounceX(character);
```

**Step 3: sliding의 X 경계 처리도 bounceX로 교체**

`tickPhysics`의 sliding 블록(line 332-338)에서 동일한 X 경계 코드를 교체:

```typescript
      // X 벽 튕김
      this.bounceX(character);
```

**Step 4: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 5: Commit**

```
feat(drag): add wall bounce with Spine bounds detection
```

---

## Task 3: 바닥 X 관성 (sliding)

**Files:**
- Modify: `apps/webview/src/pixi/DragController.ts:249-253`

**Step 1: handlePointerUp 바닥 분기 수정**

기존(line 249-253):

```typescript
    // 바닥에 있으면 바로 착지 처리
    if (character.container.y >= this.stage.groundY) {
      this.handleLanding(character);
      return;
    }
```

변경:

```typescript
    // 바닥에 있는 경우
    if (character.container.y >= this.stage.groundY) {
      character.container.y = this.stage.groundY;
      if (Math.abs(this.vx) > 1) {
        // X 관성이 있으면 바닥 미끄러짐
        this.phase = 'sliding';
        this.startPhysicsTicker();
        return;
      }
      this.handleLanding(character);
      return;
    }
```

**Step 2: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 3: Commit**

```
feat(drag): add ground sliding when released with horizontal velocity
```

---

## Task 4: 실시간 충돌 밀기 — pushed 캐릭터 상태

**Files:**
- Modify: `apps/webview/src/pixi/DragController.ts`

**Step 1: pushed 캐릭터 상태 필드 추가**

DragController 클래스의 `private tickerCallback` 선언(line 59) 뒤에 추가:

```typescript
  // -- Pushed characters (충돌로 밀린 캐릭터들) --
  private readonly pushedCharacters = new Map<string, { character: SpineCharacter; vx: number }>();
```

**Step 2: tickPushedCharacters 메서드 추가**

`bounceX` 메서드 뒤에 추가:

```typescript
  // ---------------------------------------------------------------------------
  // Pushed characters physics
  // ---------------------------------------------------------------------------

  /**
   * 밀린 캐릭터들의 관성 이동 처리.
   * 매 프레임 vx *= friction, |vx| < 1이면 정지.
   */
  private tickPushedCharacters(deltaSec: number): void {
    const stopped: string[] = [];

    for (const [agentId, state] of this.pushedCharacters) {
      state.vx *= this.config.drag_friction;
      state.character.container.x += state.vx * deltaSec;

      // 벽 튕김 (pushed용 — vx를 state에 반영)
      const bounds = state.character.container.getBounds();
      const screenW = window.innerWidth;
      const bounce = this.config.drag_bounce_factor;

      if (bounds.x < 0) {
        state.character.container.x -= bounds.x;
        state.vx = Math.abs(state.vx) * bounce;
      } else if (bounds.x + bounds.width > screenW) {
        state.character.container.x -= (bounds.x + bounds.width - screenW);
        state.vx = -Math.abs(state.vx) * bounce;
      }

      if (Math.abs(state.vx) < 1) {
        state.vx = 0;
        stopped.push(agentId);
      }
    }

    for (const agentId of stopped) {
      const state = this.pushedCharacters.get(agentId);
      if (state) {
        this.manager.setCharacterHomeX(agentId, state.character.container.x);
      }
      this.pushedCharacters.delete(agentId);
    }
  }
```

**Step 3: tickPhysics에서 tickPushedCharacters 호출**

`tickPhysics`의 히트존 갱신 블록(line 298-299) 뒤에 추가:

```typescript
    // 밀린 캐릭터들 관성 이동
    this.tickPushedCharacters(deltaSec);
```

**Step 4: destroy에서 pushed 정리**

`destroy()` 메서드의 `await setCursorPolling(false)` 앞에 추가:

```typescript
    this.pushedCharacters.clear();
```

**Step 5: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 6: Commit**

```
feat(drag): add pushed character physics with friction decay
```

---

## Task 5: 실시간 충돌 감지 + 밀기

**Files:**
- Modify: `apps/webview/src/pixi/DragController.ts`
- Modify: `apps/webview/src/pixi/CharacterManager.ts`

**Step 1: checkCollisions 메서드 추가**

DragController의 `tickPushedCharacters` 메서드 뒤에 추가:

```typescript
  // ---------------------------------------------------------------------------
  // Collision detection
  // ---------------------------------------------------------------------------

  /**
   * 이동 중인 캐릭터와 다른 캐릭터의 AABB 겹침을 체크하고 밀기 처리.
   * 연쇄 충돌은 한 프레임 최대 2회 반복.
   */
  private checkCollisions(movingCharacter: SpineCharacter): void {
    const padding = this.config.drag_collision_padding;
    const strength = this.config.drag_push_strength;

    for (let pass = 0; pass < 2; pass++) {
      let anyPush = false;

      const allCharacters = this.manager.getAllCharacterEntries();
      for (const [agentId, entry] of allCharacters) {
        if (entry.character === movingCharacter) continue;
        if (entry.character.isDragged) continue;

        const aBounds = movingCharacter.container.getBounds();
        const bBounds = entry.character.container.getBounds();

        // AABB 겹침 체크
        const overlapX = Math.min(aBounds.x + aBounds.width, bBounds.x + bBounds.width)
          - Math.max(aBounds.x, bBounds.x);
        const overlapY = Math.min(aBounds.y + aBounds.height, bBounds.y + bBounds.height)
          - Math.max(aBounds.y, bBounds.y);

        if (overlapX > 0 && overlapY > 0) {
          // 밀기 방향: 이동 캐릭터 기준 반대편
          const direction = entry.character.container.x >= movingCharacter.container.x ? 1 : -1;
          const pushVx = direction * (overlapX + padding) * strength;

          // 이미 밀리고 있으면 속도 누적, 아니면 새로 등록
          const existing = this.pushedCharacters.get(agentId);
          if (existing) {
            existing.vx += pushVx;
          } else {
            this.pushedCharacters.set(agentId, {
              character: entry.character,
              vx: pushVx,
            });
          }

          // 즉시 겹침 해소 (최소 이동)
          entry.character.container.x += direction * (overlapX + padding);
          anyPush = true;
        }
      }

      // 연쇄 충돌이 없으면 중단
      if (!anyPush) break;
    }

    // pushed 캐릭터가 있고 ticker가 없으면 시작
    if (this.pushedCharacters.size > 0 && !this.tickerCallback) {
      this.startPhysicsTicker();
    }
  }
```

**Step 2: CharacterManager에 getAllCharacterEntries 메서드 추가**

`apps/webview/src/pixi/CharacterManager.ts`의 `getCharacter` 메서드(line 249-252) 뒤에 추가:

```typescript
  /** 모든 캐릭터 엔트리 반환. DragController 충돌 체크용. */
  getAllCharacterEntries(): ReadonlyMap<string, { character: SpineCharacter; bubble: SpeechBubble; workspaceId: string }> {
    return this.characters;
  }
```

CharacterManager 파일 상단 import에 `SpeechBubble`은 이미 있음. 타입 노출을 위해 `CharacterEntry` 인터페이스를 export하거나 인라인 타입을 사용. 기존 `CharacterEntry`는 private이므로 인라인 타입 사용.

**Step 3: handlePointerMove에서 충돌 체크 호출**

`handlePointerMove`의 캐릭터 위치 업데이트(line 230-231) 뒤에 추가:

```typescript
    // 실시간 충돌 체크
    this.checkCollisions(this.draggedCharacter);
```

**Step 4: tickPhysics의 flying/sliding에서 충돌 체크 호출**

flying 블록의 `this.bounceX(character)` 뒤에 추가:

```typescript
      this.checkCollisions(character);
```

sliding 블록의 `this.bounceX(character)` 뒤에도 동일 추가:

```typescript
      this.checkCollisions(character);
```

**Step 5: CharacterManager의 resolveOverlap 호출 제거**

DragController의 `handleLanding`에서 기존 호출(line 363) 제거:

```typescript
    // 겹침 해소
    this.manager.resolveOverlap(character.agentId);
```

→ 제거. 실시간 충돌이 대체.

**Step 6: tickPhysics에서 pushed만 남았을 때도 ticker 유지**

현재 `tickPhysics` 시작 부분(line 286-290)에서 `draggedCharacter`가 null이면 ticker를 중단하는데, pushed 캐릭터가 남아있을 수 있음.

기존:

```typescript
    const character = this.draggedCharacter;
    if (!character) {
      this.stopPhysicsTicker();
      return;
    }
```

변경:

```typescript
    const character = this.draggedCharacter;
    if (!character && this.pushedCharacters.size === 0) {
      this.stopPhysicsTicker();
      return;
    }

    // pushed 캐릭터 관성 이동 (draggedCharacter 없어도 실행)
    this.tickPushedCharacters(deltaSec);

    if (!character) return;
```

그리고 기존 `this.tickPushedCharacters(deltaSec)` 호출은 제거 (위로 이동했으므로).

**Step 7: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 8: Commit**

```
feat(drag): add real-time Spine bounds collision with push physics
```

---

## Task 6: 통합 빌드 + 수동 테스트

**Step 1: 전체 빌드**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 2: 수동 테스트 체크리스트**

- [ ] 캐릭터를 공중에서 옆벽으로 던지면 튕겨나옴 (반 잘림 없음)
- [ ] 바닥에서 횡으로 빠르게 놓으면 미끄러지다 멈춤
- [ ] 드래그 중 다른 캐릭터에 밀어넣으면 실시간으로 밀려남
- [ ] 빠르게 던져서 다른 캐릭터에 부딪히면 밀려남 (관성으로 감속)
- [ ] 밀린 캐릭터가 또 다른 캐릭터를 밀어냄 (연쇄)
- [ ] 밀린 캐릭터가 벽에 부딪히면 튕김
- [ ] 밀린 캐릭터 정지 후 homeX가 갱신됨

**Step 3: 최종 커밋**

```
feat(drag): drag physics v2 — bounce, sliding, real-time collision
```
