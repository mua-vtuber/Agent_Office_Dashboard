import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { useUiSettingsStore } from "../stores/ui-settings-store";
import { useErrorStore } from "../stores/error-store";
import { useTranslation } from "react-i18next";
import { ConnectionSettings } from "../components/settings/ConnectionSettings";
import { SeatEditor } from "../components/settings/SeatEditor";
import { TransitionRulesEditor } from "../components/settings/TransitionRulesEditor";
import { OperationsSettings } from "../components/settings/OperationsSettings";

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

type ThoughtBubbleForm = {
  enabled: boolean;
  max_length: number;
  translation: {
    enabled: boolean;
    api_endpoint: string;
    api_key: string;
    model: string;
    target_language: string;
  };
};

const THOUGHT_BUBBLE_DEFAULTS: ThoughtBubbleForm = {
  enabled: true,
  max_length: 120,
  translation: {
    enabled: false,
    api_endpoint: "https://api.anthropic.com/v1/messages",
    api_key: "",
    model: "claude-haiku-4-5-20251001",
    target_language: "ko",
  },
};

type GlobalInstallResult = {
  ok: boolean;
  message?: string;
  target_file?: string;
  backup?: string | null;
  added?: string[];
  skipped?: string[];
};

export function SettingsPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const language = useUiSettingsStore((s) => s.language);
  const motion = useUiSettingsStore((s) => s.motion);
  const setAllUi = useUiSettingsStore((s) => s.setAll);
  const pushError = useErrorStore((s) => s.push);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [globalResult, setGlobalResult] = useState<GlobalInstallResult | null>(null);
  const [globalInstalling, setGlobalInstalling] = useState(false);
  const [draftLanguage, setDraftLanguage] = useState<"ko" | "en">(language);
  const [draftMotion, setDraftMotion] = useState<"low" | "normal" | "high">(motion);
  const [draftLayoutProfile, setDraftLayoutProfile] = useState<string>("kr_t_left_v2");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Thought bubble settings
  const [tbForm, setTbForm] = useState<ThoughtBubbleForm>(THOUGHT_BUBBLE_DEFAULTS);
  const [tbSaveMsg, setTbSaveMsg] = useState<string>("");

  const hasDirty =
    draftLanguage !== language || draftMotion !== motion || draftLayoutProfile !== "kr_t_left_v2";

  const refreshStatus = async (): Promise<void> => {
    try {
      const json = await apiGet<IntegrationStatus>("/api/integration/status");
      setStatus(json);
    } catch (e) {
      pushError(t("settings_hooks_title"), e instanceof Error ? e.message : "failed to load integration status");
    }
  };

  // Load server settings for thought_bubble
  useEffect(() => {
    void (async () => {
      try {
        const json = await apiGet<{ value?: { thought_bubble?: ThoughtBubbleForm } }>("/api/settings/app");
        if (json.value?.thought_bubble) {
          setTbForm(json.value.thought_bubble);
        }
      } catch (e) {
        pushError(t("settings_thought_bubble_title"), e instanceof Error ? e.message : "failed to load thought bubble settings");
      }
    })();
    void refreshStatus();
  }, [pushError, t]);

  useEffect(() => {
    if (loaded) return;
    let mounted = true;
    void (async () => {
      try {
        const json = await apiGet<{
          settings?: {
            ui_language?: "ko" | "en";
            ui_motion?: "low" | "normal" | "high";
            layout_profile?: string;
            general?: { language?: "ko" | "en" };
            office_layout?: { layout_profile?: string };
          };
        }>("/api/settings");
        if (!mounted) return;
        const serverLanguage = json.settings?.ui_language ?? json.settings?.general?.language ?? language;
        const serverMotion = json.settings?.ui_motion ?? motion;
        const serverLayout = json.settings?.layout_profile ?? json.settings?.office_layout?.layout_profile ?? "kr_t_left_v2";
        setAllUi({ language: serverLanguage, motion: serverMotion });
        void i18n.changeLanguage(serverLanguage);
        setDraftLanguage(serverLanguage);
        setDraftMotion(serverMotion);
        setDraftLayoutProfile(serverLayout);
        setLoaded(true);
      } catch (e) {
        if (mounted) {
          pushError(t("settings_title"), e instanceof Error ? e.message : "failed to load settings");
          setLoaded(true);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [i18n, language, loaded, motion, setAllUi, pushError, t]);

  const saveSettings = async (): Promise<void> => {
    setSaving(true);
    setSaveMessage("");
    try {
      const json = await apiPut<{ ok?: boolean }>("/api/settings", {
        settings: {
          ui_language: draftLanguage,
          ui_motion: draftMotion,
          layout_profile: draftLayoutProfile
        }
      });
      if (!json.ok) {
        throw new Error("failed to save settings");
      }
      setAllUi({ language: draftLanguage, motion: draftMotion });
      void i18n.changeLanguage(draftLanguage);
      setSaveMessage(t("settings_saved"));
    } catch (e) {
      pushError(t("settings_title"), e instanceof Error ? e.message : "failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const installGlobalHooks = async (): Promise<void> => {
    setGlobalInstalling(true);
    setGlobalResult(null);
    try {
      const raw = await apiPost<GlobalInstallResult>("/api/integration/hooks/install-global", {});
      const normalized: GlobalInstallResult = {
        ok: Boolean(raw?.ok),
        backup: raw?.backup ?? null,
        added: Array.isArray(raw?.added) ? raw.added : [],
        skipped: Array.isArray(raw?.skipped) ? raw.skipped : []
      };
      if (typeof raw?.message === "string") normalized.message = raw.message;
      if (typeof raw?.target_file === "string") normalized.target_file = raw.target_file;
      setGlobalResult(normalized);
      await refreshStatus();
    } catch (e) {
      pushError(t("settings_global_hooks_title"), e instanceof Error ? e.message : "failed to install global hooks");
    } finally {
      setGlobalInstalling(false);
    }
  };

  const installHooks = async (mode: "guide" | "write"): Promise<void> => {
    setInstallResult(null);
    try {
      const json = await apiPost<InstallResult>("/api/integration/hooks/install", { mode });
      setInstallResult(json);
      await refreshStatus();
    } catch (e) {
      pushError(t("settings_hooks_title"), e instanceof Error ? e.message : "failed to install hooks");
    }
  };

  const saveThoughtBubble = async (): Promise<void> => {
    setTbSaveMsg("");
    try {
      const currentJson = await apiGet<{ value?: Record<string, unknown> }>("/api/settings/app");
      const merged = { ...currentJson.value, thought_bubble: tbForm };
      await apiPut("/api/settings/app", { value: merged });
      setTbSaveMsg(t("settings_thought_bubble_save_ok"));
    } catch (e) {
      setTbSaveMsg(t("settings_thought_bubble_save_fail", { error: e instanceof Error ? e.message : "unknown" }));
    }
  };

  const updateTb = (patch: Partial<ThoughtBubbleForm>): void => {
    setTbForm((prev) => ({ ...prev, ...patch }));
  };

  const updateTranslation = (patch: Partial<ThoughtBubbleForm["translation"]>): void => {
    setTbForm((prev) => ({ ...prev, translation: { ...prev.translation, ...patch } }));
  };

  return (
    <section>
      <h2>{t("settings_title")}</h2>

      <div className="split-layout">
        <article className="panel settings-form">
          <h3>{t("settings_lang_motion")}</h3>
          <p>{t("settings_lang_motion_desc")}</p>
          <label>
            {t("settings_language")}
            <select value={draftLanguage} onChange={(e) => setDraftLanguage(e.target.value as "ko" | "en")}>
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t("settings_motion")}
            <select value={draftMotion} onChange={(e) => setDraftMotion(e.target.value as "low" | "normal" | "high")}>
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </label>
          <label>
            {t("settings_layout_profile")}
            <select value={draftLayoutProfile} onChange={(e) => setDraftLayoutProfile(e.target.value)}>
              <option value="kr_t_left_v2">kr_t_left_v2</option>
            </select>
          </label>
          <p className="settings-hint">{t("settings_layout_profile_help")}</p>
          <div className="action-row">
            <button className="list-btn" onClick={() => void saveSettings()} disabled={saving || !hasDirty}>
              {saving ? t("common_loading") : t("settings_btn_save")}
            </button>
          </div>
          {saveMessage ? <p>{saveMessage}</p> : null}
        </article>

        <article className="panel">
          <h3>{t("settings_hooks_title")}</h3>
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

          <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--line)" }} />
          <h3>{t("settings_global_hooks_title")}</h3>
          <p className="settings-hint" style={{ marginTop: 0 }}>{t("settings_global_hooks_desc")}</p>
          <div className="action-row">
            <button className="list-btn" onClick={() => void installGlobalHooks()} disabled={globalInstalling}>
              {globalInstalling ? t("common_loading") : t("settings_btn_install_global")}
            </button>
          </div>
          {globalResult ? (
            <div className="panel nested" style={{ marginTop: "10px" }}>
              <p>{t("settings_result_ok")}: {String(globalResult.ok)}</p>
              {globalResult.message ? <p>{globalResult.message}</p> : null}
              {globalResult.target_file ? <p>{t("settings_result_target")}: {globalResult.target_file}</p> : null}
              {Array.isArray(globalResult.added) && globalResult.added.length > 0 ? <p>{t("settings_global_added")}: {globalResult.added.join(", ")}</p> : null}
              {Array.isArray(globalResult.skipped) && globalResult.skipped.length > 0 ? <p>{t("settings_global_skipped")}: {globalResult.skipped.join(", ")}</p> : null}
              {globalResult.backup ? <p>{t("settings_global_backup")}: {globalResult.backup}</p> : null}
            </div>
          ) : null}
        </article>
      </div>

      <article className="panel" style={{ marginTop: "1rem" }}>
        <h3>{t("settings_thought_bubble_title")}</h3>
        <p>{t("settings_thought_bubble_desc")}</p>

        <label>
          <input
            type="checkbox"
            checked={tbForm.enabled}
            onChange={(e) => updateTb({ enabled: e.target.checked })}
          />
          {t("settings_thought_bubble_enabled")}
        </label>

        <label>
          {t("settings_thought_bubble_max_length")}
          <input
            type="number"
            min={10}
            max={500}
            value={tbForm.max_length}
            onChange={(e) => updateTb({ max_length: Number(e.target.value) })}
            style={{ width: "80px", marginLeft: "0.5rem" }}
          />
        </label>

        <h4 style={{ marginTop: "1rem" }}>{t("settings_translation_title")}</h4>

        <label>
          <input
            type="checkbox"
            checked={tbForm.translation.enabled}
            onChange={(e) => updateTranslation({ enabled: e.target.checked })}
          />
          {t("settings_translation_enabled")}
        </label>

        <label>
          {t("settings_translation_api_endpoint")}
          <input
            type="text"
            value={tbForm.translation.api_endpoint}
            onChange={(e) => updateTranslation({ api_endpoint: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          {t("settings_translation_api_key")}
          <input
            type="password"
            value={tbForm.translation.api_key}
            onChange={(e) => updateTranslation({ api_key: e.target.value })}
            style={{ width: "100%" }}
            autoComplete="off"
          />
        </label>

        <label>
          {t("settings_translation_model")}
          <input
            type="text"
            value={tbForm.translation.model}
            onChange={(e) => updateTranslation({ model: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          {t("settings_translation_target_language")}
          <input
            type="text"
            value={tbForm.translation.target_language}
            onChange={(e) => updateTranslation({ target_language: e.target.value })}
            style={{ width: "80px" }}
          />
        </label>

        <div className="action-row" style={{ marginTop: "0.5rem" }}>
          <button className="list-btn" onClick={() => void saveThoughtBubble()}>
            {t("settings_thought_bubble_save")}
          </button>
          {tbSaveMsg ? <span style={{ marginLeft: "0.5rem" }}>{tbSaveMsg}</span> : null}
        </div>
      </article>

      <div className="split-layout" style={{ marginTop: "14px" }}>
        <ConnectionSettings />
        <OperationsSettings />
      </div>

      <div className="split-layout" style={{ marginTop: "14px" }}>
        <SeatEditor />
        <TransitionRulesEditor />
      </div>
    </section>
  );
}
