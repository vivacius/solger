import { useMemo, useState } from 'react';
import { Zap, Sun, Leaf, TrendingUp, Activity, Building2, Search, Filter } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList, LineChart, Line, ReferenceLine
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

type RangeStatus = 'optimal' | 'warning' | 'critical' | 'nodata';

const RANGE_META: Record<RangeStatus, { color: string; label: string; bg: string }> = {
  optimal: { color: '#58AE32', label: 'En rango (≥85%)', bg: 'rgba(88,174,50,0.10)' },
  warning: { color: '#F59E0B', label: 'Bajo rango (65–85%)', bg: 'rgba(245,158,11,0.12)' },
  critical: { color: '#EF4444', label: 'Fuera de rango (<65%)', bg: 'rgba(239,68,68,0.10)' },
  nodata: { color: '#94A3B8', label: 'Sin datos / Nocturno', bg: 'rgba(148,163,184,0.12)' },
};

interface BarItem {
  plantCode: string;
  name: string;
  fullName: string;
  energy: number;
  capacity: number;
  yf: number | null;
  pctOfExpected: number | null;
  health: number;
  rangeStatus: RangeStatus;
  kwhLost: number;
  copLost: number;
}

/* ── Custom Tooltip ────────────────────────────────────────────── */
function BarTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BarItem }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const hi = healthInfo(d.health);
  const rm = RANGE_META[d.rangeStatus];
  const diffPct = d.pctOfExpected != null ? Math.round(d.pctOfExpected - 100) : null;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid rgba(15,23,42,0.09)',
      borderRadius: 10,
      padding: '10px 13px',
      boxShadow: '0 6px 18px rgba(15,23,42,0.10)',
      minWidth: 195,
    }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: '#172033', marginBottom: 4 }}>{d.fullName}</p>
      <p style={{ fontSize: 18, fontWeight: 800, color: '#172033', letterSpacing: '-0.03em', fontFamily: 'Inter, sans-serif', margin: 0 }}>
        {fmt(d.energy, 1)} <span style={{ fontSize: 11, fontWeight: 500, color: '#64748B' }}>kWh</span>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(15,23,42,0.06)' }}>
        {d.yf != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#475569' }}>
            <span>Rendimiento (Yf):</span>
            <strong style={{ color: '#0F172A' }}>{d.yf.toFixed(2)} kWh/kWp</strong>
          </div>
        )}
        {diffPct != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#475569' }}>
            <span>Vs. rango horario:</span>
            <strong style={{ color: rm.color }}>{diffPct >= 0 ? `+${diffPct}%` : `${diffPct}%`}</strong>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#64748B' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: hi.color, display: 'inline-block' }} />
            {hi.label}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: rm.bg, color: rm.color }}>
            {rm.label.split(' ')[0]} {rm.label.split(' ')[1]}
          </span>
        </div>
      </div>
    </div>
  );
}

const STATUS_OPTS = [
  { value: 'all', label: 'Todos' },
  { value: '3', label: 'Operativa' },
  { value: '2', label: 'En alarma' },
  { value: '1', label: 'Offline' },
  { value: '0', label: 'Sin datos' },
];

export default function Dashboard() {
  const { data, loading, error, refresh } = useFetch(api.getSummary, [], { refreshInterval: POLL });
  const { data: anomaliesData } = useFetch(api.getAnomalies, [], { refreshInterval: POLL });
  const { data: dailyData } = useFetch(() => api.getPortfolioDaily(30), [], { refreshInterval: POLL });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const barData: BarItem[] = useMemo(() => {
    if (!data) return [];

    const anomMap = new Map(
      (anomaliesData?.evaluations ?? []).map(ev => [ev.plant_code, ev])
    );

    // 1. Calcular Yf (kWh / kWp) de plantas operativas con capacidad > 0 para obtener la mediana horaria del portafolio
    const rawItems = data.plants.map(p => {
      const kpi = data.kpis.find(k => k.plantCode === p.plantCode || k.stationCode === p.plantCode);
      const energy = +(kpi?.dataItemMap?.day_power ?? 0).toFixed(1);
      const health = kpi?.dataItemMap?.real_health_state ?? 0;
      const capacity = p.capacity ?? 0;
      const yf = capacity > 0 ? +(energy / capacity).toFixed(3) : null;
      return { plant: p, energy, health, capacity, yf, anom: anomMap.get(p.plantCode) };
    });

    const activeYfs = rawItems
      .filter(i => i.health === 3 && i.yf != null && i.energy > 0.5)
      .map(i => i.yf as number)
      .sort((a, b) => a - b);

    const medianYf = activeYfs.length > 0
      ? activeYfs[Math.floor(activeYfs.length / 2)]
      : 0;

    // 2. Clasificar cada planta según su posición frente al rango esperado a la hora actual
    return rawItems.map(({ plant, energy, health, capacity, yf, anom }): BarItem => {
      let pctOfExpected: number | null = null;
      if (anom?.ratio_pares != null && anom.ratio_pares > 0) {
        pctOfExpected = +(anom.ratio_pares * 100).toFixed(1);
      } else if (yf != null && medianYf > 0.05) {
        pctOfExpected = +((yf / medianYf) * 100).toFixed(1);
      }

      let rangeStatus: RangeStatus = 'nodata';
      if (health === 1) {
        rangeStatus = 'critical';
      } else if (medianYf <= 0.05 && energy === 0) {
        rangeStatus = 'nodata';
      } else if (pctOfExpected != null) {
        if (pctOfExpected >= 85 && health === 3) rangeStatus = 'optimal';
        else if (pctOfExpected >= 65) rangeStatus = 'warning';
        else rangeStatus = 'critical';
      } else if (health === 3 && energy > 0) {
        rangeStatus = 'optimal';
      } else if (health === 2) {
        rangeStatus = 'warning';
      }

      return {
        plantCode: plant.plantCode,
        name: plant.plantName
          .replace(/^HDA\s+|^HACIENDA\s+/i, '')
          .replace(/\s*POZO\s*/i, ' P')
          .slice(0, 12),
        fullName: plant.plantName,
        energy,
        capacity,
        yf,
        pctOfExpected,
        health,
        rangeStatus,
        kwhLost: anom?.kwh_perdidos ?? 0,
        copLost: anom?.cop_perdidos ?? 0,
      };
    }).sort((a, b) => b.energy - a.energy);
  }, [data, anomaliesData]);

  // Serie diaria del portafolio (últimos 30 días)
  const { dailySeries, dailyAvg } = useMemo(() => {
    const raw = dailyData?.series ?? [];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const formatted = raw.map(item => {
      const parts = item.date.split('-');
      const mIdx = parseInt(parts[1] || '1', 10) - 1;
      const day = parts[2] || '';
      return {
        ...item,
        label: `${day} ${months[mIdx] ?? ''}`.trim(),
      };
    });
    const avg = formatted.length > 0
      ? formatted.reduce((s, r) => s + r.gen_kwh, 0) / formatted.length
      : 0;
    return { dailySeries: formatted, dailyAvg: avg };
  }, [dailyData]);

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

        {/* ── Charts & Business Intelligence ───────────────────── */}
        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.65fr 1fr', gap: 16 }}>

            {/* Bar chart con Etiquetas y Coloración por Rango Histórico / Esperado */}
            <div style={{ ...sCard, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: `1px solid ${BRAND.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}>
                <div>
                  <p className="section-title" style={{ fontSize: 13.5, margin: 0 }}>Energía Hoy por Planta</p>
                  <p style={{ fontSize: 11, color: BRAND.muted, margin: '2px 0 0 0' }}>
                    Coloración según desempeño a la hora actual vs. rango histórico / pares
                  </p>
                </div>
              </div>
              <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ height: 255 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} barSize={18} margin={{ top: 20, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.05)" vertical={false} />
                      <XAxis
                        dataKey="plantCode"
                        tickFormatter={(code) => barData.find(b => b.plantCode === code)?.name ?? String(code)}
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
                      <Bar dataKey="energy" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {barData.map((e) => (
                          <Cell key={e.plantCode} fill={RANGE_META[e.rangeStatus].color} />
                        ))}
                        <LabelList
                          dataKey="energy"
                          position="top"
                          formatter={(v: any) => (Number(v) > 0 ? Math.round(Number(v)) : '')}
                          style={{ fill: '#334155', fontSize: 10, fontWeight: 700 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 14, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BRAND.border}`, flexWrap: 'wrap' }}>
                  {(['optimal', 'warning', 'critical', 'nodata'] as RangeStatus[]).map(st => (
                    <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: RANGE_META[st].color, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: BRAND.muted, fontWeight: 500 }}>{RANGE_META[st].label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Gráfico de Líneas: Sumatoria Diaria de Generación (Último Mes) */}
            <div style={{ ...sCard, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: `1px solid ${BRAND.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <div>
                  <p className="section-title" style={{ fontSize: 13.5, margin: 0 }}>Generación Diaria del Portafolio</p>
                  <p style={{ fontSize: 11, color: BRAND.muted, margin: '2px 0 0 0' }}>
                    Sumatoria por día — Últimos 30 días (kWh/día)
                  </p>
                </div>
                {dailyAvg > 0 && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>Promedio/día</div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: BRAND.teal }}>{fmt(dailyAvg, 0)} kWh</div>
                  </div>
                )}
              </div>

              <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ height: 255 }}>
                  {dailySeries.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.muted, fontSize: 12 }}>
                      Cargando histórico diario del portafolio…
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailySeries} margin={{ top: 14, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.05)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: BRAND.muted, fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          minTickGap={18}
                        />
                        <YAxis
                          tick={{ fill: BRAND.muted, fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={50}
                          tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#fff',
                            border: '1px solid rgba(15,23,42,0.09)',
                            borderRadius: 10,
                            fontSize: 11.5,
                            boxShadow: '0 6px 18px rgba(15,23,42,0.10)',
                          }}
                          formatter={(value: any, _name: any, props: any) => [
                            `${fmt(Number(value), 1)} kWh (${props?.payload?.plants_count ?? '—'} plantas)`,
                            'Generación total',
                          ]}
                          labelFormatter={(label: any, payload: any) => {
                            const fullDate = payload?.[0]?.payload?.date;
                            return fullDate ? `${label} (${fullDate})` : String(label);
                          }}
                        />
                        {dailyAvg > 0 && (
                          <ReferenceLine
                            y={dailyAvg}
                            stroke="#F59E0B"
                            strokeDasharray="5 5"
                            strokeWidth={1.6}
                            label={{
                              value: `Prom: ${fmt(dailyAvg, 0)}`,
                              position: 'insideTopRight',
                              fill: '#B45309',
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey="gen_kwh"
                          stroke={BRAND.teal}
                          strokeWidth={2.4}
                          dot={{ r: 2.5, fill: BRAND.teal, strokeWidth: 0 }}
                          activeDot={{ r: 5, fill: BRAND.green, stroke: '#fff', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BRAND.border}`, fontSize: 11, color: BRAND.muted, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 12, height: 2.5, background: BRAND.teal, display: 'inline-block', borderRadius: 2 }} />
                      Generación/día
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 14, borderTop: '2px dashed #F59E0B', display: 'inline-block' }} />
                      Promedio ({fmt(dailyAvg, 0)} kWh)
                    </span>
                  </div>
                  <span>{dailySeries.length} días registrados</span>
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
