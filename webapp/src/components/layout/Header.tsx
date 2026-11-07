import { useLocation, NavLink, Link } from 'react-router-dom';
import { RefreshCw, Bell, MapPin, Calendar, ArrowLeft, LogOut } from 'lucide-react';
import { BRAND } from '../../lib/utils';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const NAV_ITEMS = [
  { to: '/',              label: 'Dashboard' },
  { to: '/plantas',       label: 'Plantas'   },
  { to: '/mapa',          label: 'Mapa'      },
  { to: '/alertas',       label: 'Alertas', badge: true },
  { to: '/comparar',      label: 'Comparar'  },
  { to: '/mantenimiento', label: 'Mantenimiento' },
  { to: '/mercado',       label: 'Mercado'   },
  { to: '/facturacion',   label: 'Facturación' },
  { to: '/reportes',      label: 'Reportes'  },
];

function fmtHeaderDate(): string {
  return new Date().toLocaleDateString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}

interface HeaderProps {
  lastUpdated?: string;
  onRefresh?: () => void;
  loading?: boolean;
}

export function Header({ lastUpdated, onRefresh, loading }: HeaderProps) {
  const location = useLocation();
  const { user, logout } = useAuth();

  // Detecta si es una ruta de detalle de planta
  const isPlantDetail = location.pathname.startsWith('/plantas/') && location.pathname !== '/plantas';

  const fmtTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
    : null;

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'var(--header-h)',
        zIndex: 50,
        background: 'rgba(250,248,242,0.92)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(15,23,42,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
      }}
    >
      {/* ── Izquierda: Logo y Navegación de Retorno ───────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center' }}>
          <img
            src="/logo.png"
            alt="SOLGER"
            style={{
              height: 28,
              width: 'auto',
              objectFit: 'contain',
              transition: 'transform 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          />
        </Link>

        {isPlantDetail && (
          <Link
            to="/plantas"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: BRAND.muted,
              textDecoration: 'none',
              padding: '3px 8px',
              borderRadius: 6,
              background: 'white',
              border: '1px solid rgba(15,23,42,0.08)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(15,23,42,0.03)';
              (e.currentTarget as HTMLElement).style.color = BRAND.text;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'white';
              (e.currentTarget as HTMLElement).style.color = BRAND.muted;
            }}
          >
            <ArrowLeft size={12} />
            <span>Volver</span>
          </Link>
        )}
      </div>

      {/* ── Centro: Navegación Horizontal — oculto en móvil ─── */}
      <nav className="header-nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: 4, height: '100%', flexWrap: 'nowrap', overflow: 'hidden' }}>
        {NAV_ITEMS.map(({ to, label, badge }) => {
          const active = isActive(to);
          return (
            <NavLink
              key={to}
              to={to}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: active ? 650 : 500,
                color: active ? '#3D8A1F' : 'var(--text-secondary)',
                background: active ? 'rgba(88,174,50,0.08)' : 'transparent',
                border: active ? '1px solid rgba(88,174,50,0.18)' : '1px solid transparent',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
              onMouseEnter={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(15,23,42,0.03)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                }
              }}
            >
              <span>{label}</span>

              {badge && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: BRAND.red,
                    boxShadow: '0 0 4px rgba(239,68,68,0.5)',
                  }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* ── Derecha: Sincronización y Métricas — oculto en móvil ── */}
      <div className="header-widgets-desktop" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {/* Ubicación */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 6px',
            borderRadius: 5,
            background: 'rgba(15,23,42,0.03)',
            border: '1px solid rgba(15,23,42,0.05)',
          }}
        >
          <MapPin size={10} color="#64748B" />
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>Valle del Cauca</span>
        </div>

        {/* Fecha */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 6px',
            borderRadius: 5,
            background: 'rgba(15,23,42,0.03)',
            border: '1px solid rgba(15,23,42,0.05)',
          }}
        >
          <Calendar size={10} color="#64748B" />
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>{fmtHeaderDate()}</span>
        </div>

        {/* Notificaciones */}
        <button
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: '1px solid rgba(15,23,42,0.07)',
            background: 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748B',
            boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(15,23,42,0.14)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(15,23,42,0.07)'}
        >
          <Bell size={13} />
        </button>

        {/* Última actualización */}
        {fmtTime && (
          <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, marginLeft: 2, whiteSpace: 'nowrap' }}>
            Act. {fmtTime}
          </span>
        )}

        {/* Refresh */}
        {onRefresh && (
          <button
            onClick={async () => {
              try {
                await api.clearCache();
              } catch { /* silent */ }
              onRefresh();
            }}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid rgba(88,174,50,0.25)',
              background: 'rgba(88,174,50,0.06)',
              color: '#3D8A1F',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => {
              if (!loading) (e.currentTarget as HTMLElement).style.background = 'rgba(88,174,50,0.12)';
            }}
            onMouseLeave={e => {
              if (!loading) (e.currentTarget as HTMLElement).style.background = 'rgba(88,174,50,0.06)';
            }}
          >
            <RefreshCw size={11} style={{ animation: loading ? 'spin-slow 1.2s linear infinite' : 'none' }} />
            Actualizar
          </button>
        )}

        {/* Cerrar sesión */}
        {user && (
          <button
            onClick={logout}
            title="Cerrar sesión"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid rgba(15,23,42,0.1)',
              background: 'white',
              color: '#64748B',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <LogOut size={11} />
            Salir
          </button>
        )}
      </div>
    </header>
  );
}
