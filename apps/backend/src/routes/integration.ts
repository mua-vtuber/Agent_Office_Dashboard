import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { latestHookEventTs } from "../storage/events-repo";
import { config } from "../config";

type IntegrationStatus = {
  hooks_configured: boolean;
  last_checked_at: string;
  collector_reachable: boolean;
  last_hook_event_at: string | null;
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

  return {
    hooks_configured: configured,
    last_checked_at: new Date().toISOString(),
    collector_reachable: true,
    last_hook_event_at: latestHookEventTs(),
    mode: configured ? "normal" : "degraded",
    checked_files: files
  };
}

type HookEntry = { matcher?: string; command?: string; hooks?: Array<{ type?: string; command?: string }> };
type HooksMap = Record<string, HookEntry[]>;
type SettingsFile = Record<string, unknown> & { hooks?: HooksMap };
type MergeResult = { added: string[]; skipped: string[]; backup?: string; error?: string };

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

function readTemplateSettings(): { settings?: SettingsFile; template?: string; error?: string } {
  const tplPath = templatePath();
  if (!fs.existsSync(tplPath)) {
    return { error: `template not found: ${tplPath}` };
  }
  let settings: SettingsFile;
  let raw: string;
  try {
    raw = fs.readFileSync(tplPath, "utf8");
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

function mergeHooksIntoFile(targetPath: string, templateHooks: HooksMap): MergeResult {
  const targetSettings = readJsonFile(targetPath) as SettingsFile;
  const targetHooks = targetSettings.hooks && typeof targetSettings.hooks === "object" ? targetSettings.hooks : {};

  const added = new Set<string>();
  const skipped = new Set<string>();

  for (const [eventType, templateEntries] of Object.entries(templateHooks)) {
    if (!Array.isArray(templateEntries) || templateEntries.length === 0) continue;
    const existingEntries = Array.isArray(targetHooks[eventType]) ? targetHooks[eventType] : [];
    const existingCmds = extractCommands(existingEntries);

    for (const templateEntry of templateEntries) {
      const templateCmds = extractCommands([templateEntry]);
      const duplicated = Array.from(templateCmds).some((cmd) => existingCmds.has(cmd));
      if (duplicated) {
        skipped.add(eventType);
        continue;
      }
      existingEntries.push(templateEntry);
      for (const cmd of templateCmds) existingCmds.add(cmd);
      added.add(eventType);
    }

    targetHooks[eventType] = existingEntries;
  }

  if (added.size === 0) {
    return { added: [], skipped: Array.from(skipped) };
  }

  let backup: string | undefined;
  if (fs.existsSync(targetPath)) {
    backup = `${targetPath}.backup.${Date.now()}`;
    fs.copyFileSync(targetPath, backup);
  }

  targetSettings.hooks = targetHooks;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(targetSettings, null, 2) + "\n", "utf8");

  const result: MergeResult = { added: Array.from(added), skipped: Array.from(skipped) };
  if (backup) result.backup = backup;
  return result;
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/integration/status", async () => {
    const root = workspaceRoot();
    return checkStatus(root);
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

      const changed = merged.added.length > 0;
      return {
        ok: true,
        mode: "write",
        message: changed
          ? `hooks merged for: ${merged.added.join(", ")}`
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

      return {
        ok: true,
        target_file: globalSettingsPath(),
        backup: result.backup ?? null,
        added: result.added,
        skipped: result.skipped,
        message:
          result.added.length > 0
            ? `Added hooks for: ${result.added.join(", ")}. Restart Claude Code to activate.`
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
