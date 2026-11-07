import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import Dashboard from './pages/Dashboard';
import Plants from './pages/Plants';
import PlantDetail from './pages/PlantDetail';
import MapPage from './pages/MapPage';
import AlertsPage from './pages/AlertsPage';
import ComparePage from './pages/ComparePage';
import MaintenancePage from './pages/MaintenancePage';
import LandingPage from './pages/LandingPage';
import MarketPage from './pages/MarketPage';
import InvoicePage from './pages/InvoicePage';
import { ReportsPage } from './pages/ReportsPage';

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="plantas" element={<Plants />} />
        <Route path="plantas/:plantCode" element={<PlantDetail />} />
        <Route path="mapa" element={<MapPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="comparar" element={<ComparePage />} />
        <Route path="mantenimiento" element={<MaintenancePage />} />
        <Route path="mercado" element={<MarketPage />} />
        <Route path="facturacion" element={<InvoicePage />} />
        <Route path="reportes" element={<ReportsPage />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
