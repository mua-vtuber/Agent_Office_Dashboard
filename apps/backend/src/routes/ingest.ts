import type { FastifyInstance } from "fastify";
import type { AgentStatus } from "@aod/shared-schema";
import { normalizeHookEvent } from "../services/normalizer";
import { translateThinking } from "../services/translator";
import { eventExists, insertEvent } from "../storage/events-repo";
import { getState, upsertState } from "../storage/state-repo";
import { getAgent, upsertAgent } from "../storage/agents-repo";
import { upsertTask, getTask } from "../storage/tasks-repo";
import { upsertSession } from "../storage/sessions-repo";
import { nextStatus, getAppSettings } from "../services/state-machine";
import { broadcast } from "../ws/gateway";
import { serializeError, summarizeHookBody } from "../utils/logging";

export async function registerIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ingest/hooks", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    try {
      const event = normalizeHookEvent(body);

      // Dedup: return success if already processed
      if (eventExists(event.id)) {
        return reply.code(200).send({ ok: true, event_id: event.id, deduplicated: true });
      }

      insertEvent(event);
      upsertSession({
        workspace_id: event.workspace_id,
        terminal_session_id: event.terminal_session_id,
        run_id: event.run_id,
        last_heartbeat_ts: event.ts,
        status: "active",
      });

      // Auto-register unknown agents
      if (!getAgent(event.agent_id)) {
        const isLeader = event.agent_id.endsWith("/leader");
        const shortName = event.agent_id.split("/").at(-1) ?? event.agent_id;
        upsertAgent({
          agent_id: event.agent_id,
          display_name: shortName,
          role: isLeader ? "manager" : "worker",
          employment_type: "contractor",
          is_persisted: false,
          source: "runtime_agent",
          avatar_id: null,
          seat_x: 0,
          seat_y: 0,
          active: true,
        });
      }

      const currentRow = getState(event.agent_id);
      const current: AgentStatus = (currentRow?.status as AgentStatus | undefined) ?? "idle";
      const prevSince = currentRow?.since || event.ts;
      const settings = getAppSettings();

      const next = nextStatus({ current, event, since: prevSince, settings });

      const agentRow = getAgent(event.agent_id);
      const seatX = agentRow?.seat_x ?? 0;
      const seatY = agentRow?.seat_y ?? 0;

      const since = next !== current ? event.ts : prevSince;

      // Extract and translate thinking text
      const rawThinking = (event.payload as Record<string, unknown>).thinking as string | null | undefined;
      let thinkingText: string | null = rawThinking ?? null;
      if (thinkingText && settings.thought_bubble?.enabled) {
        const translated = await translateThinking(thinkingText);
        thinkingText = translated.text;
        if (translated.error) {
          app.log.error(
            {
              event_id: event.id,
              agent_id: event.agent_id,
              error: translated.error,
              request_id: request.id
            },
            "thinking translation failed"
          );
          broadcast({
            type: "runtime_error",
            data: {
              source: "translator",
              message: translated.error,
              event_id: event.id,
              agent_id: event.agent_id,
              ts: event.ts
            },
          });
        }
      }

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
        thinking_text: thinkingText,
        last_event_ts: event.ts,
      });

      // Task tracking
      if (event.task_id) {
        const taskBase = {
          task_id: event.task_id,
          agent_id: event.agent_id,
          workspace_id: event.workspace_id,
          terminal_session_id: event.terminal_session_id,
          run_id: event.run_id,
          last_event_ts: event.ts,
        };

        if (event.type === "task_started") {
          upsertTask({ ...taskBase, status: "active", started_at: event.ts });
        } else if (event.type === "task_completed") {
          upsertTask({ ...taskBase, status: "completed", completed_at: event.ts });
        } else if (event.type === "task_failed") {
          upsertTask({ ...taskBase, status: "failed", failed_at: event.ts });
        } else {
          // Update last_event_ts on existing active task
          const existing = getTask(event.task_id);
          if (existing && existing.status === "active") {
            upsertTask({ ...taskBase, status: "active" });
          }
        }

        const taskRow = getTask(event.task_id);
        if (taskRow) {
          broadcast({ type: "task_update", data: taskRow });
        }
      }

      broadcast({ type: "event", data: event });
      broadcast({
        type: "state_update",
        data: {
          agent_id: event.agent_id,
          prev_status: current,
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
          thinking: thinkingText,
          triggered_by_event_id: event.id,
          ts: event.ts,
          terminal_session_id: event.terminal_session_id,
        },
      });

      app.log.info(
        {
          event_id: event.id,
          event_type: event.type,
          agent_id: event.agent_id,
          workspace_id: event.workspace_id,
          terminal_session_id: event.terminal_session_id,
          run_id: event.run_id
        },
        "ingest processed"
      );

      return reply.code(200).send({ ok: true, event_id: event.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      app.log.error(
        {
          error: serializeError(error),
          hook_body: summarizeHookBody(body),
          request_id: request.id
        },
        "failed to process ingest event"
      );
      return reply.code(422).send({ ok: false, error: message });
    }
  });
}
