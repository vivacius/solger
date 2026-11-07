import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Zap,
  Map,
  Bell,
  BarChart3,
  Wrench,
  TrendingUp,
  FileText,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',               icon: LayoutDashboard, label: 'Inicio'   },
  { to: '/plantas',        icon: Zap,             label: 'Plantas'  },
  { to: '/mapa',           icon: Map,             label: 'Mapa'     },
  { to: '/alertas',        icon: Bell,            label: 'Alertas', badge: true },
  { to: '/comparar',       icon: BarChart3,       label: 'Comparar' },
  { to: '/mantenimiento',  icon: Wrench,          label: 'Mant.'    },
  { to: '/mercado',        icon: TrendingUp,      label: 'Mercado'  },
  { to: '/facturacion',    icon: FileText,        label: 'Factura'  },
];

export function BottomNav() {
  const location = useLocation();

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <nav
      className="bottom-nav"
      aria-label="Navegación principal"
    >
      {NAV_ITEMS.map(({ to, icon: Icon, label, badge }) => {
        const active = isActive(to);
        return (
          <NavLink
            key={to}
            to={to}
            className={`bottom-nav-item${active ? ' active' : ''}`}
          >
            <span className="bottom-nav-icon-wrap">
              <Icon
                size={20}
                strokeWidth={active ? 2.2 : 1.7}
              />
              {badge && <span className="bottom-nav-badge" />}
            </span>
            <span className="bottom-nav-label">{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
