import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { Sun, Cloud, CloudSun, Navigation, Maximize2, Search, Layers, Play, Pause } from 'lucide-react';
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

type BaseLayerKey = 'hybrid' | 'satellite' | 'streets';

const BASE_LAYERS: Record<BaseLayerKey, { label: string; url: string; attribution: string }> = {
  hybrid: {
    label: 'Híbrido (Google)',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps Satellite &amp; Roads',
  },
  streets: {
    label: 'Calles (Google)',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps',
  },
  satellite: {
    label: 'Satélite (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri World Imagery',
  },
};

function createSolgerMarker(color: string, selected = false) {
  const size = selected ? 28 : 24;
  const ring = selected ? 'box-shadow: 0 0 0 5px rgba(36,165,174,0.35), 0 3px 8px rgba(15,23,42,0.35);' : 'box-shadow: 0 2px 6px rgba(15,23,42,0.25);';
  return L.divIcon({
    html: `
      <div style="
        width: ${size}px; height: ${size}px;
        background: ${color};
        border: 2.5px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        ${ring}
      "></div>
    `,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -(size + 2)],
  });
}

const healthColors: Record<number, string> = {
  3: BRAND.green,   // Operativa (Huawei: 3)
  2: BRAND.gold,    // Alarma    (Huawei: 2)
  1: BRAND.red,     // Offline   (Huawei: 1)
};

function irradianceColor(wm2: number): string {
  if (wm2 >= 750) return '#EF4444';
  if (wm2 >= 550) return '#F97316';
  if (wm2 >= 350) return '#FACC15';
  if (wm2 >= 150) return '#38BDF8';
  return '#64748B';
}

function MapController({
  plants,
  selectedPlant,
  fitTrigger,
}: {
  plants: Plant[];
  selectedPlant: Plant | null;
  fitTrigger: number;
}) {
  const map = useMap();
  const didInitialFit = useRef(false);

  useEffect(() => {
    if (plants.length === 0) return;
    if (!didInitialFit.current || fitTrigger > 0) {
      const valid = plants.filter(p => p.latitude && p.longitude);
      if (valid.length === 0) return;
      const bounds = L.latLngBounds(valid.map(p => [parseFloat(p.latitude!), parseFloat(p.longitude!)]));
      map.fitBounds(bounds, { padding: [36, 36] });
      didInitialFit.current = true;
    }
  }, [plants, map, fitTrigger]);

  useEffect(() => {
    if (selectedPlant?.latitude && selectedPlant?.longitude) {
      map.flyTo(
        [parseFloat(selectedPlant.latitude), parseFloat(selectedPlant.longitude)],
        15,
        { duration: 0.7 }
      );
    }
  }, [selectedPlant, map]);

  return null;
}

export default function MapPage() {
  const { data, loading, error, refresh } = useFetch(api.getSummary, [], { refreshInterval: 5 * 60 * 1000 });
  const { data: gridData } = useFetch(api.getIrradianceGrid, [], { refreshInterval: 30 * 60 * 1000 });
  const [baseLayer, setBaseLayer] = useState<BaseLayerKey>('hybrid');
  const [showIrradiance, setShowIrradiance] = useState(true);
  const [hourIndex, setHourIndex] = useState<number>(6);
  const [isPlaying, setIsPlaying] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '3' | '2' | '1'>('all');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const markerRefs = useRef<Record<string, L.Marker | null>>({});

  useEffect(() => {
    if (gridData?.times?.length && gridData.defaultIndex != null) {
      setHourIndex(gridData.defaultIndex);
    }
  }, [gridData]);

  useEffect(() => {
    if (!isPlaying || !gridData?.times?.length) return;
    const id = setInterval(() => {
      setHourIndex(prev => (prev + 1) % gridData.times.length);
    }, 750);
    return () => clearInterval(id);
  }, [isPlaying, gridData]);

  const kpiMap = useMemo(
    () =>
      Object.fromEntries(
        (data?.kpis ?? []).map((k: PlantKpi) => [k.plantCode ?? k.stationCode ?? '', k.dataItemMap])
      ),
    [data]
  );

  const plants = useMemo(
    () => (data?.plants ?? []).filter(p => p.latitude && p.longitude),
    [data]
  );

  const filteredPlants = useMemo(() => {
    return plants.filter(p => {
      const dim = kpiMap[p.plantCode] ?? {};
      const health = String(dim.real_health_state ?? 0);
      const matchSearch = !search || p.plantName.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || health === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [plants, kpiMap, search, statusFilter]);

  const selectedPlant = useMemo(
    () => plants.find(p => p.plantCode === selectedCode) ?? null,
    [plants, selectedCode]
  );

  const handleSelectPlant = (plant: Plant) => {
    setSelectedCode(plant.plantCode);
    setTimeout(() => {
      const marker = markerRefs.current[plant.plantCode];
      if (marker) marker.openPopup();
    }, 350);
  };

  const summary = data?.summary;
  const cloudPct = summary?.cloudCover_pct;
  const WeatherIcon = cloudPct == null ? Sun : cloudPct > 65 ? Cloud : cloudPct > 25 ? CloudSun : Sun;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--header-h))' }}>
      <Header lastUpdated={data?.lastUpdated} onRefresh={refresh} loading={loading} />

      {error && <div style={{ padding: 16 }}><ErrorState message={error} onRetry={refresh} /></div>}
      {loading && !data && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingSpinner text="Cargando mapa..." />
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar de listado del mapa (280px) */}
          <div
            style={{
              width: 280,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: BRAND.card,
              borderRight: `1px solid ${BRAND.border}`,
            }}
          >
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BRAND.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p className="label-xs" style={{ color: BRAND.muted, fontSize: 10.5, margin: 0 }}>
                  {filteredPlants.length} de {plants.length} plantas en mapa
                </p>
                <button
                  onClick={() => { setSelectedCode(null); setFitTrigger(c => c + 1); }}
                  title="Ver todas las plantas"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10.5, fontWeight: 700, color: BRAND.teal,
                    background: `${BRAND.teal}12`, border: `1px solid ${BRAND.teal}30`,
                    borderRadius: 5, padding: '2px 7px', cursor: 'pointer',
                  }}
                >
                  <Maximize2 size={10} /> Todas
                </button>
              </div>

              {/* Buscador */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: BRAND.muted }} />
                <input
                  type="text"
                  placeholder="Buscar planta..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    width: '100%', padding: '5px 8px 5px 26px', borderRadius: 6,
                    border: `1px solid ${BRAND.border}`, fontSize: 12, color: BRAND.text,
                    background: '#fff', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Filtro por estado */}
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { id: 'all' as const, label: 'Todas', color: BRAND.text },
                  { id: '3' as const, label: 'OK', color: BRAND.green },
                  { id: '2' as const, label: 'Alarma', color: BRAND.gold },
                  { id: '1' as const, label: 'Offline', color: BRAND.red },
                ].map(opt => {
                  const active = statusFilter === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setStatusFilter(opt.id)}
                      style={{
                        flex: 1, padding: '3px 4px', borderRadius: 5, fontSize: 10.5, fontWeight: 700,
                        cursor: 'pointer',
                        border: `1px solid ${active ? opt.color : BRAND.border}`,
                        background: active ? `${opt.color}15` : 'transparent',
                        color: active ? opt.color : BRAND.muted,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filteredPlants.map(plant => {
                const dim = kpiMap[plant.plantCode] ?? {};
                const isSelected = selectedCode === plant.plantCode;
                return (
                  <button
                    key={plant.plantCode}
                    type="button"
                    onClick={() => handleSelectPlant(plant)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'block',
                      padding: '10px 14px',
                      border: 'none',
                      borderBottom: `1px solid ${BRAND.border}`,
                      borderLeft: isSelected ? `3px solid ${BRAND.teal}` : '3px solid transparent',
                      background: isSelected ? `${BRAND.teal}0D` : 'transparent',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: BRAND.text, lineHeight: 1.25, margin: 0 }}>
                        {plant.plantName}
                      </p>
                      <StatusBadge state={dim.real_health_state} size="sm" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                      <span style={{ fontWeight: 700, color: '#B45309' }}>
                        {dim.day_power != null ? `${fmt(dim.day_power)} kWh hoy` : '—'}
                      </span>
                      {plant.cloudCover_pct != null && (
                        <span style={{ color: BRAND.muted, fontSize: 10.5 }}>
                          ☁️ {Math.round(plant.cloudCover_pct)}% · {plant.satelliteGhi_kWh_m2?.toFixed(1) ?? '—'} HSP
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contenedor del mapa satelital */}
          <div style={{ flex: 1, position: 'relative' }}>
            {/* Widget Flotante: Clima Satelital en Tiempo Real */}
            {summary && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 54,
                  zIndex: 1000,
                  background: 'rgba(255, 255, 255, 0.94)',
                  backdropFilter: 'blur(8px)',
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: 10,
                  padding: '8px 13px',
                  boxShadow: '0 4px 14px rgba(15,23,42,0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <WeatherIcon size={18} color="#D97706" />
                  <div>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>Clima Satelital</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.text }}>
                      {summary.satelliteIrradiance_W_m2 != null ? `${Math.round(summary.satelliteIrradiance_W_m2)} W/m²` : '—'}
                    </div>
                  </div>
                </div>
                <div style={{ width: 1, height: 24, background: BRAND.border }} />
                <div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>HSP Hoy</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.teal }}>
                    {summary.satelliteHspToday_h != null ? `${summary.satelliteHspToday_h.toFixed(2)} kWh/m²` : '—'}
                  </div>
                </div>
                <div style={{ width: 1, height: 24, background: BRAND.border }} />
                <div>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>Nubosidad</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.text }}>
                    {cloudPct != null ? `${Math.round(cloudPct)}%` : '—'}
                  </div>
                </div>
              </div>
            )}

            {/* Selector Flotante de Capas (Google Híbrido / Calles / Satélite) */}
            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                zIndex: 1000,
                background: 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${BRAND.border}`,
                borderRadius: 9,
                padding: 4,
                boxShadow: '0 4px 14px rgba(15,23,42,0.12)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Layers size={13} color={BRAND.muted} style={{ marginLeft: 6, marginRight: 2 }} />
              {(['hybrid', 'streets', 'satellite'] as BaseLayerKey[]).map(key => {
                const active = baseLayer === key;
                return (
                  <button
                    key={key}
                    onClick={() => setBaseLayer(key)}
                    style={{
                      padding: '5px 9px',
                      borderRadius: 6,
                      border: 'none',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      background: active ? BRAND.teal : 'transparent',
                      color: active ? '#fff' : BRAND.muted,
                    }}
                  >
                    {BASE_LAYERS[key].label}
                  </button>
                );
              })}
              <div style={{ width: 1, height: 18, background: BRAND.border, margin: '0 2px' }} />
              <button
                onClick={() => setShowIrradiance(v => !v)}
                title="Mostrar u ocultar capa de irradiancia satelital Open-Meteo"
                style={{
                  padding: '5px 9px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: showIrradiance ? '#F59E0B' : 'transparent',
                  color: showIrradiance ? '#fff' : BRAND.muted,
                }}
              >
                <Sun size={12} /> Irradiancia
              </button>
            </div>

            {/* Barra inferior de Time-Lapse de Irradiancia (Open-Meteo) */}
            {showIrradiance && gridData && gridData.times.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 16,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1000,
                  background: 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(8px)',
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: 12,
                  padding: '8px 14px',
                  boxShadow: '0 6px 20px rgba(15,23,42,0.16)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  minWidth: 360,
                  maxWidth: '92%',
                }}
              >
                <button
                  onClick={() => setIsPlaying(p => !p)}
                  title={isPlaying ? 'Pausar animación' : 'Animar movimiento de irradiancia'}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', border: 'none',
                    background: BRAND.teal, color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}
                >
                  {isPlaying ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
                </button>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700, color: BRAND.text }}>
                    <span>Irradiancia Valle (Open-Meteo)</span>
                    <span style={{ color: '#D97706' }}>{gridData.times[hourIndex] ?? '—'} COT</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, gridData.times.length - 1)}
                    value={hourIndex}
                    onChange={e => { setIsPlaying(false); setHourIndex(Number(e.target.value)); }}
                    style={{ width: '100%', accentColor: '#F59E0B', cursor: 'pointer', margin: 0 }}
                  />
                </div>

                {/* Escala de colores W/m² */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9.5, color: BRAND.muted, fontWeight: 600, borderLeft: `1px solid ${BRAND.border}`, paddingLeft: 10 }}>
                  {[
                    { c: '#64748B', l: '<150' },
                    { c: '#38BDF8', l: '350' },
                    { c: '#FACC15', l: '550' },
                    { c: '#F97316', l: '750' },
                    { c: '#EF4444', l: '750+' },
                  ].map(s => (
                    <div key={s.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ width: 12, height: 5, borderRadius: 2, background: s.c }} />
                      <span>{s.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <MapContainer center={[3.6, -76.35]} zoom={11} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                key={baseLayer}
                attribution={BASE_LAYERS[baseLayer].attribution}
                url={BASE_LAYERS[baseLayer].url}
              />
              {showIrradiance && gridData?.points?.map((pt, idx) => {
                const rad = pt.radiation[hourIndex] ?? 0;
                const cld = pt.cloud[hourIndex] ?? 0;
                const fill = irradianceColor(rad);
                return (
                  <Circle
                    key={`grid-${idx}`}
                    center={[pt.lat, pt.lon]}
                    radius={15000}
                    pathOptions={{
                      color: fill,
                      stroke: false,
                      fillColor: fill,
                      fillOpacity: rad > 20 ? 0.28 : 0.14,
                    }}
                  >
                    <LeafletTooltip direction="top" opacity={0.95}>
                      <div style={{ fontSize: 11, fontFamily: 'Inter, sans-serif' }}>
                        <strong>{rad} W/m²</strong> · ☁️ {cld}% ({gridData.times[hourIndex]})
                      </div>
                    </LeafletTooltip>
                  </Circle>
                );
              })}
              <MapController plants={filteredPlants} selectedPlant={selectedPlant} fitTrigger={fitTrigger} />
              {filteredPlants.map(plant => {
                const dim = kpiMap[plant.plantCode] ?? {};
                const health = dim.real_health_state ?? 0;
                const color = healthColors[health] ?? BRAND.muted;
                const yf = plant.capacity > 0 && dim.day_power != null ? dim.day_power / plant.capacity : null;
                const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${plant.latitude},${plant.longitude}`;

                return (
                  <Marker
                    key={plant.plantCode}
                    position={[parseFloat(plant.latitude!), parseFloat(plant.longitude!)]}
                    icon={createSolgerMarker(color, selectedCode === plant.plantCode)}
                    ref={el => { markerRefs.current[plant.plantCode] = el; }}
                    eventHandlers={{
                      click: () => setSelectedCode(plant.plantCode),
                    }}
                  >
                    <Popup>
                      <div style={{ minWidth: 215, fontFamily: 'Inter, sans-serif' }}>
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
                              {yf != null ? ` (${yf.toFixed(2)} Yf)` : ''}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: BRAND.muted }}>Mes</span>
                            <span style={{ color: '#0F766E', fontWeight: 650 }}>{dim.month_power != null ? fmtEnergy(dim.month_power) : '—'}</span>
                          </div>
                          {(plant.satelliteGhi_kWh_m2 != null || plant.cloudCover_pct != null) && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: `1px dashed ${BRAND.border}` }}>
                              <span style={{ color: BRAND.muted }}>Clima sitio</span>
                              <span style={{ color: BRAND.text, fontWeight: 650 }}>
                                ☁️ {plant.cloudCover_pct != null ? `${Math.round(plant.cloudCover_pct)}%` : '—'} · {plant.satelliteGhi_kWh_m2?.toFixed(2) ?? '—'} HSP
                              </span>
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
                          <a
                            href={gmapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 4,
                              fontSize: 11,
                              color: '#1D4ED8',
                              fontWeight: 700,
                              textDecoration: 'none',
                              background: 'rgba(37,99,235,0.08)',
                              padding: '5px 6px',
                              borderRadius: 5,
                              border: '1px solid rgba(37,99,235,0.18)',
                            }}
                          >
                            <Navigation size={11} /> Google Maps
                          </a>
                          <Link
                            to={`/plantas/${plantSlug(plant.plantCode)}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                              color: BRAND.greenD,
                              fontWeight: 700,
                              textDecoration: 'none',
                              background: 'rgba(88,174,50,0.08)',
                              padding: '5px 6px',
                              borderRadius: 5,
                              border: '1px solid rgba(88,174,50,0.20)',
                            }}
                          >
                            Ver detalle →
                          </Link>
                        </div>
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
