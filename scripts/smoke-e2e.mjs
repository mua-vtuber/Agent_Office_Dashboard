/* eslint-disable no-console */

const baseUrl = process.env.AOD_BASE_URL ?? "http://127.0.0.1:4800";

async function mustJson(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  console.log(`[smoke] base URL: ${baseUrl}`);

  const health = await mustJson("/api/health");
  if (!health.ok) throw new Error("/api/health returned non-ok payload");
  console.log("[smoke] health ok");

  const tsSeed = Date.now();
  const workspace = `smoke-ws-${tsSeed}`;
  const session = `smoke-session-${tsSeed}`;
  const run = `smoke-run-${tsSeed}`;
  const agentName = "smoke-agent";

  await mustJson("/ingest/hooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "SubagentStart",
      workspace_id: workspace,
      terminal_session_id: session,
      run_id: run,
      team_name: workspace,
      session_id: session,
      agent_name: agentName
    })
  });

  await mustJson("/ingest/hooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_name: "PreToolUse",
      workspace_id: workspace,
      terminal_session_id: session,
      run_id: run,
      team_name: workspace,
      session_id: session,
      agent_name: agentName,
      tool_name: "Bash"
    })
  });
  console.log("[smoke] ingest ok");

  const sessions = await mustJson("/api/sessions");
  if (!Array.isArray(sessions.scopes) || sessions.scopes.length === 0) {
    throw new Error("/api/sessions returned empty scopes");
  }
  const hasScope = sessions.scopes.some(
    (s) => s.workspace_id === workspace && s.terminal_session_id === session && s.run_id === run
  );
  if (!hasScope) throw new Error("newly ingested scope not found in /api/sessions");
  console.log("[smoke] sessions ok");

  const qs = `?workspace_id=${encodeURIComponent(workspace)}&terminal_session_id=${encodeURIComponent(session)}&run_id=${encodeURIComponent(run)}`;
  const snapshot = await mustJson(`/api/snapshot${qs}`);
  if (!Array.isArray(snapshot.agents) || snapshot.agents.length === 0) {
    throw new Error("/api/snapshot did not return agents for smoke scope");
  }
  console.log("[smoke] snapshot ok");

  const events = await mustJson(`/api/events${qs}`);
  if (!Array.isArray(events.events) || events.events.length === 0) {
    throw new Error("/api/events did not return events for smoke scope");
  }
  const latest = events.events[0];
  if (!latest?.id) throw new Error("latest event missing id");
  console.log("[smoke] events ok");

  const context = await mustJson(`/api/events/${encodeURIComponent(latest.id)}/context`);
  if (!context?.pivot?.id) throw new Error("/api/events/:id/context missing pivot");
  console.log("[smoke] time-travel context ok");

  const integration = await mustJson("/api/integration/status");
  if (typeof integration.hooks_configured !== "boolean") {
    throw new Error("/api/integration/status malformed payload");
  }
  console.log("[smoke] integration status ok");

  console.log("[smoke] PASS");
}

main().catch((error) => {
  console.error("[smoke] FAIL:", error.message);
  process.exit(1);
});
