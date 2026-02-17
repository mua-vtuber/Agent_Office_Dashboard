import { useEffect, useState } from "react";
import { useAppSettingsStore, type TransitionRule } from "../../stores/app-settings-store";
import { useErrorStore } from "../../stores/error-store";
import { useTranslation } from "react-i18next";

const STATUS_OPTIONS = [
  "*", "idle", "working", "handoff", "meeting", "returning",
  "pending_input", "failed", "completed", "roaming", "breakroom", "resting", "offline"
];

const EVENT_OPTIONS = [
  "agent_started", "agent_stopped", "agent_blocked", "agent_unblocked",
  "task_created", "manager_assign", "agent_acknowledged",
  "task_started", "task_progress", "task_completed", "task_failed",
  "meeting_requested", "meeting_started", "meeting_ended",
  "tool_started", "tool_succeeded", "tool_failed",
  "heartbeat", "schema_error"
];

export function TransitionRulesEditor(): JSX.Element {
  const { t } = useTranslation();
  const settings = useAppSettingsStore((s) => s.settings);
  const update = useAppSettingsStore((s) => s.update);
  const pushError = useErrorStore((s) => s.push);
  const [rules, setRules] = useState<TransitionRule[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings?.transition_rules) setRules(settings.transition_rules);
  }, [settings]);

  const updateRule = (idx: number, field: keyof TransitionRule, value: string): void => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRule = (): void => {
    setRules((prev) => [...prev, { from: "*", event: "task_started", to: "working" }]);
  };

  const removeRule = (idx: number): void => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await update({ transition_rules: rules });
    } catch (e) {
      pushError(t("settings_transition_title"), e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel settings-form">
      <h3>{t("settings_transition_title")}</h3>
      <table className="settings-table">
        <thead>
          <tr>
            <th>{t("settings_transition_from")}</th>
            <th>{t("settings_transition_event")}</th>
            <th>{t("settings_transition_to")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, idx) => (
            <tr key={idx}>
              <td>
                <select value={rule.from} onChange={(e) => updateRule(idx, "from", e.target.value)}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>
                <select value={rule.event} onChange={(e) => updateRule(idx, "event", e.target.value)}>
                  {EVENT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>
                <select value={rule.to} onChange={(e) => updateRule(idx, "to", e.target.value)}>
                  {STATUS_OPTIONS.filter((s) => s !== "*").map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>
                <button className="list-btn" onClick={() => removeRule(idx)}>{t("settings_transition_remove")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="action-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button className="list-btn" onClick={() => void save()} disabled={saving}>
          {saving ? t("common_loading") : t("settings_btn_save")}
        </button>
        <button className="list-btn" onClick={addRule}>{t("settings_transition_add")}</button>
      </div>
    </article>
  );
}
