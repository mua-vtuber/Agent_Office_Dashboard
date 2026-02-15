import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { config } from "../config";

/**
 * Bearer token authentication guard.
 *
 * - If DASHBOARD_TOKEN env var is empty → auth disabled (dev mode).
 * - Otherwise validates Authorization: Bearer <token> header.
 * - /api/health is excluded (caller responsibility).
 */
export function authGuard(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  if (!config.authToken) {
    done();
    return;
  }

  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    void reply.code(401).send({
      ok: false,
      error: "Authorization header required: Bearer <token>",
    });
    return;
  }

  const token = header.slice(7);
  if (token !== config.authToken) {
    void reply.code(403).send({ ok: false, error: "Invalid token" });
    return;
  }

  done();
}
