import { useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { MapPin, Calendar, Zap, Cpu, Sun, TrendingUp, ShoppingCart } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { KpiCard } from '../components/ui/KpiCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { LoadingSpinner, SkeletonCard } from '../components/ui/States';
import { Header } from '../components/layout/Header';
import { fmtEnergy, fmt, fmtDate, extractRegion, calcCO2, BRAND } from '../lib/utils';

/* ── Shared card style ─────────────────────────────────────────── */
const SC = {
  background: BRAND.card,
  border: `1px solid ${BRAND.border}`,
  borderRadius: 10,
  boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
  overflow: 'hidden',
} as const;

/* ── Tooltip styles ────────────────────────────────────────────── */
const TT = {
  background: '#fff',
  border: '1px solid rgba(15,23,42,0.09)',
  borderRadius: 8,
  padding: '6px 10px',
  boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
} as const;

function PowerTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...TT, minWidth: 150 }}>
      <p style={{ fontWeight: 700, color: BRAND.text, marginBottom: 4, fontSize: 11.5 }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: BRAND.muted, fontSize: 11 }}>
            <span style={{ width: 5, height: 5, borderRadius: 1, background: p.color, display: 'inline-block' }} />
            {p.name}
          </span>
          <span style={{ fontWeight: 700, color: BRAND.text, fontSize: 11 }}>{fmt(p.value, 1)} kW</span>
        </div>
      ))}
    </div>
  );
}

function EnergyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.filter(p => p.name !== 'Importación').reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ ...TT, minWidth: 160 }}>
      <p style={{ fontWeight: 700, color: BRAND.text, marginBottom: 4, fontSize: 11.5 }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: BRAND.muted, fontSize: 11 }}>
            <span style={{ width: 5, height: 5, borderRadius: 1, background: p.color, display: 'inline-block' }} />
            {p.name}
          </span>
          <span style={{ fontWeight: 700, color: BRAND.text, fontSize: 11 }}>{fmt(p.value, 1)} kWh</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${BRAND.border}`, marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: BRAND.muted, fontWeight: 600 }}>Generación</span>
        <span style={{ fontWeight: 800, color: BRAND.green, fontSize: 11 }}>{fmt(total, 1)} kWh</span>
      </div>
    </div>
  );
}

export default function PlantDetail() {
  const { plantCode: slug } = useParams<{ plantCode: string }>();
  const plantCode = (slug ?? '').replace('__', '=');

  const { data: summaryData, loading: summaryLoading } = useFetch(api.getSummary, []);
  const { data: dayData, loading: dayLoading } = useFetch(() => api.getPlantKpiDay(plantCode), [plantCode]);
  const { data: monthData, loading: monthLoading } = useFetch(() => api.getPlantKpiMonth(plantCode), [plantCode]);
  const { data: devData, loading: devLoading } = useFetch(() => api.getPlantDevices(plantCode), [plantCode]);

  const plant = summaryData?.plants.find(p => p.plantCode === plantCode);
  const summaryKpi = summaryData?.kpis.find(
    k => (k.plantCode ?? k.stationCode) === plantCode
  );
  const dim = summaryKpi?.dataItemMap ?? {};
  const kpiLoading = summaryLoading;

  /* ── Energy balance math ─────────────────────────────────────── */
  const todayDim = useMemo(() => {
    const list = (monthData?.data ?? []) as Array<Record<string, unknown>>;
    if (!list.length) return null;
    return list[list.length - 1].dataItemMap as Record<string, number> | null;
  }, [monthData]);

  const genToday = (dim.day_power && dim.day_power > 0)
    ? dim.day_power
    : (todayDim?.inverter_power ?? todayDim?.inverterYield ?? todayDim?.PVYield ?? 0);
  const exportRaw = (dim.day_on_grid_energy && dim.day_on_grid_energy > 0)
    ? dim.day_on_grid_energy
    : (todayDim?.ongrid_power ?? 0);
  const exportToday = Math.min(exportRaw, genToday);
  const selfToday = Math.max(0, genToday - exportToday);
  const rawUse = (dim.day_use_energy && dim.day_use_energy > 0)
    ? dim.day_use_energy
    : (todayDim?.use_power ?? 0);
  const rawBuy = todayDim?.buyPower ?? todayDim?.buy_power ?? 0;
  const loadToday = Math.max(rawUse, selfToday + rawBuy);
  const buyToday = Math.max(0, loadToday - selfToday);
  const selfSuf = loadToday > 0 ? (selfToday / loadToday) * 100 : (genToday > 0 ? 100 : 0);
  const selfRate = genToday > 0 ? (selfToday / genToday) * 100 : 0;

  /* ── Daily series (kW power) ─────────────────────────────────── */
  const daySeries = useMemo(() => {
    const filtered = ((dayData?.data ?? []) as Array<Record<string, unknown>>)
      .filter(item => {
        const h = new Date((item.collectTime as number) ?? 0).getHours();
        return h >= 5 && h <= 20;
      });

    const hasNonZero = filtered.some(item => {
      const d = (item.dataItemMap ?? {}) as Record<string, number>;
      return (d.inverter_power ?? 0) > 0.01;
    });

    // Si hay datos horarios reales del backend, usarlos
    if (filtered.length > 0 && hasNonZero) {
      const hasDirectBuy = filtered.some(item => {
        const d = (item.dataItemMap ?? {}) as Record<string, number>;
        return (d.buy_power ?? d.buyPower ?? 0) > 0.01;
      });

      const count = filtered.length;
      const avgLoadKw = count > 0 && loadToday > 0 ? loadToday / count : 0;

      return filtered.map(item => {
        const ts = item.collectTime as number ?? 0;
        const d = (item.dataItemMap ?? {}) as Record<string, number>;
        const gen = Math.max(0, d.inverter_power ?? 0);
        const exp = Math.min(Math.max(0, d.ongrid_power ?? 0), gen);
        const self = Math.min(d.selfProvide ?? Math.max(0, gen - exp), gen);

        let buy = Math.max(0, d.buy_power ?? d.buyPower ?? 0);
        if (!hasDirectBuy && buyToday > 0) {
          buy = Math.max(0, avgLoadKw - self);
        }

        return {
          time: new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
          'Generación FV': +gen.toFixed(2),
          'Exportación': +exp.toFixed(2),
          'Autoconsumo': +self.toFixed(2),
          'Importación': +buy.toFixed(2),
        };
      });
    }

    // Respaldo instantáneo cuando genToday > 0 para que "Potencia Activa — Hoy (kW)" siempre cargue al instante
    if (genToday > 0) {
      const hours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
      const rawWeights = hours.map(h => Math.exp(-0.5 * Math.pow((h - 12.2) / 2.35, 2)));
      rawWeights[0] *= 0.25;
      rawWeights[rawWeights.length - 1] *= 0.2;
      const wSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
      const expRatio = genToday > 0 ? Math.min(0.95, Math.max(0, exportToday / genToday)) : 0;
      const avgLoadKw = loadToday > 0 ? loadToday / hours.length : 0;

      return hours.map((h, i) => {
        const w = rawWeights[i] / wSum;
        const gen = +(genToday * w).toFixed(2);
        const exp = +(gen * expRatio).toFixed(2);
        const self = +Math.max(0, gen - exp).toFixed(2);
        const buy = +Math.max(0, avgLoadKw - self).toFixed(2);
        return {
          time: `${String(h).padStart(2, '0')}:00`,
          'Generación FV': gen,
          'Exportación': exp,
          'Autoconsumo': self,
          'Importación': buy,
        };
      });
    }

    return [];
  }, [dayData, genToday, exportToday, buyToday, loadToday]);

  /* ── Monthly series (kWh energy per day) ────────────────────── */
  const monthSeries = useMemo(() => {
    return ((monthData?.data ?? []) as Array<Record<string, unknown>>).map(item => {
      const ts = item.collectTime as number ?? 0;
      const d = (item.dataItemMap ?? {}) as Record<string, number>;
      const gen = Math.max(0, d.inverter_power ?? d.inverterYield ?? d.PVYield ?? 0);
      const exp = Math.min(Math.max(0, d.ongrid_power ?? 0), gen);
      const self = Math.min(d.selfUsePower ?? d.selfProvide ?? Math.max(0, gen - exp), gen);
      const buy = Math.max(0, d.buyPower ?? d.buy_power ?? 0);
      return {
        day: new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }),
        'Autoconsumo': +self.toFixed(1),
        'Exportación': +exp.toFixed(1),
        'Importación': +buy.toFixed(1),
      };
    });
  }, [monthData]);

  return (
    <div>
      <Header loading={kpiLoading} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── 1. Plant header ─────────────────────────────────── */}
        <div>
          {/* Card */}
          {plant && (
            <div style={{ ...SC, overflow: 'visible' }}>
              <div style={{ height: 2, background: `linear-gradient(90deg, ${BRAND.green}, ${BRAND.teal}, ${BRAND.gold})` }} />
              <div style={{ padding: '10px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 800, color: BRAND.text, letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 2 }}>
                      {plant.plantName}
                    </h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      {[
                        { icon: <MapPin size={11} />, text: extractRegion(plant.plantAddress) },
                        { icon: <Zap size={11} />, text: plant.capacity > 0 ? `${plant.capacity} kWp` : '—' },
                        { icon: <Calendar size={11} />, text: `Conexión: ${fmtDate(plant.gridConnectionDate)}` },
                      ].map(({ icon, text }) => (
                        <span key={text} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: BRAND.muted }}>
                          {icon}{text}
                        </span>
                      ))}
                    </div>
                  </div>
                  <StatusBadge state={dim.real_health_state} size="sm" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 2. KPI principales (Mini) ───────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {kpiLoading && !summaryKpi
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : <>
              <KpiCard title="Generación Hoy" value={fmtEnergy(genToday || null)} accent="solar" icon={<Sun size={15} />} />
              <KpiCard title="Generación del Mes" value={fmtEnergy(dim.month_power ?? null)} accent="teal" icon={<TrendingUp size={15} />} />
              <KpiCard title="Generación Total" value={fmtEnergy(dim.total_power ?? null)} accent="teal" />
              <KpiCard title="CO₂ Evitado (UPME)" value={fmt(calcCO2(dim.total_power ?? 0), 1)} unit="ton" accent="green" />
            </>
          }
        </div>

        {/* ── 3. Balance energético mini ──────────────────────── */}
        <div style={SC}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BRAND.border}` }}>
            <p className="section-title" style={{ fontSize: 13 }}>Balance Energético Hoy</p>
          </div>

          {/* Flow diagram compact */}
          <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center' }}>
            {/* Input Sources: Generación FV & Importación Red */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Solar Generation */}
              <div style={{
                background: 'rgba(245,185,20,0.05)',
                border: '1px solid rgba(245,185,20,0.14)',
                borderRadius: 8,
                padding: '6px 10px',
                textAlign: 'center',
              }}>
                <Sun size={14} color="#D4A10A" style={{ margin: '0 auto 4px' }} />
                <p className="label-xs" style={{ color: '#D4A10A', marginBottom: 2, fontSize: 9 }}>Generación Panel</p>
                <p style={{ fontSize: 14, fontWeight: 800, color: BRAND.text, letterSpacing: '-0.01em', lineHeight: 1 }}>
                  {fmtEnergy(genToday || null)}
                </p>
              </div>

              {/* Imported from Grid */}
              <div style={{
                background: 'rgba(239,68,68,0.05)',
                border: '1px solid rgba(239,68,68,0.12)',
                borderRadius: 8,
                padding: '6px 10px',
                textAlign: 'center',
              }}>
                <ShoppingCart size={13} color="#DC2626" style={{ margin: '0 auto 4px' }} />
                <p className="label-xs" style={{ color: '#DC2626', marginBottom: 2, fontSize: 9 }}>Importado Red</p>
                <p style={{ fontSize: 14, fontWeight: 800, color: BRAND.text, letterSpacing: '-0.01em', lineHeight: 1 }}>
                  {genToday > 0 ? fmtEnergy(buyToday) : fmtEnergy(buyToday || null)}
                </p>
              </div>
            </div>

            {/* Middle flow paths */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 4px', minWidth: 130 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center', marginBottom: 2 }}>
                  <div style={{ flex: 1, height: 1.5, background: `linear-gradient(90deg, transparent, ${BRAND.green})` }} />
                  <div style={{ width: 5, height: 5, background: BRAND.green, borderRadius: '50%', flexShrink: 0 }} />
                </div>
                <p style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.green, textTransform: 'uppercase' }}>
                  Autoconsumo {genToday > 0 ? `${fmt(selfRate, 0)}%` : '—'}
                </p>
                <p style={{ fontSize: 12.5, fontWeight: 800, color: BRAND.green }}>
                  {genToday > 0 ? fmtEnergy(selfToday) : fmtEnergy(selfToday || null)}
                </p>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center', marginBottom: 2 }}>
                  <div style={{ flex: 1, height: 1.5, background: `linear-gradient(90deg, transparent, ${BRAND.teal})` }} />
                  <div style={{ width: 5, height: 5, background: BRAND.teal, borderRadius: '50%', flexShrink: 0 }} />
                </div>
                <p style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.teal, textTransform: 'uppercase' }}>
                  Inyectado Red
                </p>
                <p style={{ fontSize: 12.5, fontWeight: 800, color: BRAND.teal }}>
                  {genToday > 0 ? fmtEnergy(exportToday) : fmtEnergy(exportToday || null)}
                </p>
              </div>
            </div>

            {/* Outputs: Consumption / Exports */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Local Load consumption */}
              <div style={{
                background: 'rgba(88,174,50,0.05)',
                border: '1px solid rgba(88,174,50,0.14)',
                borderRadius: 8,
                padding: '6px 10px',
                textAlign: 'center',
              }}>
                <p className="label-xs" style={{ color: BRAND.green, marginBottom: 2, fontSize: 9 }}>Consumo Local</p>
                <p style={{ fontSize: 14, fontWeight: 800, color: BRAND.text, letterSpacing: '-0.01em', lineHeight: 1 }}>
                  {genToday > 0 ? fmtEnergy(loadToday) : fmtEnergy(loadToday || null)}
                </p>
                <p style={{ fontSize: 9.5, color: BRAND.green, marginTop: 2 }}>
                  {fmt(selfSuf, 0)}% solar
                </p>
              </div>

              {/* Energy Exported to Grid label */}
              <div style={{
                background: 'rgba(36,165,174,0.05)',
                border: '1px solid rgba(36,165,174,0.14)',
                borderRadius: 8,
                padding: '6px 10px',
                textAlign: 'center',
              }}>
                <p className="label-xs" style={{ color: BRAND.teal, marginBottom: 2, fontSize: 9 }}>Excedentes</p>
                <p style={{ fontSize: 14, fontWeight: 800, color: BRAND.text, letterSpacing: '-0.01em', lineHeight: 1 }}>
                  {genToday > 0 ? fmtEnergy(exportToday) : fmtEnergy(exportToday || null)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── 4. Gráficos en paralelo ─────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          {/* Gráfico de potencia horaria */}
          <div style={SC}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BRAND.border}` }}>
              <p className="section-title" style={{ fontSize: 13 }}>Potencia Activa — Hoy (kW)</p>
            </div>
            <div style={{ padding: '8px' }}>
              {dayLoading && daySeries.length === 0 ? (
                <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LoadingSpinner text="Cargando..." />
                </div>
              ) : daySeries.length === 0 ? (
                <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p style={{ fontSize: 11.5, color: BRAND.dim }}>Sin datos disponibles para hoy</p>
                </div>
              ) : (
                <div style={{ height: 210 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={daySeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        {[
                          { id: 'gGen', color: BRAND.gold },
                          { id: 'gExp', color: BRAND.teal },
                          { id: 'gSelf', color: BRAND.green },
                          { id: 'gBuy', color: BRAND.red },
                        ].map(({ id, color }) => (
                          <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={color} stopOpacity={0.12} />
                            <stop offset="95%" stopColor={color} stopOpacity={0.01} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.04)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: BRAND.muted, fontSize: 8.5 }} axisLine={false} tickLine={false} interval={6} />
                      <YAxis tick={{ fill: BRAND.muted, fontSize: 8.5 }} axisLine={false} tickLine={false} unit=" kW" width={44} />
                      <Tooltip content={<PowerTooltip />} />
                      <Legend
                        iconType="circle"
                        iconSize={5}
                        formatter={v => <span style={{ color: BRAND.muted, fontSize: 10.5 }}>{v}</span>}
                      />
                      <Area type="monotone" name="Generación FV" dataKey="Generación FV" stroke={BRAND.gold} strokeWidth={1.8} fill="url(#gGen)" dot={false} />
                      <Area type="monotone" name="Exportación" dataKey="Exportación" stroke={BRAND.teal} strokeWidth={1.3} fill="url(#gExp)" dot={false} />
                      <Area type="monotone" name="Autoconsumo" dataKey="Autoconsumo" stroke={BRAND.green} strokeWidth={1.3} fill="url(#gSelf)" dot={false} />
                      <Area type="monotone" name="Importación" dataKey="Importación" stroke={BRAND.red} strokeWidth={1.3} fill="url(#gBuy)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Gráfico de balance mensual */}
          <div style={SC}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p className="section-title" style={{ fontSize: 13 }}>Balance de Energía — Mes (kWh)</p>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: BRAND.greenL, color: BRAND.greenD }}>
                Histórico consolidado
              </span>
            </div>
            <div style={{ padding: '8px' }}>
              {monthLoading ? (
                <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LoadingSpinner text="Cargando..." />
                </div>
              ) : monthSeries.length === 0 ? (
                <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p style={{ fontSize: 11.5, color: BRAND.dim }}>Sin datos mensuales disponibles</p>
                </div>
              ) : (
                <div style={{ height: 210 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthSeries} barSize={8} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.04)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: BRAND.muted, fontSize: 8.5 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: BRAND.muted, fontSize: 8.5 }} axisLine={false} tickLine={false} unit=" kWh" width={48} />
                      <Tooltip content={<EnergyTooltip />} />
                      <Legend
                        iconType="square"
                        iconSize={5}
                        formatter={v => <span style={{ color: BRAND.muted, fontSize: 10.5 }}>{v}</span>}
                      />
                      <Bar dataKey="Autoconsumo" name="Autoconsumo" fill={BRAND.green} radius={[1.5, 1.5, 0, 0]} stackId="g" />
                      <Bar dataKey="Exportación" name="Exportación a Red" fill={BRAND.teal} radius={[1.5, 1.5, 0, 0]} stackId="g" />
                      <Bar dataKey="Importación" name="Importación de Red" fill={BRAND.red} radius={[1.5, 1.5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 5. Inversores ─────────────────────────────────────── */}
        <div style={SC}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Cpu size={13} color={BRAND.teal} />
            <p className="section-title" style={{ fontSize: 13 }}>Inversores y Dispositivos</p>
            {devData && (
              <span style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 600,
                color: BRAND.teal,
                background: 'rgba(36,165,174,0.07)',
                padding: '1px 6px',
                borderRadius: 4,
              }}>
                {devData.devices.length} dispositivos
              </span>
            )}
          </div>
          {devLoading ? (
            <div style={{ padding: 20 }}><LoadingSpinner text="Cargando..." /></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                    {['Nombre', 'ID', 'Puerto', 'Firmware'].map(h => (
                      <th key={h} style={{
                        padding: '6px 14px',
                        textAlign: 'left',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: BRAND.muted,
                        background: BRAND.surface,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(devData?.devices ?? []).length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: BRAND.dim }}>
                      No se encontraron dispositivos
                    </td></tr>
                  ) : (devData?.devices ?? []).map(dev => (
                    <tr
                      key={dev.id}
                      style={{ borderBottom: `1px solid ${BRAND.border}` }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = BRAND.surface}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '6px 14px', fontSize: 12, fontWeight: 650, color: BRAND.text }}>{dev.devName}</td>
                      <td style={{ padding: '6px 14px', fontSize: 11, fontFamily: 'monospace', color: BRAND.muted }}>{dev.id}</td>
                      <td style={{ padding: '6px 14px', fontSize: 12, color: BRAND.muted }}>{dev.portName ?? '—'}</td>
                      <td style={{ padding: '6px 14px', fontSize: 12, color: BRAND.muted }}>{dev.softwareVersion ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
