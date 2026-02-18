import { useState } from "react";
import { useAppSettingsStore } from "../../stores/app-settings-store";
import { useErrorStore } from "../../stores/error-store";
import { useTranslation } from "react-i18next";
import { saveConnection } from "../../lib/constants";

export function ConnectionSettings(): JSX.Element {
  const { t } = useTranslation();
  const settings = useAppSettingsStore((s) => s.settings);
  const update = useAppSettingsStore((s) => s.update);
  const pushError = useErrorStore((s) => s.push);
  const [apiUrl, setApiUrl] = useState(settings?.connection?.api_base_url ?? "http://127.0.0.1:4800");
  const [wsUrl, setWsUrl] = useState(settings?.connection?.ws_url ?? "ws://127.0.0.1:4800/ws");
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await update({ connection: { api_base_url: apiUrl, ws_url: wsUrl } });
      saveConnection({ api_base_url: apiUrl, ws_url: wsUrl });
    } catch (e) {
      pushError(t("settings_connection_title"), e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel settings-form">
      <h3>{t("settings_connection_title")}</h3>
      <label>
        {t("settings_connection_api_url")}
        <input type="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className="settings-input" />
      </label>
      <label>
        {t("settings_connection_ws_url")}
        <input type="text" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} className="settings-input" />
      </label>
      <p className="settings-hint">{t("settings_connection_refresh_hint")}</p>
      <div className="action-row">
        <button className="list-btn" onClick={() => void save()} disabled={saving}>
          {saving ? t("common_loading") : t("settings_btn_save")}
        </button>
      </div>
    </article>
  );
}
