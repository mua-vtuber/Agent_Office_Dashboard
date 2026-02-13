import type { FastifyInstance } from "fastify";
import { normalizeHookEvent } from "../services/normalizer";
import { insertEvent } from "../storage/events-repo";
import { listStates, upsertState } from "../storage/state-repo";
import { nextStatus } from "../services/state-machine";
import { broadcast } from "../ws/gateway";

export async function registerIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ingest/hooks", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    // respond quickly to avoid blocking hook caller
    reply.code(200).send({ ok: true });

    try {
      const event = normalizeHookEvent(body);
      insertEvent(event);

      const stateRows = listStates() as Array<{ agent_id: string; status: string }>;
      const current = stateRows.find((row) => row.agent_id === event.agent_id)?.status;
      const next = nextStatus(current, event);

      upsertState({
        agent_id: event.agent_id,
        workspace_id: event.workspace_id,
        terminal_session_id: event.terminal_session_id,
        run_id: event.run_id,
        status: next,
        position_x: 0,
        position_y: 0,
        facing: "right",
        last_event_ts: event.ts
      });

      broadcast({ type: "event", data: event });
      broadcast({
        type: "state_update",
        data: {
          agent_id: event.agent_id,
          prev_status: current ?? "idle",
          next_status: next,
          position: { x: 0, y: 0 },
          target_position: null,
          facing: "right",
          context: { task_id: event.task_id ?? undefined },
          triggered_by_event_id: event.id,
          ts: event.ts
        }
      });
    } catch (error) {
      app.log.error({ error }, "failed to process ingest event");
    }
  });
}
