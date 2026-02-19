import { useErrorStore } from "../../stores/error-store";
import { useTranslation } from "react-i18next";

export function ErrorModal(): JSX.Element | null {
  const errors = useErrorStore((s) => s.errors);
  const dismiss = useErrorStore((s) => s.dismiss);
  const clear = useErrorStore((s) => s.clear);
  const { t } = useTranslation();

  if (errors.length === 0) return null;

  return (
    <div className="error-modal-overlay">
      <div className="error-modal">
        <div className="error-modal-header">
          <h3>{t("error_modal_title")}</h3>
          <button className="error-modal-close" onClick={clear}>{t("error_modal_close_all")}</button>
        </div>
        {errors.map((err) => (
          <div key={err.id} className="error-modal-item">
            <div className="error-modal-item-head">
              <strong>{err.title}</strong>
              <button onClick={() => dismiss(err.id)}>&times;</button>
            </div>
            <p>{err.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
