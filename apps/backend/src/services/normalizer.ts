import { normalizedEventSchema, type NormalizedEvent, defaultSettings, type Settings } from "@aod/shared-schema";
import { config } from "../config";
import { getSetting } from "../storage/settings-repo";
import crypto from "node:crypto";

function nowIso(): string {
  return new Date().toISOString();
}

function makeFingerprint(
  sessionId: string,
  toolName: string,
  ts: string,
  payload: unknown,
): string {
  const tsBucket = ts.slice(0, 19); // second-level granularity
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 12);
  const raw = `${sessionId}|${toolName}|${tsBucket}|${payloadHash}`;
  return `evt_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

/**
 * Semantic event extraction (event-schema.md §5.2)
 *
 * Priority chain:
 *   SubagentStart/Stop (definitive)
 *   > Notification → agent_blocked
 *   > PreToolUse  → tool-name-based semantic inference
 *   > PostToolUse → tool-name + result-based confirmation
 *   > fallback    → schema_error
 */
function deriveSemanticType(
  rawEventName: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  error: unknown,
): NormalizedEvent["type"] {
  // 1. Definitive lifecycle events
  if (rawEventName === "SubagentStart") return "agent_started";
  if (rawEventName === "SubagentStop" || rawEventName === "Stop") return "agent_stopped";

  // 2. Notification → agent_blocked (#14)
  if (rawEventName === "Notification") return "agent_blocked";

  // 3. PreToolUse — tool-name-based semantic inference
  if (rawEventName === "PreToolUse") {
    if (toolName === "Task" || toolName === "TaskCreate") return "task_created";
    return "tool_started";
  }

  // 4. PostToolUse — result-based confirmation
  if (rawEventName === "PostToolUse") {
    if (error) return "tool_failed";

    if (toolName === "Task" || toolName === "TaskCreate") {
      const status = toolInput.status as string | undefined;
      if (status === "completed") return "task_completed";
      if (status === "failed") return "task_failed";
      if (status === "started") return "task_started";
      return "task_progress";
    }
    return "tool_succeeded";
  }

  return "schema_error";
}

function resolveLocale(input: Record<string, unknown>): string {
  if (typeof input.locale === "string" && input.locale.length > 0) {
    return input.locale;
  }
  const settings = getSetting<Settings>("app");
  const lang = settings?.general?.language ?? defaultSettings.general.language;
  return `${lang}-${lang.toUpperCase()}`;
}

type ContentBlock = { type: string; thinking?: string; text?: string };

function extractThinking(input: Record<string, unknown>): string | null {
  const message = input.message as { content?: ContentBlock[] } | undefined;
  if (!message || !Array.isArray(message.content)) return null;
  const thinkingBlocks = message.content.filter(
    (block): block is ContentBlock & { thinking: string } =>
      block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0,
  );
  if (thinkingBlocks.length === 0) return null;
  return thinkingBlocks[thinkingBlocks.length - 1]!.thinking;
}

export function normalizeHookEvent(input: Record<string, unknown>): NormalizedEvent {
  const rawEventName = (input.event_name ?? input.hook_event ?? "unknown") as string;
  const sessionId = String(input.session_id ?? "unknown-session");
  const agentName = String(input.agent_name ?? "leader");
  const teamName = String(input.team_name ?? config.defaultWorkspace);
  const toolName = String(input.tool_name ?? "");
  const toolInput = (typeof input.tool_input === "object" && input.tool_input !== null
    ? input.tool_input
    : {}) as Record<string, unknown>;
  const error = input.error;

  const type = deriveSemanticType(rawEventName, toolName, toolInput, error);
  const severity: NormalizedEvent["severity"] =
    error ? "error"
    : rawEventName === "Notification" && input.level === "error" ? "error"
    : "info";

  const ts = nowIso();

  const normalized = normalizedEventSchema.parse({
    id: makeFingerprint(sessionId, toolName, ts, input),
    version: "1.1",
    ts,
    type,
    source: "hook",
    workspace_id: String(input.workspace_id ?? teamName),
    terminal_session_id: String(input.terminal_session_id ?? sessionId),
    run_id: String(input.run_id ?? config.defaultRunId),
    session_id: sessionId,
    agent_id: `${teamName}/${agentName}`,
    target_agent_id: (input.target_agent_id as string | undefined) ?? null,
    task_id: (input.task_id as string | undefined) ?? null,
    severity,
    locale: resolveLocale(input),
    payload: {
      tool_name: toolName || undefined,
      error_message: typeof error === "string" ? error : undefined,
      summary: input.summary,
      thinking: extractThinking(input),
    },
    raw: {
      provider: "claude_code",
      event_name: rawEventName,
      payload: input,
    },
  });

  return normalized;
}
