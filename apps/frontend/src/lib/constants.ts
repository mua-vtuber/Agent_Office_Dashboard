const fallback = "http://127.0.0.1:4800";

export const BACKEND_ORIGIN: string =
  import.meta.env.VITE_BACKEND_ORIGIN ?? fallback;

export const AUTH_TOKEN: string =
  (import.meta.env.VITE_DASHBOARD_TOKEN as string | undefined) ?? "";

export const WS_URL: string = (() => {
  const base: string =
    (import.meta.env.VITE_WS_URL as string | undefined) ??
    BACKEND_ORIGIN.replace(/^http/, "ws") + "/ws";
  if (!AUTH_TOKEN) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(AUTH_TOKEN)}`;
})();
