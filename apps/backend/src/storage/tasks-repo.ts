import { db } from "./db";

export type TaskRow = {
  id: string;
  title: string;
  status: "created" | "started" | "completed" | "failed";
  assignee_id: string | null;
  manager_id: string | null;
  created_at: string;
  updated_at: string;
};

const upsertStmt = db.prepare(`
INSERT INTO tasks (id, title, status, assignee_id, manager_id, created_at, updated_at)
VALUES (@id, @title, @status, @assignee_id, @manager_id, @created_at, @updated_at)
ON CONFLICT(id) DO UPDATE SET
  title=excluded.title,
  status=excluded.status,
  assignee_id=excluded.assignee_id,
  manager_id=excluded.manager_id,
  updated_at=excluded.updated_at
`);

const getStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
const listActiveStmt = db.prepare(
  "SELECT * FROM tasks WHERE status IN ('created','started') ORDER BY created_at DESC"
);
const listByAssigneeStmt = db.prepare(
  "SELECT * FROM tasks WHERE assignee_id = ? ORDER BY created_at DESC"
);
const listScopedStmt = db.prepare(
  "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?"
);

export function upsertTask(input: {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  manager_id: string | null;
  created_at: string;
  updated_at: string;
}): void {
  upsertStmt.run(input);
}

export function getTask(taskId: string): TaskRow | null {
  const row = getStmt.get(taskId) as TaskRow | undefined;
  return row ?? null;
}

export function listActiveTasks(): TaskRow[] {
  return listActiveStmt.all() as TaskRow[];
}

export function listTasksByAssignee(assigneeId: string): TaskRow[] {
  return listByAssigneeStmt.all(assigneeId) as TaskRow[];
}

export function listTasks(limit = 100): TaskRow[] {
  return listScopedStmt.all(limit) as TaskRow[];
}
