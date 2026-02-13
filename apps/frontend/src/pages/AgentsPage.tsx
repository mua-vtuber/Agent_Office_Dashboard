import { useEffect, useMemo, useState } from "react";
import { BACKEND_ORIGIN } from "../lib/constants";
import { useSearchParams } from "react-router-dom";

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

type Scope = {
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  last_event_ts: string;
};

function badge(type: EmploymentType): string {
  return type === "employee" ? "정직원" : "계약직";
}

export function AgentsPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [employmentFilter, setEmploymentFilter] = useState<"all" | EmploymentType>("all");
  const [error, setError] = useState<string>("");
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

        const [agentsRes, sessionsRes] = await Promise.all([
          fetch(`${BACKEND_ORIGIN}/api/agents${suffix}`),
          fetch(`${BACKEND_ORIGIN}/api/sessions`)
        ]);
        const json = (await agentsRes.json()) as { agents?: AgentRow[] };
        const sessionsJson = (await sessionsRes.json()) as { scopes?: Scope[] };
        if (mounted && Array.isArray(json.agents)) {
          setAgents(json.agents);
          const first = json.agents[0];
          if (first) setSelectedId(first.agent_id);
        }
        if (mounted && Array.isArray(sessionsJson.scopes)) {
          setScopes(sessionsJson.scopes);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load agents");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedWorkspace, selectedTerminal, selectedRun]);

  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (selectedWorkspace) query.set("workspace_id", selectedWorkspace);
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        if (selectedRun) query.set("run_id", selectedRun);
        const suffix = query.toString() ? `?${query.toString()}` : "";
        const encoded = encodeURIComponent(selectedId);
        const res = await fetch(`${BACKEND_ORIGIN}/api/agents/${encoded}${suffix}`);
        const json = (await res.json()) as { agent?: AgentDetail };
        if (mounted) setDetail(json.agent ?? null);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load agent detail");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId, selectedWorkspace, selectedTerminal, selectedRun]);

  const filteredAgents = useMemo(() => {
    if (employmentFilter === "all") return agents;
    return agents.filter((a) => a.employment_type === employmentFilter);
  }, [agents, employmentFilter]);

  useEffect(() => {
    if (filteredAgents.length === 0) {
      setSelectedId("");
      setDetail(null);
      return;
    }
    const exists = filteredAgents.some((a) => a.agent_id === selectedId);
    if (!exists) setSelectedId(filteredAgents[0]?.agent_id ?? "");
  }, [filteredAgents, selectedId]);

  const workspaceOptions = useMemo(
    () => Array.from(new Set(scopes.map((s) => s.workspace_id))),
    [scopes]
  );
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

  const selectAgent = (agentId: string): void => {
    setSelectedId(agentId);
    const params = new URLSearchParams(searchParams);
    params.set("agent_id", agentId);
    setSearchParams(params);
  };

  return (
    <section>
      <h2>Agents</h2>
      <p>저장 에이전트는 정직원, 임시 호출 에이전트는 계약직으로 표시합니다.</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="scope-bar">
        <label>
          Workspace
          <select value={selectedWorkspace} onChange={(e) => updateScope({ workspace_id: e.target.value })}>
            <option value="">All</option>
            {workspaceOptions.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </label>
        <label>
          Terminal
          <select value={selectedTerminal} onChange={(e) => updateScope({ terminal_session_id: e.target.value })}>
            <option value="">All</option>
            {terminalOptions.map((s) => (
              <option key={`${s.workspace_id}:${s.terminal_session_id}`} value={s.terminal_session_id}>
                {s.terminal_session_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Run
          <select value={selectedRun} onChange={(e) => updateScope({ run_id: e.target.value })}>
            <option value="">All</option>
            {runOptions.map((s) => (
              <option key={`${s.workspace_id}:${s.terminal_session_id}:${s.run_id}`} value={s.run_id}>
                {s.run_id}
              </option>
            ))}
          </select>
        </label>
      </div>

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
                <button className={a.agent_id === selectedId ? "list-btn active" : "list-btn"} onClick={() => selectAgent(a.agent_id)}>
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
