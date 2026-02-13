import { create } from "zustand";
import { useAgentStore } from "./agent-store";
import { useEventStore } from "./event-store";

type WsStatus = "idle" | "connecting" | "connected" | "disconnected";

type WsStore = {
  status: WsStatus;
  socket: WebSocket | null;
  connect: (url: string) => void;
};

export const useWsStore = create<WsStore>((set, get) => ({
  status: "idle",
  socket: null,
  connect: (url) => {
    if (get().socket) return;

    set({ status: "connecting" });
    const ws = new WebSocket(url);

    ws.addEventListener("open", () => set({ status: "connected" }));
    ws.addEventListener("close", () => set({ status: "disconnected", socket: null }));

    ws.addEventListener("message", (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type === "event") {
          useEventStore.getState().add(msg.data);
        }
        if (msg.type === "state_update") {
          const d = msg.data as { agent_id: string; next_status: string; ts: string };
          useAgentStore.getState().upsert({
            agent_id: d.agent_id,
            status: d.next_status,
            last_event_ts: d.ts
          });
        }
      } catch {
        // ignore malformed message in MVP shell
      }
    });

    set({ socket: ws });
  }
}));
