import { db } from "./db";

const getStmt = db.prepare("SELECT value_json FROM settings WHERE key = ?");
const upsertStmt = db.prepare(`
INSERT INTO settings (key, value_json) VALUES (@key, @value_json)
ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
`);
const listStmt = db.prepare("SELECT key, value_json FROM settings ORDER BY key ASC");
export function getSetting<T = unknown>(key: string): T | null {
  const row = getStmt.get(key) as { value_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value_json) as T;
}

export function setSetting(key: string, value: unknown): void {
  upsertStmt.run({ key, value_json: JSON.stringify(value) });
}

export function listSettings(): Record<string, unknown> {
  const rows = listStmt.all() as Array<{ key: string; value_json: string }>;
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value_json);
  }
  return result;
}

/** Alias used by gateway/snapshot for bulk settings retrieval */
export const listSettingsObject = listSettings;

export function putSettings(partial: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(partial)) {
    upsertStmt.run({ key, value_json: JSON.stringify(value) });
  }
}
