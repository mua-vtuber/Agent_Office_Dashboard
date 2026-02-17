import type { FastifyInstance } from "fastify";
import { getSetting, setSetting, putSettings } from "../storage/settings-repo";
import { getMergedSettings } from "../services/settings-service";
import { serializeError } from "../utils/logging";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => {
    return { settings: getMergedSettings(), server_ts: new Date().toISOString() };
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

  app.put("/api/settings", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { settings?: Record<string, unknown> };
      const settings = body.settings ?? {};
      putSettings(settings);
      return { ok: true, settings: getMergedSettings(), server_ts: new Date().toISOString() };
    } catch (error) {
      app.log.error({ error: serializeError(error), request_id: request.id }, "failed to update settings");
      reply.code(500);
      return { ok: false, message: "failed to update settings" };
    }
  });
}
