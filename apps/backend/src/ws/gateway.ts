import { WebSocketServer } from "ws";

// --- Client metadata ---

type WsClient = {
  readyState: number;
  send: (data: string) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

type ClientMeta = {
  subscriptions: Set<string>;
};

const clientMeta = new WeakMap<object, ClientMeta>();

export const wss = new WebSocketServer({ noServer: true });

export function handleConnection(ws: WsClient): void {
  clientMeta.set(ws, { subscriptions: new Set() });

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
        ws.send(JSON.stringify({ type: "subscribed", scope: key }));
      } else if (msg.type === "unsubscribe") {
        const key = scopeKey(msg.workspace_id, msg.terminal_session_id, msg.run_id);
        meta.subscriptions.delete(key);
        ws.send(JSON.stringify({ type: "unsubscribed", scope: key }));
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: new Date().toISOString() }));
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid message format" }));
    }
  });
}

// --- Scope helpers ---

function scopeKey(w?: string, t?: string, r?: string): string {
  return `${w ?? "*"}:${t ?? "*"}:${r ?? "*"}`;
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
