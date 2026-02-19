import { create } from "zustand";

export type AgentView = {
  agent_id: string;
  status: string;
  thinking: string | null;
  last_event_ts: string;
};

type AgentStore = {
  agents: Record<string, AgentView>;
  upsert: (agent: AgentView) => void;
  setMany: (agents: AgentView[]) => void;
};

export const useAgentStore = create<AgentStore>((set) => ({
  agents: {},
  upsert: (agent) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [agent.agent_id]: agent
      }
    })),
  setMany: (agents) =>
    set(() => ({
      agents: Object.fromEntries(agents.map((a) => [a.agent_id, a]))
    }))
}));
