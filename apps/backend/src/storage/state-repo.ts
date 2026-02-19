import { db } from "./db";

export type StateRow = {
  agent_id: string;
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  status: string;
  position_x: number;
  position_y: number;
  home_position_x: number;
  home_position_y: number;
  facing: string;
  since: string;
  context_json: string;
  thinking_text: string | null;
  last_event_ts: string;
};

const upsert = db.prepare(`
INSERT INTO state_current (
  agent_id, workspace_id, terminal_session_id, run_id,
  status, position_x, position_y, home_position_x, home_position_y,
  facing, since, context_json, thinking_text, last_event_ts
) VALUES (
  @agent_id, @workspace_id, @terminal_session_id, @run_id,
  @status, @position_x, @position_y, @home_position_x, @home_position_y,
  @facing, @since, @context_json, @thinking_text, @last_event_ts
)
ON CONFLICT(agent_id) DO UPDATE SET
  workspace_id=excluded.workspace_id,
  terminal_session_id=excluded.terminal_session_id,
  run_id=excluded.run_id,
  status=excluded.status,
  position_x=excluded.position_x,
  position_y=excluded.position_y,
  home_position_x=excluded.home_position_x,
  home_position_y=excluded.home_position_y,
  facing=excluded.facing,
  since=excluded.since,
  context_json=excluded.context_json,
  thinking_text=COALESCE(excluded.thinking_text, state_current.thinking_text),
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
  home_position_x: number;
  home_position_y: number;
  facing: "left" | "right" | "up" | "down";
  since: string;
  context_json: string;
  thinking_text: string | null;
  last_event_ts: string;
}): void {
  upsert.run(input);
}

export function listStates(): StateRow[] {
  return db.prepare("SELECT * FROM state_current ORDER BY agent_id ASC").all() as StateRow[];
}

export function listStatesScoped(filter: {
  workspace_id?: string;
  terminal_session_id?: string;
  run_id?: string;
}): StateRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.workspace_id) {
    where.push("workspace_id = ?");
    args.push(filter.workspace_id);
  }
  if (filter.terminal_session_id) {
    where.push("terminal_session_id = ?");
    args.push(filter.terminal_session_id);
  }
  if (filter.run_id) {
    where.push("run_id = ?");
    args.push(filter.run_id);
  }
  const sql = `SELECT * FROM state_current ${
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY agent_id ASC`;
  return db.prepare(sql).all(...args) as StateRow[];
}

export function getState(agentId: string): StateRow | null {
  const row = db
    .prepare("SELECT * FROM state_current WHERE agent_id = ?")
    .get(agentId) as StateRow | undefined;
  return row ?? null;
}
