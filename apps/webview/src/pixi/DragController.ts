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

type DragPhase = 'idle' | 'dragging' | 'flying' | 'sliding';

/**
 * 캐릭터 드래그 이동을 관리하는 컨트롤러.
 *
 * 동작 흐름:
 * 1. Rust 커서 폴링이 hover 감지 -> click-through 일시 해제
 * 2. pointerdown -> grabbed 애니메이션 + 드래그 시작
 * 3. pointermove -> 캐릭터 추적 + 속도 샘플링
 * 4. pointerup -> 물리 시뮬레이션 (관성 + 중력)
 * 5. 착지 -> landing 애니메이션 + 겹침 해소 + 위치 저장
 */
export class DragController {
  private readonly stage: MascotStage;
  private readonly manager: CharacterManager;
  private readonly config: DisplayConfig;

  private unlistenHover: UnlistenFn | null = null;
  private hitZoneInterval: ReturnType<typeof setInterval> | null = null;

  // -- Hover state --
  private hoveredAgentId: string | null = null;

  // -- Drag state --
  private phase: DragPhase = 'idle';
  private draggedCharacter: SpineCharacter | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // -- Velocity tracking --
  private velocitySamples: VelocitySample[] = [];
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastPointerTime = 0;

  // -- Physics state --
  private vx = 0;
  private vy = 0;
  private tickerCallback: ((ticker: Ticker) => void) | null = null;

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

    if (this.tickerCallback) {
      this.stage.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }

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
    // flying/sliding 중에는 허용 → 날아가는 캐릭터를 다시 잡을 수 있음
    if (this.phase === 'dragging') return;

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

    // 물리 시뮬레이션 중이면 즉시 중단
    if (this.phase === 'flying' || this.phase === 'sliding') {
      this.stopPhysicsTicker();
      this.vx = 0;
      this.vy = 0;
      // 이전 draggedCharacter와 다른 캐릭터를 잡으면 이전 것을 착지시킴
      if (this.draggedCharacter && this.draggedCharacter !== character) {
        this.draggedCharacter.container.y = this.stage.groundY;
        this.manager.setCharacterHomeX(
          this.draggedCharacter.agentId,
          this.draggedCharacter.container.x,
        );
        this.draggedCharacter.transitionTo(this.draggedCharacter.currentStatus);
      }
    }

    this.phase = 'dragging';
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
    if (this.phase !== 'dragging' || !this.draggedCharacter) return;

    const now = performance.now();
    const dt = now - this.lastPointerTime;

    // 속도 샘플 기록
    if (dt > 0) {
      this.velocitySamples.push({
        dx: e.clientX - this.lastPointerX,
        dy: e.clientY - this.lastPointerY,
        dt,
      });
      // 최근 N개만 유지
      if (this.velocitySamples.length > this.config.drag_velocity_samples) {
        this.velocitySamples.shift();
      }
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.lastPointerTime = now;

    // 캐릭터 위치 업데이트 (화면 경계 클램프)
    const newX = clamp(e.clientX - this.dragOffsetX, 0, window.innerWidth);
    const newY = clamp(e.clientY - this.dragOffsetY, 0, this.stage.groundY);

    this.draggedCharacter.container.x = newX;
    this.draggedCharacter.container.y = newY;
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (this.phase !== 'dragging' || !this.draggedCharacter) return;

    // 릴리스 속도 계산
    const vel = this.computeReleaseVelocity();
    this.vx = vel.vx;
    this.vy = vel.vy;

    const character = this.draggedCharacter;
    character.endDrag();

    // 손을 놓는 즉시 click-through 복원 — 물리 시뮬레이션에 포인터 입력 불필요
    void toggleClickThrough(true);
    this.hoveredAgentId = null;

    // 바닥에 있으면 바로 착지 처리
    if (character.container.y >= this.stage.groundY) {
      this.handleLanding(character);
      return;
    }

    // 공중이면 물리 시뮬레이션 시작
    character.playFalling();
    this.phase = 'flying';
    this.startPhysicsTicker();
  }

  // ---------------------------------------------------------------------------
  // Physics simulation
  // ---------------------------------------------------------------------------

  private startPhysicsTicker(): void {
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

  /** 히트존 갱신 스로틀 — 물리 중 매 프레임이 아닌 ~100ms 간격 */
  private hitZoneTickCounter = 0;

  private tickPhysics(deltaSec: number): void {
    const character = this.draggedCharacter;
    if (!character) {
      this.stopPhysicsTicker();
      return;
    }

    const groundY = this.stage.groundY;

    // 물리 중 히트존 갱신 (~100ms 간격, 60fps 기준 6프레임마다)
    this.hitZoneTickCounter++;
    if (this.hitZoneTickCounter >= 6) {
      this.hitZoneTickCounter = 0;
      this.sendHitZones();
    }

    if (this.phase === 'flying') {
      // 중력 적용
      this.vy += this.config.drag_gravity * deltaSec;

      // 관성 이동
      this.vx *= this.config.drag_friction;
      character.container.x += this.vx * deltaSec;
      character.container.y += this.vy * deltaSec;

      // X 화면 경계
      if (character.container.x <= 0) {
        character.container.x = 0;
        this.vx = 0;
      } else if (character.container.x >= window.innerWidth) {
        character.container.x = window.innerWidth;
        this.vx = 0;
      }

      // 착지 판정
      if (character.container.y >= groundY) {
        character.container.y = groundY;
        character.playLanding();
        this.vy = 0;
        this.phase = 'sliding';
      }
    } else if (this.phase === 'sliding') {
      // 바닥 미끄러짐 (X만)
      this.vx *= this.config.drag_friction;
      character.container.x += this.vx * deltaSec;

      // X 화면 경계
      if (character.container.x <= 0) {
        character.container.x = 0;
        this.vx = 0;
      } else if (character.container.x >= window.innerWidth) {
        character.container.x = window.innerWidth;
        this.vx = 0;
      }

      // 정지 판정
      if (Math.abs(this.vx) < 1) {
        this.vx = 0;
        this.handleLanding(character);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Landing
  // ---------------------------------------------------------------------------

  private handleLanding(character: SpineCharacter): void {
    this.stopPhysicsTicker();

    character.container.y = this.stage.groundY;

    // landing 애니메이션이 아직 재생 안 됐으면 재생
    if (this.phase !== 'sliding') {
      character.playLanding();
    }

    // 겹침 해소
    this.manager.resolveOverlap(character.agentId);

    // 새 homeX 저장
    const finalX = character.container.x;
    this.manager.setCharacterHomeX(character.agentId, finalX);
    void notifyDragDrop(character.agentId, finalX);

    // idle 전환 (landing 완료 후)
    // landing은 0.4초 one-shot -- 완료 후 idle로
    setTimeout(() => {
      if (!character.isDragged) {
        character.transitionTo(character.currentStatus);
      }
    }, 400);

    // 상태 초기화
    this.phase = 'idle';
    this.draggedCharacter = null;

    // 히트존 즉시 갱신
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
