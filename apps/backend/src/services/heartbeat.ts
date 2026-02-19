import { listActiveSessions, markStaleSessions } from "../storage/sessions-repo";
import { listStates } from "../storage/state-repo";
import { checkTimerTransitions, getAppSettings } from "../services/state-machine";
import { upsertState } from "../storage/state-repo";
import { broadcast } from "../ws/gateway";
import type { AgentStatus } from "@aod/shared-schema";

let timer: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(): void {
  if (timer) return;
  tick();

  const settings = getAppSettings();
  const intervalMs = settings.session_tracking.heartbeat_interval_sec * 1000;
  timer = setInterval(tick, intervalMs);
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function tick(): void {
  const settings = getAppSettings();
  const ts = new Date().toISOString();

  // 1. Mark stale sessions inactive
  const staleThresholdMs = settings.operations.stale_agent_seconds * 1000;
  const cutoffTs = new Date(Date.now() - staleThresholdMs).toISOString();
  markStaleSessions(cutoffTs);

  // 2. Check timer-based state transitions for all agents
  const states = listStates();
  for (const state of states) {
    const current = state.status as AgentStatus;
    const timerNext = checkTimerTransitions(current, state.since, settings);
    if (timerNext) {
      upsertState({
        ...state,
        facing: (state.facing as "left" | "right" | "up" | "down") || "right",
        status: timerNext,
        since: ts,
      });

      broadcast({
        type: "state_update",
        data: {
          agent_id: state.agent_id,
          prev_status: current,
          next_status: timerNext,
          position: { x: state.position_x, y: state.position_y },
          home_position: { x: state.home_position_x, y: state.home_position_y },
          target_position: null,
          facing: state.facing,
          since: ts,
          context: state.context_json ? JSON.parse(state.context_json) : {},
          triggered_by_event_id: null,
          ts,
        },
      });
    }
  }

  // 3. Broadcast heartbeat to active sessions
  const sessions = listActiveSessions();
  for (const session of sessions) {
    broadcast(
      {
        type: "heartbeat",
        data: {
          workspace_id: session.workspace_id,
          terminal_session_id: session.terminal_session_id,
          run_id: session.run_id,
          ts,
        },
      },
      session,
    );
  }
}
