import { z } from "zod";

export const settingsSchema = z.object({
  general: z.object({
    language: z.enum(["ko", "en"]),
    timezone: z.string(),
    date_format: z.enum(["relative", "absolute"]),
    theme: z.string(),
    animation_speed: z.enum(["slow", "normal", "fast"])
  }),
  office_layout: z.object({
    layout_profile: z.string(),
    pantry_zone_enabled: z.boolean().default(true)
  }),
  operations: z.object({
    idle_to_breakroom_seconds: z.number(),
    idle_to_resting_seconds: z.number(),
    pending_input_alert_seconds: z.number(),
    failed_alert_seconds: z.number(),
    snapshot_sync_interval_sec: z.number()
  })
});

export type Settings = z.infer<typeof settingsSchema>;
