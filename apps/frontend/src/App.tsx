import { NavLink, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { OfficePage } from "./pages/OfficePage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useEffect, useMemo, useState } from "react";
import { useWsStore } from "./stores/ws-store";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { ErrorModal } from "./components/layout/ErrorModal";
import { useUiSettingsStore } from "./stores/ui-settings-store";
import { useAppSettingsStore } from "./stores/app-settings-store";
import { useTranslation } from "react-i18next";
import { useErrorStore } from "./stores/error-store";
import { apiGet } from "./lib/api";
import { getWsUrl } from "./lib/constants";

type TerminalSession = {
  terminal_session_id: string;
  terminal_label: string;
  workspace_id: string;
  last_event_ts: string;
};

export default function App(): JSX.Element {
  const connect = useWsStore((s) => s.connect);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const language = useUiSettingsStore((s) => s.language);
  const motion = useUiSettingsStore((s) => s.motion);
  const loadSettings = useAppSettingsStore((s) => s.load);
  const settingsLoaded = useAppSettingsStore((s) => s.loaded);
  const { t, i18n } = useTranslation();
  const pushError = useErrorStore((s) => s.push);
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const selectedTerminal = searchParams.get("terminal_session_id") ?? "";

  const tabs = [
    { to: "/", label: t("tab_office") },
    { to: "/dashboard", label: t("tab_dashboard") },
    { to: "/agents", label: t("tab_agents") },
    { to: "/settings", label: t("tab_settings") }
  ];

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settingsLoaded) return;
    connect(getWsUrl());
  }, [connect, settingsLoaded]);

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
        const json = await apiGet<{ terminals?: TerminalSession[]; scopes?: Array<{ terminal_session_id: string; workspace_id: string; last_event_ts: string }> }>("/api/sessions");
        if (!mounted) return;
        if (Array.isArray(json.terminals)) {
          setTerminals(json.terminals);
          return;
        }
        if (Array.isArray(json.scopes)) {
          const byTerminal = new Map<string, TerminalSession>();
          for (const scope of json.scopes) {
            const prev = byTerminal.get(scope.terminal_session_id);
            if (!prev || scope.last_event_ts > prev.last_event_ts) {
              byTerminal.set(scope.terminal_session_id, {
                terminal_session_id: scope.terminal_session_id,
                terminal_label: scope.terminal_session_id,
                workspace_id: scope.workspace_id,
                last_event_ts: scope.last_event_ts
              });
            }
          }
          setTerminals(Array.from(byTerminal.values()).sort((a, b) => b.last_event_ts.localeCompare(a.last_event_ts)));
          return;
        }
        setTerminals([]);
      } catch (e) {
        if (mounted) {
          pushError(t("app_title"), e instanceof Error ? e.message : "failed to load sessions");
          setTerminals([]);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [location.search, pushError, t]);

  const terminalOptions = useMemo(() => terminals, [terminals]);

  const updateScope = (terminalSessionId: string): void => {
    const params = new URLSearchParams(searchParams);
    if (terminalSessionId) params.set("terminal_session_id", terminalSessionId);
    else params.delete("terminal_session_id");
    params.delete("workspace_id");
    params.delete("run_id");
    setSearchParams(params);
  };

  return (
    <div className="app-shell">
      <ErrorModal />
      <header className="topbar">
        <div className="topbar-main">
          <h1>{t("app_title")}</h1>
          <div className="scope-bar header-scope">
            <label>
              {t("common_terminal")}
              <select value={selectedTerminal} onChange={(e) => updateScope(e.target.value)}>
                <option value="">{t("common_all")}</option>
                {terminalOptions.map((s) => (
                  <option key={s.terminal_session_id} value={s.terminal_session_id}>
                    {s.terminal_label} ({s.workspace_id})
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
