import { db } from "./db";

export type AgentRow = {
  agent_id: string;
  display_name: string;
  role: "manager" | "worker" | "specialist" | "unknown";
  employment_type: "employee" | "contractor";
  is_persisted: number; // SQLite boolean (0 | 1)
  source: "project_agent" | "runtime_agent" | "unknown";
  avatar_id: string | null;
  seat_x: number;
  seat_y: number;
  active: number; // SQLite boolean (0 | 1)
};

const upsertStmt = db.prepare(`
INSERT INTO agents (
  agent_id, display_name, role, employment_type,
  is_persisted, source, avatar_id, seat_x, seat_y, active
) VALUES (
  @agent_id, @display_name, @role, @employment_type,
  @is_persisted, @source, @avatar_id, @seat_x, @seat_y, @active
)
ON CONFLICT(agent_id) DO UPDATE SET
  display_name=excluded.display_name,
  role=excluded.role,
  employment_type=excluded.employment_type,
  is_persisted=excluded.is_persisted,
  source=excluded.source,
  avatar_id=excluded.avatar_id,
  seat_x=excluded.seat_x,
  seat_y=excluded.seat_y,
  active=excluded.active
`);

const getStmt = db.prepare("SELECT * FROM agents WHERE agent_id = ?");
const listActiveStmt = db.prepare("SELECT * FROM agents WHERE active = 1 ORDER BY agent_id ASC");
const listAllStmt = db.prepare("SELECT * FROM agents ORDER BY agent_id ASC");

export function upsertAgent(input: {
  agent_id: string;
  display_name: string;
  role: string;
  employment_type: string;
  is_persisted: boolean;
  source: string;
  avatar_id: string | null;
  seat_x: number;
  seat_y: number;
  active: boolean;
}): void {
  upsertStmt.run({
    ...input,
    is_persisted: input.is_persisted ? 1 : 0,
    active: input.active ? 1 : 0,
  });
}

export function getAgent(agentId: string): AgentRow | null {
  const row = getStmt.get(agentId) as AgentRow | undefined;
  return row ?? null;
}

export function listActiveAgents(): AgentRow[] {
  return listActiveStmt.all() as AgentRow[];
}

export function listAllAgents(): AgentRow[] {
  return listAllStmt.all() as AgentRow[];
}
