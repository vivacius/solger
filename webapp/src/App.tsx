import { useState } from 'react';
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
import ClientPortalPage from './pages/ClientPortalPage';

// Persist "already entered" for the current browser session
const SESSION_KEY = 'cie_started';

function AppRoutes() {
  const { user } = useAuth();
  const isClient = user.rol === 'cliente';

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={isClient ? <ClientPortalPage /> : <Dashboard />} />
        <Route path="portal-cliente" element={<ClientPortalPage />} />
        <Route path="plantas" element={<Plants />} />
        <Route path="plantas/:plantCode" element={<PlantDetail />} />
        <Route path="mapa" element={<MapPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="comparar" element={<ComparePage />} />
        <Route path="mantenimiento" element={<MaintenancePage />} />
        <Route path="mercado" element={<MarketPage />} />
        <Route path="facturacion" element={<InvoicePage />} />
        <Route path="*" element={isClient ? <ClientPortalPage /> : <Dashboard />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const [started, setStarted] = useState<boolean>(
    () => sessionStorage.getItem(SESSION_KEY) === 'true'
  );

  const handleStart = () => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    setStarted(true);
  };

  if (!started) {
    return <LandingPage onStart={handleStart} />;
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
