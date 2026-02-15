import { db } from "./db";

export type SessionRow = {
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  last_heartbeat_ts: string;
  status: "active" | "inactive";
};

const upsertStmt = db.prepare(`
INSERT INTO sessions (workspace_id, terminal_session_id, run_id, last_heartbeat_ts, status)
VALUES (@workspace_id, @terminal_session_id, @run_id, @last_heartbeat_ts, @status)
ON CONFLICT(workspace_id, terminal_session_id, run_id) DO UPDATE SET
  last_heartbeat_ts=excluded.last_heartbeat_ts,
  status=excluded.status
`);

const listActiveStmt = db.prepare(
  "SELECT * FROM sessions WHERE status = 'active' ORDER BY last_heartbeat_ts DESC"
);

const listAllStmt = db.prepare(
  "SELECT * FROM sessions ORDER BY last_heartbeat_ts DESC"
);

const getStmt = db.prepare(
  "SELECT * FROM sessions WHERE workspace_id = ? AND terminal_session_id = ? AND run_id = ?"
);

const markInactiveStmt = db.prepare(`
UPDATE sessions SET status = 'inactive'
WHERE status = 'active'
  AND last_heartbeat_ts < ?
`);

export function upsertSession(input: {
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  last_heartbeat_ts: string;
  status: "active" | "inactive";
}): void {
  upsertStmt.run(input);
}

export function getSession(
  workspaceId: string,
  terminalSessionId: string,
  runId: string
): SessionRow | null {
  const row = getStmt.get(workspaceId, terminalSessionId, runId) as SessionRow | undefined;
  return row ?? null;
}

export function listActiveSessions(): SessionRow[] {
  return listActiveStmt.all() as SessionRow[];
}

export function listAllSessions(): SessionRow[] {
  return listAllStmt.all() as SessionRow[];
}

export function markStaleSessions(cutoffTs: string): number {
  const result = markInactiveStmt.run(cutoffTs) as { changes: number };
  return result.changes;
}
