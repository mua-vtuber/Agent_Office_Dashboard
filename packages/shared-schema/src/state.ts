export type AgentStatus =
  | "idle"
  | "working"
  | "handoff"
  | "meeting"
  | "returning"
  | "pending_input"
  | "failed"
  | "completed"
  | "roaming"
  | "breakroom"
  | "resting"
  | "offline";

export interface AgentState {
  agent_id: string;
  status: AgentStatus;
  position: { x: number; y: number };
  target_position: { x: number; y: number } | null;
  facing: "left" | "right" | "up" | "down";
  last_event_ts: string;
}
