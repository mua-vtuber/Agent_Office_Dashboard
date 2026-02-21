# 드래그 물리 개선 v2 (통합) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** X 경계 튕김, 바닥 X 관성, 실시간 충돌 밀기, 다중 물리 동시 실행을 한 번에 구현한다.

**Architecture:** DragController를 단일 캐릭터 물리(vx/vy/phase)에서 `physicsCharacters: Map<string, PhysicsState>` 기반 다중 물리로 전면 리팩터링. Config에 bounce/collision/push 필드 추가. CharacterManager에 충돌 체크용 API 추가.

**Tech Stack:** Rust (config 검증), TypeScript (PixiJS getBounds AABB, DragController 물리)

**Design Doc:** `docs/plans/2026-02-22-drag-physics-v2-design.md`

---

## Task 1: Config 필드 추가 (Rust)

**Files:**
- Modify: `src-tauri/src/config.rs:82-89` (DragConfig)
- Modify: `src-tauri/src/config.rs:195-203` (validate)
- Modify: `src-tauri/config.toml:45-52`

**Step 1: DragConfig에 3개 필드 추가**

`src-tauri/src/config.rs` DragConfig(line 82-89)에 추가:

```rust
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DragConfig {
    pub poll_interval_ms: u64,
    pub hit_padding_px: i32,
    pub gravity: f64,
    pub friction: f64,
    pub max_throw_speed: f64,
    pub velocity_samples: usize,
    // v2 추가
    pub bounce_factor: f64,
    pub collision_padding: f64,
    pub push_strength: f64,
}
```

**Step 2: validate()에 검증 추가**

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

`src-tauri/config.toml` [drag] 섹션 끝에 추가:

```toml
bounce_factor = 0.5
collision_padding = 5.0
push_strength = 8.0
```

---

## Task 2: Config 필드 추가 (IPC + TypeScript)

**Files:**
- Modify: `src-tauri/src/commands/agents.rs:14-32, 184-202`
- Modify: `apps/webview/src/types/ipc.ts:54-61`

**Step 1: DisplayConfigResponse에 필드 추가**

`src-tauri/src/commands/agents.rs` DisplayConfigResponse(line 31 뒤)에 추가:

```rust
    pub drag_bounce_factor: f64,
    pub drag_collision_padding: f64,
    pub drag_push_strength: f64,
```

get_display_config(line 201 뒤)에 추가:

```rust
        drag_bounce_factor: dr.bounce_factor,
        drag_collision_padding: dr.collision_padding,
        drag_push_strength: dr.push_strength,
```

**Step 2: TypeScript DisplayConfig에 필드 추가**

`apps/webview/src/types/ipc.ts` DisplayConfig(line 60 뒤)에 추가:

```typescript
  drag_bounce_factor: number;
  drag_collision_padding: number;
  drag_push_strength: number;
```

**Step 3: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 4: Commit**

```
feat(drag): add bounce_factor, collision_padding, push_strength config
```

---

## Task 3: CharacterManager API 추가

**Files:**
- Modify: `apps/webview/src/pixi/CharacterManager.ts:249-252`

**Step 1: getAllAgentIds 메서드 추가**

`getCharacter` 메서드(line 249-252) 뒤에 추가:

```typescript
  /** 모든 에이전트 ID 반환. DragController 충돌 체크용. */
  getAllAgentIds(): string[] {
    return [...this.characters.keys()];
  }
```

**Step 2: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 3: Commit**

```
feat(drag): add CharacterManager.getAllAgentIds for collision detection
```

---

## Task 4: DragController 전면 리팩터링

**Files:**
- Replace: `apps/webview/src/pixi/DragController.ts` (전체 교체)

핵심 구조 변경:
- `phase: DragPhase` → `dragPhase: 'idle' | 'dragging'` (드래그만 추적)
- `vx, vy` 단일 → `physicsCharacters: Map<string, PhysicsState>` (다중 물리)
- `startPhysicsTicker/stopPhysicsTicker` → `ensurePhysicsTicker/stopPhysicsTicker`

**Step 1: DragController.ts 전체 교체**

```typescript
import { Ticker } from 'pixi.js';
import type { UnlistenFn } from '@tauri-apps/api/event';
import {
  toggleClickThrough,
  setCursorPolling,
  setHitZones,
  notifyDragDrop,
} from '../tauri/commands';
import { onCursorHover } from '../tauri/events';
import type { CursorHoverPayload, DisplayConfig } from '../types/ipc';
import type { MascotStage } from './MascotStage';
import type { CharacterManager } from './CharacterManager';
import type { SpineCharacter } from './SpineCharacter';

interface VelocitySample {
  dx: number;
  dy: number;
  dt: number;
}

interface PhysicsState {
  character: SpineCharacter;
  vx: number;
  vy: number;
  phase: 'flying' | 'sliding' | 'pushed';
}

/**
 * 캐릭터 드래그 이동을 관리하는 컨트롤러.
 *
 * 동작 흐름:
 * 1. Rust 커서 폴링이 hover 감지 -> click-through 일시 해제
 * 2. pointerdown -> grabbed 애니메이션 + 드래그 시작
 * 3. pointermove -> 캐릭터 추적 + 속도 샘플링 + 실시간 충돌
 * 4. pointerup -> physicsCharacters에 등록 (flying/sliding/즉시착지)
 * 5. ticker -> 다중 물리 시뮬레이션 (관성 + 중력 + 튕김 + 충돌)
 * 6. 착지/정지 -> landing 애니메이션 + 위치 저장 + idle 전환
 *
 * 다중 물리: 여러 캐릭터가 동시에 독립적으로 물리 적용.
 * 날아가는 중에 다른 캐릭터를 잡아 다시 던질 수 있음.
 */
export class DragController {
  private readonly stage: MascotStage;
  private readonly manager: CharacterManager;
  private readonly config: DisplayConfig;

  private unlistenHover: UnlistenFn | null = null;
  private hitZoneInterval: ReturnType<typeof setInterval> | null = null;

  // -- Hover state --
  private hoveredAgentId: string | null = null;

  // -- Drag state (단일: 현재 손으로 잡고 있는 캐릭터) --
  private dragPhase: 'idle' | 'dragging' = 'idle';
  private draggedCharacter: SpineCharacter | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // -- Velocity tracking --
  private velocitySamples: VelocitySample[] = [];
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastPointerTime = 0;

  // -- Physics state (복수: 독립적으로 움직이는 캐릭터들) --
  private readonly physicsCharacters = new Map<string, PhysicsState>();
  private tickerCallback: ((ticker: Ticker) => void) | null = null;
  private hitZoneTickCounter = 0;

  // -- Bound event handlers --
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;

  constructor(
    stage: MascotStage,
    manager: CharacterManager,
    config: DisplayConfig,
  ) {
    this.stage = stage;
    this.manager = manager;
    this.config = config;

    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async enable(): Promise<void> {
    const canvas = this.stage.app.canvas as HTMLCanvasElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);

    await setCursorPolling(true);

    this.sendHitZones();
    this.hitZoneInterval = setInterval(() => this.sendHitZones(), 500);

    this.unlistenHover = await onCursorHover((p) => this.handleCursorHover(p));
  }

  async destroy(): Promise<void> {
    const canvas = this.stage.app.canvas as HTMLCanvasElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);

    if (this.hitZoneInterval) {
      clearInterval(this.hitZoneInterval);
      this.hitZoneInterval = null;
    }

    if (this.unlistenHover) {
      this.unlistenHover();
      this.unlistenHover = null;
    }

    this.stopPhysicsTicker();
    this.physicsCharacters.clear();

    await setCursorPolling(false);
  }

  // ---------------------------------------------------------------------------
  // Hit zones
  // ---------------------------------------------------------------------------

  private sendHitZones(): void {
    const dpr = window.devicePixelRatio;
    const zones = this.manager.getHitZones(dpr);
    void setHitZones(zones);
  }

  // ---------------------------------------------------------------------------
  // Hover handling (from Rust cursor polling)
  // ---------------------------------------------------------------------------

  private handleCursorHover(payload: CursorHoverPayload): void {
    // 드래그 중에만 hover 무시 (이미 잡고 있으니까)
    // 물리 중에는 허용 → 날아가는 캐릭터를 다시 잡을 수 있음
    if (this.dragPhase === 'dragging') return;

    if (payload.hovered_agent_id) {
      if (!this.hoveredAgentId) {
        void toggleClickThrough(false);
      }
      this.hoveredAgentId = payload.hovered_agent_id;
    } else {
      if (this.hoveredAgentId) {
        void toggleClickThrough(true);
        this.hoveredAgentId = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer event handlers
  // ---------------------------------------------------------------------------

  private handlePointerDown(e: PointerEvent): void {
    if (!this.hoveredAgentId) return;

    const character = this.manager.getCharacter(this.hoveredAgentId);
    if (!character) return;

    // 물리 중인 캐릭터를 다시 잡으면 → physicsCharacters에서 제거 (재잡기)
    if (this.physicsCharacters.has(this.hoveredAgentId)) {
      this.physicsCharacters.delete(this.hoveredAgentId);
    }

    this.dragPhase = 'dragging';
    this.draggedCharacter = character;

    // 진행 중인 이동 취소
    this.manager.cancelMovement(character.agentId);

    // 오프셋 계산 (CSS 픽셀)
    this.dragOffsetX = e.clientX - character.container.x;
    this.dragOffsetY = e.clientY - character.container.y;

    // grabbed 애니메이션
    character.startDrag();

    // 속도 샘플 초기화
    this.velocitySamples = [];
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.lastPointerTime = performance.now();

    // 포인터 캡처
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.dragPhase !== 'dragging' || !this.draggedCharacter) return;

    const now = performance.now();
    const dt = now - this.lastPointerTime;

    if (dt > 0) {
      this.velocitySamples.push({
        dx: e.clientX - this.lastPointerX,
        dy: e.clientY - this.lastPointerY,
        dt,
      });
      if (this.velocitySamples.length > this.config.drag_velocity_samples) {
        this.velocitySamples.shift();
      }
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.lastPointerTime = now;

    const newX = clamp(e.clientX - this.dragOffsetX, 0, window.innerWidth);
    const newY = clamp(e.clientY - this.dragOffsetY, 0, this.stage.groundY);

    this.draggedCharacter.container.x = newX;
    this.draggedCharacter.container.y = newY;

    // 실시간 충돌 체크 (드래그 중)
    this.checkCollisions(this.draggedCharacter);
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (this.dragPhase !== 'dragging' || !this.draggedCharacter) return;

    const vel = this.computeReleaseVelocity();
    const character = this.draggedCharacter;
    character.endDrag();

    // click-through 즉시 복원
    void toggleClickThrough(true);
    this.hoveredAgentId = null;

    // drag 상태 초기화
    this.dragPhase = 'idle';
    this.draggedCharacter = null;

    const groundY = this.stage.groundY;

    if (character.container.y < groundY) {
      // 공중 → flying
      character.playFalling();
      this.physicsCharacters.set(character.agentId, {
        character,
        vx: vel.vx,
        vy: vel.vy,
        phase: 'flying',
      });
      this.ensurePhysicsTicker();
    } else if (Math.abs(vel.vx) > 1) {
      // 바닥 + X 관성 → sliding
      character.container.y = groundY;
      this.physicsCharacters.set(character.agentId, {
        character,
        vx: vel.vx,
        vy: 0,
        phase: 'sliding',
      });
      this.ensurePhysicsTicker();
    } else {
      // 바닥 + 정지 → 즉시 착지
      character.container.y = groundY;
      this.handleLanding(character);
    }
  }

  // ---------------------------------------------------------------------------
  // Physics simulation
  // ---------------------------------------------------------------------------

  private ensurePhysicsTicker(): void {
    if (this.tickerCallback) return;

    this.hitZoneTickCounter = 0;
    this.tickerCallback = (ticker: Ticker) => {
      this.tickPhysics(ticker.deltaMS / 1000);
    };
    this.stage.app.ticker.add(this.tickerCallback);
  }

  private stopPhysicsTicker(): void {
    if (this.tickerCallback) {
      this.stage.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }
  }

  private tickPhysics(deltaSec: number): void {
    const groundY = this.stage.groundY;

    // 히트존 갱신 스로틀 (~100ms)
    this.hitZoneTickCounter++;
    if (this.hitZoneTickCounter >= 6) {
      this.hitZoneTickCounter = 0;
      this.sendHitZones();
    }

    const finished: string[] = [];

    for (const [agentId, state] of this.physicsCharacters) {
      if (state.phase === 'flying') {
        state.vy += this.config.drag_gravity * deltaSec;
        state.vx *= this.config.drag_friction;
        state.character.container.x += state.vx * deltaSec;
        state.character.container.y += state.vy * deltaSec;

        this.bounceX(state);
        this.checkCollisions(state.character);

        if (state.character.container.y >= groundY) {
          state.character.container.y = groundY;
          state.character.playLanding();
          state.vy = 0;
          state.phase = 'sliding';
        }
      } else if (state.phase === 'sliding') {
        state.vx *= this.config.drag_friction;
        state.character.container.x += state.vx * deltaSec;

        this.bounceX(state);
        this.checkCollisions(state.character);

        if (Math.abs(state.vx) < 1) {
          state.vx = 0;
          this.handleLanding(state.character, false);
          finished.push(agentId);
        }
      } else if (state.phase === 'pushed') {
        state.vx *= this.config.drag_friction;
        state.character.container.x += state.vx * deltaSec;

        this.bounceX(state);

        if (Math.abs(state.vx) < 1) {
          state.vx = 0;
          this.manager.setCharacterHomeX(agentId, state.character.container.x);
          finished.push(agentId);
        }
      }
    }

    for (const agentId of finished) {
      this.physicsCharacters.delete(agentId);
    }

    if (this.physicsCharacters.size === 0) {
      this.stopPhysicsTicker();
    }
  }

  // ---------------------------------------------------------------------------
  // Wall bounce
  // ---------------------------------------------------------------------------

  /**
   * X 벽 충돌 체크 + 튕김 처리.
   * Spine 바운드 기준으로 화면 밖이면 안쪽으로 보정하고 vx를 반전.
   */
  private bounceX(state: PhysicsState): void {
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
  }

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

      const allIds = this.manager.getAllAgentIds();
      for (const agentId of allIds) {
        const other = this.manager.getCharacter(agentId);
        if (!other) continue;
        if (other === movingCharacter) continue;
        if (other.isDragged) continue;

        // flying/sliding 중인 캐릭터는 밀지 않음 (독립 물리)
        const existingState = this.physicsCharacters.get(agentId);
        if (existingState && existingState.phase !== 'pushed') continue;

        const aBounds = movingCharacter.container.getBounds();
        const bBounds = other.container.getBounds();

        const overlapX = Math.min(aBounds.x + aBounds.width, bBounds.x + bBounds.width)
          - Math.max(aBounds.x, bBounds.x);
        const overlapY = Math.min(aBounds.y + aBounds.height, bBounds.y + bBounds.height)
          - Math.max(aBounds.y, bBounds.y);

        if (overlapX > 0 && overlapY > 0) {
          const direction = other.container.x >= movingCharacter.container.x ? 1 : -1;
          const pushVx = direction * (overlapX + padding) * strength;

          // 즉시 겹침 해소
          other.container.x += direction * (overlapX + padding);

          if (existingState) {
            existingState.vx += pushVx;
          } else {
            this.physicsCharacters.set(agentId, {
              character: other,
              vx: pushVx,
              vy: 0,
              phase: 'pushed',
            });
          }

          anyPush = true;
        }
      }

      if (!anyPush) break;
    }

    if (this.physicsCharacters.size > 0) {
      this.ensurePhysicsTicker();
    }
  }

  // ---------------------------------------------------------------------------
  // Landing
  // ---------------------------------------------------------------------------

  /**
   * 드래그 캐릭터 착지 처리.
   * @param playAnim true면 landing 애니메이션 재생 (즉시 착지용),
   *                 false면 이미 재생됨 (flying→sliding→정지 경로)
   */
  private handleLanding(character: SpineCharacter, playAnim = true): void {
    character.container.y = this.stage.groundY;

    if (playAnim) {
      character.playLanding();
    }

    const finalX = character.container.x;
    this.manager.setCharacterHomeX(character.agentId, finalX);
    void notifyDragDrop(character.agentId, finalX);

    setTimeout(() => {
      if (!character.isDragged) {
        character.transitionTo(character.currentStatus);
      }
    }, 400);

    this.sendHitZones();
  }

  // ---------------------------------------------------------------------------
  // Velocity computation
  // ---------------------------------------------------------------------------

  private computeReleaseVelocity(): { vx: number; vy: number } {
    if (this.velocitySamples.length === 0) {
      return { vx: 0, vy: 0 };
    }

    let totalDx = 0;
    let totalDy = 0;
    let totalDt = 0;
    for (const s of this.velocitySamples) {
      totalDx += s.dx;
      totalDy += s.dy;
      totalDt += s.dt;
    }

    if (totalDt === 0) return { vx: 0, vy: 0 };

    const maxSpeed = this.config.drag_max_throw_speed;
    return {
      vx: clamp((totalDx / totalDt) * 1000, -maxSpeed, maxSpeed),
      vy: clamp((totalDy / totalDt) * 1000, -maxSpeed, maxSpeed),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
```

**Step 2: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 3: Commit**

```
feat(drag): rewrite DragController with multi-physics and collision system
```

---

## Task 5: resolveOverlap 제거

**Files:**
- Modify: `apps/webview/src/pixi/CharacterManager.ts:301-323`

**Step 1: resolveOverlap 메서드 제거**

`CharacterManager.ts`의 `resolveOverlap` 메서드(line 301-323) 삭제.

실시간 충돌이 완전히 대체하므로 더 이상 필요 없음.

**Step 2: TypeScript 빌드 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음. (DragController에서 resolveOverlap 호출이 이미 제거됨)

**Step 3: Commit**

```
refactor(drag): remove resolveOverlap — replaced by real-time collision
```

---

## Task 6: 빌드 검증 + 수동 테스트 체크리스트

**Step 1: 전체 TypeScript 빌드**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 2: 수동 테스트 체크리스트**

다중 물리:
- [ ] 캐릭터 A를 던진 후, 날아가는 동안 캐릭터 B를 잡아서 던질 수 있음
- [ ] A와 B가 독립적으로 물리 적용됨 (동시에 날아감)
- [ ] 날아가는 캐릭터를 다시 잡으면 해당 캐릭터만 드래그로 전환됨
- [ ] 다른 물리 캐릭터들은 계속 움직임

X 경계 튕김:
- [ ] 캐릭터를 왼쪽 벽으로 던지면 튕겨나옴 (반 잘림 없음)
- [ ] 캐릭터를 오른쪽 벽으로 던지면 튕겨나옴
- [ ] 바닥 미끄러짐 중에도 벽 튕김 작동
- [ ] 밀린 캐릭터가 벽에 부딪히면 튕김

바닥 X 관성:
- [ ] 바닥에서 횡으로 빠르게 놓으면 미끄러지다 멈춤
- [ ] 미끄러짐 정지 후 homeX 갱신됨

실시간 충돌:
- [ ] 드래그 중 다른 캐릭터에 밀어넣으면 실시간으로 밀려남
- [ ] 빠르게 던져서 다른 캐릭터에 부딪히면 밀려남 (관성 감속)
- [ ] 밀린 캐릭터가 또 다른 캐릭터를 밀어냄 (연쇄)
- [ ] 밀린 캐릭터 정지 후 homeX 갱신됨
- [ ] flying/sliding 중인 캐릭터끼리는 밀지 않음 (독립 물리)
