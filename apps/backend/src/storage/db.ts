import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const dir = path.dirname(config.dbPath);
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");

// --- Base tables (v0) ---

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

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','worker','specialist','unknown')),
  employment_type TEXT NOT NULL CHECK(employment_type IN ('employee','contractor')),
  is_persisted INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK(source IN ('project_agent','runtime_agent','unknown')),
  avatar_id TEXT,
  seat_x REAL NOT NULL DEFAULT 0,
  seat_y REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('created','started','completed','failed')),
  assignee_id TEXT,
  manager_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  workspace_id TEXT NOT NULL,
  terminal_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  last_heartbeat_ts TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  PRIMARY KEY (workspace_id, terminal_session_id, run_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`);

// --- Migration v1: extend state_current with home_position, since, context ---

const versionRow = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
const userVersion = versionRow?.user_version ?? 0;

if (userVersion < 1) {
  db.exec(`
    ALTER TABLE state_current ADD COLUMN home_position_x REAL NOT NULL DEFAULT 0;
    ALTER TABLE state_current ADD COLUMN home_position_y REAL NOT NULL DEFAULT 0;
    ALTER TABLE state_current ADD COLUMN since TEXT NOT NULL DEFAULT '';
    ALTER TABLE state_current ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
  `);
  db.exec("PRAGMA user_version = 1");
}
