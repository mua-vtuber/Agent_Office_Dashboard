import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const dir = path.dirname(config.dbPath);
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  terminal_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  payload_json TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_scope_ts
ON events (workspace_id, terminal_session_id, run_id, ts);

CREATE TABLE IF NOT EXISTS state_current (
  agent_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  terminal_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  facing TEXT NOT NULL,
  last_event_ts TEXT NOT NULL
);
`);
