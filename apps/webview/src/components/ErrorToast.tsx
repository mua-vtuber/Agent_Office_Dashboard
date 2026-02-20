import { useEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorStore } from '../stores/error-store';

const containerStyle: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  pointerEvents: 'auto',
  maxWidth: 360,
};

const toastStyle: CSSProperties = {
  background: 'rgba(220, 38, 38, 0.9)',
  color: '#fff',
  borderRadius: 8,
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
};

const sourceStyle: CSSProperties = {
  fontWeight: 'bold',
  fontSize: 11,
  opacity: 0.85,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const messageStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.4,
  wordBreak: 'break-word',
};

const dismissBtnStyle: CSSProperties = {
  alignSelf: 'flex-end',
  background: 'rgba(255,255,255,0.2)',
  border: 'none',
  color: '#fff',
  borderRadius: 4,
  padding: '2px 10px',
  cursor: 'pointer',
  fontSize: 12,
  marginTop: 4,
};

const AUTO_DISMISS_MS = 5000;

export default function ErrorToast() {
  const { t } = useTranslation();
  const errors = useErrorStore((s) => s.errors);
  const dismiss = useErrorStore((s) => s.dismiss);

  // Track which error timestamps we already started auto-dismiss timers for
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    errors.forEach((error, index) => {
      const key = `${error.ts}:${error.source}:${error.message}`;
      if (dismissedRef.current.has(key)) return;
      dismissedRef.current.add(key);

      const timer = setTimeout(() => {
        // Re-read current errors to find the correct index at dismissal time
        const currentErrors = useErrorStore.getState().errors;
        const currentIndex = currentErrors.findIndex(
          (e) => e.ts === error.ts && e.source === error.source && e.message === error.message,
        );
        if (currentIndex >= 0) {
          useErrorStore.getState().dismiss(currentIndex);
        }
      }, AUTO_DISMISS_MS);

      timers.push(timer);
      // Suppress unused variable warning: index is needed for forEach signature
      void index;
    });

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [errors]);

  if (errors.length === 0) return null;

  return (
    <div style={containerStyle}>
      {errors.map((error, index) => (
        <div key={`${error.ts}-${error.source}-${index}`} style={toastStyle}>
          <span style={sourceStyle}>{error.source}</span>
          <span style={messageStyle}>{error.message}</span>
          <button
            type="button"
            style={dismissBtnStyle}
            onClick={() => dismiss(index)}
          >
            {t('error.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
