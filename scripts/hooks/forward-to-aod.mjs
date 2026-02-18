#!/usr/bin/env node

// forward-to-aod.mjs — Cross-platform Claude Code hook forwarder
// Reads hook payload from stdin, enriches with metadata, POSTs to AOD collector.
// No external dependencies — uses only Node.js built-ins (Node 18+).

import { basename } from "node:path";
import { execFileSync } from "node:child_process";

const env = process.env;
const collectorUrl =
  env.AOD_COLLECTOR_URL ?? "http://127.0.0.1:4800/ingest/hooks";
const integrationErrorUrl =
  env.AOD_INTEGRATION_ERROR_URL ??
  collectorUrl.replace(/\/ingest\/hooks$/, "/api/integration/hook-error");
const dashboardToken = env.DASHBOARD_TOKEN ?? "";
const workspaceId = env.AOD_WORKSPACE_ID ?? basename(process.cwd());
const runId = env.AOD_RUN_ID ?? "";
const collectedAt = new Date().toISOString();

// ── Terminal session detection (cross-platform) ──

function detectTerminalSession() {
  if (env.AOD_TERMINAL_SESSION_ID) return env.AOD_TERMINAL_SESSION_ID;
  if (env.TERM_SESSION_ID) return env.TERM_SESSION_ID;
  // Windows Terminal
  if (env.WT_SESSION) return `wt_${env.WT_SESSION}`;
  // Unix tty
  if (process.platform !== "win32") {
    try {
      const raw = execFileSync("tty", { stdio: ["inherit", "pipe", "pipe"], timeout: 1000 })
        .toString()
        .trim();
      if (raw && raw !== "not a tty") {
        return `tty_${raw.replace(/^\/dev\//, "").replace(/\//g, "_")}`;
      }
    } catch {
      // tty unavailable — non-interactive or Windows
    }
  }
  return "";
}

function detectTerminalLabel() {
  return (
    env.AOD_TERMINAL_LABEL ??
    env.WT_PROFILE_ID ??
    env.TERM_PROGRAM ??
    "terminal"
  );
}

const terminalSessionId = detectTerminalSession();
const terminalLabel = detectTerminalLabel();

// ── HTTP helpers ──

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (dashboardToken) h["Authorization"] = `Bearer ${dashboardToken}`;
  return h;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

async function reportHookError(reason, responseBody = "") {
  try {
    await postJson(integrationErrorUrl, {
      workspace_id: workspaceId || null,
      terminal_session_id: terminalSessionId || null,
      run_id: runId || null,
      reason,
      response_body: responseBody.slice(0, 2000),
      collector_url: collectorUrl,
      ts: collectedAt,
    });
  } catch {
    process.stderr.write(`[AOD hook] failed to report hook error: ${reason}\n`);
  }
}

// ── stdin reader ──

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

// ── Main ──

try {
  const raw = await readStdin();
  if (!raw) {
    process.stderr.write("[AOD hook] empty payload from stdin\n");
    process.exit(1);
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    obj = { _raw: raw };
  }

  // Build _meta
  const meta =
    typeof obj._meta === "object" && obj._meta !== null ? obj._meta : {};

  const existingTerminal =
    typeof obj.terminal_session_id === "string" ? obj.terminal_session_id : "";
  const metaTerminal =
    typeof meta.terminal_session === "string" ? meta.terminal_session : "";
  const parentSession =
    typeof obj.parent_session_id === "string" ? obj.parent_session_id : "";
  const sessionId =
    typeof obj.session_id === "string" ? obj.session_id : "";

  const effectiveTerminal =
    existingTerminal ||
    metaTerminal ||
    terminalSessionId ||
    parentSession ||
    sessionId;

  if (workspaceId && !meta.workspace) meta.workspace = workspaceId;
  if (effectiveTerminal && !meta.terminal_session)
    meta.terminal_session = effectiveTerminal;
  if (runId && !meta.run) meta.run = runId;
  if (terminalLabel && !meta.terminal_label)
    meta.terminal_label = terminalLabel;
  if (!meta.collected_at) meta.collected_at = collectedAt;

  obj._meta = meta;

  if (workspaceId && !obj.workspace_id) obj.workspace_id = workspaceId;
  if (effectiveTerminal && !obj.terminal_session_id)
    obj.terminal_session_id = effectiveTerminal;
  if (runId && !obj.run_id) obj.run_id = runId;

  // POST to collector
  let result;
  try {
    result = await postJson(collectorUrl, obj);
  } catch (err) {
    const reason = `collector request failed (${err.name}: ${err.message})`;
    await reportHookError(reason, "");
    process.stderr.write(`[AOD hook] ${reason}\n`);
    process.exit(1);
  }

  if (!result.ok) {
    const reason = `collector returned HTTP ${result.status}`;
    await reportHookError(reason, result.body);
    process.stderr.write(`[AOD hook] ${reason}\n`);
    process.exit(1);
  }

  process.exit(0);
} catch (err) {
  process.stderr.write(
    `[AOD hook] unexpected error: ${err.message ?? err}\n`,
  );
  process.exit(1);
}
