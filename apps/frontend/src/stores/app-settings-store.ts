import { create } from "zustand";

export type SeatPosition = { x: number; y: number };
export type TransitionRule = { from: string; event: string; to: string };

export type AppSettings = {
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
    meeting_spots: Record<string, SeatPosition>;
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
};

const CONNECTION_STORAGE_KEY = "aod.connection.v1";

function loadConnectionFromStorage(): { api_base_url: string; ws_url: string } | null {
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { api_base_url: string; ws_url: string };
  } catch {
    return null;
  }
}

function saveConnectionToStorage(connection: { api_base_url: string; ws_url: string }): void {
  try {
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connection));
  } catch {
    // ignore storage failures
  }
}

type AppSettingsStore = {
  settings: AppSettings | null;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (partial: Record<string, unknown>) => Promise<void>;
  getApiBase: () => string;
  getWsUrl: () => string;
};

const FALLBACK_API = "http://127.0.0.1:4800";
const FALLBACK_WS = "ws://127.0.0.1:4800/ws";

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  settings: null,
  loaded: false,
  error: null,

  load: async () => {
    try {
      const apiBase = get().getApiBase();
      const res = await fetch(`${apiBase}/api/settings`);
      const json = (await res.json()) as { settings?: AppSettings };
      if (json.settings) {
        set({ settings: json.settings, loaded: true, error: null });
        if (json.settings.connection) {
          saveConnectionToStorage(json.settings.connection);
        }
      } else {
        set({ loaded: true });
      }
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : "failed to load settings" });
    }
  },

  update: async (partial) => {
    try {
      const apiBase = get().getApiBase();
      const res = await fetch(`${apiBase}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: partial }),
      });
      const json = (await res.json()) as { ok?: boolean; settings?: AppSettings };
      if (json.settings) {
        set({ settings: json.settings, error: null });
        if (json.settings.connection) {
          saveConnectionToStorage(json.settings.connection);
        }
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "failed to update settings" });
    }
  },

  getApiBase: () => {
    const s = get().settings;
    if (s?.connection?.api_base_url) return s.connection.api_base_url;
    const stored = loadConnectionFromStorage();
    if (stored?.api_base_url) return stored.api_base_url;
    return FALLBACK_API;
  },

  getWsUrl: () => {
    const s = get().settings;
    if (s?.connection?.ws_url) return s.connection.ws_url;
    const stored = loadConnectionFromStorage();
    if (stored?.ws_url) return stored.ws_url;
    return FALLBACK_WS;
  },
}));
