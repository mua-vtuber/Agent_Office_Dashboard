import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';

interface ErrorOverlayProps {
  message: string;
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  background: 'rgba(0, 0, 0, 0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'auto',
};

const contentStyle: CSSProperties = {
  textAlign: 'center',
  maxWidth: 480,
  padding: 32,
};

const titleStyle: CSSProperties = {
  color: '#ef4444',
  fontWeight: 'bold',
  fontSize: 22,
  marginBottom: 16,
};

const messageStyle: CSSProperties = {
  color: '#e5e5e5',
  fontSize: 15,
  lineHeight: 1.6,
  wordBreak: 'break-word',
};

export default function ErrorOverlay({ message }: ErrorOverlayProps) {
  const { t } = useTranslation();

  return (
    <div style={backdropStyle}>
      <div style={contentStyle}>
        <div style={titleStyle}>{t('error.fatal')}</div>
        <div style={messageStyle}>{message}</div>
      </div>
    </div>
  );
}
