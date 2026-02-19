import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { latestHookEventTs } from "../storage/events-repo";
import { insertHookError, listRecentHookErrors, type HookErrorRow } from "../storage/hook-errors-repo";
import { getMergedSettings } from "../services/settings-service";

type IntegrationStatus = {
  hooks_configured: boolean;
  last_checked_at: string;
  collector_reachable: boolean;
  last_hook_event_at: string | null;
  last_hook_event_age_sec: number | null;
  recent_hook_errors: HookErrorRow[];
  issues: string[];
  mode: "normal" | "degraded";
  checked_files: string[];
};

function workspaceRoot(): string {
  return process.env.AOD_WORKSPACE_ROOT ?? path.resolve(process.cwd(), "../..");
}

function hooksFiles(root: string): string[] {
  return [
    path.join(root, ".claude", "settings.json"),
    path.join(root, ".claude", "settings.local.json")
  ];
}

function hasHookCollectorConfig(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  return text.includes("/ingest/hooks");
}

function checkStatus(root: string): IntegrationStatus {
  const files = hooksFiles(root);
  const configured = files.some(hasHookCollectorConfig);
  const lastHookEventAt = latestHookEventTs();
  const now = Date.now();
  const lastHookAgeSec = lastHookEventAt
    ? Math.max(0, Math.floor((now - new Date(lastHookEventAt).getTime()) / 1000))
    : null;

  const settings = getMergedSettings();
  const staleThresholdSec = Math.max(
    settings.session_tracking.heartbeat_interval_sec * 3,
    settings.operations.stale_agent_seconds
  );
  const recentErrors = listRecentHookErrors(5);
  const latestError = recentErrors[0];
  const latestErrorAgeSec = latestError
    ? Math.max(0, Math.floor((now - new Date(latestError.ts).getTime()) / 1000))
    : null;

  const issues: string[] = [];
  if (!configured) {
    issues.push("hooks_not_configured");
  } else if (!lastHookEventAt) {
    issues.push("no_hook_events");
  } else if (lastHookAgeSec !== null && lastHookAgeSec > staleThresholdSec) {
    issues.push("hook_events_stale");
  }
  if (latestErrorAgeSec !== null && latestErrorAgeSec <= staleThresholdSec) {
    issues.push("hook_delivery_failed");
  }

  return {
    hooks_configured: configured,
    last_checked_at: new Date().toISOString(),
    collector_reachable: true,
    last_hook_event_at: lastHookEventAt,
    last_hook_event_age_sec: lastHookAgeSec,
    recent_hook_errors: recentErrors,
    issues,
    mode: issues.length === 0 ? "normal" : "degraded",
    checked_files: files
  };
}

function maskSensitiveText(input: string | null, maskingKeys: string[]): string | null {
  if (!input) return null;
  let out = input;
  for (const key of maskingKeys) {
    if (!key) continue;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const quoted = new RegExp(`("${escaped}"\\s*:\\s*")[^"]*(")`, "gi");
    const plain = new RegExp(`(${escaped}\\s*[=:]\\s*)[^\\s,;]+`, "gi");
    out = out.replace(quoted, `$1***$2`);
    out = out.replace(plain, `$1***`);
  }
  return out;
}

type HookEntry = { matcher?: string; command?: string; hooks?: Array<{ type?: string; command?: string }> };
type HooksMap = Record<string, HookEntry[]>;
type SettingsFile = Record<string, unknown> & { hooks?: HooksMap };
type MergeResult = { added: string[]; updated: string[]; skipped: string[]; backup?: string; error?: string };

function globalSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function templatePath(): string {
  return path.resolve(workspaceRoot(), "docs", "global-hooks-template.json");
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function aodRoot(): string {
  const root = process.env.AOD_ROOT ?? path.resolve(templatePath(), "../..");
  // Normalize to forward slashes so the path works inside shell commands on all platforms
  return root.replaceAll("\\", "/");
}

function readTemplateSettings(): { settings?: SettingsFile; template?: string; error?: string } {
  const tplPath = templatePath();
  if (!fs.existsSync(tplPath)) {
    return { error: `template not found: ${tplPath}` };
  }
  let settings: SettingsFile;
  let raw: string;
  try {
    raw = fs.readFileSync(tplPath, "utf8");
    raw = raw.replaceAll("{{AOD_ROOT}}", aodRoot());
    settings = JSON.parse(raw) as SettingsFile;
  } catch (e) {
    return { error: e instanceof Error ? `invalid template json: ${e.message}` : "invalid template json" };
  }
  if (!settings.hooks || typeof settings.hooks !== "object") {
    return { error: "template has no hooks section" };
  }
  return { settings, template: JSON.stringify(settings, null, 2) };
}

function extractCommands(entries: HookEntry[]): Set<string> {
  const cmds = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.command === "string" && entry.command) {
      cmds.add(entry.command);
    }
    if (Array.isArray(entry.hooks)) {
      for (const h of entry.hooks) {
        if (typeof h.command === "string" && h.command) cmds.add(h.command);
      }
    }
  }
  return cmds;
}

const AOD_HOOK_MARKER = "forward-to-aod";

function isAodCommand(cmd: string): boolean {
  return cmd.includes(AOD_HOOK_MARKER);
}

function mergeHooksIntoFile(targetPath: string, templateHooks: HooksMap): MergeResult {
  const targetSettings = readJsonFile(targetPath) as SettingsFile;
  const targetHooks = targetSettings.hooks && typeof targetSettings.hooks === "object" ? targetSettings.hooks : {};

  const added = new Set<string>();
  const updated = new Set<string>();
  const skipped = new Set<string>();

  for (const [eventType, templateEntries] of Object.entries(templateHooks)) {
    if (!Array.isArray(templateEntries) || templateEntries.length === 0) continue;
    const existingEntries = Array.isArray(targetHooks[eventType]) ? targetHooks[eventType] : [];
    const existingCmds = extractCommands(existingEntries);

    for (const templateEntry of templateEntries) {
      const templateCmds = extractCommands([templateEntry]);

      // Exact match → skip
      if (Array.from(templateCmds).some((cmd) => existingCmds.has(cmd))) {
        skipped.add(eventType);
        continue;
      }

      // Same AOD script with different path → update in place
      const isAodHook = Array.from(templateCmds).some(isAodCommand);
      if (isAodHook) {
        const idx = existingEntries.findIndex((entry) =>
          Array.from(extractCommands([entry])).some(isAodCommand),
        );
        if (idx !== -1) {
          existingEntries[idx] = templateEntry;
          updated.add(eventType);
          continue;
        }
      }

      existingEntries.push(templateEntry);
      for (const cmd of templateCmds) existingCmds.add(cmd);
      added.add(eventType);
    }

    targetHooks[eventType] = existingEntries;
  }

  if (added.size === 0 && updated.size === 0) {
    return { added: [], updated: [], skipped: Array.from(skipped) };
  }

  let backup: string | undefined;
  if (fs.existsSync(targetPath)) {
    backup = `${targetPath}.backup.${Date.now()}`;
    fs.copyFileSync(targetPath, backup);
  }

  targetSettings.hooks = targetHooks;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(targetSettings, null, 2) + "\n", "utf8");

  const result: MergeResult = { added: Array.from(added), updated: Array.from(updated), skipped: Array.from(skipped) };
  if (backup) result.backup = backup;
  return result;
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/integration/hook-error", async (request, reply) => {
    const body = (request.body ?? {}) as {
      workspace_id?: string;
      terminal_session_id?: string;
      run_id?: string;
      reason?: string;
      response_body?: string;
      collector_url?: string;
      ts?: string;
    };

    if (!body.reason || typeof body.reason !== "string") {
      reply.code(400);
      return { ok: false, message: "reason is required" };
    }

    insertHookError({
      ts: typeof body.ts === "string" ? body.ts : new Date().toISOString(),
      workspace_id: typeof body.workspace_id === "string" ? body.workspace_id : null,
      terminal_session_id: typeof body.terminal_session_id === "string" ? body.terminal_session_id : null,
      run_id: typeof body.run_id === "string" ? body.run_id : null,
      reason: body.reason,
      response_body: typeof body.response_body === "string" ? body.response_body.slice(0, 2000) : null,
      collector_url: typeof body.collector_url === "string" ? body.collector_url : null,
    });
    return { ok: true };
  });

  app.get("/api/integration/status", async () => {
    const root = workspaceRoot();
    return checkStatus(root);
  });

  app.get("/api/integration/hook-errors", async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limitRaw = Number(query.limit ?? 20);
    const offsetRaw = Number(query.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const settings = getMergedSettings();
    const maskingKeys = settings.connection.masking_keys;
    const rows = listRecentHookErrors(limit, offset).map((row) => ({
      ...row,
      response_body: maskSensitiveText(row.response_body, maskingKeys),
    }));

    return { errors: rows, limit, offset };
  });

  app.post("/api/integration/hooks/install", async (request) => {
    try {
      const body = (request.body ?? {}) as { mode?: "guide" | "write"; workspace_root?: string };
      const mode = body.mode ?? "guide";
      const root = body.workspace_root ?? workspaceRoot();
      const targetFile = path.join(root, ".claude", "settings.local.json");
      const templateResult = readTemplateSettings();

      if (templateResult.error || !templateResult.settings?.hooks || !templateResult.template) {
        return {
          ok: false,
          mode,
          message: templateResult.error ?? "failed to load hooks template",
          target_file: targetFile
        };
      }

      if (mode === "guide") {
        return {
          ok: true,
          mode: "guide",
          target_file: targetFile,
          template: templateResult.template,
          next_step: "Paste this template into .claude/settings.local.json then restart Claude Code session."
        };
      }

      const merged = mergeHooksIntoFile(targetFile, templateResult.settings.hooks);
      if (merged.error) {
        return {
          ok: false,
          mode: "write",
          message: merged.error,
          target_file: targetFile
        };
      }

      const changed = merged.added.length > 0 || merged.updated.length > 0;
      const parts: string[] = [];
      if (merged.added.length > 0) parts.push(`added: ${merged.added.join(", ")}`);
      if (merged.updated.length > 0) parts.push(`updated: ${merged.updated.join(", ")}`);
      return {
        ok: true,
        mode: "write",
        message: changed
          ? `hooks ${parts.join("; ")}`
          : "hooks already configured",
        target_file: targetFile,
        next_step: changed ? "Restart Claude Code session to activate hooks." : undefined
      };
    } catch (e) {
      return {
        ok: false,
        mode: "write",
        message: e instanceof Error ? e.message : "failed to install hooks"
      };
    }
  });

  /* ── Global hooks install (merge into ~/.claude/settings.json) ── */
  app.post("/api/integration/hooks/install-global", async () => {
    try {
      const templateResult = readTemplateSettings();
      if (templateResult.error || !templateResult.settings?.hooks) {
        return { ok: false, message: templateResult.error ?? "failed to load hooks template", added: [], skipped: [] };
      }
      const result = mergeHooksIntoFile(globalSettingsPath(), templateResult.settings.hooks);
      if (result.error) {
        return { ok: false, message: result.error, added: [], skipped: [] };
      }

      const changed = result.added.length > 0 || result.updated.length > 0;
      const parts: string[] = [];
      if (result.added.length > 0) parts.push(`added: ${result.added.join(", ")}`);
      if (result.updated.length > 0) parts.push(`updated: ${result.updated.join(", ")}`);
      return {
        ok: true,
        target_file: globalSettingsPath(),
        backup: result.backup ?? null,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        message: changed
          ? `Hooks ${parts.join("; ")}. Restart Claude Code to activate.`
          : "All hooks already configured. Nothing changed."
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "unknown error",
        added: [],
        skipped: []
      };
    }
  });
}
