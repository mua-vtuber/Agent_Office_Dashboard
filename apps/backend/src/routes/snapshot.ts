import type { FastifyInstance } from "fastify";
import { listEvents } from "../storage/events-repo";
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
}
