import { useEffect, useMemo, useState } from "react";
import { useEventStore } from "../stores/event-store";
import { useAgentStore } from "../stores/agent-store";
import { BACKEND_ORIGIN } from "../lib/constants";

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
  const events = useEventStore((s) => s.events) as EventRow[];
  const setAllEvents = useEventStore((s) => s.setAll);

  const agentsMap = useAgentStore((s) => s.agents);
  const setManyAgents = useAgentStore((s) => s.setMany);

  const [error, setError] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [context, setContext] = useState<EventContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [eventsRes, snapshotRes] = await Promise.all([
          fetch(`${BACKEND_ORIGIN}/api/events`),
          fetch(`${BACKEND_ORIGIN}/api/snapshot`)
        ]);

        const eventsJson = (await eventsRes.json()) as { events?: EventRow[] };
        const snapshotJson = (await snapshotRes.json()) as { agents?: SnapshotAgent[] };

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
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load dashboard");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [setAllEvents, setManyAgents]);

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

  return (
    <section>
      <h2>Dashboard</h2>
      <p>상태 카드 + 타임라인 + Time Travel(전후 문맥) 패널.</p>
      {error ? <p className="error">{error}</p> : null}

      <div className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">총 에이전트</div>
          <div className="stat-value">{agents.length}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">실패</div>
          <div className="stat-value">{agents.filter((a) => a.status === "failed").length}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">작업중</div>
          <div className="stat-value">{agents.filter((a) => a.status === "working" || a.status === "meeting").length}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">이벤트(표시)</div>
          <div className="stat-value">{events.length}</div>
        </article>
      </div>

      <h3>Agent Status Cards</h3>
      <div className="agent-card-grid">
        {agents.length === 0 ? (
          <p>에이전트가 없습니다. seed-mock를 실행해보세요.</p>
        ) : (
          agents.map((agent) => (
            <article key={agent.agent_id} className="agent-card">
              <div className="agent-card-head">
                <strong>{agent.agent_id}</strong>
                <span className={`badge ${statusClass(agent.status)}`}>{agent.status}</span>
              </div>
              <div className="agent-meta">last: {agent.last_event_ts}</div>
            </article>
          ))
        )}
      </div>

      <div className="split-layout">
        <article className="panel">
          <h3>Recent Events</h3>
          <ul className="list timeline-list">
            {events.slice(0, 40).map((evt) => (
              <li key={evt.id}>
                <button
                  className={evt.id === selectedEventId ? "list-btn active" : "list-btn"}
                  onClick={() => setSelectedEventId(evt.id)}
                >
                  {eventSummary(evt)}
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h3>Time Travel Context</h3>
          {!selectedEventId ? <p>이벤트를 선택하세요.</p> : null}
          {loadingContext ? <p>불러오는 중...</p> : null}
          {context ? (
            <div className="context-grid">
              <div className="context-col">
                <h4>Before</h4>
                <ul className="compact-list">
                  {context.before.map((e) => (
                    <li key={e.id}>{eventSummary(e)}</li>
                  ))}
                </ul>
              </div>
              <div className="context-col">
                <h4>Pivot</h4>
                <p className="pivot-line">{eventSummary(context.pivot)}</p>
                <h4>Agent Snapshot</h4>
                <p>{context.agent_snapshot.agent_id}</p>
                <p>status: {context.agent_snapshot.status}</p>
                <p>events until pivot: {context.agent_snapshot.event_count_until_pivot}</p>
                <p>last event ts: {context.agent_snapshot.last_event_ts ?? "-"}</p>
              </div>
              <div className="context-col">
                <h4>After</h4>
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
