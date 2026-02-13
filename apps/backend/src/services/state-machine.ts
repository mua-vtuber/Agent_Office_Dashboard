import type { NormalizedEvent } from "@aod/shared-schema";

export function nextStatus(current: string | undefined, event: NormalizedEvent): string {
  const status = current ?? "idle";

  if (event.type === "agent_stopped") return "offline";
  if (event.type === "task_started") return "working";
  if (event.type === "task_completed") return "completed";
  if (event.type === "task_failed") return "failed";
  if (event.type === "tool_failed") return "pending_input";
  if (event.type === "manager_assign") return status === "working" ? "working" : "handoff";
  if (event.type === "meeting_started") return "meeting";
  if (event.type === "meeting_ended") return "returning";

  return status;
}
