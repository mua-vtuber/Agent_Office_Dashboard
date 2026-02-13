import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { OfficePage } from "./pages/OfficePage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useEffect } from "react";
import { useWsStore } from "./stores/ws-store";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { useUiSettingsStore } from "./stores/ui-settings-store";
import { useTranslation } from "react-i18next";

export default function App(): JSX.Element {
  const connect = useWsStore((s) => s.connect);
  const location = useLocation();
  const language = useUiSettingsStore((s) => s.language);
  const motion = useUiSettingsStore((s) => s.motion);
  const { t, i18n } = useTranslation();

  const tabs = [
    { to: "/", label: t("tab_office") },
    { to: "/dashboard", label: t("tab_dashboard") },
    { to: "/agents", label: t("tab_agents") },
    { to: "/settings", label: t("tab_settings") }
  ];

  useEffect(() => {
    connect("ws://127.0.0.1:4800/ws");
  }, [connect]);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [i18n, language]);

  useEffect(() => {
    document.documentElement.setAttribute("data-motion", motion);
  }, [motion]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>{t("app_title")}</h1>
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
