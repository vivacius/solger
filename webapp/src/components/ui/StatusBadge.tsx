import { healthInfo } from '../../lib/utils';

interface StatusBadgeProps {
  state: number | undefined;
  size?: 'sm' | 'md';
}

export function StatusBadge({ state, size = 'md' }: StatusBadgeProps) {
  const info = healthInfo(state);
  const isSmall = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSmall ? 4 : 5,
        padding: isSmall ? '3px 8px' : '5px 11px',
        borderRadius: 9999,
        fontSize: isSmall ? 11 : 12,
        fontWeight: 600,
        color: info.color,
        background: info.bg,
        border: `1px solid ${info.color}30`,
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
      }}
    >
      <span
        style={{
          width: isSmall ? 6 : 7,
          height: isSmall ? 6 : 7,
          borderRadius: '50%',
          background: info.color,
          flexShrink: 0,
        }}
      />
      {info.label}
    </span>
  );
}
