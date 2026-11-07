import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';

export function Layout() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        width: '100%',
      }}
    >
      {/* Área de contenido principal que ocupa todo el ancho (cada página monta su <Header /> con onRefresh) */}
      <main
        style={{
          flex: 1,
          width: '100%',
          paddingTop: 'var(--header-h)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          className="layout-content"
          style={{
            flex: 1,
            width: '100%',
            maxWidth: 1700,
            margin: '0 auto',
            padding: '16px 20px',
          }}
        >
          <Outlet />
        </div>
      </main>

      {/* Barra inferior de navegación — solo visible en móvil */}
      <BottomNav />
    </div>
  );
}
export function useSidebar() {
  return { isCollapsed: false, toggle: () => {} };
}
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

