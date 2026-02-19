import { useMemo, useState, useEffect } from "react";
import { useTaskStore } from "../../stores/task-store";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "-";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function ActiveTaskList(): JSX.Element {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const tasksMap = useTaskStore((s) => s.tasks);
  const [, setTick] = useState(0);

  // Refresh elapsed time every second
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeTasks = useMemo(
    () => Object.values(tasksMap).filter((t) => t.status === "active"),
    [tasksMap]
  );

  return (
    <article className="panel">
      <h3>{t("dashboard_active_tasks")}</h3>
      {activeTasks.length === 0 ? (
        <p>{t("dashboard_active_tasks_empty")}</p>
      ) : (
        <table className="task-table">
          <thead>
            <tr>
              <th>{t("dashboard_col_task_id")}</th>
              <th>{t("dashboard_col_agent")}</th>
              <th>{t("dashboard_col_elapsed")}</th>
            </tr>
          </thead>
          <tbody>
            {activeTasks.map((task) => (
              <tr key={task.task_id} className="task-row">
                <td>{task.task_id}</td>
                <td>
                  <Link
                    to={{
                      pathname: "/agents",
                      search: (() => {
                        const params = new URLSearchParams(searchParams);
                        params.set("agent_id", task.agent_id);
                        return params.toString() ? `?${params.toString()}` : "";
                      })(),
                    }}
                  >
                    {task.agent_id.split("/").at(-1) ?? task.agent_id}
                  </Link>
                </td>
                <td className="elapsed">{formatElapsed(task.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
