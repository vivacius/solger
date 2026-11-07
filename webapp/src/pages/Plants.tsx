import { Link } from 'react-router-dom';
import { MapPin, Zap, Calendar, Search } from 'lucide-react';
import { useState, useMemo } from 'react';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ErrorState, LoadingSpinner } from '../components/ui/States';
import { Header } from '../components/layout/Header';
import { fmtEnergy, fmt, fmtDate, extractRegion, plantSlug, BRAND } from '../lib/utils';
import type { Plant } from '../types/api';

const POLL = 5 * 60 * 1000;

const HEALTH_BAR: Record<number, string> = {
  3: `linear-gradient(90deg, ${BRAND.green}, #24A5AE)`,
  2: `linear-gradient(90deg, ${BRAND.gold}, #F97316)`,
  1: `linear-gradient(90deg, #EF4444, #F97316)`,
};

function PlantCard({ plant, kpi }: { plant: Plant; kpi?: Record<string, number> }) {
  const dim = kpi ?? {};
  const health = dim.real_health_state;
  const dayPower = dim.day_power;
  const monthPower = dim.month_power;
  const capacity = plant.capacity;
  const specificYield = capacity > 0 && dayPower != null ? dayPower / capacity : null;

  return (
    <Link
      to={`/plantas/${plantSlug(plant.plantCode)}`}
      style={{
        display: 'block',
        background: BRAND.card,
        border: `1px solid ${BRAND.border}`,
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        overflow: 'hidden',
        textDecoration: 'none',
        transition: 'box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '0 6px 16px rgba(15,23,42,0.06)';
        el.style.transform = 'translateY(-2px)';
        el.style.borderColor = 'rgba(88,174,50,0.30)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)';
        el.style.transform = 'translateY(0)';
        el.style.borderColor = BRAND.border;
      }}
    >
      {/* Health color bar */}
      <div style={{ height: 2.5, background: HEALTH_BAR[health ?? 0] ?? BRAND.surface }} />

      <div style={{ padding: '14px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{
              fontSize: 13,
              fontWeight: 700,
              color: BRAND.text,
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {plant.plantName}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
              <MapPin size={10.5} color={BRAND.muted} />
              <span style={{ fontSize: 11.5, color: BRAND.muted }}>{extractRegion(plant.plantAddress)}</span>
            </div>
          </div>
          <StatusBadge state={health} size="sm" />
        </div>

        {/* Metrics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{
            background: 'rgba(245,185,20,0.06)',
            border: '1px solid rgba(245,185,20,0.14)',
            borderRadius: 8,
            padding: '8px 10px',
          }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: '#B45309', textTransform: 'uppercase', marginBottom: 2 }}>
              Hoy
            </p>
            <p style={{ fontSize: 17, fontWeight: 800, color: '#92400E', letterSpacing: '-0.02em', lineHeight: 1 }}>
              {dayPower != null ? fmt(dayPower, 1) : '—'}
              <span style={{ fontSize: 10, fontWeight: 600, color: '#B45309', marginLeft: 2 }}>kWh</span>
            </p>
            {specificYield != null && (
              <p style={{ fontSize: 10, color: '#D97706', marginTop: 3 }}>
                {fmt(specificYield, 2)} kWh/kWp
              </p>
            )}
          </div>

          <div style={{
            background: 'rgba(36,165,174,0.06)',
            border: '1px solid rgba(36,165,174,0.14)',
            borderRadius: 8,
            padding: '8px 10px',
          }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: '#0E7490', textTransform: 'uppercase', marginBottom: 2 }}>
              Mes
            </p>
            <p style={{ fontSize: 17, fontWeight: 800, color: '#155E75', letterSpacing: '-0.02em', lineHeight: 1 }}>
              {monthPower != null ? fmtEnergy(monthPower) : '—'}
            </p>
            <p style={{ fontSize: 10, color: '#0E7490', marginTop: 3 }}>acumulado</p>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 10,
          borderTop: `1px solid ${BRAND.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: BRAND.muted }}>
            <Zap size={10.5} color={BRAND.dim} />
            {capacity > 0 ? `${capacity} kWp` : 'Sin capacidad'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: BRAND.muted }}>
            <Calendar size={10.5} color={BRAND.dim} />
            {fmtDate(plant.gridConnectionDate).split(' de ').slice(1).join(' de ')}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Plants() {
  const { data, loading, error, refresh } = useFetch(api.getSummary, [], { refreshInterval: POLL });
  const [search, setSearch] = useState('');

  const kpiMap = Object.fromEntries(
    (data?.kpis ?? []).map(k => [
      k.plantCode ?? k.stationCode ?? '',
      k.dataItemMap as Record<string, number>,
    ])
  );

  const filteredPlants = useMemo(() => {
    if (!data) return [];
    return data.plants.filter(p =>
      p.plantName.toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  const totalHoy = data
    ? data.kpis.reduce((sum, k) => sum + (k.dataItemMap?.day_power ?? 0), 0)
    : 0;

  return (
    <div>
      <Header lastUpdated={data?.lastUpdated} onRefresh={refresh} loading={loading} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Summary strip + Search Input */}
        {data && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            paddingBottom: 14,
            borderBottom: `1px solid ${BRAND.border}`,
          }}>
            {/* Stats row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
              {[
                { label: 'Total plantas',   value: String(data.plants.length),             valueColor: BRAND.text },
                { label: 'Operativas',      value: String(data.summary.activePlants),       valueColor: BRAND.green },
                { label: 'Capacidad',       value: `${fmt(data.summary.totalCapacity_kWp, 0)} kWp`, valueColor: BRAND.text },
                { label: 'Generación hoy',  value: fmtEnergy(totalHoy),                    valueColor: '#B45309' },
              ].map(({ label, value, valueColor }) => (
                <div key={label}>
                  <p style={{ fontSize: 10, color: BRAND.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</p>
                  <p style={{ fontSize: 18, fontWeight: 800, color: valueColor, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Search filter on right */}
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: BRAND.muted }} />
              <input
                type="text"
                placeholder="Buscar planta..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  paddingLeft: 24,
                  paddingRight: 8,
                  paddingTop: 5,
                  paddingBottom: 5,
                  borderRadius: 6,
                  border: `1px solid ${BRAND.border}`,
                  background: 'white',
                  fontSize: 12.5,
                  color: BRAND.text,
                  outline: 'none',
                  width: 200,
                }}
              />
            </div>
          </div>
        )}

        {loading && !data && <LoadingSpinner text="Cargando plantas..." />}
        {error && <ErrorState message={error} onRetry={refresh} />}

        {data && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 12,
          }}>
            {filteredPlants.map(plant => (
              <PlantCard key={plant.plantCode} plant={plant} kpi={kpiMap[plant.plantCode]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
