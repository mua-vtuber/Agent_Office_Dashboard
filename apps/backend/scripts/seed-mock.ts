/* eslint-disable no-console */
import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = process.env.BACKEND_URL ?? "http://localhost:4800";
const token = process.env.DASHBOARD_TOKEN ?? "";

const headers: Record<string, string> = {
  "content-type": "application/json",
};
if (token) headers["authorization"] = `Bearer ${token}`;

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
}

async function put(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
}

const WORKSPACE = "demo-project";
const TERMINAL = "term-1";
const RUN = "run-001";

// 1. Settings initialization (dynamic speed)
await put("/api/settings", {
  settings: {
    general: {
      language: "ko",
      timezone: "Asia/Seoul",
      date_format: "relative",
      theme: "office-light",
      animation_speed: "normal",
    },
    i18n: {
      fallback_language: "en",
      number_locale: "ko-KR",
      event_message_locale_mode: "ui_locale",
    },
    office_layout: {
      layout_profile: "kr_t_left_v2",
      seat_positions: {},
      meeting_spots: {},
      desks: [
        { id: "desk_mgr", x_min: 13, x_max: 25, y_min: 11, y_max: 15 },
        { id: "desk_L1", x_min: 17, x_max: 21, y_min: 26, y_max: 34 },
        { id: "desk_L2", x_min: 17, x_max: 21, y_min: 39, y_max: 47 },
        { id: "desk_L3", x_min: 17, x_max: 21, y_min: 52, y_max: 60 },
        { id: "desk_L4", x_min: 17, x_max: 21, y_min: 65, y_max: 73 },
        { id: "desk_R1", x_min: 53, x_max: 57, y_min: 26, y_max: 34 },
        { id: "desk_R2", x_min: 53, x_max: 57, y_min: 39, y_max: 47 },
        { id: "desk_R3", x_min: 53, x_max: 57, y_min: 52, y_max: 60 },
        { id: "desk_R4", x_min: 53, x_max: 57, y_min: 65, y_max: 73 },
      ],
      pantry_zone_enabled: true,
      pantry_door_lane: { x_min: 64, x_max: 78, y_min: 84, y_max: 96 },
      speech_bubble_enabled: true,
      status_icon_enabled: true,
    },
    operations: {
      idle_to_breakroom_seconds: 180,
      idle_to_resting_seconds: 240,
      post_complete_policy: "weighted_random",
      post_complete_weights: { roaming: 0.4, breakroom: 0.4, resting: 0.2 },
      pending_input_alert_seconds: 60,
      failed_alert_seconds: 30,
      stale_agent_seconds: 30,
      failure_alert_enabled: true,
      snapshot_sync_interval_sec: 30,
      move_speed_px_per_sec: 120,
    },
    connection: {
      api_base_url: "http://127.0.0.1:4800",
      ws_url: "ws://127.0.0.1:4800/ws",
      masking_keys: ["password", "token", "secret", "api_key"],
    },
    session_tracking: {
      workspace_id_strategy: "repo_name",
      terminal_session_id_strategy: "env",
      default_view_scope: "workspace",
      heartbeat_interval_sec: 10,
    },
    motion_effects: {
      working_paper_effect_enabled: true,
      failed_scream_motion_enabled: true,
      resting_zzz_effect_enabled: true,
      motion_intensity: "normal",
    },
  },
});
console.log("settings initialized");

// 2. Event sequence — diverse state transitions for 5 agents
const scenario: Array<Record<string, unknown>> = [
  // Leader starts
  { event_name: "SubagentStart", session_id: "sess_1",
    agent_name: "leader", team_name: WORKSPACE,
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // 4 workers start
  ...["alice", "bob", "carol", "dave"].map((name) => ({
    event_name: "SubagentStart", session_id: `sess_${name}`,
    agent_name: name, team_name: WORKSPACE,
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN,
  })),

  // Leader creates task-1
  { event_name: "PreToolUse", session_id: "sess_1",
    agent_name: "leader", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { title: "Implement auth module" },
    task_id: "task-1",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // alice starts task-1
  { event_name: "PostToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "started" }, error: null,
    task_id: "task-1",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // alice uses a tool
  { event_name: "PreToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Bash", tool_input: { command: "npm test" },
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
  { event_name: "PostToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Bash", tool_input: { command: "npm test" }, error: null,
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // bob starts task-2, then fails
  { event_name: "PostToolUse", session_id: "sess_bob",
    agent_name: "bob", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "started" }, error: null,
    task_id: "task-2",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
  { event_name: "PostToolUse", session_id: "sess_bob",
    agent_name: "bob", team_name: WORKSPACE,
    tool_name: "Bash", tool_input: {},
    error: "permission denied: /etc/shadow",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // carol completes task-3
  { event_name: "PostToolUse", session_id: "sess_carol",
    agent_name: "carol", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "started" }, error: null,
    task_id: "task-3",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
  { event_name: "PostToolUse", session_id: "sess_carol",
    agent_name: "carol", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "completed" }, error: null,
    task_id: "task-3",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // dave gets blocked (Notification)
  { event_name: "Notification", session_id: "sess_dave",
    agent_name: "dave", team_name: WORKSPACE,
    level: "warn",
    summary: "Waiting for user approval",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },

  // alice completes task-1
  { event_name: "PostToolUse", session_id: "sess_alice",
    agent_name: "alice", team_name: WORKSPACE,
    tool_name: "Task", tool_input: { status: "completed" }, error: null,
    task_id: "task-1",
    workspace_id: WORKSPACE, terminal_session_id: TERMINAL, run_id: RUN },
];

for (const event of scenario) {
  await post("/ingest/hooks", event);
  console.log(`sent ${String(event.event_name)} -> ${String(event.agent_name)}`);
  await sleep(500);
}

console.log("\n=== seed-mock complete ===");
console.log("Expected states:");
console.log("  leader : idle (started, no task assigned)");
console.log("  alice  : completed -> roaming/breakroom/resting (post_complete_policy)");
console.log("  bob    : failed (permission denied)");
console.log("  carol  : completed -> roaming/breakroom/resting");
console.log("  dave   : pending_input (Notification blocked)");
