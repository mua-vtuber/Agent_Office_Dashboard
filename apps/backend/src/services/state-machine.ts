import type { NormalizedEvent, AgentStatus, Settings } from "@aod/shared-schema";
import { getMergedSettings } from "./settings-service";

// --- TransitionContext ---

export interface TransitionContext {
  current: AgentStatus;
  event: NormalizedEvent;
  since: string;
  settings: Settings;
}

// --- Transition table ---

type TransitionRule = {
  from: AgentStatus | "*";
  event: NormalizedEvent["type"];
  condition?: (ctx: TransitionContext) => boolean;
  to: AgentStatus;
};

const FATAL_PATTERNS = ["permission denied", "not found", "enoent"];

function isFatalError(event: NormalizedEvent): boolean {
  const msg = String(event.payload?.error_message ?? "").toLowerCase();
  return FATAL_PATTERNS.some((p) => msg.includes(p));
}

const transitionTable: TransitionRule[] = [
  // --- Agent lifecycle ---
  { from: "*",              event: "agent_started",     to: "idle" },
  { from: "*",              event: "agent_stopped",     to: "offline" },

  // --- Task flow (from idle/seated states) ---
  { from: "idle",           event: "task_started",      to: "working" },
  { from: "working",        event: "task_completed",    to: "completed" },
  { from: "working",        event: "task_failed",       to: "failed" },
  { from: "completed",      event: "task_started",      to: "working" },

  // --- Task flow (from off-duty states → returning first) ---
  { from: "roaming",        event: "task_started",      to: "returning" },
  { from: "breakroom",      event: "task_started",      to: "returning" },
  { from: "resting",        event: "task_started",      to: "returning" },

  // --- tool_failed: fatal → failed, retryable → pending_input ---
  { from: "working",        event: "tool_failed",       to: "failed",
    condition: (ctx) => isFatalError(ctx.event) },
  { from: "working",        event: "tool_failed",       to: "pending_input" },

  // --- Recovery ---
  { from: "failed",         event: "agent_unblocked",   to: "working" },
  { from: "pending_input",  event: "agent_unblocked",   to: "working" },

  // --- Collaboration (from idle) ---
  { from: "idle",           event: "manager_assign",    to: "handoff" },
  { from: "working",        event: "manager_assign",    to: "working" },

  // --- Collaboration (from off-duty states → handoff) ---
  { from: "roaming",        event: "manager_assign",    to: "handoff" },
  { from: "breakroom",      event: "manager_assign",    to: "handoff" },
  { from: "resting",        event: "manager_assign",    to: "handoff" },

  // --- Meeting choreography ---
  { from: "handoff",        event: "meeting_started",   to: "meeting" },
  { from: "meeting",        event: "meeting_ended",     to: "returning" },

  // --- Blocked agents ---
  { from: "working",        event: "agent_blocked",     to: "pending_input" },
  { from: "idle",           event: "agent_blocked",     to: "pending_input" },
];

const KNOWN_STATUSES = new Set<AgentStatus>([
  "idle",
  "working",
  "handoff",
  "meeting",
  "returning",
  "pending_input",
  "failed",
  "completed",
  "roaming",
  "breakroom",
  "resting",
  "offline",
]);

const KNOWN_EVENTS = new Set<NormalizedEvent["type"]>([
  "agent_started",
  "agent_stopped",
  "agent_blocked",
  "agent_unblocked",
  "task_created",
  "manager_assign",
  "agent_acknowledged",
  "task_started",
  "task_progress",
  "task_completed",
  "task_failed",
  "meeting_requested",
  "meeting_started",
  "meeting_ended",
  "tool_started",
  "tool_succeeded",
  "tool_failed",
  "heartbeat",
  "schema_error",
]);

function toDynamicRules(settings: Settings): TransitionRule[] {
  const source = settings.transition_rules;
  if (!Array.isArray(source)) return [];

  const rules: TransitionRule[] = [];
  for (const raw of source) {
    const from = raw.from;
    const event = raw.event;
    const to = raw.to;

    if (from !== "*" && !KNOWN_STATUSES.has(from as AgentStatus)) continue;
    if (!KNOWN_EVENTS.has(event as NormalizedEvent["type"])) continue;
    if (!KNOWN_STATUSES.has(to as AgentStatus)) continue;

    rules.push({
      from: from as AgentStatus | "*",
      event: event as NormalizedEvent["type"],
      to: to as AgentStatus,
    });
  }

  return rules;
}

// --- Core transition function ---

export function nextStatus(ctx: TransitionContext): AgentStatus {
  const rules = [...toDynamicRules(ctx.settings), ...transitionTable];
  for (const rule of rules) {
    if (rule.from !== "*" && rule.from !== ctx.current) continue;
    if (rule.event !== ctx.event.type) continue;
    if (rule.condition && !rule.condition(ctx)) continue;
    return rule.to;
  }
  return ctx.current;
}

// --- Convenience: old-style signature for replay (events-repo) ---

export function nextStatusSimple(
  current: AgentStatus | undefined,
  event: NormalizedEvent,
): AgentStatus {
  return nextStatus({
    current: current ?? "idle",
    event,
    since: event.ts,
    settings: getAppSettings(),
  });
}

// --- Timer transitions ---

export function checkTimerTransitions(
  status: AgentStatus,
  since: string,
  settings: Settings,
): AgentStatus | null {
  const elapsed = (Date.now() - new Date(since).getTime()) / 1000;

  if (status === "idle" && elapsed > settings.operations.idle_to_resting_seconds) {
    return "resting";
  }
  if (status === "idle" && elapsed > settings.operations.idle_to_breakroom_seconds) {
    return "breakroom";
  }
  if (status === "handoff" && elapsed > 10) {
    return "returning";
  }
  if (status === "meeting" && elapsed > 15) {
    return "returning";
  }
  return null;
}

// --- Post-complete policy ---

export function resolvePostComplete(settings: Settings): AgentStatus {
  const policy = settings.operations.post_complete_policy;
  if (policy === "roaming_only") return "roaming";
  if (policy === "breakroom_only") return "breakroom";
  if (policy === "resting_only") return "resting";

  const w = settings.operations.post_complete_weights;
  const r = Math.random();
  if (r < w.roaming) return "roaming";
  if (r < w.roaming + w.breakroom) return "breakroom";
  return "resting";
}

// --- Settings helper ---

function getAppSettings(): Settings {
  return getMergedSettings();
}

export { getAppSettings };
