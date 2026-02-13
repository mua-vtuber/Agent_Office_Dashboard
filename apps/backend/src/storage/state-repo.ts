import { db } from "./db";

const upsert = db.prepare(`
INSERT INTO state_current (
  agent_id, workspace_id, terminal_session_id, run_id,
  status, position_x, position_y, facing, last_event_ts
) VALUES (
  @agent_id, @workspace_id, @terminal_session_id, @run_id,
  @status, @position_x, @position_y, @facing, @last_event_ts
)
ON CONFLICT(agent_id) DO UPDATE SET
  workspace_id=excluded.workspace_id,
  terminal_session_id=excluded.terminal_session_id,
  run_id=excluded.run_id,
  status=excluded.status,
  position_x=excluded.position_x,
  position_y=excluded.position_y,
  facing=excluded.facing,
  last_event_ts=excluded.last_event_ts
`);

export function upsertState(input: {
  agent_id: string;
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  status: string;
  position_x: number;
  position_y: number;
  facing: "left" | "right" | "up" | "down";
  last_event_ts: string;
}): void {
  upsert.run(input);
}

export function listStates(): unknown[] {
  return db.prepare("SELECT * FROM state_current ORDER BY agent_id ASC").all();
}
