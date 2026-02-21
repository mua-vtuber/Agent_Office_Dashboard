import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  toggleClickThrough,
  setCursorPolling,
  setHitZones,
  notifyDragDrop,
} from '../tauri/commands';
import type { CursorHoverPayload, DragConfig } from '../types/ipc';
import type { MascotStage } from './MascotStage';
import type { CharacterManager } from './CharacterManager';
import type { SpineCharacter } from './SpineCharacter';

/**
 * Manages character drag-and-drop interaction.
 *
 * Flow:
 * 1. enable() — start cursor polling + send hit zones periodically + subscribe to hover events
 * 2. Rust polls GetCursorPos, compares with hit zones → emits mascot://cursor-hover
 * 3. On hover → disable click-through so WebView receives pointer events
 * 4. pointerdown → start drag (grabbed animation)
 * 5. pointermove → move character
 * 6. pointerup → end drag → save position → restore click-through
 */
export class DragController {
  private readonly stage: MascotStage;
  private readonly manager: CharacterManager;
  private readonly dragConfig: DragConfig;

  private unlistenHover: UnlistenFn | null = null;
  private hitZoneInterval: ReturnType<typeof setInterval> | null = null;

  /** Currently hovered character (cursor is over it) */
  private hoveredCharacter: SpineCharacter | null = null;
  /** Currently dragged character */
  private draggedCharacter: SpineCharacter | null = null;
  /** Cursor-character offset at drag start */
  private dragOffsetX = 0;

  /** Bound event handler references for removal */
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;

  constructor(
    stage: MascotStage,
    manager: CharacterManager,
    dragConfig: DragConfig,
  ) {
    this.stage = stage;
    this.manager = manager;
    this.dragConfig = dragConfig;

    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
  }

  /** Activate the drag system. */
  async enable(): Promise<void> {
    // 1. Register pointer event listeners on canvas
    const canvas = this.stage.app.canvas as HTMLCanvasElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);

    // 2. Start Rust cursor polling
    await setCursorPolling(true);

    // 3. Send hit zones periodically (characters move, so zones change)
    this.sendHitZones();
    this.hitZoneInterval = setInterval(() => this.sendHitZones(), 500);

    // 4. Subscribe to hover events from Rust
    this.unlistenHover = await listen<CursorHoverPayload>(
      'mascot://cursor-hover',
      (event) => this.handleCursorHover(event.payload),
    );
  }

  /** Send current hit zones to Rust. */
  private sendHitZones(): void {
    const dpr = window.devicePixelRatio;
    const zones = this.manager.getHitZones(dpr);
    void setHitZones(zones);
  }

  /** Handle hover state change from Rust cursor polling. */
  private handleCursorHover(payload: CursorHoverPayload): void {
    // Ignore hover changes during drag (click-through already disabled)
    if (this.draggedCharacter) return;

    if (payload.hovered_agent_id) {
      // Cursor is over a character → disable click-through
      if (!this.hoveredCharacter) {
        void toggleClickThrough(false);
      }
      this.hoveredCharacter = this.manager.getCharacter(payload.hovered_agent_id);
    } else {
      // Cursor left all characters → restore click-through
      if (this.hoveredCharacter) {
        void toggleClickThrough(true);
        this.hoveredCharacter = null;
      }
    }
  }

  /** pointerdown: start dragging. */
  private handlePointerDown(e: PointerEvent): void {
    if (!this.hoveredCharacter) return;

    const character = this.hoveredCharacter;
    this.draggedCharacter = character;

    // Cancel any in-progress movement
    this.manager.cancelMovement(character.agentId);

    // Calculate cursor-character offset (CSS pixels)
    this.dragOffsetX = e.clientX - character.container.x;

    // Start grabbed animation
    character.startDrag();

    // Capture pointer for reliable move/up tracking
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  /** pointermove: move character while dragging. */
  private handlePointerMove(e: PointerEvent): void {
    if (!this.draggedCharacter) return;

    const newX = e.clientX - this.dragOffsetX;
    this.draggedCharacter.container.x = newX;

    if (!this.dragConfig.snap_to_ground) {
      this.draggedCharacter.container.y = e.clientY;
    }
  }

  /** pointerup: finish dragging. */
  private handlePointerUp(_e: PointerEvent): void {
    if (!this.draggedCharacter) return;

    const character = this.draggedCharacter;
    const droppedX = character.container.x;

    // End grabbed animation, restore previous status animation
    character.endDrag();

    if (this.dragConfig.return_to_home_on_release) {
      // Return to original position
      character.container.x = character.homeX;
    } else {
      // Save dropped position as new homeX
      this.manager.setCharacterHomeX(character.agentId, droppedX);
      void notifyDragDrop(character.agentId, droppedX);
    }

    // Restore Y to ground level
    if (this.dragConfig.snap_to_ground) {
      character.container.y = this.stage.groundY;
    }

    this.draggedCharacter = null;

    // Restore click-through
    void toggleClickThrough(true);
    this.hoveredCharacter = null;

    // Immediately refresh hit zones
    this.sendHitZones();
  }

  /** Deactivate drag system and clean up all resources. */
  async destroy(): Promise<void> {
    // Remove pointer event listeners
    const canvas = this.stage.app.canvas as HTMLCanvasElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);

    // Stop hit zone sending
    if (this.hitZoneInterval) {
      clearInterval(this.hitZoneInterval);
      this.hitZoneInterval = null;
    }

    // Unsubscribe hover events
    if (this.unlistenHover) {
      this.unlistenHover();
      this.unlistenHover = null;
    }

    // Stop cursor polling
    await setCursorPolling(false);
  }
}
