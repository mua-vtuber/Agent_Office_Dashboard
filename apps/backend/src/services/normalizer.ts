import { normalizedEventSchema, type NormalizedEvent } from "@aod/shared-schema";
import { config } from "../config";
import crypto from "node:crypto";

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(payload: unknown): string {
  return `evt_${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)}`;
}

export function normalizeHookEvent(input: Record<string, unknown>): NormalizedEvent {
  const rawEventName = (input.event_name ?? input.hook_event ?? "unknown") as string;
  const sessionId = String(input.session_id ?? "unknown-session");
  const agentName = String(input.agent_name ?? "leader");
  const teamName = String(input.team_name ?? config.defaultWorkspace);
  const toolName = String(input.tool_name ?? "");
  const error = input.error;

  let type: NormalizedEvent["type"] = "schema_error";

  if (rawEventName === "SubagentStart") type = "agent_started";
  else if (rawEventName === "SubagentStop") type = "agent_stopped";
  else if (rawEventName === "PreToolUse") type = "tool_started";
  else if (rawEventName === "PostToolUse") type = error ? "tool_failed" : "tool_succeeded";
  else if (rawEventName === "Stop") type = "agent_stopped";

  const normalized = normalizedEventSchema.parse({
    id: makeId({ input, ts: nowIso() }),
    version: "1.1",
    ts: nowIso(),
    type,
    source: "hook",
    workspace_id: String(input.workspace_id ?? teamName),
    terminal_session_id: String(input.terminal_session_id ?? sessionId),
    run_id: String(input.run_id ?? config.defaultRunId),
    session_id: sessionId,
    agent_id: `${teamName}/${agentName}`,
    target_agent_id: null,
    task_id: (input.task_id as string | undefined) ?? null,
    severity: error ? "error" : "info",
    locale: "ko-KR",
    payload: {
      tool_name: toolName || undefined,
      error_message: typeof error === "string" ? error : undefined,
      summary: input.summary
    },
    raw: {
      provider: "claude_code",
      event_name: rawEventName,
      payload: input
    }
  });

  return normalized;
}
