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

  const validationErrors = (() => {
    const errors: string[] = [];
    const exact = new Set<string>();
    const byPair = new Map<string, Set<string>>();

    rules.forEach((rule, idx) => {
      const row = idx + 1;
      const exactKey = `${rule.from}|${rule.event}|${rule.to}`;
      if (exact.has(exactKey)) {
        errors.push(t("settings_transition_error_duplicate", { row }));
      }
      exact.add(exactKey);

      const pairKey = `${rule.from}|${rule.event}`;
      const toSet = byPair.get(pairKey) ?? new Set<string>();
      toSet.add(rule.to);
      byPair.set(pairKey, toSet);
    });

    for (const [pair, toSet] of byPair.entries()) {
      if (toSet.size > 1) {
        const [from, event] = pair.split("|");
        errors.push(t("settings_transition_error_conflict", { from, event }));
      }
    }

    return errors;
  })();

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
    if (validationErrors.length > 0) {
      pushError(t("settings_transition_title"), validationErrors[0] ?? "invalid transition rules");
      return;
    }
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
      {validationErrors.length > 0 ? (
        <div className="panel nested" style={{ marginTop: "8px" }}>
          <p><strong>{t("settings_transition_validation_title")}</strong></p>
          <ul className="compact-list">
            {validationErrors.map((msg, idx) => (
              <li key={`${msg}-${idx}`}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="action-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button className="list-btn" onClick={() => void save()} disabled={saving || validationErrors.length > 0}>
          {saving ? t("common_loading") : t("settings_btn_save")}
        </button>
        <button className="list-btn" onClick={addRule}>{t("settings_transition_add")}</button>
      </div>
    </article>
  );
}
