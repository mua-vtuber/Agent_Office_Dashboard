/** Fallback URL used before settings are loaded (bootstrap). */
export const FALLBACK_BACKEND_ORIGIN = "http://127.0.0.1:4800";

export const AUTH_TOKEN: string =
  (import.meta.env.VITE_DASHBOARD_TOKEN as string | undefined) ?? "";

/**
 * Get the backend API origin dynamically.
 * Reads from app-settings-store if loaded, falls back to localStorage, then hardcoded default.
 */
export function getBackendOrigin(): string {
  try {
    // Lazy import to avoid circular dependency at module init time
    const { useAppSettingsStore } = require("../stores/app-settings-store") as {
      useAppSettingsStore: { getState: () => { getApiBase: () => string } };
    };
    return useAppSettingsStore.getState().getApiBase();
  } catch {
    return FALLBACK_BACKEND_ORIGIN;
  }
}

/**
 * Get the WebSocket URL dynamically.
 */
export function getWsUrl(): string {
  try {
    const { useAppSettingsStore } = require("../stores/app-settings-store") as {
      useAppSettingsStore: { getState: () => { getWsUrl: () => string } };
    };
    const base = useAppSettingsStore.getState().getWsUrl();
    if (!AUTH_TOKEN) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}token=${encodeURIComponent(AUTH_TOKEN)}`;
  } catch {
    return "ws://127.0.0.1:4800/ws";
  }
}

// Keep BACKEND_ORIGIN as alias for backward compatibility during migration
export const BACKEND_ORIGIN = FALLBACK_BACKEND_ORIGIN;
