import type { FastifyInstance } from "fastify";
import { listStates } from "../storage/state-repo";
import { listEventsByAgent } from "../storage/events-repo";

type StateRow = {
  agent_id: string;
  status: string;
  last_event_ts: string;
};

function roleFromAgentId(agentId: string): "manager" | "worker" {
  return agentId.endsWith("/leader") ? "manager" : "worker";
}

function employmentFromAgentId(agentId: string): "employee" | "contractor" {
  return agentId.endsWith("/leader") ? "employee" : "contractor";
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agents", async () => {
    const states = listStates() as StateRow[];
    return {
      agents: states.map((state) => ({
        agent_id: state.agent_id,
        display_name: state.agent_id.split("/").at(-1) ?? state.agent_id,
        role: roleFromAgentId(state.agent_id),
        employment_type: employmentFromAgentId(state.agent_id),
        is_persisted: state.agent_id.endsWith("/leader"),
        source: state.agent_id.endsWith("/leader") ? "project_agent" : "runtime_agent",
        avatar_id: null,
        status: state.status,
        last_active_ts: state.last_event_ts ?? new Date().toISOString()
      }))
    };
  });

  app.get("/api/agents/:agentId", async (request, reply) => {
    const params = request.params as { agentId: string };
    const encoded = params.agentId;
    const agentId = decodeURIComponent(encoded);

    const states = listStates() as StateRow[];
    const state = states.find((s) => s.agent_id === agentId);

    if (!state) {
      reply.code(404);
      return { ok: false, message: "agent not found" };
    }

    return {
      agent: {
        agent_id: state.agent_id,
        display_name: state.agent_id.split("/").at(-1) ?? state.agent_id,
        role: roleFromAgentId(state.agent_id),
        employment_type: employmentFromAgentId(state.agent_id),
        status: state.status,
        intro: "이 에이전트의 상세 소개는 후속 단계에서 사용자 정의 가능합니다.",
        tools: ["Task", "Bash", "Read", "Write"],
        expertise: ["implementation", "debugging"],
        recent_events: listEventsByAgent(state.agent_id, 10)
      }
    };
  });
}
