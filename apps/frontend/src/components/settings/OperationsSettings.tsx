import { useEffect, useState } from "react";
import { useAppSettingsStore } from "../../stores/app-settings-store";
import { useErrorStore } from "../../stores/error-store";
import { useTranslation } from "react-i18next";

export function OperationsSettings(): JSX.Element {
  const { t } = useTranslation();
  const settings = useAppSettingsStore((s) => s.settings);
  const update = useAppSettingsStore((s) => s.update);
  const pushError = useErrorStore((s) => s.push);
  const [pendingSec, setPendingSec] = useState(120);
  const [failedSec, setFailedSec] = useState(60);
  const [staleSec, setStaleSec] = useState(300);
  const [failureEnabled, setFailureEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ops = settings?.operations;
    if (!ops) return;
    setPendingSec(ops.pending_input_alert_seconds);
    setFailedSec(ops.failed_alert_seconds);
    setStaleSec(ops.stale_agent_seconds);
    setFailureEnabled(ops.failure_alert_enabled);
  }, [settings]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await update({
        operations: {
          ...settings?.operations,
          pending_input_alert_seconds: pendingSec,
          failed_alert_seconds: failedSec,
          stale_agent_seconds: staleSec,
          failure_alert_enabled: failureEnabled,
        },
      });
    } catch (e) {
      pushError(t("settings_operations_title"), e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel settings-form">
      <h3>{t("settings_operations_title")}</h3>
      <label>
        {t("settings_operations_pending_seconds")}
        <input type="number" value={pendingSec} onChange={(e) => setPendingSec(Number(e.target.value))} className="settings-input" />
      </label>
      <label>
        {t("settings_operations_failed_seconds")}
        <input type="number" value={failedSec} onChange={(e) => setFailedSec(Number(e.target.value))} className="settings-input" />
      </label>
      <label>
        {t("settings_operations_stale_seconds")}
        <input type="number" value={staleSec} onChange={(e) => setStaleSec(Number(e.target.value))} className="settings-input" />
      </label>
      <label style={{ flexDirection: "row", display: "flex", alignItems: "center", gap: "8px" }}>
        <input type="checkbox" checked={failureEnabled} onChange={(e) => setFailureEnabled(e.target.checked)} />
        {t("settings_operations_failure_enabled")}
      </label>
      <div className="action-row">
        <button className="list-btn" onClick={() => void save()} disabled={saving}>
          {saving ? t("common_loading") : t("settings_btn_save")}
        </button>
      </div>
    </article>
  );
}
