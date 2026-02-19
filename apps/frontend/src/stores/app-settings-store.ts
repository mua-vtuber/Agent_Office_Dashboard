import { create } from "zustand";
import type { Settings } from "@aod/shared-schema";
import { apiGet, apiPut } from "../lib/api";
import { useErrorStore } from "./error-store";
import { CONNECTION_STORAGE_KEY } from "../lib/constants";

export type { SeatPosition, TransitionRule } from "@aod/shared-schema";

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
  } catch (error) {
    throw new Error(`failed to persist connection settings: ${String(error)}`);
  }
}

type AppSettingsStore = {
  settings: Settings | null;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (partial: Record<string, unknown>) => Promise<void>;
  getApiBase: () => string;
  getWsUrl: () => string;
};

function normalizeWsFromHttp(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) return `wss://${httpUrl.slice("https://".length)}/ws`;
  if (httpUrl.startsWith("http://")) return `ws://${httpUrl.slice("http://".length)}/ws`;
  throw new Error(`invalid api_base_url protocol: ${httpUrl}`);
}

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  settings: null,
  loaded: false,
  error: null,

  load: async () => {
    try {
      const json = await apiGet<{ settings?: Settings }>("/api/settings");
      if (json.settings) {
        set({ settings: json.settings, loaded: true, error: null });
        if (json.settings.connection) {
          saveConnectionToStorage(json.settings.connection);
        }
      } else {
        set({ loaded: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed to load settings";
      set({ loaded: true, error: msg });
      useErrorStore.getState().push("Settings", msg);
    }
  },

  update: async (partial) => {
    try {
      const json = await apiPut<{ ok?: boolean; settings?: Settings }>("/api/settings", { settings: partial });
      if (!json.ok) {
        throw new Error("settings update rejected");
      }
      if (json.settings) {
        set({ settings: json.settings, error: null });
        if (json.settings.connection) {
          saveConnectionToStorage(json.settings.connection);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed to update settings";
      set({ error: msg });
      useErrorStore.getState().push("Settings", msg);
      throw new Error(msg);
    }
  },

  getApiBase: () => {
    const s = get().settings;
    if (s?.connection?.api_base_url) return s.connection.api_base_url;
    const stored = loadConnectionFromStorage();
    if (stored?.api_base_url) return stored.api_base_url;
    const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
    if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
    throw new Error("api base URL is not configured");
  },

  getWsUrl: () => {
    const s = get().settings;
    if (s?.connection?.ws_url) return s.connection.ws_url;
    const stored = loadConnectionFromStorage();
    if (stored?.ws_url) return stored.ws_url;
    const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
    if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
    return normalizeWsFromHttp(get().getApiBase());
  },
}));
