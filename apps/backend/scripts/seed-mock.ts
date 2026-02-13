/* eslint-disable no-console */
import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = process.env.BACKEND_URL ?? "http://localhost:4800";

const events = [
  { event_name: "SubagentStart", session_id: "sess_1", team_name: "demo", agent_name: "leader" },
  { event_name: "PreToolUse", session_id: "sess_1", team_name: "demo", agent_name: "leader", tool_name: "TaskCreate" },
  { event_name: "PostToolUse", session_id: "sess_1", team_name: "demo", agent_name: "leader", tool_name: "TaskCreate", error: null },
  { event_name: "PreToolUse", session_id: "sess_1", team_name: "demo", agent_name: "worker-1", tool_name: "Bash" },
  { event_name: "PostToolUse", session_id: "sess_1", team_name: "demo", agent_name: "worker-1", tool_name: "Bash", error: null }
];

for (const e of events) {
  await fetch(`${baseUrl}/ingest/hooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(e)
  });
  console.log("sent", e.event_name);
  await sleep(700);
}
