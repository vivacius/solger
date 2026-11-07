import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { ErrorState, LoadingSpinner } from '../components/ui/States';
import { Header } from '../components/layout/Header';
import { StatusBadge } from '../components/ui/StatusBadge';
import { fmtEnergy, fmt, plantSlug, BRAND } from '../lib/utils';
import type { Plant, PlantKpi } from '../types/api';

// Fix Leaflet icon paths in Vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function createSolgerMarker(color: string) {
  return L.divIcon({
    html: `
      <div style="
        width: 24px; height: 24px;
        background: ${color};
        border: 2px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 6px rgba(15,23,42,0.25);
      "></div>
    `,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -26],
  });
}

const healthColors: Record<number, string> = {
  3: BRAND.green,   // Operativa (Huawei: 3)
  2: BRAND.gold,    // Alarma    (Huawei: 2)
  1: BRAND.red,     // Offline   (Huawei: 1)
};

function FitBounds({ plants }: { plants: Plant[] }) {
  const map = useMap();
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || plants.length === 0) return;
    const valid = plants.filter(p => p.latitude && p.longitude);
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map(p => [parseFloat(p.latitude!), parseFloat(p.longitude!)]));
    map.fitBounds(bounds, { padding: [30, 30] });
    didFit.current = true;
  }, [plants, map]);
  return null;
}

export default function MapPage() {
  const { data, loading, error, refresh } = useFetch(api.getSummary, [], { refreshInterval: 5 * 60 * 1000 });

  const kpiMap = Object.fromEntries(
    (data?.kpis ?? []).map((k: PlantKpi) => [k.plantCode ?? k.stationCode ?? '', k.dataItemMap])
  );

  const plants = (data?.plants ?? []).filter(p => p.latitude && p.longitude);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--header-h))' }}>
      <Header lastUpdated={data?.lastUpdated} onRefresh={refresh} loading={loading} />

      {error && <div style={{ padding: 16 }}><ErrorState message={error} onRetry={refresh} /></div>}
      {loading && !data && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyItems: 'center' }}>
          <LoadingSpinner text="Cargando mapa..." />
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar de listado del mapa compacto (260px) */}
          <div
            style={{
              width: 260,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: BRAND.card,
              borderRight: `1px solid ${BRAND.border}`,
            }}
          >
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BRAND.border}` }}>
              <p className="label-xs" style={{ color: BRAND.muted, fontSize: 10.5 }}>
                {plants.length} plantas en el mapa
              </p>
            </div>

            {/* Leyenda en sidebar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid ${BRAND.border}` }}>
              {[
                { color: BRAND.green, label: 'OK' },
                { color: BRAND.gold,  label: 'Alarma'    },
                { color: BRAND.red,   label: 'Offline'   },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                  <span style={{ fontSize: 10.5, color: BRAND.muted, fontWeight: 500 }}>{label}</span>
                </div>
              ))}
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {plants.map(plant => {
                const dim = kpiMap[plant.plantCode] ?? {};
                return (
                  <Link
                    key={plant.plantCode}
                    to={`/plantas/${plantSlug(plant.plantCode)}`}
                    style={{
                      display: 'block',
                      padding: '10px 16px',
                      borderBottom: `1px solid ${BRAND.border}`,
                      textDecoration: 'none',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = BRAND.surface}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: BRAND.text, lineHeight: 1.25 }}>
                        {plant.plantName}
                      </p>
                      <StatusBadge state={dim.real_health_state} size="sm" />
                    </div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#B45309' }}>
                      {dim.day_power != null ? `${fmt(dim.day_power)} kWh hoy` : '—'}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Contenedor del mapa satelital */}
          <div style={{ flex: 1, position: 'relative' }}>
            <MapContainer center={[3.6, -76.35]} zoom={11} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
              <FitBounds plants={plants} />
              {plants.map(plant => {
                const dim = kpiMap[plant.plantCode] ?? {};
                const health = dim.real_health_state ?? 0;
                const color = healthColors[health] ?? BRAND.muted;
                return (
                  <Marker
                    key={plant.plantCode}
                    position={[parseFloat(plant.latitude!), parseFloat(plant.longitude!)]}
                    icon={createSolgerMarker(color)}
                  >
                    <Popup>
                      <div style={{ minWidth: 190, fontFamily: 'Inter, sans-serif' }}>
                        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: BRAND.text, borderBottom: `1px solid ${BRAND.border}`, paddingBottom: 4 }}>
                          {plant.plantName}
                        </p>
                        <div style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: BRAND.muted }}>Capacidad</span>
                            <span style={{ color: BRAND.text, fontWeight: 650 }}>{plant.capacity > 0 ? `${plant.capacity} kWp` : '—'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: BRAND.muted }}>Hoy</span>
                            <span style={{ color: '#B45309', fontWeight: 700 }}>
                              {dim.day_power != null ? `${fmt(dim.day_power)} kWh` : '—'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: BRAND.muted }}>Mes</span>
                            <span style={{ color: '#0F766E', fontWeight: 650 }}>{dim.month_power != null ? fmtEnergy(dim.month_power) : '—'}</span>
                          </div>
                        </div>
                        <Link
                          to={`/plantas/${plantSlug(plant.plantCode)}`}
                          style={{
                            display: 'block',
                            marginTop: 10,
                            textAlign: 'center',
                            fontSize: 11.5,
                            color: BRAND.greenD,
                            fontWeight: 700,
                            textDecoration: 'none',
                            background: 'rgba(88,174,50,0.06)',
                            padding: '4px 0',
                            borderRadius: 5,
                            border: '1px solid rgba(88,174,50,0.12)',
                          }}
                        >
                          Ver detalle →
                        </Link>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        </div>
      )}
    </div>
  );
}
