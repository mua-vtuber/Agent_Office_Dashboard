const fallback = "http://127.0.0.1:4800";

export const BACKEND_ORIGIN: string =
  import.meta.env.VITE_BACKEND_ORIGIN ?? fallback;

export const WS_URL: string =
  import.meta.env.VITE_WS_URL ??
  BACKEND_ORIGIN.replace(/^http/, "ws") + "/ws";
