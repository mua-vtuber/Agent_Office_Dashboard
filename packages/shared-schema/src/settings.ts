import { z } from "zod";

// --- Sub-schemas for complex nested types ---

const pointSchema = z.object({ x: z.number(), y: z.number() });

export const seatPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const meetingSpotSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
});

const boundsSchema = z.object({
  x_min: z.number(),
  x_max: z.number(),
  y_min: z.number(),
  y_max: z.number(),
});

const deskSchema = z.object({
  id: z.string().min(1),
  x_min: z.number(),
  x_max: z.number(),
  y_min: z.number(),
  y_max: z.number(),
});

const officeZonesSchema = z.object({
  left_cluster: boundsSchema,
  center_block: boundsSchema,
  pantry_zone: boundsSchema,
  meeting_lane: boundsSchema,
  roam_zone: boundsSchema,
});

const postCompleteWeightsSchema = z.object({
  roaming: z.number().min(0).max(1),
  breakroom: z.number().min(0).max(1),
  resting: z.number().min(0).max(1),
});

const translationSettingsSchema = z.object({
  enabled: z.boolean(),
  api_endpoint: z.string().min(1),
  api_key: z.string(),
  model: z.string().min(1),
  target_language: z.string().min(1),
});

const thoughtBubbleSchema = z.object({
  enabled: z.boolean(),
  max_length: z.number().int().min(10).max(500),
  translation: translationSettingsSchema,
});

export const transitionRuleSchema = z.object({
  from: z.string(),
  event: z.string(),
  to: z.string(),
});

// --- Settings schema (settings-spec.md §2) ---

export const settingsSchema = z.object({
  /** §2.1 General */
  general: z.object({
    language: z.enum(["ko", "en"]),
    timezone: z.string().min(1),
    date_format: z.enum(["relative", "absolute"]),
    theme: z.enum(["office-light", "office-dark"]),
    animation_speed: z.enum(["slow", "normal", "fast"]),
  }),

  /** §2.2 i18n */
  i18n: z.object({
    fallback_language: z.enum(["ko", "en"]),
    number_locale: z.string().min(1),
    event_message_locale_mode: z.enum(["ui_locale", "event_locale"]),
  }),

  /** §2.3 Office Layout */
  office_layout: z.object({
    layout_profile: z.string().min(1),
    canvas_width: z.number().int().min(320).max(4096),
    canvas_height: z.number().int().min(240).max(4096),
    seat_positions: z.record(z.string(), seatPositionSchema),
    meeting_spots: z.record(z.string(), seatPositionSchema).default({}),
    desks: z.array(deskSchema).default([]),
    zones: officeZonesSchema,
    pantry_zone_enabled: z.boolean(),
    pantry_door_lane: boundsSchema,
    speech_bubble_enabled: z.boolean(),
    status_icon_enabled: z.boolean(),
  }),

  /** §2.4 Operations */
  operations: z.object({
    idle_to_breakroom_seconds: z.number().int().positive(),
    idle_to_resting_seconds: z.number().int().positive(),
    post_complete_policy: z.enum([
      "weighted_random",
      "roaming_only",
      "breakroom_only",
      "resting_only",
    ]),
    post_complete_weights: postCompleteWeightsSchema,
    pending_input_alert_seconds: z.number().int().positive(),
    failed_alert_seconds: z.number().int().positive(),
    stale_agent_seconds: z.number().int().positive(),
    failure_alert_enabled: z.boolean(),
    snapshot_sync_interval_sec: z.number().int().min(5).max(300),
    move_speed_px_per_sec: z.number().int().min(30).max(300),
  }),

  /** §2.5 Connection */
  connection: z.object({
    api_base_url: z.string().url(),
    ws_url: z.string().url(),
    masking_keys: z.array(z.string()),
  }),

  /** §2.6 Session Tracking */
  session_tracking: z.object({
    workspace_id_strategy: z.enum(["repo_name", "explicit"]),
    terminal_session_id_strategy: z.enum(["env", "generated"]),
    default_view_scope: z.enum(["workspace", "terminal_session", "all"]),
    heartbeat_interval_sec: z.number().int().min(2).max(60),
  }),

  /** §2.7 Motion and Effects */
  motion_effects: z.object({
    working_paper_effect_enabled: z.boolean(),
    failed_scream_motion_enabled: z.boolean(),
    resting_zzz_effect_enabled: z.boolean(),
    motion_intensity: z.enum(["low", "normal", "high"]),
  }),

  /** §2.8 Thought Bubble */
  thought_bubble: thoughtBubbleSchema,

  /** Dynamic transition rules (optional, from incoming) */
  transition_rules: z.array(transitionRuleSchema).optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SeatPosition = z.infer<typeof seatPositionSchema>;
export type Desk = z.infer<typeof deskSchema>;
export type TransitionRule = z.infer<typeof transitionRuleSchema>;

// --- Default values (settings-spec.md §3) ---

export const defaultSettings: Settings = {
  general: {
    language: "ko",
    timezone: "Asia/Seoul",
    date_format: "relative",
    theme: "office-light",
    animation_speed: "normal",
  },
  i18n: {
    fallback_language: "en",
    number_locale: "ko-KR",
    event_message_locale_mode: "ui_locale",
  },
  office_layout: {
    layout_profile: "kr_t_left_v2",
    canvas_width: 800,
    canvas_height: 560,
    seat_positions: {
      /* 팀장: T자 상단 가로 책상 아래 */
      manager: { x: 19, y: 18 },
      /* 왼쪽 T열: 4줄, 각 줄 좌(→)·우(←) 마주보기 */
      seat_01: { x: 10, y: 30 },  /* L1 왼쪽 → */
      seat_02: { x: 28, y: 30 },  /* L1 오른쪽 ← */
      seat_03: { x: 10, y: 43 },  /* L2 왼쪽 → */
      seat_04: { x: 28, y: 43 },  /* L2 오른쪽 ← */
      seat_05: { x: 10, y: 56 },  /* L3 왼쪽 → */
      seat_06: { x: 28, y: 56 },  /* L3 오른쪽 ← */
      seat_07: { x: 10, y: 69 },  /* L4 왼쪽 → */
      seat_08: { x: 28, y: 69 },  /* L4 오른쪽 ← */
      /* 오른쪽 I열: 4줄, 동일 마주보기 */
      seat_09: { x: 46, y: 30 },  /* R1 왼쪽 → */
      seat_10: { x: 64, y: 30 },  /* R1 오른쪽 ← */
      seat_11: { x: 46, y: 43 },  /* R2 왼쪽 → */
      seat_12: { x: 64, y: 43 },  /* R2 오른쪽 ← */
      seat_13: { x: 46, y: 56 },  /* R3 왼쪽 → */
      seat_14: { x: 64, y: 56 },  /* R3 오른쪽 ← */
      seat_15: { x: 46, y: 69 },  /* R4 왼쪽 → */
      seat_16: { x: 64, y: 69 },  /* R4 오른쪽 ← */
    },
    meeting_spots: {},
    desks: [
      /* 팀장 책상 — T자 가로 막대 */
      { id: "desk_mgr", x_min: 13, x_max: 25, y_min: 11, y_max: 15 },
      /* 왼쪽 T열: 세로 책상 4개 (좌우 마주보기 사이 칸막이) */
      { id: "desk_L1", x_min: 17, x_max: 21, y_min: 26, y_max: 34 },
      { id: "desk_L2", x_min: 17, x_max: 21, y_min: 39, y_max: 47 },
      { id: "desk_L3", x_min: 17, x_max: 21, y_min: 52, y_max: 60 },
      { id: "desk_L4", x_min: 17, x_max: 21, y_min: 65, y_max: 73 },
      /* 오른쪽 I열: 세로 책상 4개 */
      { id: "desk_R1", x_min: 53, x_max: 57, y_min: 26, y_max: 34 },
      { id: "desk_R2", x_min: 53, x_max: 57, y_min: 39, y_max: 47 },
      { id: "desk_R3", x_min: 53, x_max: 57, y_min: 52, y_max: 60 },
      { id: "desk_R4", x_min: 53, x_max: 57, y_min: 65, y_max: 73 },
    ],
    zones: {
      left_cluster: { x_min: 4, x_max: 34, y_min: 6, y_max: 80 },
      center_block: { x_min: 38, x_max: 70, y_min: 20, y_max: 80 },
      pantry_zone: { x_min: 76, x_max: 100, y_min: 0, y_max: 100 },
      meeting_lane: { x_min: 0, x_max: 0, y_min: 0, y_max: 0 },
      roam_zone: { x_min: 8, x_max: 70, y_min: 12, y_max: 92 },
    },
    pantry_zone_enabled: true,
    pantry_door_lane: { x_min: 64, x_max: 78, y_min: 84, y_max: 96 },
    speech_bubble_enabled: true,
    status_icon_enabled: true,
  },
  operations: {
    idle_to_breakroom_seconds: 180,
    idle_to_resting_seconds: 240,
    post_complete_policy: "weighted_random",
    post_complete_weights: { roaming: 0.4, breakroom: 0.4, resting: 0.2 },
    pending_input_alert_seconds: 60,
    failed_alert_seconds: 30,
    stale_agent_seconds: 30,
    failure_alert_enabled: true,
    snapshot_sync_interval_sec: 30,
    move_speed_px_per_sec: 120,
  },
  connection: {
    api_base_url: "http://127.0.0.1:4800",
    ws_url: "ws://127.0.0.1:4800/ws",
    masking_keys: ["password", "token", "secret", "api_key"],
  },
  session_tracking: {
    workspace_id_strategy: "repo_name",
    terminal_session_id_strategy: "env",
    default_view_scope: "workspace",
    heartbeat_interval_sec: 10,
  },
  motion_effects: {
    working_paper_effect_enabled: true,
    failed_scream_motion_enabled: true,
    resting_zzz_effect_enabled: true,
    motion_intensity: "normal",
  },
  thought_bubble: {
    enabled: true,
    max_length: 120,
    translation: {
      enabled: false,
      api_endpoint: "https://api.anthropic.com/v1/messages",
      api_key: "",
      model: "claude-haiku-4-5-20251001",
      target_language: "ko",
    },
  },
};
