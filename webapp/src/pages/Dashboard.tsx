import { useMemo, useState } from 'react';
import { Zap, Sun, Leaf, TrendingUp, Activity, Building2, Search, Filter } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';
import { Link } from 'react-router-dom';

import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { fmtEnergy, fmt, plantSlug, BRAND, healthInfo } from '../lib/utils';
import { KpiCard } from '../components/ui/KpiCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ErrorState, SkeletonCard } from '../components/ui/States';
import { Header } from '../components/layout/Header';

const POLL = 5 * 60 * 1000;

const PIE_COLORS = ['#58AE32','#24A5AE','#F5B914','#3D8A1F','#1A8A92','#D4A10A','#7AC94E','#5BC2CB','#8BC34A','#2196F3'];

/* ── Custom Tooltip ────────────────────────────────────────────── */
function BarTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { fullName: string; energy: number; health: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const hi = healthInfo(d.health);
  return (
    <div style={{
      background: '#fff',
      border: '1px solid rgba(15,23,42,0.09)',
      borderRadius: 10,
      padding: '8px 12px',
      boxShadow: '0 6px 16px rgba(15,23,42,0.08)',
      minWidth: 160,
    }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: '#172033', marginBottom: 4 }}>{d.fullName}</p>
      <p style={{ fontSize: 18, fontWeight: 800, color: '#172033', letterSpacing: '-0.03em', fontFamily: 'Inter, sans-serif' }}>
        {fmt(d.energy, 1)} <span style={{ fontSize: 11, fontWeight: 500, color: '#64748B' }}>kWh</span>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: hi.color, display: 'inline-block' }} />
        <span style={{ fontSize: 10.5, color: '#64748B' }}>{hi.label}</span>
      </div>
    </div>
  );
}

const STATUS_OPTS = [
  { value: 'all',  label: 'Todos'     },
  { value: '3',    label: 'Operativa' },
  { value: '2',    label: 'En alarma' },
  { value: '1',    label: 'Offline'   },
  { value: '0',    label: 'Sin datos' },
];

export default function Dashboard() {
  const { data, loading, error, refresh } = useFetch(api.getSummary, [], { refreshInterval: POLL });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const barData = useMemo(() => {
    if (!data) return [];
    return data.plants.map(p => {
      const kpi = data.kpis.find(k => k.plantCode === p.plantCode || k.stationCode === p.plantCode);
      return {
        name: p.plantName.replace(/^HDA\s+|^HACIENDA\s+/i, '').slice(0, 10),
        fullName: p.plantName,
        energy: +(kpi?.dataItemMap?.day_power ?? 0).toFixed(1),
        health: kpi?.dataItemMap?.real_health_state ?? 0,
      };
    }).sort((a, b) => b.energy - a.energy);
  }, [data]);

  const pieData = useMemo(() => {
    if (!data) return [];
    return data.plants.filter(p => p.capacity > 0).map(p => ({
      name: p.plantName.replace(/^HDA\s+|^HACIENDA\s+/i, '').slice(0, 16),
      value: p.capacity,
    }));
  }, [data]);

  const filteredPlants = useMemo(() => {
    if (!data) return [];
    return data.plants.filter(p => {
      const kpi = data.kpis.find(k => k.plantCode === p.plantCode || k.stationCode === p.plantCode);
      const health = kpi?.dataItemMap?.real_health_state;

      const matchSearch = !search || p.plantName.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || String(health ?? 0) === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [data, search, statusFilter]);

  const s = data?.summary;
  const sCard = { background: BRAND.card, border: `1px solid ${BRAND.border}`, borderRadius: 12, boxShadow: '0 1px 3px rgba(15,23,42,0.04)' };

  return (
    <div>
      <Header lastUpdated={data?.lastUpdated} onRefresh={refresh} loading={loading} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── KPI Row ──────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {loading && !data
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : <>
              <KpiCard
                title="Capacidad Total"
                value={fmt(s?.totalCapacity_kWp ?? 0, 0)}
                unit="kWp"
                subtitle={`${s?.totalPlants ?? '—'} plantas instaladas`}
                icon={<Zap size={18} />}
                accent="solar"
                loading={loading && !s}
              />
              <KpiCard
                title="Energía Hoy"
                value={fmtEnergy(s?.totalEnergyToday_kWh)}
                subtitle="Generación del portafolio"
                icon={<Sun size={18} />}
                accent="solar"
                loading={loading && !s}
              />
              <KpiCard
                title="Energía del Mes"
                value={fmtEnergy(s?.totalEnergyMonth_kWh)}
                subtitle="Acumulado mensual"
                icon={<Activity size={18} />}
                accent="teal"
                loading={loading && !s}
              />
              <KpiCard
                title="Energía Total"
                value={fmtEnergy(s?.totalEnergyTotal_kWh)}
                subtitle="Histórico acumulado"
                icon={<TrendingUp size={18} />}
                accent="teal"
                loading={loading && !s}
              />
              <KpiCard
                title="CO₂ Evitado"
                value={fmt(s?.co2Avoided_ton ?? 0, 1)}
                unit="ton"
                subtitle="Factor UPME Colombia"
                icon={<Leaf size={18} />}
                accent="green"
                loading={loading && !s}
              />
              <KpiCard
                title="Plantas Activas"
                value={`${s?.activePlants ?? '—'}`}
                unit={`/ ${s?.totalPlants ?? '—'}`}
                subtitle="Estado en tiempo real"
                icon={<Building2 size={18} />}
                accent={s && s.activePlants < s.totalPlants ? 'red' : 'green'}
                loading={loading && !s}
              />
            </>
          }
        </div>

        {error && <ErrorState message={error} onRetry={refresh} />}

        {/* ── Charts ───────────────────────────────────────────── */}
        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16 }}>

            {/* Bar chart */}
            <div style={{ ...sCard, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BRAND.border}` }}>
                <p className="section-title" style={{ fontSize: 13.5 }}>Energía Hoy por Planta</p>
              </div>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} barSize={14} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.05)" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: BRAND.muted, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: BRAND.muted, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        unit=" kWh"
                        width={56}
                      />
                      <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(15,23,42,0.02)', radius: 4 }} />
                      <Bar dataKey="energy" radius={[4, 4, 0, 0]}>
                        {barData.map((e, i) => (
                          <Cell key={i} fill={
                            e.health === 3 ? BRAND.green :
                            e.health === 2 ? BRAND.gold : BRAND.dim
                          } />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 12, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BRAND.border}` }}>
                  {[{ c: BRAND.green, l: 'Operativa' }, { c: BRAND.gold, l: 'En alarma' }, { c: BRAND.dim, l: 'Offline / Sin datos' }].map(({ c, l }) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: BRAND.muted }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Pie chart */}
            <div style={{ ...sCard, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BRAND.border}` }}>
                <p className="section-title" style={{ fontSize: 13.5 }}>Capacidad Instalada</p>
              </div>
              <div style={{ padding: '12px' }}>
                <div style={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        cx="50%"
                        cy="40%"
                        outerRadius={75}
                        innerRadius={45}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: '#fff',
                          border: '1px solid rgba(15,23,42,0.09)',
                          borderRadius: 8,
                          fontSize: 11,
                          boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
                        }}
                        formatter={(v) => [`${v} kWp`, 'Capacidad']}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={6}
                        formatter={(v) => <span style={{ color: BRAND.muted, fontSize: 10.5 }}>{v}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Portafolio table ──────────────────────────────────── */}
        {data && (
          <div style={{ ...sCard, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: `1px solid ${BRAND.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <div>
                <p className="section-title" style={{ fontSize: 14 }}>Portafolio de Plantas</p>
                <p style={{ fontSize: 12, color: BRAND.muted, marginTop: 1 }}>
                  {data.plants.length} plantas · Datos en tiempo real
                </p>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Search */}
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
                      paddingTop: 4,
                      paddingBottom: 4,
                      borderRadius: 6,
                      border: `1px solid ${BRAND.border}`,
                      background: 'white',
                      fontSize: 12.5,
                      color: BRAND.text,
                      outline: 'none',
                      width: 170,
                    }}
                  />
                </div>

                {/* Status filter */}
                <div style={{ position: 'relative' }}>
                  <Filter size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: BRAND.muted, pointerEvents: 'none' }} />
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    style={{
                      paddingLeft: 24,
                      paddingRight: 10,
                      paddingTop: 4,
                      paddingBottom: 4,
                      borderRadius: 6,
                      border: `1px solid ${BRAND.border}`,
                      background: 'white',
                      fontSize: 12.5,
                      color: BRAND.text,
                      outline: 'none',
                      cursor: 'pointer',
                      appearance: 'none',
                    }}
                  >
                    {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                <Link
                  to="/plantas"
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: `1px solid rgba(88,174,50,0.25)`,
                    background: 'rgba(88,174,50,0.06)',
                    color: BRAND.greenD,
                    fontSize: 12.5,
                    fontWeight: 600,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Ver todas →
                </Link>
              </div>
            </div>

            {/* Compact Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                    {['Planta', 'Capacidad', 'Hoy', 'Mes', 'Estado', ''].map((h, i) => (
                      <th
                        key={h + i}
                        style={{
                          padding: '8px 14px',
                          textAlign: h === '' || h === 'Estado' ? 'center' : i === 0 ? 'left' : 'right',
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: BRAND.muted,
                          background: BRAND.surface,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPlants.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '30px 14px', color: BRAND.muted, fontSize: 12.5 }}>
                        No hay plantas que coincidan con los filtros
                      </td>
                    </tr>
                  ) : filteredPlants.map(plant => {
                    const kpi = data.kpis.find(k => k.plantCode === plant.plantCode || k.stationCode === plant.plantCode);
                    const dim = kpi?.dataItemMap ?? {};
                    return (
                      <tr
                        key={plant.plantCode}
                        style={{ borderBottom: `1px solid ${BRAND.border}` }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = BRAND.surface}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      >
                        <td style={{ padding: '8px 14px' }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: BRAND.text }}>{plant.plantName}</div>
                          <div style={{ fontSize: 10.5, color: BRAND.dim, marginTop: 1, fontFamily: 'monospace' }}>{plant.plantCode}</div>
                        </td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12.5, color: BRAND.muted, fontWeight: 500 }}>
                          {plant.capacity > 0 ? `${plant.capacity} kWp` : '—'}
                        </td>
                        <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#B45309', letterSpacing: '-0.02em' }}>
                            {dim.day_power != null ? `${fmt(dim.day_power)} kWh` : '—'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontSize: 12.5, color: BRAND.muted, fontWeight: 500 }}>
                          {dim.month_power != null ? fmtEnergy(dim.month_power) : '—'}
                        </td>
                        <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                          <StatusBadge state={dim.real_health_state} size="sm" />
                        </td>
                        <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                          <Link
                            to={`/plantas/${plantSlug(plant.plantCode)}`}
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: BRAND.green,
                              textDecoration: 'none',
                              padding: '3px 8px',
                              borderRadius: 5,
                              border: `1px solid rgba(88,174,50,0.18)`,
                              background: 'rgba(88,174,50,0.05)',
                              display: 'inline-block',
                            }}
                          >
                            Ver
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
