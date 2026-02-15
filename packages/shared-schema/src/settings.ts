import { z } from "zod";

// --- Sub-schemas for complex nested types ---

const pointSchema = z.object({ x: z.number(), y: z.number() });

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

const postCompleteWeightsSchema = z.object({
  roaming: z.number().min(0).max(1),
  breakroom: z.number().min(0).max(1),
  resting: z.number().min(0).max(1),
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
    seat_positions: z.record(z.string(), pointSchema),
    meeting_spots: z.array(meetingSpotSchema).min(1),
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
});

export type Settings = z.infer<typeof settingsSchema>;

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
    seat_positions: {},
    meeting_spots: [{ id: "m1", x: 40, y: 48 }],
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
};
