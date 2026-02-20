import { Spine, Skin, SkeletonData, TrackEntry } from '@esotericsoftware/spine-pixi-v8';
import { Container } from 'pixi.js';
import type { AgentStatus, AppearanceProfile } from '../types/agent';
import { notifyAnimationDone } from '../tauri/commands';
import { useErrorStore } from '../stores/error-store';
import {
  STATUS_TO_ANIMATION,
  LOOPING_ANIMATIONS,
  ANIMATION_MIX_TIMES,
  DEFAULT_MIX_TIME,
  SYNTHETIC_ANIMATION_EVENTS,
  Z_INDEX,
} from './constants';

/**
 * Manages a single Spine character instance.
 *
 * Responsibilities:
 * - Creates a Spine instance from SkeletonData
 * - Composes a custom skin from AppearanceProfile indices
 * - Transitions animations based on AgentStatus
 * - Reports one-shot animation completion back to Rust via synthetic events
 * - Manages mix times between animations
 * - Supports facing direction (scaleX flip)
 */
export class SpineCharacter {
  readonly container: Container;
  readonly spine: Spine;
  readonly agentId: string;

  private _homeX = 0;
  private _isMoving = false;
  private _currentStatus: AgentStatus = 'offline';

  constructor(skeletonData: SkeletonData, agentId: string, appearance: AppearanceProfile) {
    this.agentId = agentId;

    this.spine = new Spine({ skeletonData });
    this.container = new Container();
    this.container.zIndex = Z_INDEX.NORMAL;
    this.container.addChild(this.spine);

    this.setupMixTimes();
    this.applySkin(appearance);
    this.setupCompleteListener();
  }

  /** The character's home X position. When not moving, container.x = homeX. */
  get homeX(): number {
    return this._homeX;
  }

  set homeX(value: number) {
    this._homeX = value;
    if (!this._isMoving) {
      this.container.x = value;
    }
  }

  /** Whether the character is currently being moved by the movement system. */
  get isMoving(): boolean {
    return this._isMoving;
  }

  set isMoving(value: boolean) {
    this._isMoving = value;
  }

  /** Current status of the character. */
  get currentStatus(): AgentStatus {
    return this._currentStatus;
  }

  /**
   * Compose a custom skin from AppearanceProfile indices.
   *
   * Skin naming convention: body/type-N, hair/style-N, outfit/style-N,
   * accessory/item-N (if > 0), face/type-N
   */
  applySkin(appearance: AppearanceProfile): void {
    const skeletonData = this.spine.skeleton.data;
    const customSkin = new Skin('agent-custom');

    const skinMappings: [string, number][] = [
      [`body/type-${appearance.body_index}`, appearance.body_index],
      [`hair/style-${appearance.hair_index}`, appearance.hair_index],
      [`outfit/style-${appearance.outfit_index}`, appearance.outfit_index],
      [`face/type-${appearance.face_index}`, appearance.face_index],
    ];

    for (const [skinName] of skinMappings) {
      const skin = skeletonData.findSkin(skinName);
      if (skin) {
        customSkin.addSkin(skin);
      }
    }

    // Accessory is optional -- only apply if index > 0
    if (appearance.accessory_index > 0) {
      const accessorySkin = skeletonData.findSkin(`accessory/item-${appearance.accessory_index}`);
      if (accessorySkin) {
        customSkin.addSkin(accessorySkin);
      }
    }

    this.spine.skeleton.setSkin(customSkin);
    this.spine.skeleton.setSlotsToSetupPose();
  }

  /**
   * Transition to the animation corresponding to the given AgentStatus.
   * Maps status to animation name via STATUS_TO_ANIMATION and plays it
   * with the correct loop setting from LOOPING_ANIMATIONS.
   */
  transitionTo(status: AgentStatus): void {
    const animationName = STATUS_TO_ANIMATION[status];
    this._currentStatus = status;

    if (!animationName) {
      // 'offline' maps to empty string -- clear the animation track
      this.spine.state.clearTrack(0);
      return;
    }

    const loop = LOOPING_ANIMATIONS.has(animationName);
    this.spine.state.setAnimation(0, animationName, loop);
  }

  /**
   * Set facing direction.
   * @param direction 1 = right (default), -1 = left (flip scaleX)
   */
  setFacing(direction: 1 | -1): void {
    this.spine.skeleton.scaleX = Math.abs(this.spine.skeleton.scaleX) * direction;
  }

  /**
   * Set up mix times between animation pairs from ANIMATION_MIX_TIMES.
   * Uses AnimationStateData.setMix() which takes animation names as strings.
   * Also sets the defaultMix.
   */
  private setupMixTimes(): void {
    const stateData = this.spine.state.data;
    stateData.defaultMix = DEFAULT_MIX_TIME;

    for (const [key, duration] of Object.entries(ANIMATION_MIX_TIMES)) {
      const parts = key.split('/');
      const fromName = parts[0];
      const toName = parts[1];
      if (fromName && toName) {
        // Only set mix if both animations exist in skeleton data
        const fromAnim = stateData.skeletonData.findAnimation(fromName);
        const toAnim = stateData.skeletonData.findAnimation(toName);
        if (fromAnim && toAnim) {
          stateData.setMix(fromName, toName, duration);
        }
      }
    }
  }

  /**
   * Listen for animation completion on the Spine pixi event system.
   * When a one-shot animation completes:
   * - Checks SYNTHETIC_ANIMATION_EVENTS; if matched, calls notifyAnimationDone
   * - Special case: 'celebrate' auto-transitions to 'idle'
   */
  private setupCompleteListener(): void {
    this.spine.state.addListener({
      complete: (entry: TrackEntry) => {
        const animationName = entry.animation?.name;
        if (!animationName) return;

        // Only care about one-shot (non-looping) animations completing
        if (LOOPING_ANIMATIONS.has(animationName)) return;

        const eventType = SYNTHETIC_ANIMATION_EVENTS[animationName];
        if (eventType) {
          notifyAnimationDone(this.agentId, eventType).catch((err: unknown) => {
            useErrorStore.getState().push({
              source: 'SpineCharacter',
              message: `notifyAnimationDone failed: ${String(err)}`,
              ts: new Date().toISOString(),
            });
          });
        }

        // Special case: celebrate -> auto-transition to idle
        if (animationName === 'celebrate') {
          this.transitionTo('idle');
        }
      },
    });
  }

  /** Clean up the container and spine instance. */
  destroy(): void {
    this.spine.state.clearListeners();
    this.container.destroy({ children: true });
  }
}
