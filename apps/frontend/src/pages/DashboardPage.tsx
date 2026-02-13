import { useEffect, useMemo, useState } from "react";
import { useEventStore } from "../stores/event-store";
import { useAgentStore } from "../stores/agent-store";
import { BACKEND_ORIGIN } from "../lib/constants";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

type SnapshotAgent = {
  agent_id: string;
  status: string;
  last_event_ts: string;
};

type EventRow = {
  id: string;
  ts: string;
  type: string;
  agent_id: string;
  task_id: string | null;
};

type AgentSnapshot = {
  agent_id: string;
  status: string;
  event_count_until_pivot: number;
  last_event_ts: string | null;
};

type EventContext = {
  pivot: EventRow;
  before: EventRow[];
  after: EventRow[];
  agent_snapshot: AgentSnapshot;
  server_ts: string;
};

type IntegrationStatus = {
  hooks_configured: boolean;
  mode: "normal" | "degraded";
};

type Scope = {
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  last_event_ts: string;
};

function statusClass(status: string): string {
  if (status === "failed") return "critical";
  if (status === "pending_input") return "warn";
  if (status === "working" || status === "meeting") return "good";
  return "neutral";
}

function eventSummary(e: EventRow): string {
  return `${e.ts} | ${e.type} | ${e.agent_id}`;
}

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const events = useEventStore((s) => s.events) as EventRow[];
  const setAllEvents = useEventStore((s) => s.setAll);

  const agentsMap = useAgentStore((s) => s.agents);
  const setManyAgents = useAgentStore((s) => s.setMany);

  const [error, setError] = useState<string>("");
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [context, setContext] = useState<EventContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const selectedWorkspace = searchParams.get("workspace_id") ?? "";
  const selectedTerminal = searchParams.get("terminal_session_id") ?? "";
  const selectedRun = searchParams.get("run_id") ?? "";

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (selectedWorkspace) query.set("workspace_id", selectedWorkspace);
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        if (selectedRun) query.set("run_id", selectedRun);
        const suffix = query.toString() ? `?${query.toString()}` : "";

        const [eventsRes, snapshotRes, sessionsRes, integrationRes] = await Promise.all([
          fetch(`${BACKEND_ORIGIN}/api/events${suffix}`),
          fetch(`${BACKEND_ORIGIN}/api/snapshot${suffix}`),
          fetch(`${BACKEND_ORIGIN}/api/sessions`),
          fetch(`${BACKEND_ORIGIN}/api/integration/status`)
        ]);

        const eventsJson = (await eventsRes.json()) as { events?: EventRow[] };
        const snapshotJson = (await snapshotRes.json()) as { agents?: SnapshotAgent[] };
        const sessionsJson = (await sessionsRes.json()) as { scopes?: Scope[] };
        const integrationJson = (await integrationRes.json()) as IntegrationStatus;

        if (!mounted) return;

        if (Array.isArray(eventsJson.events)) {
          setAllEvents(eventsJson.events);
          const first = eventsJson.events[0];
          if (first) setSelectedEventId(first.id);
        }
        if (Array.isArray(snapshotJson.agents)) {
          setManyAgents(
            snapshotJson.agents.map((a) => ({
              agent_id: a.agent_id,
              status: a.status,
              last_event_ts: a.last_event_ts ?? new Date().toISOString()
            }))
          );
        }
        if (Array.isArray(sessionsJson.scopes)) setScopes(sessionsJson.scopes);
        setIntegration(integrationJson);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load dashboard");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [setAllEvents, setManyAgents, selectedWorkspace, selectedTerminal, selectedRun]);

  useEffect(() => {
    if (!selectedEventId) return;
    let mounted = true;
    setLoadingContext(true);
    void (async () => {
      try {
        const encoded = encodeURIComponent(selectedEventId);
        const res = await fetch(`${BACKEND_ORIGIN}/api/events/${encoded}/context?before=8&after=8`);
        const json = (await res.json()) as EventContext;
        if (mounted) setContext(json);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load event context");
      } finally {
        if (mounted) setLoadingContext(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedEventId]);

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const workspaceOptions = useMemo(() => Array.from(new Set(scopes.map((s) => s.workspace_id))), [scopes]);
  const terminalOptions = useMemo(() => {
    if (!selectedWorkspace) return scopes;
    return scopes.filter((s) => s.workspace_id === selectedWorkspace);
  }, [scopes, selectedWorkspace]);
  const runOptions = useMemo(() => {
    return scopes.filter(
      (s) =>
        (!selectedWorkspace || s.workspace_id === selectedWorkspace) &&
        (!selectedTerminal || s.terminal_session_id === selectedTerminal)
    );
  }, [scopes, selectedWorkspace, selectedTerminal]);

  const updateScope = (next: { workspace_id?: string; terminal_session_id?: string; run_id?: string }): void => {
    const params = new URLSearchParams(searchParams);
    if (next.workspace_id !== undefined) {
      if (next.workspace_id) params.set("workspace_id", next.workspace_id);
      else params.delete("workspace_id");
      params.delete("terminal_session_id");
      params.delete("run_id");
    }
    if (next.terminal_session_id !== undefined) {
      if (next.terminal_session_id) params.set("terminal_session_id", next.terminal_session_id);
      else params.delete("terminal_session_id");
      params.delete("run_id");
    }
    if (next.run_id !== undefined) {
      if (next.run_id) params.set("run_id", next.run_id);
      else params.delete("run_id");
    }
    setSearchParams(params);
  };

  return (
    <section>
      <h2>{t("dashboard_title")}</h2>
      <p>{t("dashboard_subtitle")}</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="scope-bar">
        <label>
          {t("common_workspace")}
          <select value={selectedWorkspace} onChange={(e) => updateScope({ workspace_id: e.target.value })}>
            <option value="">{t("common_all")}</option>
            {workspaceOptions.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          {t("common_terminal")}
          <select value={selectedTerminal} onChange={(e) => updateScope({ terminal_session_id: e.target.value })}>
            <option value="">{t("common_all")}</option>
            {terminalOptions.map((s) => (
              <option key={`${s.workspace_id}:${s.terminal_session_id}`} value={s.terminal_session_id}>
                {s.terminal_session_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("common_run")}
          <select value={selectedRun} onChange={(e) => updateScope({ run_id: e.target.value })}>
            <option value="">{t("common_all")}</option>
            {runOptions.map((s) => (
              <option key={`${s.workspace_id}:${s.terminal_session_id}:${s.run_id}`} value={s.run_id}>
                {s.run_id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {integration && !integration.hooks_configured ? (
        <div className="hooks-banner">
          {t("dashboard_hooks_missing", { mode: integration.mode })}
          <Link to="/settings"> {t("dashboard_open_settings")}</Link>
        </div>
      ) : null}

      <div className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">{t("dashboard_stat_total_agents")}</div>
          <div className="stat-value">{agents.length}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t("dashboard_stat_failed")}</div>
          <div className="stat-value">{agents.filter((a) => a.status === "failed").length}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t("dashboard_stat_working")}</div>
          <div className="stat-value">{agents.filter((a) => a.status === "working" || a.status === "meeting").length}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t("dashboard_stat_events")}</div>
          <div className="stat-value">{events.length}</div>
        </article>
      </div>

      <h3>{t("dashboard_agent_cards")}</h3>
      <div className="agent-card-grid">
        {agents.length === 0 ? (
          <p>{t("dashboard_agents_empty")}</p>
        ) : (
          agents.map((agent) => (
            <article key={agent.agent_id} className="agent-card">
              <div className="agent-card-head">
                <strong>{agent.agent_id}</strong>
                <span className={`badge ${statusClass(agent.status)}`}>{agent.status}</span>
              </div>
              <div className="agent-meta">{t("common_last")}: {agent.last_event_ts}</div>
            </article>
          ))
        )}
      </div>

      <div className="split-layout">
        <article className="panel">
          <h3>{t("dashboard_recent_events")}</h3>
          <ul className="list timeline-list">
            {events.slice(0, 40).map((evt) => (
              <li key={evt.id}>
                <button className={evt.id === selectedEventId ? "list-btn active" : "list-btn"} onClick={() => setSelectedEventId(evt.id)}>
                  {eventSummary(evt)}
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h3>{t("dashboard_time_travel_title")}</h3>
          {!selectedEventId ? <p>{t("dashboard_select_event_prompt")}</p> : null}
          {loadingContext ? <p>{t("common_loading")}</p> : null}
          {context ? (
            <div className="context-grid">
              <div className="context-col">
                <h4>{t("dashboard_before")}</h4>
                <ul className="compact-list">
                  {context.before.map((e) => (
                    <li key={e.id}>{eventSummary(e)}</li>
                  ))}
                </ul>
              </div>
              <div className="context-col">
                <h4>{t("dashboard_pivot")}</h4>
                <p className="pivot-line">{eventSummary(context.pivot)}</p>
                <h4>{t("dashboard_agent_snapshot")}</h4>
                <p>{context.agent_snapshot.agent_id}</p>
                <p>{t("common_status")}: {context.agent_snapshot.status}</p>
                <p>events until pivot: {context.agent_snapshot.event_count_until_pivot}</p>
                <p>{t("common_last")} event ts: {context.agent_snapshot.last_event_ts ?? "-"}</p>
              </div>
              <div className="context-col">
                <h4>{t("dashboard_after")}</h4>
                <ul className="compact-list">
                  {context.after.map((e) => (
                    <li key={e.id}>{eventSummary(e)}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
