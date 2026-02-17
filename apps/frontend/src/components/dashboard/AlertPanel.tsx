import { useMemo, useState, useEffect } from "react";
import { useAgentStore } from "../../stores/agent-store";
import { useAppSettingsStore } from "../../stores/app-settings-store";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

type Alert = {
  id: string;
  type: "failed" | "pending" | "stale";
  agent_id: string;
  message: string;
};

export function AlertPanel(): JSX.Element {
  const { t } = useTranslation();
  const agentsMap = useAgentStore((s) => s.agents);
  const settings = useAppSettingsStore((s) => s.settings);
  const [, setTick] = useState(0);

  const ops = settings?.operations;
  const failureEnabled = ops?.failure_alert_enabled ?? true;
  const pendingSec = ops?.pending_input_alert_seconds ?? 120;
  const failedSec = ops?.failed_alert_seconds ?? 60;
  const staleSec = ops?.stale_agent_seconds ?? 300;

  // Re-calculate alerts every 5 seconds
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const alerts = useMemo((): Alert[] => {
    const now = Date.now();
    const result: Alert[] = [];
    for (const agent of Object.values(agentsMap)) {
      const lastTs = new Date(agent.last_event_ts).getTime();
      const elapsed = (now - lastTs) / 1000;

      if (agent.status === "pending_input" && elapsed > pendingSec) {
        result.push({
          id: `pending-${agent.agent_id}`,
          type: "pending",
          agent_id: agent.agent_id,
          message: t("dashboard_alert_pending"),
        });
      }
      if (agent.status === "failed" && elapsed > failedSec) {
        result.push({
          id: `failed-${agent.agent_id}`,
          type: "failed",
          agent_id: agent.agent_id,
          message: t("dashboard_alert_failed"),
        });
      }
      if (agent.status !== "offline" && elapsed > staleSec) {
        result.push({
          id: `stale-${agent.agent_id}`,
          type: "stale",
          agent_id: agent.agent_id,
          message: t("dashboard_alert_stale"),
        });
      }
    }
    return result;
  }, [agentsMap, pendingSec, failedSec, staleSec, t]);

  return (
    <article className="alert-panel">
      <h3>{t("dashboard_alert_title")}</h3>
      {!failureEnabled ? (
        <p className="settings-hint">
          {t("dashboard_alert_disabled")}{" "}
          <Link to="/settings">{t("dashboard_alert_go_settings")}</Link>
        </p>
      ) : null}
      {alerts.length === 0 ? (
        <p>{t("dashboard_alert_empty")}</p>
      ) : (
        alerts.map((alert) => (
          <div key={alert.id} className={`alert-card ${alert.type}`}>
            <strong>{alert.agent_id.split("/").at(-1) ?? alert.agent_id}</strong>
            <span>{alert.message}</span>
          </div>
        ))
      )}
    </article>
  );
}
