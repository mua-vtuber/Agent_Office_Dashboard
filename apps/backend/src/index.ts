import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
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
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  await registerIngestRoutes(app);
  await registerSnapshotRoutes(app);
  await registerAgentRoutes(app);
  await registerIntegrationRoutes(app);
  await registerSettingsRoutes(app);

  app.get("/api/health", async () => ({ ok: true }));

  app.server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
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
