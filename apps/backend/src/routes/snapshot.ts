import type { FastifyInstance } from "fastify";
import { computeAgentStatusAtTs, getEventById, listEvents, listEventsAfter, listEventsBefore } from "../storage/events-repo";
import { listStates } from "../storage/state-repo";

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/snapshot", async () => {
    return {
      agents: listStates(),
      tasks: [],
      sessions: [],
      settings: {},
      recent_events: listEvents(100),
      server_ts: new Date().toISOString()
    };
  });

  app.get("/api/events", async () => {
    return { events: listEvents(200) };
  });

  app.get("/api/events/:eventId/context", async (request, reply) => {
    const params = request.params as { eventId: string };
    const query = request.query as { before?: string; after?: string };
    const beforeLimit = Number(query.before ?? 8);
    const afterLimit = Number(query.after ?? 8);

    const pivot = getEventById(decodeURIComponent(params.eventId));
    if (!pivot) {
      reply.code(404);
      return { ok: false, message: "event not found" };
    }

    const before = listEventsBefore(pivot.ts, Number.isFinite(beforeLimit) ? beforeLimit : 8);
    const after = listEventsAfter(pivot.ts, Number.isFinite(afterLimit) ? afterLimit : 8);

    return {
      pivot,
      before,
      after,
      agent_snapshot: computeAgentStatusAtTs(pivot.agent_id, pivot.ts),
      server_ts: new Date().toISOString()
    };
  });
}
