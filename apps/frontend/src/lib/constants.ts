/** Shared key for persisted runtime connection settings. */
export const CONNECTION_STORAGE_KEY = "aod.connection.v1";

export const AUTH_TOKEN: string =
  (import.meta.env.VITE_DASHBOARD_TOKEN as string | undefined) ?? "";

function readConnectionFromStorage(): { api_base_url: string; ws_url: string } | null {
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { api_base_url: string; ws_url: string };
  } catch (error) {
    throw new Error(`invalid connection settings in localStorage: ${String(error)}`);
  }
}

function normalizeWsFromHttp(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) return `wss://${httpUrl.slice("https://".length)}/ws`;
  if (httpUrl.startsWith("http://")) return `ws://${httpUrl.slice("http://".length)}/ws`;
  throw new Error(`invalid api_base_url protocol: ${httpUrl}`);
}

function resolveApiBaseOrThrow(): string {
  const fromStorage = readConnectionFromStorage()?.api_base_url;
  if (typeof fromStorage === "string" && fromStorage.trim().length > 0) {
    return fromStorage;
  }

  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  throw new Error("api base URL is not configured");
}

function resolveWsBaseOrThrow(): string {
  const fromStorage = readConnectionFromStorage()?.ws_url;
  if (typeof fromStorage === "string" && fromStorage.trim().length > 0) {
    return fromStorage;
  }

  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv;
  }

  return normalizeWsFromHttp(resolveApiBaseOrThrow());
}

export function getBackendOrigin(): string {
  return resolveApiBaseOrThrow();
}

export function getWsUrl(): string {
  const base = resolveWsBaseOrThrow();
  if (!AUTH_TOKEN) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(AUTH_TOKEN)}`;
}

export function saveConnection(connection: { api_base_url: string; ws_url: string }): void {
  try {
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connection));
  } catch (error) {
    throw new Error(`failed to save connection settings: ${String(error)}`);
  }
}
