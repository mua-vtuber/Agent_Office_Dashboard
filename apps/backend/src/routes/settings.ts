import type { FastifyInstance } from "fastify";
import { getSetting, setSetting, listSettings } from "../storage/settings-repo";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => {
    return { settings: listSettings() };
  });

  app.get("/api/settings/:key", async (request, reply) => {
    const params = request.params as { key: string };
    const value = getSetting(params.key);
    if (value === null) {
      reply.code(404);
      return { ok: false, message: "setting not found" };
    }
    return { key: params.key, value };
  });

  app.put("/api/settings/:key", async (request) => {
    const params = request.params as { key: string };
    const body = request.body as { value: unknown };
    setSetting(params.key, body.value);
    return { ok: true, key: params.key };
  });
}
