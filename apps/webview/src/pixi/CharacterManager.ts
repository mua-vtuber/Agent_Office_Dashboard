import {
  SkeletonData,
  SkeletonJson,
  AtlasAttachmentLoader,
  TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';
import { Assets } from 'pixi.js';

import type { MascotAgent, AgentStatus, SlotCounts } from '../types/agent';
import type { AgentUpdatePayload, DisplayConfig } from '../types/ipc';
import { setSlotCounts } from '../tauri/commands';
import { STATUS_BUBBLE_VISIBILITY } from './constants';
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
   * Movement stub: begin walking a character toward a peer.
   * Will be fully implemented in Task 8.
   */
  startWalking(_agentId: string, _peerAgentId: string): void {
    // Stub: movement system implemented in Task 8
  }

  /**
   * Movement stub: begin returning a character to its home position.
   * Will be fully implemented in Task 8.
   */
  startReturning(_agentId: string): void {
    // Stub: movement system implemented in Task 8
  }

  /**
   * Clean up all characters, bubbles, and workspace labels.
   */
  destroy(): void {
    for (const [agentId] of this.characters) {
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
        entry.character.homeX = charX;
        entry.character.container.y = groundY;

        // Position bubble above character
        entry.bubble.container.x = charX;
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
