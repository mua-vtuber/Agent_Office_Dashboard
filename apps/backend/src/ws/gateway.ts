import { WebSocketServer } from "ws";

export const wss = new WebSocketServer({ noServer: true });

export function broadcast(message: unknown): void {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}
