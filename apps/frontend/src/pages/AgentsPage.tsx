import { useEffect, useState } from "react";

type AgentRow = {
  agent_id: string;
  display_name: string;
  employment_type: "employee" | "contractor";
  status: string;
};

function badge(type: AgentRow["employment_type"]): string {
  return type === "employee" ? "정직원" : "계약직";
}

export function AgentsPage(): JSX.Element {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch("http://127.0.0.1:4800/api/agents");
        const json = (await res.json()) as { agents?: AgentRow[] };
        if (mounted && Array.isArray(json.agents)) {
          setAgents(json.agents);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load agents");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section>
      <h2>Agents</h2>
      <p>저장 에이전트는 정직원, 임시 호출 에이전트는 계약직으로 표시합니다.</p>
      {error ? <p className="error">{error}</p> : null}
      <ul className="list">
        {agents.map((a) => (
          <li key={a.agent_id}>
            <strong>{a.display_name}</strong> ({a.agent_id}) - {a.status} [{badge(a.employment_type)}]
          </li>
        ))}
      </ul>
      {!error && agents.length === 0 ? <p>표시할 에이전트가 없습니다. mock 이벤트를 주입해보세요.</p> : null}
    </section>
  );
}
