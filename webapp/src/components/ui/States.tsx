import { AlertCircle, RefreshCw } from 'lucide-react';
import { BRAND } from '../../lib/utils';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', textAlign: 'center', gap: 16 }}>
      <div style={{
        width: 52,
        height: 52,
        borderRadius: 14,
        background: BRAND.redL,
        border: `1px solid rgba(239,68,68,0.2)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <AlertCircle color={BRAND.red} size={24} />
      </div>
      <div>
        <p style={{ fontWeight: 600, fontSize: 14, color: BRAND.text }}>Error al cargar datos</p>
        <p style={{ fontSize: 13, color: BRAND.muted, marginTop: 4, maxWidth: 360 }}>{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 9,
            border: `1px solid ${BRAND.border}`,
            background: BRAND.card,
            color: BRAND.text,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
          }}
        >
          <RefreshCw size={13} />
          Reintentar
        </button>
      )}
    </div>
  );
}

export function LoadingSpinner({ text = 'Cargando...' }: { text?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', gap: 14 }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: '3px solid rgba(88,174,50,0.15)',
        borderTopColor: BRAND.green,
        animation: 'spin-slow 0.9s linear infinite',
      }} />
      <p style={{ fontSize: 13, fontWeight: 500, color: BRAND.muted }}>{text}</p>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div
      style={{
        background: BRAND.card,
        border: `1px solid ${BRAND.border}`,
        borderRadius: 16,
        padding: '18px 20px',
        minHeight: 120,
      }}
    >
      <div className="skeleton" style={{ height: 11, width: 80, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 28, width: 130, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 11, width: 100 }} />
    </div>
  );
}
