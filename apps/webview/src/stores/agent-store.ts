import { create } from 'zustand';
import type { MascotAgent, AgentStatus } from '../types/agent';

interface AgentStoreState {
  /** workspace_id -> (agent_id -> MascotAgent) */
  agentsByWorkspace: Map<string, Map<string, MascotAgent>>;

  addAgent: (agent: MascotAgent) => void;
  updateStatus: (agentId: string, status: AgentStatus, extra?: Partial<MascotAgent>) => void;
  removeAgent: (agentId: string) => void;
  getAllAgents: () => MascotAgent[];
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agentsByWorkspace: new Map(),

  addAgent: (agent) =>
    set((state) => {
      const next = new Map(state.agentsByWorkspace);
      const wsMap = new Map(next.get(agent.workspace_id) ?? []);
      wsMap.set(agent.agent_id, agent);
      next.set(agent.workspace_id, wsMap);
      return { agentsByWorkspace: next };
    }),

  updateStatus: (agentId, status, extra) =>
    set((state) => {
      const next = new Map(state.agentsByWorkspace);
      for (const [wsId, wsMap] of next) {
        if (wsMap.has(agentId)) {
          const updated = new Map(wsMap);
          const existing = updated.get(agentId);
          if (existing) {
            updated.set(agentId, { ...existing, status, ...extra });
          }
          next.set(wsId, updated);
          break;
        }
      }
      return { agentsByWorkspace: next };
    }),

  removeAgent: (agentId) =>
    set((state) => {
      const next = new Map(state.agentsByWorkspace);
      for (const [wsId, wsMap] of next) {
        if (wsMap.has(agentId)) {
          const updated = new Map(wsMap);
          updated.delete(agentId);
          if (updated.size === 0) {
            next.delete(wsId);
          } else {
            next.set(wsId, updated);
          }
          break;
        }
      }
      return { agentsByWorkspace: next };
    }),

  getAllAgents: () => {
    const all: MascotAgent[] = [];
    for (const wsMap of get().agentsByWorkspace.values()) {
      for (const agent of wsMap.values()) {
        all.push(agent);
      }
    }
    return all;
  },
}));
