import type { FastifyInstance } from "fastify";
import {
  computeAgentStatusAtTs,
  getEventById,
  listEventsAfter,
  listEventsBefore,
  listEventsScoped,
  listScopes
} from "../storage/events-repo";
import { listStatesScoped } from "../storage/state-repo";
import { listActiveTasks } from "../storage/tasks-repo";
import { listAllSessions } from "../storage/sessions-repo";
import { listSettingsObject } from "../storage/settings-repo";
import { config } from "../config";

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

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/snapshot", async (request) => {
    const query = request.query as { workspace_id?: string; terminal_session_id?: string; run_id?: string };
    const filter = scopeFilter(query);

    return {
      agents: listStatesScoped(filter),
      tasks: listActiveTasks(),
      sessions: listAllSessions(),
      settings: listSettingsObject(),
      recent_events: listEventsScoped(100, filter),
      server_ts: new Date().toISOString(),
    };
  });

  app.get("/api/events", async (request) => {
    const query = request.query as { workspace_id?: string; terminal_session_id?: string; run_id?: string };
    return { events: listEventsScoped(200, scopeFilter(query)) };
  });

  app.get("/api/sessions", async () => {
    const scopes = listScopes();
    if (scopes.length === 0) {
      return {
        scopes: [
          {
            workspace_id: config.defaultWorkspace,
            terminal_session_id: config.defaultTerminalSession,
            run_id: config.defaultRunId,
            last_event_ts: new Date().toISOString()
          }
        ]
      };
    }
    return { scopes };
  });

  app.get("/api/events/:eventId/context", async (request, reply) => {
    const params = request.params as { eventId: string };
    const query = request.query as { before?: string; after?: string };
    const beforeLimit = Number(query.before ?? 10);
    const afterLimit = Number(query.after ?? 10);

    const pivot = getEventById(decodeURIComponent(params.eventId));
    if (!pivot) {
      reply.code(404);
      return { ok: false, message: "event not found" };
    }

    const before = listEventsBefore(pivot.ts, Number.isFinite(beforeLimit) ? beforeLimit : 10);
    const after = listEventsAfter(pivot.ts, Number.isFinite(afterLimit) ? afterLimit : 10);

    return {
      pivot,
      before,
      after,
      agent_snapshot: computeAgentStatusAtTs(pivot.agent_id, pivot.ts),
      server_ts: new Date().toISOString()
    };
  });
}
