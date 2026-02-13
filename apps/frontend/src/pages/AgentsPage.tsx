import { useEffect, useMemo, useState } from "react";
import { BACKEND_ORIGIN } from "../lib/constants";

type EmploymentType = "employee" | "contractor";

type AgentRow = {
  agent_id: string;
  display_name: string;
  role: string;
  employment_type: EmploymentType;
  status: string;
};

type AgentDetail = {
  agent_id: string;
  display_name: string;
  role: string;
  employment_type: EmploymentType;
  status: string;
  intro: string;
  tools: string[];
  expertise: string[];
  recent_events: unknown[];
};

function badge(type: EmploymentType): string {
  return type === "employee" ? "정직원" : "계약직";
}

export function AgentsPage(): JSX.Element {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [employmentFilter, setEmploymentFilter] = useState<"all" | EmploymentType>("all");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch(`${BACKEND_ORIGIN}/api/agents`);
        const json = (await res.json()) as { agents?: AgentRow[] };
        if (mounted && Array.isArray(json.agents)) {
          setAgents(json.agents);
          const first = json.agents[0];
          if (first) setSelectedId(first.agent_id);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load agents");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    void (async () => {
      try {
        const encoded = encodeURIComponent(selectedId);
        const res = await fetch(`${BACKEND_ORIGIN}/api/agents/${encoded}`);
        const json = (await res.json()) as { agent?: AgentDetail };
        if (mounted) setDetail(json.agent ?? null);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load agent detail");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const filteredAgents = useMemo(() => {
    if (employmentFilter === "all") return agents;
    return agents.filter((a) => a.employment_type === employmentFilter);
  }, [agents, employmentFilter]);

  return (
    <section>
      <h2>Agents</h2>
      <p>저장 에이전트는 정직원, 임시 호출 에이전트는 계약직으로 표시합니다.</p>
      {error ? <p className="error">{error}</p> : null}

      <div className="filter-row">
        <label>
          고용형태 필터
          <select value={employmentFilter} onChange={(e) => setEmploymentFilter(e.target.value as "all" | EmploymentType)}>
            <option value="all">전체</option>
            <option value="employee">정직원</option>
            <option value="contractor">계약직</option>
          </select>
        </label>
      </div>

      <div className="split-layout">
        <aside className="panel">
          <h3>목록</h3>
          <ul className="list">
            {filteredAgents.map((a) => (
              <li key={a.agent_id}>
                <button className={a.agent_id === selectedId ? "list-btn active" : "list-btn"} onClick={() => setSelectedId(a.agent_id)}>
                  <strong>{a.display_name}</strong> [{badge(a.employment_type)}] - {a.status}
                </button>
              </li>
            ))}
          </ul>
          {filteredAgents.length === 0 ? <p>표시할 에이전트가 없습니다.</p> : null}
        </aside>

        <article className="panel">
          <h3>상세</h3>
          {!detail ? (
            <p>에이전트를 선택하세요.</p>
          ) : (
            <div>
              <p><strong>{detail.display_name}</strong> ({detail.agent_id})</p>
              <p>역할: {detail.role} / 고용형태: {badge(detail.employment_type)} / 상태: {detail.status}</p>
              <p>{detail.intro}</p>
              <p>도구: {detail.tools.join(", ")}</p>
              <p>전문영역: {detail.expertise.join(", ")}</p>
              <h4>최근 이벤트</h4>
              <pre className="panel nested">{JSON.stringify(detail.recent_events, null, 2)}</pre>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
