import {
  SkeletonData,
  SkeletonJson,
  AtlasAttachmentLoader,
  TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';
import { Assets, Ticker } from 'pixi.js';

import type { MascotAgent, AgentStatus, SlotCounts } from '../types/agent';
import type { AgentUpdatePayload, DisplayConfig } from '../types/ipc';
import { setSlotCounts, notifyMovementDone } from '../tauri/commands';
import { useErrorStore } from '../stores/error-store';
import { STATUS_BUBBLE_VISIBILITY, Z_INDEX } from './constants';
import { MascotStage } from './MascotStage';
import { SpineCharacter } from './SpineCharacter';
import { SpeechBubble } from './SpeechBubble';
import { WorkspaceLabel } from './WorkspaceLabel';

/** Spine asset paths served from the public directory */
const SPINE_SKELETON_ALIAS = 'character-skeleton';
const SPINE_ATLAS_ALIAS = 'character-atlas';
const SPINE_SKELETON_PATH = '/spine/character.json';
const SPINE_ATLAS_PATH = '/spine/character.atlas';

/** Fade duration for temporary bubble messages (completed, startled) */
const TEMP_BUBBLE_FADE_MS = 3000;

/** Skin prefix conventions used in the Spine asset */
const SKIN_PREFIXES: Record<keyof SlotCounts, string> = {
  body: 'body/type-',
  hair: 'hair/style-',
  outfit: 'outfit/style-',
  accessory: 'accessory/item-',
  face: 'face/type-',
};

interface WorkspaceGroup {
  label: WorkspaceLabel;
  agentIds: string[];
}

interface CharacterEntry {
  character: SpineCharacter;
  bubble: SpeechBubble;
  workspaceId: string;
}

/**
 * Orchestrates all character instances, workspace groups, and position layout.
 *
 * Responsibilities:
 * - Loads the shared Spine asset and extracts SlotCounts
 * - Manages agent lifecycle (add/update/remove)
 * - Groups agents by workspace with labels
 * - Calculates positions so groups and characters are evenly spaced
 * - Updates speech bubbles based on AgentStatus
 * - Provides movement stubs for Task 8
 */
export class CharacterManager {
  private readonly stage: MascotStage;
  private skeletonData: SkeletonData | null = null;
  private displayConfig: DisplayConfig;

  /** All active character entries keyed by agent_id */
  private readonly characters = new Map<string, CharacterEntry>();

  /** Workspace groups keyed by workspace_id */
  private readonly workspaceGroups = new Map<string, WorkspaceGroup>();

  /** Active movement tracking keyed by agent_id */
  private readonly movingAgents = new Map<
    string,
    { targetX: number; peerAgentId?: string; type: 'walk' | 'return' }
  >();

  /** Bound reference to the ticker callback for add/remove */
  private tickerCallback: ((ticker: Ticker) => void) | null = null;

  constructor(stage: MascotStage, displayConfig: DisplayConfig) {
    this.stage = stage;
    this.displayConfig = displayConfig;
  }

  /**
   * Load the shared Spine skeleton + atlas assets via PixiJS Assets system.
   * The spine-pixi-v8 package registers loaders automatically, so
   * Assets.load handles .json and .atlas files for Spine.
   *
   * After loading, parses SkeletonData and extracts SlotCounts to send to Rust.
   */
  async loadSpineAsset(): Promise<void> {
    // Register asset aliases for later retrieval
    Assets.add({ alias: SPINE_SKELETON_ALIAS, src: SPINE_SKELETON_PATH });
    Assets.add({ alias: SPINE_ATLAS_ALIAS, src: SPINE_ATLAS_PATH });

    // Load both skeleton JSON and atlas (with textures) in parallel
    const [skeletonJsonData, atlasData] = await Promise.all([
      Assets.load<Record<string, unknown>>(SPINE_SKELETON_ALIAS),
      Assets.load<TextureAtlas>(SPINE_ATLAS_ALIAS),
    ]);

    // Build SkeletonData from the loaded raw assets
    const attachmentLoader = new AtlasAttachmentLoader(atlasData);
    const skeletonJson = new SkeletonJson(attachmentLoader);
    this.skeletonData = skeletonJson.readSkeletonData(skeletonJsonData);

    // Extract SlotCounts from the skeleton's skin list
    const slotCounts = this.extractSlotCounts(this.skeletonData);
    await setSlotCounts(slotCounts);
  }

  /**
   * Add a new agent to the stage.
   *
   * Creates a SpineCharacter + SpeechBubble, adds them to the PixiJS stage,
   * manages the workspace group + WorkspaceLabel, recalculates positions,
   * and sets the initial animation.
   */
  addAgent(agent: MascotAgent): void {
    if (!this.skeletonData) {
      throw new Error('CharacterManager: Spine asset not loaded. Call loadSpineAsset() first.');
    }

    if (this.characters.has(agent.agent_id)) {
      return; // Agent already exists
    }

    // Create SpineCharacter
    const character = new SpineCharacter(this.skeletonData, agent.agent_id, agent.appearance);
    character.container.y = this.stage.groundY;

    // Create SpeechBubble
    const bubble = new SpeechBubble();
    bubble.setMaxChars(this.displayConfig.max_bubble_chars);

    // Add to PixiJS stage
    this.stage.app.stage.addChild(character.container);
    this.stage.app.stage.addChild(bubble.container);

    // Track entry
    const entry: CharacterEntry = {
      character,
      bubble,
      workspaceId: agent.workspace_id,
    };
    this.characters.set(agent.agent_id, entry);

    // Add to workspace group
    this.addToWorkspaceGroup(agent.agent_id, agent.workspace_id);

    // Recalculate all positions
    this.recalculatePositions();

    // Set initial animation
    character.transitionTo(agent.status);

    // Set initial bubble text
    this.updateBubbleForStatus(agent.agent_id, agent.status, {
      current_task: agent.current_task,
      thinking_text: agent.thinking_text,
      chat_message: null,
    });
  }

  /**
   * Update an existing agent based on a status update payload from Rust.
   *
   * Transitions animation, updates bubble text, and triggers movement stubs.
   */
  updateAgent(payload: AgentUpdatePayload): void {
    const entry = this.characters.get(payload.agent_id);
    if (!entry) return;

    // Handle workspace change
    if (payload.workspace_id !== entry.workspaceId) {
      this.removeFromWorkspaceGroup(payload.agent_id, entry.workspaceId);
      entry.workspaceId = payload.workspace_id;
      this.addToWorkspaceGroup(payload.agent_id, payload.workspace_id);
      this.recalculatePositions();
    }

    // Transition animation
    entry.character.transitionTo(payload.status);

    // Update speech bubble
    this.updateBubbleForStatus(payload.agent_id, payload.status, {
      current_task: payload.current_task,
      thinking_text: payload.thinking_text,
      chat_message: payload.chat_message,
    });

    // Handle walking/returning triggers (stubs for Task 8)
    if (payload.status === 'walking' && payload.peer_agent_id) {
      this.startWalking(payload.agent_id, payload.peer_agent_id);
    } else if (payload.status === 'returning') {
      this.startReturning(payload.agent_id);
    }
  }

  /**
   * Remove an agent from the stage.
   *
   * Destroys character + bubble, removes from workspace group,
   * destroys the workspace label if the group is now empty,
   * and recalculates positions.
   */
  removeAgent(agentId: string): void {
    const entry = this.characters.get(agentId);
    if (!entry) return;

    // Remove from PixiJS stage
    this.stage.app.stage.removeChild(entry.character.container);
    this.stage.app.stage.removeChild(entry.bubble.container);

    // Destroy instances
    entry.character.destroy();
    entry.bubble.destroy();

    // Remove from workspace group
    this.removeFromWorkspaceGroup(agentId, entry.workspaceId);

    // Remove from tracking
    this.characters.delete(agentId);

    // Recalculate positions
    this.recalculatePositions();
  }

  /**
   * Update the display configuration.
   * Recalculates all positions and updates bubble max chars.
   */
  updateDisplayConfig(config: DisplayConfig): void {
    this.displayConfig = config;

    // Update all bubble max chars
    for (const entry of this.characters.values()) {
      entry.bubble.setMaxChars(config.max_bubble_chars);
    }

    // Recalculate positions with new spacing values
    this.recalculatePositions();
  }

  /**
   * Return a SpineCharacter by agent_id, or null if not found.
   * Used by DragController to access the character instance.
   */
  getCharacter(agentId: string): SpineCharacter | null {
    const entry = this.characters.get(agentId);
    return entry?.character ?? null;
  }

  /** 모든 에이전트 ID 반환. DragController 충돌 체크용. */
  getAllAgentIds(): string[] {
    return [...this.characters.keys()];
  }

  /**
   * Return hit zones for all characters in physical pixel coordinates.
   * Used by DragController to send to Rust for cursor polling.
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
   * Cancel an in-progress movement for a character.
   * Called when drag starts while the character is walking/returning.
   */
  cancelMovement(agentId: string): void {
    this.movingAgents.delete(agentId);

    const entry = this.characters.get(agentId);
    if (entry) {
      entry.character.isMoving = false;
      entry.character.container.zIndex = Z_INDEX.NORMAL;
      entry.character.container.scale.set(1, 1);
    }

    if (this.movingAgents.size === 0 && this.tickerCallback) {
      this.stage.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }
  }

  /**
   * Update a character's homeX position.
   * Called after drag drop to persist the new position.
   */
  setCharacterHomeX(agentId: string, newX: number): void {
    const entry = this.characters.get(agentId);
    if (!entry) return;
    entry.character.homeX = newX;
  }

  /**
   * Begin walking a character toward a peer character.
   * Lowers z-index (passes BEHIND other characters) and applies perspective scale.
   * Facing direction is set based on movement direction.
   */
  startWalking(agentId: string, peerAgentId: string): void {
    const walkerEntry = this.characters.get(agentId);
    const peerEntry = this.characters.get(peerAgentId);
    if (!walkerEntry || !peerEntry) return;

    const walker = walkerEntry.character;
    const targetX = peerEntry.character.homeX;

    // Lower z-index so walker passes behind other characters
    walker.container.zIndex = Z_INDEX.BEHIND;

    // Apply perspective scale while walking
    const scale = this.displayConfig.behind_scale;
    walker.container.scale.set(scale, scale);

    // Set facing direction: right (+1) if target is to the right, left (-1) otherwise
    const direction: 1 | -1 = targetX >= walker.container.x ? 1 : -1;
    walker.setFacing(direction);

    // Mark as moving
    walker.isMoving = true;

    // Track in moving map
    this.movingAgents.set(agentId, { targetX, peerAgentId, type: 'walk' });

    // Register ticker if this is the first moving agent
    this.ensureTickerRegistered();
  }

  /**
   * Begin returning a character to its home position.
   * Applies the same z-index and scale changes as walking.
   */
  startReturning(agentId: string): void {
    const entry = this.characters.get(agentId);
    if (!entry) return;

    const character = entry.character;
    const targetX = character.homeX;

    // Lower z-index so returner passes behind other characters
    character.container.zIndex = Z_INDEX.BEHIND;

    // Apply perspective scale while returning
    const scale = this.displayConfig.behind_scale;
    character.container.scale.set(scale, scale);

    // Set facing direction toward home
    const direction: 1 | -1 = targetX >= character.container.x ? 1 : -1;
    character.setFacing(direction);

    // Mark as moving
    character.isMoving = true;

    // Track in moving map
    this.movingAgents.set(agentId, { targetX, type: 'return' });

    // Register ticker if this is the first moving agent
    this.ensureTickerRegistered();
  }

  // ---------------------------------------------------------------------------
  // Private: Movement system
  // ---------------------------------------------------------------------------

  /**
   * Ensure the ticker callback is registered when there are moving agents.
   * Only registers once; the callback self-removes when no agents are moving.
   */
  private ensureTickerRegistered(): void {
    if (this.tickerCallback) return;

    this.tickerCallback = (ticker: Ticker) => {
      this.tickMovement(ticker.deltaMS / 1000);
    };
    this.stage.app.ticker.add(this.tickerCallback);
  }

  /**
   * Per-frame movement tick. Moves each active agent toward their target.
   * When an agent arrives, restores z-index/scale and notifies Rust.
   *
   * @param deltaSec Time elapsed since last frame in seconds
   */
  private tickMovement(deltaSec: number): void {
    const arrived: string[] = [];
    const speed = this.displayConfig.walk_speed_px_per_sec;
    const arrivalDist = this.displayConfig.arrival_distance_px;

    for (const [agentId, movement] of this.movingAgents) {
      const entry = this.characters.get(agentId);
      if (!entry) {
        arrived.push(agentId);
        continue;
      }

      const character = entry.character;
      const currentX = character.container.x;
      const dx = movement.targetX - currentX;
      const distance = Math.abs(dx);

      if (distance <= arrivalDist) {
        // Arrived at target — restore state
        character.container.x = movement.targetX;
        character.container.zIndex = Z_INDEX.NORMAL;
        character.container.scale.set(1, 1);
        character.isMoving = false;

        // Reset facing to right (default)
        character.setFacing(1);

        // Sync bubble to final position
        entry.bubble.container.x = character.container.x;

        arrived.push(agentId);

        // Notify Rust of arrival
        const movementType = movement.type === 'walk' ? 'arrive_at_peer' : 'arrive_at_home';
        notifyMovementDone(agentId, movementType).catch((err: unknown) => {
          useErrorStore.getState().push({
            source: 'CharacterManager',
            message: `notifyMovementDone failed: ${String(err)}`,
            ts: new Date().toISOString(),
          });
        });
      } else {
        // Move toward target
        const step = speed * deltaSec;
        const moveAmount = Math.min(step, distance);
        character.container.x += dx > 0 ? moveAmount : -moveAmount;

        // Keep bubble in sync with character position
        entry.bubble.container.x = character.container.x;
      }
    }

    // Remove arrived agents from tracking
    for (const agentId of arrived) {
      this.movingAgents.delete(agentId);
    }

    // Unregister ticker when no agents are moving
    if (this.movingAgents.size === 0 && this.tickerCallback) {
      this.stage.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }
  }

  /**
   * Clean up all characters, bubbles, and workspace labels.
   */
  destroy(): void {
    // Clean up movement ticker
    if (this.tickerCallback) {
      this.stage.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }
    this.movingAgents.clear();

    // Snapshot keys to avoid mutating the Map during iteration
    const agentIds = [...this.characters.keys()];
    for (const agentId of agentIds) {
      this.removeAgent(agentId);
    }
    // removeAgent already cleans up workspace groups, but ensure labels are gone
    for (const group of this.workspaceGroups.values()) {
      group.label.destroy();
    }
    this.workspaceGroups.clear();
  }

  // ---------------------------------------------------------------------------
  // Private: Workspace group management
  // ---------------------------------------------------------------------------

  /**
   * Add an agent to a workspace group. Creates the group + label if new.
   */
  private addToWorkspaceGroup(agentId: string, workspaceId: string): void {
    let group = this.workspaceGroups.get(workspaceId);
    if (!group) {
      const label = new WorkspaceLabel(workspaceId);
      this.stage.app.stage.addChild(label.container);
      group = { label, agentIds: [] };
      this.workspaceGroups.set(workspaceId, group);
    }
    if (!group.agentIds.includes(agentId)) {
      group.agentIds.push(agentId);
    }
  }

  /**
   * Remove an agent from a workspace group. Destroys the group + label if empty.
   */
  private removeFromWorkspaceGroup(agentId: string, workspaceId: string): void {
    const group = this.workspaceGroups.get(workspaceId);
    if (!group) return;

    group.agentIds = group.agentIds.filter((id) => id !== agentId);

    if (group.agentIds.length === 0) {
      this.stage.app.stage.removeChild(group.label.container);
      group.label.destroy();
      this.workspaceGroups.delete(workspaceId);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Position calculation
  // ---------------------------------------------------------------------------

  /**
   * Recalculate positions for all characters and workspace labels.
   *
   * Layout strategy:
   * - Characters within the same workspace are spaced by character_spacing_px
   * - Workspace groups are separated by group_spacing_px
   * - All characters sit at groundY
   * - WorkspaceLabel is centered above each group
   * - The entire layout is centered horizontally on the screen
   */
  private recalculatePositions(): void {
    const { character_spacing_px, group_spacing_px } = this.displayConfig;
    const groundY = this.stage.groundY;

    // Gather sorted workspace IDs for deterministic layout order
    const sortedWorkspaceIds = [...this.workspaceGroups.keys()].sort();

    // Calculate the total width needed for the entire layout
    let totalWidth = 0;
    const groupWidths: number[] = [];

    for (const wsId of sortedWorkspaceIds) {
      const group = this.workspaceGroups.get(wsId);
      if (!group || group.agentIds.length === 0) continue;
      const groupWidth = (group.agentIds.length - 1) * character_spacing_px;
      groupWidths.push(groupWidth);
      totalWidth += groupWidth;
    }

    // Add inter-group spacing
    const activeGroupCount = groupWidths.length;
    if (activeGroupCount > 1) {
      totalWidth += (activeGroupCount - 1) * group_spacing_px;
    }

    // Start X: center the entire layout on screen
    let currentX = (window.innerWidth - totalWidth) / 2;

    let groupIndex = 0;
    for (const wsId of sortedWorkspaceIds) {
      const group = this.workspaceGroups.get(wsId);
      if (!group || group.agentIds.length === 0) continue;

      const groupStartX = currentX;
      const groupWidth = groupWidths[groupIndex] ?? 0;

      // Position each character in this group
      for (let i = 0; i < group.agentIds.length; i++) {
        const agentId = group.agentIds[i];
        if (!agentId) continue;

        const entry = this.characters.get(agentId);
        if (!entry) continue;

        const charX = groupStartX + i * character_spacing_px;

        // Skip position update for dragged characters
        if (!entry.character.isDragged) {
          entry.character.homeX = charX;
          entry.character.container.y = groundY;
        }

        // Position bubble: follow actual character position if dragged, otherwise use layout position
        entry.bubble.container.x = entry.character.isDragged
          ? entry.character.container.x
          : charX;
        entry.bubble.container.y = groundY - this.stage.activityZoneHeight;
      }

      // Position workspace label centered above the group
      const groupCenterX = groupStartX + groupWidth / 2;
      const topY = groundY - this.stage.activityZoneHeight;
      group.label.updatePosition(groupCenterX, topY);

      currentX += groupWidth + group_spacing_px;
      groupIndex++;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Speech bubble updates
  // ---------------------------------------------------------------------------

  /**
   * Update a character's speech bubble based on their current AgentStatus.
   */
  private updateBubbleForStatus(
    agentId: string,
    status: AgentStatus,
    context: {
      current_task: string | null;
      thinking_text: string | null;
      chat_message: string | null;
    },
  ): void {
    const entry = this.characters.get(agentId);
    if (!entry) return;

    const shouldShow = STATUS_BUBBLE_VISIBILITY[status];
    if (!shouldShow) {
      entry.bubble.hide();
      return;
    }

    const fadeDuration = this.displayConfig.bubble_fade_ms;

    switch (status) {
      case 'working':
        entry.bubble.show(context.current_task ?? '작업 중...');
        break;
      case 'thinking':
        entry.bubble.show(context.thinking_text ?? '생각 중...');
        break;
      case 'pending_input':
        entry.bubble.show('입력 대기중...');
        break;
      case 'failed':
        entry.bubble.show('실패');
        break;
      case 'completed':
        entry.bubble.show('완료!', fadeDuration > 0 ? fadeDuration : TEMP_BUBBLE_FADE_MS);
        break;
      case 'resting':
        entry.bubble.show('\u{1F4A4}'); // 💤
        break;
      case 'startled':
        entry.bubble.show('\u2757', fadeDuration > 0 ? fadeDuration : TEMP_BUBBLE_FADE_MS); // ❗
        break;
      case 'chatting':
        entry.bubble.show(context.chat_message ?? '...');
        break;
      default:
        entry.bubble.hide();
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Spine asset utilities
  // ---------------------------------------------------------------------------

  /**
   * Extract SlotCounts from SkeletonData by counting skins matching known prefixes.
   *
   * Skin naming convention:
   * - body/type-N, hair/style-N, outfit/style-N, accessory/item-N, face/type-N
   */
  private extractSlotCounts(skeletonData: SkeletonData): SlotCounts {
    const skins = skeletonData.skins;

    const counts: SlotCounts = {
      body: 0,
      hair: 0,
      outfit: 0,
      accessory: 0,
      face: 0,
    };

    for (const skin of skins) {
      for (const [key, prefix] of Object.entries(SKIN_PREFIXES) as [keyof SlotCounts, string][]) {
        if (skin.name.startsWith(prefix)) {
          counts[key]++;
        }
      }
    }

    return counts;
  }
}
