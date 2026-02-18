import type { FastifyInstance } from "fastify";
import { settingsSchema } from "@aod/shared-schema";
import { z } from "zod";
import { getSetting, setSetting, putSettings } from "../storage/settings-repo";
import { deepMerge, getMergedSettings } from "../services/settings-service";
import { serializeError } from "../utils/logging";

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "invalid settings payload";
  const path = first.path.length > 0 ? first.path.join(".") : "settings";
  return `${path}: ${first.message}`;
}

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

  app.put("/api/settings/:key", async (request, reply) => {
    const params = request.params as { key: string };
    const body = request.body as { value: unknown };

    const shape = settingsSchema.shape as Record<string, z.ZodTypeAny>;
    const keySchema = shape[params.key];
    if (!keySchema) {
      reply.code(400);
      return { ok: false, message: `unsupported setting key: ${params.key}` };
    }

    const parsed = keySchema.safeParse(body.value);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: formatZodError(parsed.error) };
    }

    setSetting(params.key, parsed.data);
    return { ok: true, key: params.key };
  });

  app.put("/api/settings", async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { settings?: Record<string, unknown> };
      const settings = body.settings ?? {};
      if (typeof settings !== "object" || Array.isArray(settings)) {
        reply.code(400);
        return { ok: false, message: "settings must be an object" };
      }

      const merged = deepMerge(
        getMergedSettings() as unknown as Record<string, unknown>,
        settings
      );
      const parsed = settingsSchema.safeParse(merged);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, message: formatZodError(parsed.error) };
      }

      putSettings(settings);
      return { ok: true, settings: parsed.data, server_ts: new Date().toISOString() };
    } catch (error) {
      app.log.error({ error: serializeError(error), request_id: request.id }, "failed to update settings");
      reply.code(500);
      return { ok: false, message: "failed to update settings" };
    }
  });
}
