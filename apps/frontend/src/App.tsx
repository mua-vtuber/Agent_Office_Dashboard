import { NavLink, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { OfficePage } from "./pages/OfficePage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useEffect, useMemo, useState } from "react";
import { useWsStore } from "./stores/ws-store";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { useUiSettingsStore } from "./stores/ui-settings-store";
import { useTranslation } from "react-i18next";
import { WS_URL, BACKEND_ORIGIN } from "./lib/constants";

type Scope = {
  workspace_id: string;
  terminal_session_id: string;
  run_id: string;
  last_event_ts: string;
};

export default function App(): JSX.Element {
  const connect = useWsStore((s) => s.connect);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const language = useUiSettingsStore((s) => s.language);
  const motion = useUiSettingsStore((s) => s.motion);
  const { t, i18n } = useTranslation();
  const [scopes, setScopes] = useState<Scope[]>([]);
  const selectedWorkspace = searchParams.get("workspace_id") ?? "";
  const selectedTerminal = searchParams.get("terminal_session_id") ?? "";
  const selectedRun = searchParams.get("run_id") ?? "";

  const tabs = [
    { to: "/", label: t("tab_office") },
    { to: "/dashboard", label: t("tab_dashboard") },
    { to: "/agents", label: t("tab_agents") },
    { to: "/settings", label: t("tab_settings") }
  ];

  useEffect(() => {
    connect(WS_URL);
  }, [connect]);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [i18n, language]);

  useEffect(() => {
    document.documentElement.setAttribute("data-motion", motion);
  }, [motion]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch(`${BACKEND_ORIGIN}/api/sessions`);
        const json = (await res.json()) as { scopes?: Scope[] };
        if (mounted && Array.isArray(json.scopes)) setScopes(json.scopes);
      } catch {
        if (mounted) setScopes([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [location.search]);

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
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-main">
          <h1>{t("app_title")}</h1>
          <div className="scope-bar header-scope">
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
        </div>
        <nav className="tabs">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={{ pathname: tab.to, search: location.search }}
              className={({ isActive }) => (isActive ? "tab active" : "tab")}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="page">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<OfficePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
