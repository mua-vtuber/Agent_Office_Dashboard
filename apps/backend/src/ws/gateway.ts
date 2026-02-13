import { WebSocketServer } from "ws";
import { listEvents } from "../storage/events-repo";
import { listStates } from "../storage/state-repo";
import { listSettingsObject } from "../storage/settings-repo";

type WsClient = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  close: () => void;
};

type ClientMeta = {
  subscriptions: Set<string>;
};

const clientMeta = new WeakMap<object, ClientMeta>();

export const wss = new WebSocketServer({ noServer: true });

function sendJson(client: WsClient, message: unknown): void {
  if (client.readyState !== 1) return;
  client.send(JSON.stringify(message));
}

function snapshotPayload(): Record<string, unknown> {
  return {
    agents: listStates(),
    tasks: [],
    sessions: [],
    settings: listSettingsObject(),
    recent_events: listEvents(100),
    server_ts: new Date().toISOString(),
  };
}

// --- Scope helpers ---

function scopeKey(w?: string, t?: string, r?: string): string {
  return `${w ?? "*"}:${t ?? "*"}:${r ?? "*"}`;
}

// --- Connection handler ---

export function handleConnection(ws: WsClient): void {
  clientMeta.set(ws, { subscriptions: new Set() });

  sendJson(ws, { type: "snapshot", data: snapshotPayload() });

  const heartbeatTimer = setInterval(() => {
    sendJson(ws, { type: "heartbeat", ts: new Date().toISOString() });
  }, 15000);

  ws.on("message", (raw: unknown) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string;
        workspace_id?: string;
        terminal_session_id?: string;
        run_id?: string;
      };
      const meta = clientMeta.get(ws);
      if (!meta) return;

      if (msg.type === "subscribe") {
        const key = scopeKey(msg.workspace_id, msg.terminal_session_id, msg.run_id);
        meta.subscriptions.add(key);
        sendJson(ws, { type: "snapshot", data: snapshotPayload() });
      } else if (msg.type === "unsubscribe") {
        const key = scopeKey(msg.workspace_id, msg.terminal_session_id, msg.run_id);
        meta.subscriptions.delete(key);
        sendJson(ws, { type: "unsubscribed", scope: key });
      } else if (msg.type === "ping") {
        sendJson(ws, { type: "pong", ts: new Date().toISOString() });
      }
    } catch {
      sendJson(ws, { type: "error", message: "invalid message format" });
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeatTimer);
  });
}

// --- Broadcast ---

export function broadcast(
  message: unknown,
  scope?: { workspace_id: string; terminal_session_id: string; run_id: string },
): void {
  const payload = JSON.stringify(message);
  const eventKey = scope ? scopeKey(scope.workspace_id, scope.terminal_session_id, scope.run_id) : null;

  for (const client of wss.clients) {
    if ((client as { readyState: number }).readyState !== 1) continue;

    const meta = clientMeta.get(client);

    // No subscriptions → receive everything (backwards compatible)
    // Has subscriptions → only matching scope or wildcard
    if (meta && meta.subscriptions.size > 0 && eventKey) {
      const matches =
        meta.subscriptions.has(eventKey) ||
        meta.subscriptions.has(scopeKey("*", "*", "*"));
      if (!matches) continue;
    }

    (client as { send: (data: string) => void }).send(payload);
  }
}
