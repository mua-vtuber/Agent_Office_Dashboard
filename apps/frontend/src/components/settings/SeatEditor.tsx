import { useEffect, useState } from "react";
import { defaultSettings } from "@aod/shared-schema";
import { useAppSettingsStore, type SeatPosition } from "../../stores/app-settings-store";
import { useErrorStore } from "../../stores/error-store";
import { useTranslation } from "react-i18next";

const DEFAULT_SEATS: Record<string, SeatPosition> = defaultSettings.office_layout.seat_positions;

export function SeatEditor(): JSX.Element {
  const { t } = useTranslation();
  const settings = useAppSettingsStore((s) => s.settings);
  const update = useAppSettingsStore((s) => s.update);
  const pushError = useErrorStore((s) => s.push);
  const [seats, setSeats] = useState<Record<string, SeatPosition>>(DEFAULT_SEATS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const sp = settings?.office_layout?.seat_positions;
    if (sp && Object.keys(sp).length > 0) setSeats(sp);
  }, [settings]);

  const updateSeat = (key: string, axis: "x" | "y", value: string): void => {
    setSeats((prev) => {
      const current = prev[key] ?? { x: 0, y: 0 };
      return {
        ...prev,
        [key]: { x: current.x, y: current.y, [axis]: Number(value) || 0 },
      };
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await update({ office_layout: { ...settings?.office_layout, seat_positions: seats } });
    } catch (e) {
      pushError(t("settings_seat_editor_title"), e instanceof Error ? e.message : "failed to save");
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = (): void => {
    setSeats(DEFAULT_SEATS);
  };

  return (
    <article className="panel settings-form">
      <h3>{t("settings_seat_editor_title")}</h3>
      <table className="settings-table">
        <thead>
          <tr>
            <th>{t("settings_seat_key")}</th>
            <th>{t("settings_seat_x")}</th>
            <th>{t("settings_seat_y")}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(seats).map(([key, pos]) => (
            <tr key={key}>
              <td>{key}</td>
              <td><input type="number" value={pos.x} onChange={(e) => updateSeat(key, "x", e.target.value)} className="settings-input-sm" /></td>
              <td><input type="number" value={pos.y} onChange={(e) => updateSeat(key, "y", e.target.value)} className="settings-input-sm" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="action-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button className="list-btn" onClick={() => void save()} disabled={saving}>
          {saving ? t("common_loading") : t("settings_btn_save")}
        </button>
        <button className="list-btn" onClick={restoreDefaults}>
          {t("settings_seat_restore_defaults")}
        </button>
      </div>
    </article>
  );
}
