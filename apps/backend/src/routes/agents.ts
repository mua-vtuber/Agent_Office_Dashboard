import type { FastifyInstance } from "fastify";
import { listStates } from "../storage/state-repo";

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agents", async () => {
    const states = listStates() as Array<{ agent_id: string; status: string }>;
    return {
      agents: states.map((state) => ({
        agent_id: state.agent_id,
        display_name: state.agent_id.split("/").at(-1) ?? state.agent_id,
        role: state.agent_id.endsWith("/leader") ? "manager" : "worker",
        employment_type: "contractor",
        is_persisted: false,
        source: "runtime_agent",
        avatar_id: null,
        status: state.status,
        last_active_ts: new Date().toISOString()
      }))
    };
  });
}
