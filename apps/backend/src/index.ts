import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { authGuard } from "./middleware/auth";
import { registerIngestRoutes } from "./routes/ingest";
import { registerSnapshotRoutes } from "./routes/snapshot";
import { registerAgentRoutes } from "./routes/agents";
import { registerIntegrationRoutes } from "./routes/integration";
import { registerSettingsRoutes } from "./routes/settings";
import { wss, handleConnection } from "./ws/gateway";
import { startHeartbeat } from "./services/heartbeat";

async function start(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.corsOrigin || true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  if (!config.authToken) {
    app.log.warn("DASHBOARD_TOKEN not set — authentication disabled (development mode)");
  }

  // /api/health — unauthenticated (load balancer / monitoring)
  app.get("/api/health", async () => ({ ok: true }));

  // Auth guard for all other routes
  app.addHook("preHandler", (request, reply, done) => {
    if (request.url === "/api/health") { done(); return; }
    authGuard(request, reply, done);
  });

  await registerIngestRoutes(app);
  await registerSnapshotRoutes(app);
  await registerAgentRoutes(app);
  await registerIntegrationRoutes(app);
  await registerSettingsRoutes(app);

  app.server.on("upgrade", (request, socket, head) => {
    if (request.url?.startsWith("/ws") !== true) {
      socket.destroy();
      return;
    }

    // WS auth via query parameter: /ws?token=<token>
    if (config.authToken) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (token !== config.authToken) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws: unknown) => {
      handleConnection(ws as Parameters<typeof handleConnection>[0]);
      wss.emit("connection", ws, request);
    });
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`backend listening on http://${config.host}:${config.port}`);

  startHeartbeat();
  app.log.info("heartbeat ticker started");
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
