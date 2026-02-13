import { useEffect, useState } from "react";
import { BACKEND_ORIGIN } from "../lib/constants";
import { useUiSettingsStore } from "../stores/ui-settings-store";
import { useTranslation } from "react-i18next";

type IntegrationStatus = {
  hooks_configured: boolean;
  last_checked_at: string;
  collector_reachable: boolean;
  last_hook_event_at: string | null;
  mode: "normal" | "degraded";
  checked_files: string[];
};

type InstallResult = {
  ok: boolean;
  mode: "guide" | "write";
  message?: string;
  target_file?: string;
  template?: string;
  next_step?: string;
};

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const language = useUiSettingsStore((s) => s.language);
  const motion = useUiSettingsStore((s) => s.motion);
  const setLanguage = useUiSettingsStore((s) => s.setLanguage);
  const setMotion = useUiSettingsStore((s) => s.setMotion);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string>("");

  const refreshStatus = async (): Promise<void> => {
    try {
      const res = await fetch(`${BACKEND_ORIGIN}/api/integration/status`);
      const json = (await res.json()) as IntegrationStatus;
      setStatus(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load integration status");
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const installHooks = async (mode: "guide" | "write"): Promise<void> => {
    setInstallResult(null);
    try {
      const res = await fetch(`${BACKEND_ORIGIN}/api/integration/hooks/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const json = (await res.json()) as InstallResult;
      setInstallResult(json);
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to install hooks");
    }
  };

  return (
    <section>
      <h2>{t("settings_title")}</h2>

      <div className="split-layout">
        <article className="panel">
          <h3>{t("settings_lang_motion")}</h3>
          <p>{t("settings_lang_motion_desc")}</p>
          <label>
            {t("settings_language")}
            <select value={language} onChange={(e) => setLanguage(e.target.value as "ko" | "en")}>
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t("settings_motion")}
            <select value={motion} onChange={(e) => setMotion(e.target.value as "low" | "normal" | "high")}>
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </label>
          <p>{t("settings_layout_profile")}: kr_t_left_v2</p>
        </article>

        <article className="panel">
          <h3>{t("settings_hooks_title")}</h3>
          {error ? <p className="error">{error}</p> : null}
          {!status ? (
            <p>{t("settings_status_checking")}</p>
          ) : (
            <div>
              <p>{t("settings_mode")}: {status.mode}</p>
              <p>{t("settings_hooks_configured")}: {String(status.hooks_configured)}</p>
              <p>{t("settings_last_checked")}: {status.last_checked_at}</p>
              <p>{t("settings_last_hook_event")}: {status.last_hook_event_at ?? "-"}</p>
              <p>{t("settings_checked_files")}:</p>
              <ul className="compact-list">
                {status.checked_files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="action-row">
            <button className="list-btn" onClick={() => void installHooks("guide")}>{t("settings_btn_guide")}</button>
            <button className="list-btn" onClick={() => void installHooks("write")}>{t("settings_btn_install")}</button>
            <button className="list-btn" onClick={() => void refreshStatus()}>{t("settings_btn_refresh")}</button>
          </div>

          {installResult ? (
            <div className="panel nested">
              <p>{t("settings_result_ok")}: {String(installResult.ok)} / {t("settings_result_mode")}: {installResult.mode}</p>
              {installResult.message ? <p>{installResult.message}</p> : null}
              {installResult.target_file ? <p>{t("settings_result_target")}: {installResult.target_file}</p> : null}
              {installResult.next_step ? <p>{t("settings_result_next")}: {installResult.next_step}</p> : null}
              {installResult.template ? <pre>{installResult.template}</pre> : null}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
