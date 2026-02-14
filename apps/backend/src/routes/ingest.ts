import type { FastifyInstance } from "fastify";
import { normalizeHookEvent } from "../services/normalizer";
import { insertEvent } from "../storage/events-repo";
import { getState, upsertState } from "../storage/state-repo";
import { getAgent } from "../storage/agents-repo";
import { nextStatus } from "../services/state-machine";
import { broadcast } from "../ws/gateway";

export async function registerIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ingest/hooks", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    try {
      const event = normalizeHookEvent(body);
      insertEvent(event);

      const currentRow = getState(event.agent_id);
      const current = currentRow?.status;
      const next = nextStatus(current, event);

      const agentRow = getAgent(event.agent_id);
      const seatX = agentRow?.seat_x ?? 0;
      const seatY = agentRow?.seat_y ?? 0;

      const prevSince = currentRow?.since ?? "";
      const since = next !== current ? event.ts : prevSince;

      upsertState({
        agent_id: event.agent_id,
        workspace_id: event.workspace_id,
        terminal_session_id: event.terminal_session_id,
        run_id: event.run_id,
        status: next,
        position_x: currentRow?.position_x ?? seatX,
        position_y: currentRow?.position_y ?? seatY,
        home_position_x: seatX,
        home_position_y: seatY,
        facing: "right",
        since,
        context_json: JSON.stringify({
          task_id: event.task_id ?? null,
          peer_agent_id: event.target_agent_id ?? null,
        }),
        last_event_ts: event.ts,
      });

      broadcast({ type: "event", data: event });
      broadcast({
        type: "state_update",
        data: {
          agent_id: event.agent_id,
          prev_status: current ?? "idle",
          next_status: next,
          position: { x: currentRow?.position_x ?? seatX, y: currentRow?.position_y ?? seatY },
          home_position: { x: seatX, y: seatY },
          target_position: null,
          facing: "right",
          since,
          context: {
            task_id: event.task_id ?? null,
            peer_agent_id: event.target_agent_id ?? null,
          },
          triggered_by_event_id: event.id,
          ts: event.ts,
        },
      });

      return reply.code(200).send({ ok: true, event_id: event.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      app.log.error({ error }, "ingest processing failed");
      return reply.code(422).send({ ok: false, error: message });
    }
  });
}
