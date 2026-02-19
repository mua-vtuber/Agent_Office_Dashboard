import { create } from "zustand";

export type AgentView = {
  agent_id: string;
  status: string;
  thinking: string | null;
  last_event_ts: string;
  terminal_session_id: string;
};

type AgentStore = {
  agents: Record<string, AgentView>;
  upsert: (agent: AgentView) => void;
  setMany: (agents: AgentView[]) => void;
};

export const useAgentStore = create<AgentStore>((set) => ({
  agents: {},
  upsert: (agent) =>
    set((state) => {
      const existing = state.agents[agent.agent_id];
      return {
        agents: {
          ...state.agents,
          [agent.agent_id]: {
            ...existing,
            ...agent,
            // Preserve existing values when incoming is empty/null
            terminal_session_id: agent.terminal_session_id || existing?.terminal_session_id || "",
            thinking: agent.thinking ?? existing?.thinking ?? null,
          }
        }
      };
    }),
  setMany: (agents) =>
    set(() => ({
      agents: Object.fromEntries(agents.map((a) => [a.agent_id, a]))
    }))
}));
