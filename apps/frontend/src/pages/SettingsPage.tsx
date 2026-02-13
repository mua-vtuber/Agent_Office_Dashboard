import { useEffect, useState } from "react";
import { BACKEND_ORIGIN } from "../lib/constants";

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
  const [language, setLanguage] = useState<"ko" | "en">("ko");
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
      <h2>Settings</h2>

      <div className="split-layout">
        <article className="panel">
          <h3>언어 / 모션</h3>
          <p>i18n 기반 설정(현재 MVP는 저장 없이 즉시 선택 UI만 제공).</p>
          <label>
            언어
            <select value={language} onChange={(e) => setLanguage(e.target.value as "ko" | "en")}>
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
          </label>
          <p>모션 강도: normal (추후 low/high 제공)</p>
          <p>레이아웃 프로필: kr_t_left_v2</p>
        </article>

        <article className="panel">
          <h3>Hooks Onboarding</h3>
          {error ? <p className="error">{error}</p> : null}
          {!status ? (
            <p>상태 확인 중...</p>
          ) : (
            <div>
              <p>mode: {status.mode}</p>
              <p>hooks configured: {String(status.hooks_configured)}</p>
              <p>last checked: {status.last_checked_at}</p>
              <p>last hook event: {status.last_hook_event_at ?? "-"}</p>
              <p>checked files:</p>
              <ul className="compact-list">
                {status.checked_files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="action-row">
            <button className="list-btn" onClick={() => void installHooks("guide")}>설정 가이드 보기</button>
            <button className="list-btn" onClick={() => void installHooks("write")}>자동 설정 시도</button>
            <button className="list-btn" onClick={() => void refreshStatus()}>상태 새로고침</button>
          </div>

          {installResult ? (
            <div className="panel nested">
              <p>ok: {String(installResult.ok)} / mode: {installResult.mode}</p>
              {installResult.message ? <p>{installResult.message}</p> : null}
              {installResult.target_file ? <p>target: {installResult.target_file}</p> : null}
              {installResult.next_step ? <p>next: {installResult.next_step}</p> : null}
              {installResult.template ? <pre>{installResult.template}</pre> : null}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
