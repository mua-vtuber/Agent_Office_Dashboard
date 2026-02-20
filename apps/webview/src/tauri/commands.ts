import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { useErrorStore } from '../stores/error-store';
import type { MascotAgent, SlotCounts } from '../types/agent';
import type { DisplayConfig, AgentResume } from '../types/ipc';

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    useErrorStore.getState().push({
      source: `invoke:${cmd}`,
      message: String(error),
      ts: new Date().toISOString(),
    });
    throw error;
  }
}

export function getAllAgents(): Promise<MascotAgent[]> {
  return safeInvoke<MascotAgent[]>('get_all_agents');
}

export function getAgentResume(agentId: string): Promise<AgentResume> {
  return safeInvoke<AgentResume>('get_agent_resume', { agentId });
}

export function setSlotCounts(slotCounts: SlotCounts): Promise<void> {
  return safeInvoke<void>('set_slot_counts', { slotCounts });
}

export function notifyAnimationDone(agentId: string, animation: string): Promise<void> {
  return safeInvoke<void>('notify_animation_done', { agentId, animation });
}

export function notifyMovementDone(agentId: string, movementType: string): Promise<void> {
  return safeInvoke<void>('notify_movement_done', { agentId, movementType });
}

export function getDisplayConfig(): Promise<DisplayConfig> {
  return safeInvoke<DisplayConfig>('get_display_config');
}

export function notifyChatDone(agentId: string): Promise<void> {
  return safeInvoke<void>('notify_chat_done', { agentId });
}

export function toggleClickThrough(ignore: boolean): Promise<void> {
  return safeInvoke<void>('toggle_click_through', { ignore });
}
