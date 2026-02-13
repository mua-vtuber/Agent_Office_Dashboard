import { db } from "./db";
import type { NormalizedEvent } from "@aod/shared-schema";

const insert = db.prepare(`
INSERT OR REPLACE INTO events (
  id, ts, type, workspace_id, terminal_session_id, run_id,
  source, agent_id, task_id, payload_json, raw_json
) VALUES (
  @id, @ts, @type, @workspace_id, @terminal_session_id, @run_id,
  @source, @agent_id, @task_id, @payload_json, @raw_json
)
`);

export function insertEvent(event: NormalizedEvent): void {
  insert.run({
    ...event,
    task_id: event.task_id ?? null,
    payload_json: JSON.stringify(event.payload ?? {}),
    raw_json: JSON.stringify(event.raw ?? {})
  });
}

export function listEvents(limit = 100): unknown[] {
  return db.prepare("SELECT * FROM events ORDER BY ts DESC LIMIT ?").all(limit);
}

export function listEventsByAgent(agentId: string, limit = 20): unknown[] {
  return db
    .prepare("SELECT * FROM events WHERE agent_id = ? ORDER BY ts DESC LIMIT ?")
    .all(agentId, limit);
}
