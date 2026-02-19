import type { FastifyInstance } from "fastify";
import {
  computeAgentStatusAtTs,
  getEventById,
  listEventsAfter,
  listEventsBefore,
  listEventsScoped
} from "../storage/events-repo";
import { listStatesScoped } from "../storage/state-repo";
import { listTasksScoped } from "../storage/tasks-repo";
import { listActiveSessions } from "../storage/sessions-repo";
import { getMergedSettings } from "../services/settings-service";

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

function filterByActiveSessions<T extends { workspace_id: string; terminal_session_id: string; run_id: string }>(
  rows: T[],
  activeKeys: Set<string>
): T[] {
  return rows.filter((row) =>
    activeKeys.has(makeSessionKey(row.workspace_id, row.terminal_session_id, row.run_id))
  );
}

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/snapshot", async (request) => {
    const query = request.query as { workspace_id?: string; terminal_session_id?: string; run_id?: string };
    const filter = scopeFilter(query);
    const explicit = isExplicitFilter(filter);
    const activeSessions = listActiveSessions();
    const activeKeys = new Set(
      activeSessions.map((s) => makeSessionKey(s.workspace_id, s.terminal_session_id, s.run_id))
    );
    const states = listStatesScoped(filter);
    const tasks = listTasksScoped(filter);
    const events = listEventsScoped(100, filter);

    return {
      agents: explicit ? states : filterByActiveSessions(states, activeKeys),
      tasks: explicit ? tasks : filterByActiveSessions(tasks, activeKeys),
      sessions: activeSessions,
      settings: getMergedSettings(),
      recent_events: explicit ? events : filterByActiveSessions(events, activeKeys),
      server_ts: new Date().toISOString(),
    };
  });

  app.get("/api/events", async (request) => {
    const query = request.query as { workspace_id?: string; terminal_session_id?: string; run_id?: string };
    const filter = scopeFilter(query);
    const explicit = isExplicitFilter(filter);
    const events = listEventsScoped(200, filter);
    if (explicit) {
      return { events };
    }
    const activeSessions = listActiveSessions();
    const activeKeys = new Set(
      activeSessions.map((s) => makeSessionKey(s.workspace_id, s.terminal_session_id, s.run_id))
    );
    return { events: filterByActiveSessions(events, activeKeys) };
  });

  app.get("/api/sessions", async () => {
    const activeSessions = listActiveSessions();
    const scopes = activeSessions.map((s) => ({
      workspace_id: s.workspace_id,
      terminal_session_id: s.terminal_session_id,
      run_id: s.run_id,
      last_event_ts: s.last_heartbeat_ts
    }));
    const terminalMap = new Map<string, { terminal_session_id: string; terminal_label: string; workspace_id: string; last_event_ts: string }>();
    for (const s of activeSessions) {
      const prev = terminalMap.get(s.terminal_session_id);
      if (!prev || s.last_heartbeat_ts > prev.last_event_ts) {
        terminalMap.set(s.terminal_session_id, {
          terminal_session_id: s.terminal_session_id,
          terminal_label: s.terminal_session_id,
          workspace_id: s.workspace_id,
          last_event_ts: s.last_heartbeat_ts
        });
      }
    }
    const terminals = Array.from(terminalMap.values()).sort((a, b) => b.last_event_ts.localeCompare(a.last_event_ts));
    return { scopes, terminals };
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
