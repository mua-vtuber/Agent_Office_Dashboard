import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
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

function hookTemplate(): string {
  const origin = `http://127.0.0.1:${config.port}`;
  const curlCmd = (hook: string) =>
    `curl -s -m 2 -X POST ${origin}/ingest/hooks -H 'Content-Type: application/json' -d \\"$(cat)\\" || true`;
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [{ command: curlCmd("PreToolUse") }],
        PostToolUse: [{ command: curlCmd("PostToolUse") }],
        SubagentStart: [{ command: curlCmd("SubagentStart") }],
        SubagentStop: [{ command: curlCmd("SubagentStop") }],
        Stop: [{ command: curlCmd("Stop") }],
        Notification: [{ command: curlCmd("Notification") }],
      },
    },
    null,
    2,
  );
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/integration/status", async () => {
    const root = workspaceRoot();
    return checkStatus(root);
  });

  app.post("/api/integration/hooks/install", async (request) => {
    const body = (request.body ?? {}) as { mode?: "guide" | "write"; workspace_root?: string };
    const mode = body.mode ?? "guide";
    const root = body.workspace_root ?? workspaceRoot();
    const targetFile = path.join(root, ".claude", "settings.local.json");

    if (mode === "guide") {
      return {
        ok: true,
        mode: "guide",
        target_file: targetFile,
        template: hookTemplate(),
        next_step: "Paste this template into .claude/settings.local.json then restart Claude Code session."
      };
    }

    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    if (fs.existsSync(targetFile)) {
      const existing = fs.readFileSync(targetFile, "utf8");
      if (!existing.includes("/ingest/hooks")) {
        return {
          ok: false,
          mode: "write",
          message: "target file already exists and was not modified",
          target_file: targetFile,
          template: hookTemplate
        };
      }
      return {
        ok: true,
        mode: "write",
        message: "hooks already configured",
        target_file: targetFile
      };
    }

    fs.writeFileSync(targetFile, hookTemplate(), "utf8");
    return {
      ok: true,
      mode: "write",
      message: "hooks template installed",
      target_file: targetFile,
      next_step: "Restart Claude Code session to activate hooks."
    };
  });
}
