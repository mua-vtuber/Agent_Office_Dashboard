import { NavLink, Route, Routes } from "react-router-dom";
import { OfficePage } from "./pages/OfficePage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useEffect } from "react";
import { useWsStore } from "./stores/ws-store";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";

const tabs = [
  { to: "/", label: "Office" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/agents", label: "Agents" },
  { to: "/settings", label: "Settings" }
];

export default function App(): JSX.Element {
  const connect = useWsStore((s) => s.connect);

  useEffect(() => {
    connect("ws://127.0.0.1:4800/ws");
  }, [connect]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Agent Office Dashboard</h1>
        <nav className="tabs">
          {tabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to} className={({ isActive }) => (isActive ? "tab active" : "tab")}>
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
