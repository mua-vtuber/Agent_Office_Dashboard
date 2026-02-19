import type { FastifyInstance } from "fastify";
import { listStatesScoped, type StateRow } from "../storage/state-repo";
import { getAgent } from "../storage/agents-repo";
import { listEventsByAgent } from "../storage/events-repo";
import { listActiveSessions } from "../storage/sessions-repo";

function scopeFilter(query: { workspace_id?: string; terminal_session_id?: string; run_id?: string }): {
  workspace_id?: string;
  terminal_session_id?: string;
  run_id?: string;
} {
  const filter: { workspace_id?: string; terminal_session_id?: string; run_id?: string } = {};
  if (query.workspace_id) filter.workspace_id = query.workspace_id;
  if (query.terminal_session_id) filter.terminal_session_id = query.terminal_session_id;
  if (query.run_id) filter.run_id = query.run_id;
  return filter;
}

function makeSessionKey(workspaceId: string, terminalSessionId: string, runId: string): string {
  return `${workspaceId}::${terminalSessionId}::${runId}`;
}

function isExplicitFilter(filter: { workspace_id?: string; terminal_session_id?: string; run_id?: string }): boolean {
  return Boolean(filter.workspace_id || filter.terminal_session_id || filter.run_id);
}

function filterByActiveSessions(rows: StateRow[]): StateRow[] {
  const activeKeys = new Set(
    listActiveSessions().map((s) => makeSessionKey(s.workspace_id, s.terminal_session_id, s.run_id))
  );
  return rows.filter((row) =>
    activeKeys.has(makeSessionKey(row.workspace_id, row.terminal_session_id, row.run_id))
  );
}

function buildAgentView(state: StateRow) {
  const agentRow = getAgent(state.agent_id);
  return {
    agent_id: state.agent_id,
    display_name: agentRow?.display_name ?? state.agent_id.split("/").at(-1) ?? state.agent_id,
    role: agentRow?.role ?? "unknown",
    employment_type: agentRow?.employment_type ?? "contractor",
    is_persisted: agentRow ? agentRow.is_persisted === 1 : false,
    source: agentRow?.source ?? "unknown",
    avatar_id: agentRow?.avatar_id ?? null,
    status: state.status,
    last_active_ts: state.last_event_ts ?? new Date().toISOString(),
  };
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agents", async (request) => {
    const query = request.query as { workspace_id?: string; terminal_session_id?: string; run_id?: string };
    const filter = scopeFilter(query);
    const explicit = isExplicitFilter(filter);
    const scoped = listStatesScoped(filter);
    const states = explicit ? scoped : filterByActiveSessions(scoped);
    return {
      agents: states.map(buildAgentView),
    };
  });

  app.get("/api/agents/:agentId", async (request, reply) => {
    const params = request.params as { agentId: string };
    const agentId = decodeURIComponent(params.agentId);

    const query = request.query as { workspace_id?: string; terminal_session_id?: string; run_id?: string };
    const filter = scopeFilter(query);
    const explicit = isExplicitFilter(filter);
    const scoped = listStatesScoped(filter);
    const states = explicit ? scoped : filterByActiveSessions(scoped);
    const state = states.find((s) => s.agent_id === agentId);

    if (!state) {
      reply.code(404);
      return { ok: false, message: "agent not found" };
    }

    const agentRow = getAgent(state.agent_id);

    return {
      agent: {
        ...buildAgentView(state),
        intro: "이 에이전트의 상세 소개는 후속 단계에서 사용자 정의 가능합니다.",
        tools: ["Task", "Bash", "Read", "Write"],
        expertise: ["implementation", "debugging"],
        home_position: { x: state.home_position_x, y: state.home_position_y },
        since: state.since,
        context: state.context_json ? JSON.parse(state.context_json) : {},
        seat: agentRow ? { x: agentRow.seat_x, y: agentRow.seat_y } : null,
        recent_events: listEventsByAgent(state.agent_id, 10),
      },
    };
  });
}
