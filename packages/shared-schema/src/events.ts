import { z } from "zod";

export const eventTypeSchema = z.enum([
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
  "schema_error"
]);

export const normalizedEventSchema = z.object({
  id: z.string(),
  version: z.string().default("1.1"),
  ts: z.string(),
  type: eventTypeSchema,
  source: z.enum(["hook", "sdk", "synthetic"]),
  workspace_id: z.string(),
  terminal_session_id: z.string(),
  run_id: z.string(),
  session_id: z.string().optional(),
  agent_id: z.string(),
  target_agent_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  severity: z.enum(["debug", "info", "warn", "error"]).default("info"),
  locale: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  raw: z.record(z.string(), z.unknown()).default({})
});

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
