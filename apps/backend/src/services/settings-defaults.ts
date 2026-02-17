/**
 * Default settings for the Agent Office Dashboard.
 * These serve as the base that user overrides are merged onto.
 */

export type SeatPosition = { x: number; y: number };
export type MeetingSpot = { x: number; y: number };

export type TransitionRule = {
  from: string;   // AgentStatus or "*" for wildcard
  event: string;  // event type
  to: string;     // target AgentStatus
};

export interface AppSettings {
  general: {
    language: "ko" | "en";
    timezone: string;
    date_format: "relative" | "absolute";
    theme: string;
    animation_speed: "slow" | "normal" | "fast";
  };
  office_layout: {
    layout_profile: string;
    pantry_zone_enabled: boolean;
    seat_positions: Record<string, SeatPosition>;
    meeting_spots: Record<string, MeetingSpot>;
  };
  operations: {
    idle_to_breakroom_seconds: number;
    idle_to_resting_seconds: number;
    pending_input_alert_seconds: number;
    failed_alert_seconds: number;
    stale_agent_seconds: number;
    failure_alert_enabled: boolean;
    snapshot_sync_interval_sec: number;
  };
  connection: {
    api_base_url: string;
    ws_url: string;
  };
  transition_rules: TransitionRule[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    language: "ko",
    timezone: "Asia/Seoul",
    date_format: "relative",
    theme: "light",
    animation_speed: "normal",
  },
  office_layout: {
    layout_profile: "kr_t_left_v2",
    pantry_zone_enabled: true,
    seat_positions: {
      manager:   { x: 20, y: 18 },
      seat_01:   { x: 14, y: 30 },
      seat_02:   { x: 24, y: 30 },
      seat_03:   { x: 14, y: 46 },
      seat_04:   { x: 24, y: 46 },
      seat_05:   { x: 14, y: 62 },
      seat_06:   { x: 24, y: 62 },
      seat_07:   { x: 46, y: 30 },
      seat_08:   { x: 56, y: 30 },
      seat_09:   { x: 46, y: 46 },
      seat_10:   { x: 56, y: 46 },
      seat_11:   { x: 46, y: 62 },
      seat_12:   { x: 56, y: 62 },
    },
    meeting_spots: {
      meeting_a: { x: 40, y: 34 },
      meeting_b: { x: 40, y: 50 },
      meeting_c: { x: 40, y: 66 },
    },
  },
  operations: {
    idle_to_breakroom_seconds: 600,
    idle_to_resting_seconds: 1800,
    pending_input_alert_seconds: 120,
    failed_alert_seconds: 60,
    stale_agent_seconds: 300,
    failure_alert_enabled: true,
    snapshot_sync_interval_sec: 5,
  },
  connection: {
    api_base_url: "http://127.0.0.1:4800",
    ws_url: "ws://127.0.0.1:4800/ws",
  },
  transition_rules: [
    { from: "*", event: "agent_stopped", to: "offline" },
    { from: "*", event: "task_started", to: "working" },
    { from: "*", event: "task_completed", to: "completed" },
    { from: "*", event: "task_failed", to: "failed" },
    { from: "*", event: "tool_failed", to: "pending_input" },
    { from: "working", event: "manager_assign", to: "working" },
    { from: "*", event: "manager_assign", to: "handoff" },
    { from: "*", event: "meeting_started", to: "meeting" },
    { from: "*", event: "meeting_ended", to: "returning" },
  ],
};
