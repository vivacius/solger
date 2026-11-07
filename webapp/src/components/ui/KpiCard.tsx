import React from 'react';
import { BRAND } from '../../lib/utils';

interface KpiCardProps {
  title: string;
  value: string;
  unit?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent?: 'solar' | 'green' | 'teal' | 'red' | 'default';
  loading?: boolean;
}

const accentTokens = {
  solar: {
    iconBg:    'rgba(245,185,20,0.08)',
    iconColor: '#D4A10A',
    topBar:    '#F5B914',
  },
  green: {
    iconBg:    'rgba(88,174,50,0.08)',
    iconColor: '#3D8A1F',
    topBar:    '#58AE32',
  },
  teal: {
    iconBg:    'rgba(36,165,174,0.08)',
    iconColor: '#1A8A92',
    topBar:    '#24A5AE',
  },
  red: {
    iconBg:    'rgba(239,68,68,0.06)',
    iconColor: '#DC2626',
    topBar:    '#EF4444',
  },
  default: {
    iconBg:    BRAND.surface,
    iconColor: BRAND.muted,
    topBar:    'transparent',
  },
};

export function KpiCard({
  title,
  value,
  unit,
  subtitle,
  icon,
  accent = 'default',
  loading = false,
}: KpiCardProps) {
  const t = accentTokens[accent];

  return (
    <div
      style={{
        background: BRAND.card,
        border: `1px solid ${BRAND.border}`,
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        overflow: 'hidden',
        transition: 'box-shadow 0.15s ease, transform 0.15s ease',
        minHeight: 88,
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(15,23,42,0.06)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Accent bar top */}
      {accent !== 'default' && (
        <div style={{ height: 2.5, background: t.topBar, flexShrink: 0 }} />
      )}

      <div style={{ padding: '10px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {/* Top row: label + icon */}
        <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
          <p className="label-xs" style={{ fontSize: 9.5, letterSpacing: '0.05em' }}>{title}</p>
          {icon && (
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: t.iconBg,
                color: t.iconColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 14 })}
            </div>
          )}
        </div>

        {/* Value */}
        {loading ? (
          <div>
            <div className="skeleton" style={{ height: 20, width: 100, marginBottom: 4 }} />
            <div className="skeleton" style={{ height: 10, width: 60 }} />
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, lineHeight: 1 }}>
              <span style={{
                fontSize: value.length > 9 ? '1.35rem' : '1.6rem',
                fontWeight: 800,
                letterSpacing: '-0.025em',
                color: BRAND.text,
                lineHeight: 1,
              }}>
                {value}
              </span>
              {unit && (
                <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.muted }}>
                  {unit}
                </span>
              )}
            </div>
            {subtitle && (
              <p style={{ fontSize: 11, color: BRAND.muted, marginTop: 4, lineHeight: 1.2 }}>
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
