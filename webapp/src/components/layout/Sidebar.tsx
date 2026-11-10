import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Zap,
  Map,
  Bell,
  BarChart3,
  ChevronLeft,
  Wrench,
  TrendingUp,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import { useSidebar } from './Layout';

const NAV_MAIN = [
  { to: '/',               icon: LayoutDashboard, label: 'Dashboard'      },
  { to: '/plantas',        icon: Zap,             label: 'Plantas'        },
  { to: '/mapa',           icon: Map,             label: 'Mapa'           },
  { to: '/alertas',        icon: Bell,            label: 'Alertas',  badge: true },
  { to: '/comparar',       icon: BarChart3,       label: 'Comparar'      },
  { to: '/mantenimiento',  icon: Wrench,          label: 'Mantenimiento'  },
  { to: '/mercado',        icon: TrendingUp,      label: 'Mercado XM'    },
  { to: '/facturacion',    icon: Receipt,         label: 'Facturación'   },
  { to: '/reportes',       icon: FileSpreadsheet, label: 'Reportes'      },
];

export function Sidebar() {
  const location = useLocation();
  const { isCollapsed, toggle } = useSidebar();

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <aside
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        width: 'var(--sidebar-w)',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        transform: isCollapsed ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {/* ── Logo SOLGER Original ─────────────────────────────── */}
      <div
        style={{
          padding: '0 20px',
          height: 'var(--header-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--sidebar-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <img
            src="/logo.png"
            alt="SOLGER"
            style={{
              height: 30,
              width: 'auto',
              objectFit: 'contain',
              filter: 'brightness(1.15)',
              transition: 'transform 0.3s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          />
        </div>
        <button
          onClick={toggle}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid var(--sidebar-border)',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#475569',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
          title="Contraer sidebar"
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
            (e.currentTarget as HTMLElement).style.color = '#94A3B8';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = '#475569';
          }}
        >
          <ChevronLeft size={13} />
        </button>
      </div>

      {/* ── Nav principal ──────────────────────────────────────── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_MAIN.map(({ to, icon: Icon, label, badge }) => {
          const active = isActive(to);
          return (
            <NavLink
              key={to}
              to={to}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: active ? 600 : 450,
                color: active ? '#F8FAFC' : 'var(--sidebar-text)',
                background: active ? 'var(--sidebar-active)' : 'transparent',
                border: active ? '1px solid rgba(88,174,50,0.18)' : '1px solid transparent',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-bg-hover)';
                  (e.currentTarget as HTMLElement).style.color = '#E2E8F0';
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-text)';
                }
              }}
            >
              {/* Indicador izquierdo */}
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '20%',
                    bottom: '20%',
                    width: 3,
                    borderRadius: '0 3px 3px 0',
                    background: '#58AE32',
                  }}
                />
              )}

              <Icon
                size={15}
                strokeWidth={active ? 2.2 : 1.8}
                color={active ? '#58AE32' : 'currentColor'}
                style={{ flexShrink: 0 }}
              />
              <span style={{ flex: 1 }}>{label}</span>

              {badge && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#EF4444',
                    boxShadow: '0 0 5px rgba(239,68,68,0.5)',
                  }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--sidebar-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #1E3A5F 0%, #0F2440 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
              color: '#94A3B8',
            }}
          >
            A
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, color: '#CBD5E1', lineHeight: 1.2 }}>Admin</p>
            <p style={{ fontSize: 9.5, color: '#475569', lineHeight: 1.2, marginTop: 1 }}>FusionSolar la5</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
