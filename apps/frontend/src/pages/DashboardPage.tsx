import { useEffect, useMemo, useState } from "react";
import { useEventStore } from "../stores/event-store";
import { useAgentStore } from "../stores/agent-store";
import { BACKEND_ORIGIN } from "../lib/constants";

type SnapshotAgent = {
  agent_id: string;
  status: string;
  last_event_ts: string;
};

function statusClass(status: string): string {
  if (status === "failed") return "critical";
  if (status === "pending_input") return "warn";
  if (status === "working" || status === "meeting") return "good";
  return "neutral";
}

export function DashboardPage(): JSX.Element {
  const events = useEventStore((s) => s.events);
  const setAllEvents = useEventStore((s) => s.setAll);

  const agentsMap = useAgentStore((s) => s.agents);
  const setManyAgents = useAgentStore((s) => s.setMany);

  const [error, setError] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [eventsRes, snapshotRes] = await Promise.all([
          fetch(`${BACKEND_ORIGIN}/api/events`),
          fetch(`${BACKEND_ORIGIN}/api/snapshot`)
        ]);

        const eventsJson = (await eventsRes.json()) as { events?: unknown[] };
        const snapshotJson = (await snapshotRes.json()) as { agents?: SnapshotAgent[] };

        if (!mounted) return;

        if (Array.isArray(eventsJson.events)) setAllEvents(eventsJson.events);
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

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);

  return (
    <section>
      <h2>Dashboard</h2>
      <p>에이전트별 상태 카드와 최근 이벤트를 함께 표시합니다.</p>
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

      <h3>Recent Events</h3>
      <pre className="panel">{JSON.stringify(events.slice(0, 30), null, 2)}</pre>
    </section>
  );
}
