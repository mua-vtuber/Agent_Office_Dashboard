import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventStore } from "../stores/event-store";
import { useAgentStore } from "../stores/agent-store";
import { useTaskStore } from "../stores/task-store";
import { getBackendOrigin } from "../lib/constants";
import { useErrorStore } from "../stores/error-store";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertPanel } from "../components/dashboard/AlertPanel";
import { ActiveTaskList } from "../components/dashboard/ActiveTaskList";

type SnapshotAgent = {
  agent_id: string;
  status: string;
  thinking_text?: string | null;
  last_event_ts: string;
};

type EventRow = {
  id: string;
  ts: string;
  type: string;
  agent_id: string;
  task_id: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  manager_id: string | null;
  created_at: string;
  updated_at: string;
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

const DEFAULT_SYNC_INTERVAL_SEC = 30;


function statusClass(status: string): string {
  if (status === "failed") return "critical";
  if (status === "pending_input") return "warn";
  if (status === "working" || status === "meeting") return "good";
  return "neutral";
}

function elapsedSince(isoTs: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoTs).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function eventSummary(e: EventRow): string {
  return `${e.ts} | ${e.type} | ${e.agent_id}`;
}

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const events = useEventStore((s) => s.events) as EventRow[];
  const setAllEvents = useEventStore((s) => s.setAll);

  const agentsMap = useAgentStore((s) => s.agents);
  const setManyAgents = useAgentStore((s) => s.setMany);

  const pushError = useErrorStore((s) => s.push);
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [context, setContext] = useState<EventContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const syncIntervalRef = useRef(DEFAULT_SYNC_INTERVAL_SEC);
  const selectedTerminal = searchParams.get("terminal_session_id") ?? "";

  const buildSuffix = useCallback((): string => {
    const query = new URLSearchParams();
    if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
    return query.toString() ? `?${query.toString()}` : "";
  }, [selectedTerminal]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const origin = getBackendOrigin();
        const suffix = buildSuffix();

        const [eventsRes, snapshotRes, integrationRes] = await Promise.all([
          fetch(`${origin}/api/events${suffix}`),
          fetch(`${origin}/api/snapshot${suffix}`),
          fetch(`${origin}/api/integration/status`)
        ]);

        const eventsJson = (await eventsRes.json()) as { events?: EventRow[] };
        const snapshotJson = (await snapshotRes.json()) as { agents?: SnapshotAgent[]; tasks?: TaskRow[] };
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
              thinking: a.thinking_text ?? null,
              last_event_ts: a.last_event_ts ?? new Date().toISOString()
            }))
          );
        }
        if (Array.isArray(snapshotJson.tasks)) setTasks(snapshotJson.tasks);
        setIntegration(integrationJson);
      } catch (e) {
        if (mounted) pushError(t("dashboard_title"), e instanceof Error ? e.message : "failed to load dashboard");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [setAllEvents, setManyAgents, buildSuffix, pushError, t]);

  // Periodic snapshot resync
  useEffect(() => {
    const intervalId = window.setInterval(async () => {
      try {
        const origin = getBackendOrigin();
        const suffix = buildSuffix();
        const [snapshotRes, eventsRes] = await Promise.all([
          fetch(`${origin}/api/snapshot${suffix}`),
          fetch(`${origin}/api/events${suffix}`),
        ]);
        const snapshotJson = (await snapshotRes.json()) as { agents?: SnapshotAgent[]; tasks?: TaskRow[] };
        const eventsJson = (await eventsRes.json()) as { events?: EventRow[] };

        if (Array.isArray(snapshotJson.agents)) {
          setManyAgents(
            snapshotJson.agents.map((a) => ({
              agent_id: a.agent_id,
              status: a.status,
              thinking: a.thinking_text ?? null,
              last_event_ts: a.last_event_ts ?? new Date().toISOString()
            }))
          );
        }
        if (Array.isArray(snapshotJson.tasks)) setTasks(snapshotJson.tasks);
        if (Array.isArray(eventsJson.events)) setAllEvents(eventsJson.events);
      } catch {
        // silent -- WS and next tick will retry
      }
    }, syncIntervalRef.current * 1000);

    return () => window.clearInterval(intervalId);
  }, [setManyAgents, setAllEvents, buildSuffix]);

  useEffect(() => {
    if (!selectedEventId) return;
    let mounted = true;
    setLoadingContext(true);
    void (async () => {
      try {
        const origin = getBackendOrigin();
        const encoded = encodeURIComponent(selectedEventId);
        const res = await fetch(`${origin}/api/events/${encoded}/context?before=8&after=8`);
        const json = (await res.json()) as EventContext;
        if (mounted) setContext(json);
      } catch (e) {
        if (mounted) pushError(t("dashboard_time_travel_title"), e instanceof Error ? e.message : "failed to load event context");
      } finally {
        if (mounted) setLoadingContext(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedEventId, pushError, t]);

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const tasksMap = useTaskStore((s) => s.tasks);
  const activeTaskCount = useMemo(
    () => Object.values(tasksMap).filter((t) => t.status === "active").length,
    [tasksMap]
  );

  return (
    <section>
      <h2>{t("dashboard_title")}</h2>
      <p>{t("dashboard_subtitle")}</p>
      {integration && !integration.hooks_configured ? (
        <div className="hooks-banner">
          {t("dashboard_hooks_missing", { mode: integration.mode })}
          <Link to="/settings"> {t("dashboard_open_settings")}</Link>
        </div>
      ) : null}

      <AlertPanel />

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
          <div className="stat-label">{t("dashboard_stat_active_tasks")}</div>
          <div className="stat-value">{activeTaskCount}</div>
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
              {agent.thinking ? (
                <div className="agent-thinking">{t("dashboard_thinking")}: {agent.thinking}</div>
              ) : null}
              <div className="agent-meta">{t("common_last")}: {agent.last_event_ts}</div>
            </article>
          ))
        )}
      </div>

      <ActiveTaskList />

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
                <p>{t("dashboard_events_until_pivot")}: {context.agent_snapshot.event_count_until_pivot}</p>
                <p>{t("dashboard_last_event_ts")}: {context.agent_snapshot.last_event_ts ?? "-"}</p>
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
