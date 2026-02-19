import { db } from "./db";

export type TaskRow = {
  task_id: string;
  agent_id: string;
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  status: "active" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_event_ts: string;
};

const upsert = db.prepare(`
INSERT INTO tasks (task_id, agent_id, workspace_id, terminal_session_id, run_id, status, started_at, completed_at, failed_at, last_event_ts)
VALUES (@task_id, @agent_id, @workspace_id, @terminal_session_id, @run_id, @status, @started_at, @completed_at, @failed_at, @last_event_ts)
ON CONFLICT(task_id) DO UPDATE SET
  agent_id=excluded.agent_id,
  workspace_id=excluded.workspace_id,
  terminal_session_id=excluded.terminal_session_id,
  run_id=excluded.run_id,
  status=excluded.status,
  started_at=COALESCE(excluded.started_at, tasks.started_at),
  completed_at=COALESCE(excluded.completed_at, tasks.completed_at),
  failed_at=COALESCE(excluded.failed_at, tasks.failed_at),
  last_event_ts=excluded.last_event_ts
`);

export function upsertTask(input: {
  task_id: string;
  agent_id: string;
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  status: "active" | "completed" | "failed";
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  last_event_ts: string;
}): void {
  upsert.run({
    task_id: input.task_id,
    agent_id: input.agent_id,
    workspace_id: input.workspace_id,
    terminal_session_id: input.terminal_session_id,
    run_id: input.run_id,
    status: input.status,
    started_at: input.started_at ?? null,
    completed_at: input.completed_at ?? null,
    failed_at: input.failed_at ?? null,
    last_event_ts: input.last_event_ts,
  });
}

export function listActiveTasks(): TaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE status = 'active' ORDER BY started_at DESC").all() as TaskRow[];
}

export function listTasksScoped(filter: {
  workspace_id?: string;
  terminal_session_id?: string;
  run_id?: string;
}): TaskRow[] {
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
  const sql = `SELECT * FROM tasks ${
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY started_at DESC`;
  return db.prepare(sql).all(...args) as TaskRow[];
}

export function getTask(taskId: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as TaskRow | undefined;
}
