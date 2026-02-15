import { create } from "zustand";
import { useAgentStore } from "./agent-store";
import { useEventStore } from "./event-store";

type WsStatus = "idle" | "connecting" | "connected" | "disconnected";

type WsStore = {
  status: WsStatus;
  socket: WebSocket | null;
  connect: (url: string) => void;
  disconnect: () => void;
};

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

export const useWsStore = create<WsStore>((set, get) => {
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let currentUrl = "";

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (currentUrl && !get().socket) {
        connectWs(currentUrl);
      }
    }, delay);
  }

  function connectWs(url: string): void {
    currentUrl = url;
    set({ status: "connecting" });

    const ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      set({ status: "connected" });
      reconnectAttempt = 0;
    });

    ws.addEventListener("close", () => {
      set({ status: "disconnected", socket: null });
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close event will follow; reconnect is handled there
    });

    ws.addEventListener("message", (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          type?: string;
          data?: Record<string, unknown>;
        };

        if (msg.type === "event" && msg.data) {
          useEventStore.getState().add(msg.data);
        }

        if (msg.type === "state_update" && msg.data) {
          const d = msg.data as { agent_id: string; next_status: string; ts: string };
          useAgentStore.getState().upsert({
            agent_id: d.agent_id,
            status: d.next_status,
            last_event_ts: d.ts,
          });
        }
      } catch {
        // ignore malformed messages
      }
    });

    set({ socket: ws });
  }

  return {
    status: "idle",
    socket: null,
    connect: (url) => {
      if (get().socket) return;
      connectWs(url);
    },
    disconnect: () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectAttempt = 0;
      currentUrl = "";
      const ws = get().socket;
      if (ws) {
        ws.close();
        set({ socket: null, status: "disconnected" });
      }
    },
  };
});
