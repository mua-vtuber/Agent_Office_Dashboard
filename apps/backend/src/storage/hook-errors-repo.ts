import { db } from "./db";

export type HookErrorRow = {
  id: number;
  ts: string;
  workspace_id: string | null;
  terminal_session_id: string | null;
  run_id: string | null;
  reason: string;
  response_body: string | null;
  collector_url: string | null;
};

const insertStmt = db.prepare(`
INSERT INTO integration_hook_errors (
  ts, workspace_id, terminal_session_id, run_id, reason, response_body, collector_url
) VALUES (
  @ts, @workspace_id, @terminal_session_id, @run_id, @reason, @response_body, @collector_url
)
`);

const listStmt = db.prepare(`
SELECT * FROM integration_hook_errors
ORDER BY ts DESC
LIMIT ? OFFSET ?
`);

export function insertHookError(input: {
  ts: string;
  workspace_id?: string | null;
  terminal_session_id?: string | null;
  run_id?: string | null;
  reason: string;
  response_body?: string | null;
  collector_url?: string | null;
}): void {
  insertStmt.run({
    ts: input.ts,
    workspace_id: input.workspace_id ?? null,
    terminal_session_id: input.terminal_session_id ?? null,
    run_id: input.run_id ?? null,
    reason: input.reason,
    response_body: input.response_body ?? null,
    collector_url: input.collector_url ?? null,
  });
}

export function listRecentHookErrors(limit = 5, offset = 0): HookErrorRow[] {
  return listStmt.all(limit, offset) as HookErrorRow[];
}
