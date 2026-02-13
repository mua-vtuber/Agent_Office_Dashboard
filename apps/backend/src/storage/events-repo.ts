import { db } from "./db";
import type { NormalizedEvent } from "@aod/shared-schema";
import { nextStatus } from "../services/state-machine";

const insert = db.prepare(`
INSERT OR REPLACE INTO events (
  id, ts, type, workspace_id, terminal_session_id, run_id,
  source, agent_id, task_id, payload_json, raw_json
) VALUES (
  @id, @ts, @type, @workspace_id, @terminal_session_id, @run_id,
  @source, @agent_id, @task_id, @payload_json, @raw_json
)
`);

type EventRow = {
  id: string;
  ts: string;
  type: string;
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  source: string;
  agent_id: string;
  task_id: string | null;
  payload_json: string;
  raw_json: string;
};

type ScopeFilter = {
  workspace_id?: string;
  terminal_session_id?: string;
  run_id?: string;
};

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

export function listEventsScoped(limit = 200, filter: ScopeFilter = {}): EventRow[] {
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

  const sql = `SELECT * FROM events ${
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY ts DESC LIMIT ?`;

  return db.prepare(sql).all(...args, limit) as EventRow[];
}

export function listEventsByAgent(agentId: string, limit = 20): unknown[] {
  return db
    .prepare("SELECT * FROM events WHERE agent_id = ? ORDER BY ts DESC LIMIT ?")
    .all(agentId, limit);
}

export function latestHookEventTs(): string | null {
  const row = db
    .prepare("SELECT ts FROM events WHERE source = 'hook' ORDER BY ts DESC LIMIT 1")
    .get() as { ts?: string } | undefined;
  return row?.ts ?? null;
}

export function listScopes(): Array<{
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  last_event_ts: string;
}> {
  return db
    .prepare(
      `SELECT workspace_id, terminal_session_id, run_id, MAX(ts) as last_event_ts
       FROM events
       GROUP BY workspace_id, terminal_session_id, run_id
       ORDER BY last_event_ts DESC`
    )
    .all() as Array<{
      workspace_id: string;
      terminal_session_id: string;
      run_id: string;
      last_event_ts: string;
    }>;
}

export function getEventById(eventId: string): EventRow | null {
  const row = db.prepare("SELECT * FROM events WHERE id = ? LIMIT 1").get(eventId) as EventRow | undefined;
  return row ?? null;
}

export function listEventsBefore(ts: string, limit = 10): EventRow[] {
  return db
    .prepare("SELECT * FROM events WHERE ts < ? ORDER BY ts DESC LIMIT ?")
    .all(ts, limit) as EventRow[];
}

export function listEventsAfter(ts: string, limit = 10): EventRow[] {
  return db
    .prepare("SELECT * FROM events WHERE ts > ? ORDER BY ts ASC LIMIT ?")
    .all(ts, limit) as EventRow[];
}

export function computeAgentStatusAtTs(agentId: string, ts: string): {
  agent_id: string;
  status: string;
  event_count_until_pivot: number;
  last_event_ts: string | null;
} {
  const rows = db
    .prepare("SELECT * FROM events WHERE agent_id = ? AND ts <= ? ORDER BY ts ASC")
    .all(agentId, ts) as EventRow[];

  let status: string | undefined;
  for (const row of rows) {
    status = nextStatus(status, {
      id: row.id,
      version: "1.1",
      ts: row.ts,
      type: row.type as NormalizedEvent["type"],
      workspace_id: row.workspace_id,
      terminal_session_id: row.terminal_session_id,
      run_id: row.run_id,
      session_id: undefined,
      source: row.source as NormalizedEvent["source"],
      agent_id: row.agent_id,
      task_id: row.task_id ?? undefined,
      severity: "info",
      locale: undefined,
      payload: row.payload_json ? JSON.parse(row.payload_json) : {},
      raw: row.raw_json ? JSON.parse(row.raw_json) : {}
    });
  }

  return {
    agent_id: agentId,
    status: status ?? "idle",
    event_count_until_pivot: rows.length,
    last_event_ts: rows.at(-1)?.ts ?? null
  };
}
