import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { useAgentStore } from "../stores/agent-store";
import { useErrorStore } from "../stores/error-store";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

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

export function AgentsPage(): JSX.Element {
  const { t } = useTranslation();
  const badge = (type: EmploymentType): string => (type === "employee" ? t("agents_employee") : t("agents_contractor"));
  const [searchParams, setSearchParams] = useSearchParams();
  const agentsMap = useAgentStore((s) => s.agents);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [employmentFilter, setEmploymentFilter] = useState<"all" | EmploymentType>("all");
  const pushError = useErrorStore((s) => s.push);
  const selectedTerminal = searchParams.get("terminal_session_id") ?? "";
  const selectedAgentParam = searchParams.get("agent_id") ?? "";

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        const suffix = query.toString() ? `?${query.toString()}` : "";

        const json = await apiGet<{ agents?: AgentRow[] }>(`/api/agents${suffix}`);
        if (mounted && Array.isArray(json.agents)) {
          setAgents(json.agents);
          if (selectedAgentParam) {
            const paramAgent = json.agents.find((a) => a.agent_id === selectedAgentParam);
            if (paramAgent) setSelectedId(paramAgent.agent_id);
          } else {
            const first = json.agents[0];
            if (first) setSelectedId(first.agent_id);
          }
        }
      } catch (e) {
        if (mounted) pushError(t("agents_title"), e instanceof Error ? e.message : "failed to load agents");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedTerminal, selectedAgentParam, pushError, t]);

  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        const suffix = query.toString() ? `?${query.toString()}` : "";
        const encoded = encodeURIComponent(selectedId);
        const json = await apiGet<{ agent?: AgentDetail }>(`/api/agents/${encoded}${suffix}`);
        if (mounted) setDetail(json.agent ?? null);
      } catch (e) {
        if (mounted) pushError(t("agents_detail"), e instanceof Error ? e.message : "failed to load agent detail");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId, selectedTerminal, pushError, t]);

  const filteredAgents = useMemo(() => {
    if (employmentFilter === "all") return agents;
    return agents.filter((a) => a.employment_type === employmentFilter);
  }, [agents, employmentFilter]);

  useEffect(() => {
    if (selectedAgentParam && selectedAgentParam !== selectedId) {
      const exists = agents.some((a) => a.agent_id === selectedAgentParam);
      if (exists) setSelectedId(selectedAgentParam);
    }
  }, [agents, selectedAgentParam, selectedId]);

  useEffect(() => {
    if (filteredAgents.length === 0) {
      setSelectedId("");
      setDetail(null);
      return;
    }
    const exists = filteredAgents.some((a) => a.agent_id === selectedId);
    if (!exists) setSelectedId(filteredAgents[0]?.agent_id ?? "");
  }, [filteredAgents, selectedId]);

  const selectAgent = (agentId: string): void => {
    setSelectedId(agentId);
    const params = new URLSearchParams(searchParams);
    params.set("agent_id", agentId);
    setSearchParams(params);
  };

  return (
    <section>
      <h2>{t("agents_title")}</h2>
      <p>{t("agents_subtitle")}</p>

      <div className="filter-row">
        <label>
          {t("agents_filter_employment")}
          <select value={employmentFilter} onChange={(e) => setEmploymentFilter(e.target.value as "all" | EmploymentType)}>
            <option value="all">{t("common_all")}</option>
            <option value="employee">{t("agents_employee")}</option>
            <option value="contractor">{t("agents_contractor")}</option>
          </select>
        </label>
      </div>

      <div className="split-layout">
        <aside className="panel">
          <h3>{t("agents_list")}</h3>
          <ul className="list">
            {filteredAgents.map((a) => (
              <li key={a.agent_id}>
                <button className={a.agent_id === selectedId ? "list-btn active" : "list-btn"} onClick={() => selectAgent(a.agent_id)}>
                  <strong>{a.display_name}</strong> [{badge(a.employment_type)}] - {a.status}
                </button>
              </li>
            ))}
          </ul>
          {filteredAgents.length === 0 ? <p>{t("agents_empty")}</p> : null}
        </aside>

        <article className="panel">
          <h3>{t("agents_detail")}</h3>
          {!detail ? (
            <p>{t("agents_select_prompt")}</p>
          ) : (
            <div>
              <p><strong>{detail.display_name}</strong> ({detail.agent_id})</p>
              <p>{t("agents_meta", { role: detail.role, employment: badge(detail.employment_type), status: detail.status })}</p>
              {agentsMap[detail.agent_id]?.thinking ? (
                <p><strong>{t("agents_thinking")}:</strong> {agentsMap[detail.agent_id]!.thinking}</p>
              ) : null}
              <p>{detail.intro}</p>
              <p>{t("agents_tools")}: {detail.tools.join(", ")}</p>
              <p>{t("agents_expertise")}: {detail.expertise.join(", ")}</p>
              <p>
                <Link
                  to={{
                    pathname: "/",
                    search: (() => {
                      const params = new URLSearchParams(searchParams);
                      params.set("agent_id", detail.agent_id);
                      return params.toString() ? `?${params.toString()}` : "";
                    })()
                  }}
                >
                  {t("agents_go_office")}
                </Link>
              </p>
              <h4>{t("agents_recent_events")}</h4>
              <pre className="panel nested">{JSON.stringify(detail.recent_events, null, 2)}</pre>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
