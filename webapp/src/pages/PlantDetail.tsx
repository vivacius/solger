import { useParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
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
  const { data: stringsData, loading: stringsLoading } = useFetch(() => api.getPlantStrings(plantCode), [plantCode]);
  const [selectedInverterId, setSelectedInverterId] = useState<string | null>(null);

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
  const exc1Today = Math.min(exportToday, buyToday);
  const exc2Today = Math.max(0, exportToday - buyToday);
  const netBuyToday = Math.max(0, buyToday - exc1Today);
  const selfSuf = loadToday > 0 ? (selfToday / loadToday) * 100 : (genToday > 0 ? 100 : 0);
  const selfRate = genToday > 0 ? (selfToday / genToday) * 100 : 0;

  /* ── Daily series (kW power) — Eje X fijo 05:00 a 19:00 ──────── */
  const daySeries = useMemo(() => {
    const HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const filtered = ((dayData?.data ?? []) as Array<Record<string, unknown>>)
      .filter(item => {
        const h = new Date((item.collectTime as number) ?? 0).getHours();
        return h >= 5 && h <= 19;
      });

    const hasNonZero = filtered.some(item => {
      const d = (item.dataItemMap ?? {}) as Record<string, number>;
      return (d.inverter_power ?? 0) > 0.01;
    });

    // Si hay datos horarios reales del backend, mapearlos sobre la grilla fija 05:00–19:00
    if (filtered.length > 0 && hasNonZero) {
      const hasDirectBuy = filtered.some(item => {
        const d = (item.dataItemMap ?? {}) as Record<string, number>;
        return (d.buy_power ?? d.buyPower ?? 0) > 0.01;
      });

      const count = filtered.length;
      const avgLoadKw = count > 0 && loadToday > 0 ? loadToday / count : 0;
      const byHour = new Map<number, { gen: number; exp: number; self: number; buy: number }>();

      for (const item of filtered) {
        const ts = (item.collectTime as number) ?? 0;
        const h = new Date(ts).getHours();
        const d = (item.dataItemMap ?? {}) as Record<string, number>;
        const gen = Math.max(0, d.inverter_power ?? 0);
        const exp = Math.min(Math.max(0, d.ongrid_power ?? 0), gen);
        const self = Math.min(d.selfProvide ?? Math.max(0, gen - exp), gen);
        let buy = Math.max(0, d.buy_power ?? d.buyPower ?? 0);
        if (!hasDirectBuy && buyToday > 0) {
          buy = Math.max(0, avgLoadKw - self);
        }
        byHour.set(h, { gen, exp, self, buy });
      }

      const currentHour = new Date().getHours();
      return HOURS.map(h => {
        const label = `${String(h).padStart(2, '0')}:00`;
        const entry = byHour.get(h);
        if (entry) {
          return {
            time: label,
            'Generación FV': +entry.gen.toFixed(2),
            'Exportación': +entry.exp.toFixed(2),
            'Autoconsumo': +entry.self.toFixed(2),
            'Importación': +entry.buy.toFixed(2),
          };
        }
        const emptyVal = h > currentHour ? null : 0;
        return {
          time: label,
          'Generación FV': emptyVal,
          'Exportación': emptyVal,
          'Autoconsumo': emptyVal,
          'Importación': emptyVal,
        };
      });
    }

    // Respaldo instantáneo cuando genToday > 0 sobre la grilla fija 05:00–19:00
    if (genToday > 0) {
      const rawWeights = HOURS.map(h =>
        h === 5 || h === 19 ? 0 : Math.exp(-0.5 * Math.pow((h - 12.2) / 2.35, 2))
      );
      rawWeights[1] *= 0.25;
      rawWeights[rawWeights.length - 2] *= 0.2;
      const wSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
      const expRatio = genToday > 0 ? Math.min(0.95, Math.max(0, exportToday / genToday)) : 0;
      const avgLoadKw = loadToday > 0 ? loadToday / 13 : 0;

      return HOURS.map((h, i) => {
        const w = rawWeights[i] / wSum;
        const gen = +(genToday * w).toFixed(2);
        const exp = +(gen * expRatio).toFixed(2);
        const self = +Math.max(0, gen - exp).toFixed(2);
        const buy = (h === 5 || h === 19) ? 0 : +Math.max(0, avgLoadKw - self).toFixed(2);
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

  /* ── Monthly series (kWh energy per day) & CREG 174 summary ─── */
  const { monthSeries, monthCreg } = useMemo(() => {
    let genSum = 0;
    let expSum = 0;
    let selfSum = 0;
    let buySum = 0;

    const series = ((monthData?.data ?? []) as Array<Record<string, unknown>>).map(item => {
      const ts = item.collectTime as number ?? 0;
      const d = (item.dataItemMap ?? {}) as Record<string, number>;
      const gen = Math.max(0, d.inverter_power ?? d.inverterYield ?? d.PVYield ?? 0);
      const exp = Math.min(Math.max(0, d.ongrid_power ?? 0), gen);
      const self = Math.min(d.selfUsePower ?? d.selfProvide ?? Math.max(0, gen - exp), gen);
      const buy = Math.max(0, d.buyPower ?? d.buy_power ?? 0);

      genSum += gen;
      expSum += exp;
      selfSum += self;
      buySum += buy;

      return {
        day: new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }),
        'Autoconsumo': +self.toFixed(1),
        'Exportación': +exp.toFixed(1),
        'Importación': +buy.toFixed(1),
      };
    });

    const exc1 = Math.min(expSum, buySum);
    const exc2 = Math.max(0, expSum - buySum);
    const netBuy = Math.max(0, buySum - exc1);

    return {
      monthSeries: series,
      monthCreg: {
        days: series.length,
        gen: +genSum.toFixed(1),
        self: +selfSum.toFixed(1),
        exp: +expSum.toFixed(1),
        buy: +buySum.toFixed(1),
        load: +(selfSum + buySum).toFixed(1),
        exc1: +exc1.toFixed(1),
        exc2: +exc2.toFixed(1),
        netBuy: +netBuy.toFixed(1),
      },
    };
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

              {/* Desglose Excedentes CREG 174 (Tipo 1 / Tipo 2 / Neto) */}
              <div style={{
                background: 'rgba(36,165,174,0.05)',
                border: '1px solid rgba(36,165,174,0.18)',
                borderRadius: 8,
                padding: '6px 10px',
                textAlign: 'center',
              }}>
                <p className="label-xs" style={{ color: BRAND.teal, marginBottom: 3, fontSize: 9 }}>Excedentes CREG 174</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5 }}>
                  <span style={{ color: BRAND.muted }}>Tipo 1:</span>
                  <strong style={{ color: BRAND.greenD }}>{fmt(exc1Today, 1)} kWh</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5 }}>
                  <span style={{ color: BRAND.muted }}>Tipo 2:</span>
                  <strong style={{ color: BRAND.teal }}>{fmt(exc2Today, 1)} kWh</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5, borderTop: `1px dashed ${BRAND.border}`, marginTop: 2, paddingTop: 2 }}>
                  <span style={{ color: BRAND.muted }}>Neto Red:</span>
                  <strong style={{ color: netBuyToday > 0 ? '#DC2626' : BRAND.greenD }}>{fmt(netBuyToday, 1)} kWh</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Resumen Acumulado del Mes (Mismas variables que Facturación CREG 174) */}
          {monthCreg.days > 0 && (
            <div style={{
              padding: '8px 14px',
              borderTop: `1px solid ${BRAND.border}`,
              background: BRAND.surface,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: BRAND.text }}>
                Acumulado del Mes ({monthCreg.days}d · CREG 174):
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11 }}>
                <span>Gen: <strong style={{ color: '#B45309' }}>{fmtEnergy(monthCreg.gen)}</strong></span>
                <span>Autoconsumo: <strong style={{ color: BRAND.greenD }}>{fmtEnergy(monthCreg.self)}</strong></span>
                <span>Exportación: <strong style={{ color: BRAND.teal }}>{fmtEnergy(monthCreg.exp)}</strong></span>
                <span>Importación: <strong style={{ color: '#DC2626' }}>{fmtEnergy(monthCreg.buy)}</strong></span>
                <span>Exc. Tipo 1: <strong style={{ color: BRAND.greenD }}>{fmtEnergy(monthCreg.exc1)}</strong></span>
                <span>Exc. Tipo 2: <strong style={{ color: BRAND.teal }}>{fmtEnergy(monthCreg.exc2)}</strong></span>
                <span>Consumo Neto: <strong style={{ color: BRAND.text }}>{fmtEnergy(monthCreg.netBuy)}</strong></span>
              </div>
            </div>
          )}
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

        {/* ── 4.5 Tarjetas de Inversores + Diagrama Animado de Strings ── */}
        <div style={SC}>
          <style>{`
            @keyframes solgerEnergyFlow {
              from { stroke-dashoffset: 28; }
              to { stroke-dashoffset: 0; }
            }
            @keyframes solgerPulseBar {
              0% { background-position: 0% 0%; }
              100% { background-position: 200% 0%; }
            }
            .solger-flow-fast {
              stroke-dasharray: 8 6;
              animation: solgerEnergyFlow 0.9s linear infinite;
            }
            .solger-flow-slow {
              stroke-dasharray: 8 6;
              animation: solgerEnergyFlow 2.1s linear infinite;
            }
            .solger-diagram-desktop { display: block; }
            .solger-diagram-mobile { display: none; }
            @media (max-width: 640px) {
              .solger-diagram-desktop { display: none; }
              .solger-diagram-mobile { display: block; }
            }
          `}</style>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Zap size={14} color={BRAND.teal} />
              <div>
                <p className="section-title" style={{ fontSize: 13, margin: 0 }}>Inversores y Diagrama Animado de Strings (PV)</p>
                <p style={{ fontSize: 10.5, color: BRAND.muted, margin: 0 }}>
                  Haz clic en cualquier tarjeta de inversor para desplegar su diagrama de flujo DC → AC en tiempo real
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: BRAND.muted }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: BRAND.green }} /> Verde (Óptimo)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: BRAND.gold }} /> Amarillo (&lt;75%)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: BRAND.red }} /> Rojo (Falla/0A)
              </span>
            </div>
          </div>

          {stringsLoading ? (
            <div style={{ padding: 20 }}><LoadingSpinner text="Leyendo telemetría de inversores y strings..." /></div>
          ) : (stringsData?.inverters ?? []).length === 0 ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: BRAND.dim }}>
              Sin telemetría de strings disponible en este momento (puede requerir esperar enfriamiento de API Huawei).
            </div>
          ) : (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Tarjetas de Inversores lado a lado */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {stringsData!.inverters.map(inv => {
                  const okCount = inv.strings.filter(s => s.status === 'ok').length;
                  const lowCount = inv.strings.filter(s => s.status === 'low').length;
                  const faultCount = inv.strings.filter(s => s.status === 'fault').length;
                  const nightCount = inv.strings.filter(s => s.status === 'night').length;
                  const isSelected = selectedInverterId === inv.id;

                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => setSelectedInverterId(prev => (prev === inv.id ? null : inv.id))}
                      style={{
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderRadius: 10,
                        padding: '12px 14px',
                        background: isSelected ? 'rgba(36,165,174,0.06)' : '#fff',
                        border: isSelected ? `2px solid ${BRAND.teal}` : `1px solid ${BRAND.border}`,
                        boxShadow: isSelected ? '0 4px 14px rgba(36,165,174,0.14)' : '0 1px 3px rgba(15,23,42,0.04)',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: isSelected ? BRAND.teal : 'rgba(36,165,174,0.12)',
                            color: isSelected ? '#fff' : BRAND.teal,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <Cpu size={16} />
                          </div>
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND.text }}>{inv.name}</div>
                            <div style={{ fontSize: 10.5, color: BRAND.muted }}>
                              {inv.strings.length} strings · {fmt(inv.activePower_kw, 2)} kW AC
                            </div>
                          </div>
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: isSelected ? BRAND.teal : BRAND.muted }}>
                          {isSelected ? 'Ocultar ▲' : 'Diagrama ▼'}
                        </span>
                      </div>

                      {/* Contadores Semáforo: Verdes, Amarillos, Rojos */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        <div style={{ padding: '6px 8px', borderRadius: 7, background: BRAND.greenL, textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.greenD, lineHeight: 1 }}>{okCount}</div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.greenD, marginTop: 2 }}>VERDES</div>
                        </div>
                        <div style={{ padding: '6px 8px', borderRadius: 7, background: BRAND.goldL, textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#B45309', lineHeight: 1 }}>{lowCount}</div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: '#92400E', marginTop: 2 }}>AMARILLOS</div>
                        </div>
                        <div style={{ padding: '6px 8px', borderRadius: 7, background: BRAND.redL, textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.red, lineHeight: 1 }}>{faultCount}</div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.red, marginTop: 2 }}>ROJOS</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: BRAND.muted, paddingTop: 2, borderTop: `1px solid ${BRAND.border}` }}>
                        <span>Eficiencia: <strong>{inv.efficiency > 0 ? `${inv.efficiency}%` : '—'}</strong></span>
                        <span>Temp: <strong>{inv.temperature > 0 ? `${inv.temperature}°C` : '—'}</strong></span>
                        {nightCount > 0 && <span>Reposo: <strong>{nightCount}</strong></span>}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Diagrama Unifilar Animado al seleccionar un Inversor */}
              {(() => {
                const selectedInv = stringsData!.inverters.find(i => i.id === selectedInverterId);
                if (!selectedInv) return null;

                const strings = selectedInv.strings;
                const rowH = 33;
                const svgHeight = Math.max(170, strings.length * rowH + 24);
                const centerY = svgHeight / 2;

                return (
                  <div style={{
                    border: `1.5px solid ${BRAND.teal}`,
                    borderRadius: 10,
                    background: '#FAFCFD',
                    padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                      <div>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: BRAND.text }}>
                          Diagrama de Flujo — {selectedInv.name}
                        </span>
                        <span style={{ fontSize: 10.5, color: BRAND.muted, marginLeft: 8 }}>
                          Mediana: <strong>{selectedInv.medianCurrent_a} A</strong>
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: BRAND.teal, fontWeight: 700 }}>
                        Flujo DC → AC en vivo
                      </span>
                    </div>

                    {strings.length === 0 ? (
                      <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: BRAND.dim }}>
                        Sin strings activos reportados en este inversor.
                      </div>
                    ) : (
                      <>
                        {/* Vista Desktop: Diagrama Horizontal Compacto */}
                        <div className="solger-diagram-desktop">
                          <svg
                            viewBox={`0 0 660 ${svgHeight}`}
                            style={{ width: '100%', maxWidth: 680, margin: '0 auto', height: 'auto', display: 'block' }}
                          >
                            {/* Bus DC vertical colector */}
                            <line
                              x1={355}
                              y1={18}
                              x2={355}
                              y2={svgHeight - 18}
                              stroke="#CBD5E1"
                              strokeWidth={3.5}
                              strokeLinecap="round"
                            />

                            {/* Cables + Cajas de Strings (Izquierda) */}
                            {strings.map((st, idx) => {
                              const y = 18 + idx * rowH + 10;
                              const color =
                                st.status === 'ok' ? '#58AE32' :
                                st.status === 'low' ? '#F59E0B' :
                                st.status === 'fault' ? '#EF4444' : '#94A3B8';
                              const bg =
                                st.status === 'ok' ? '#F0FDF4' :
                                st.status === 'low' ? '#FFFBEB' :
                                st.status === 'fault' ? '#FEF2F2' : '#F8FAFC';
                              const flowClass =
                                st.status === 'ok' ? 'solger-flow-fast' :
                                st.status === 'low' ? 'solger-flow-slow' : '';
                              const pathD = `M 236 ${y} C 285 ${y}, 305 ${y}, 355 ${y}`;

                              return (
                                <g key={st.id}>
                                  <path d={pathD} fill="none" stroke="#E2E8F0" strokeWidth={2.5} />
                                  {st.status !== 'fault' && st.status !== 'night' ? (
                                    <path d={pathD} fill="none" stroke={color} strokeWidth={2.5} className={flowClass} />
                                  ) : (
                                    <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 4" opacity={0.75} />
                                  )}

                                  {st.status === 'fault' && (
                                    <g transform={`translate(295, ${y})`}>
                                      <circle r={7.5} fill="#EF4444" />
                                      <text x={0} y={3} textAnchor="middle" fill="#fff" fontSize={9} fontWeight="800">✕</text>
                                    </g>
                                  )}

                                  <rect
                                    x={6}
                                    y={y - 13}
                                    width={230}
                                    height={26}
                                    rx={6}
                                    fill={bg}
                                    stroke={color}
                                    strokeWidth={1.4}
                                  />
                                  <rect x={13} y={y - 7} width={12} height={14} rx={2} fill={color} opacity={0.18} stroke={color} strokeWidth={0.9} />
                                  <line x1={19} y1={y - 7} x2={19} y2={y + 7} stroke={color} strokeWidth={0.7} />
                                  <line x1={13} y1={y} x2={25} y2={y} stroke={color} strokeWidth={0.7} />

                                  <text x={31} y={y + 3.5} fill="#0F172A" fontSize={10.5} fontWeight="800">
                                    {st.id}
                                  </text>
                                  <text x={72} y={y + 3.5} fill="#475569" fontSize={10} fontWeight="600">
                                    {st.voltage_v}V · {st.current_a}A
                                  </text>
                                  <text x={228} y={y + 3.5} textAnchor="end" fill={color} fontSize={10} fontWeight="800">
                                    {st.power_w >= 1000 ? `${(st.power_w / 1000).toFixed(2)}kW` : `${st.power_w}W`}
                                  </text>

                                  <circle cx={355} cy={y} r={3.5} fill={color} />
                                </g>
                              );
                            })}

                            {/* Línea Bus DC -> Inversor */}
                            <line x1={355} y1={centerY} x2={415} y2={centerY} stroke="#CBD5E1" strokeWidth={3.5} />
                            {selectedInv.activePower_kw > 0.05 && (
                              <line x1={355} y1={centerY} x2={415} y2={centerY} stroke={BRAND.teal} strokeWidth={3.5} className="solger-flow-fast" />
                            )}

                            {/* Bloque Central: Inversor Huawei DC -> AC */}
                            <rect
                              x={415}
                              y={centerY - 38}
                              width={116}
                              height={76}
                              rx={10}
                              fill="#0F172A"
                              stroke={BRAND.teal}
                              strokeWidth={2}
                            />
                            <text x={473} y={centerY - 15} textAnchor="middle" fill="#94A3B8" fontSize={8.5} fontWeight="700">
                              INVERSOR DC/AC
                            </text>
                            <text x={473} y={centerY + 3} textAnchor="middle" fill="#FFFFFF" fontSize={13} fontWeight="800">
                              {fmt(selectedInv.activePower_kw, 2)} kW
                            </text>
                            <text x={473} y={centerY + 20} textAnchor="middle" fill="#34D399" fontSize={9.5} fontWeight="700">
                              {selectedInv.efficiency > 0 ? `${selectedInv.efficiency}%` : '—'} · {selectedInv.temperature > 0 ? `${selectedInv.temperature}°C` : '—'}
                            </text>

                            {/* Salida AC hacia Red / Carga */}
                            <line x1={531} y1={centerY} x2={588} y2={centerY} stroke="#CBD5E1" strokeWidth={3.5} />
                            {selectedInv.activePower_kw > 0.05 && (
                              <line x1={531} y1={centerY} x2={588} y2={centerY} stroke="#58AE32" strokeWidth={3.5} className="solger-flow-fast" />
                            )}
                            <circle cx={616} cy={centerY} r={22} fill="#F0FDF4" stroke="#58AE32" strokeWidth={1.8} />
                            <text x={616} y={centerY - 1} textAnchor="middle" fill="#166534" fontSize={9} fontWeight="800">
                              RED AC
                            </text>
                            <text x={616} y={centerY + 10} textAnchor="middle" fill="#15803D" fontSize={8.5} fontWeight="700">
                              440/220V
                            </text>
                          </svg>
                        </div>

                        {/* Vista Teléfono (<640px): Flujo Vertical Responsivo y Legible */}
                        <div className="solger-diagram-mobile">
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', borderRadius: 9, background: '#0F172A', color: '#fff',
                            border: `1.5px solid ${BRAND.teal}`, marginBottom: 8,
                          }}>
                            <div>
                              <div style={{ fontSize: 9.5, color: '#94A3B8', fontWeight: 700 }}>INVERSOR DC/AC → RED</div>
                              <div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(selectedInv.activePower_kw, 2)} kW</div>
                            </div>
                            <div style={{ textAlign: 'right', fontSize: 11, color: '#34D399', fontWeight: 700 }}>
                              <div>Eff: {selectedInv.efficiency > 0 ? `${selectedInv.efficiency}%` : '—'}</div>
                              <div>{selectedInv.temperature > 0 ? `${selectedInv.temperature}°C` : '—'}</div>
                            </div>
                          </div>

                          {/* Conector animado vertical hacia los strings */}
                          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                            <svg width="24" height="22" viewBox="0 0 24 22">
                              <line x1="12" y1="22" x2="12" y2="0" stroke="#CBD5E1" strokeWidth="3" />
                              {selectedInv.activePower_kw > 0.05 && (
                                <line x1="12" y1="22" x2="12" y2="0" stroke={BRAND.teal} strokeWidth="3" className="solger-flow-fast" />
                              )}
                            </svg>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 7 }}>
                            {strings.map(st => {
                              const color =
                                st.status === 'ok' ? BRAND.green :
                                st.status === 'low' ? BRAND.gold :
                                st.status === 'fault' ? BRAND.red : '#94A3B8';
                              const bg =
                                st.status === 'ok' ? '#F0FDF4' :
                                st.status === 'low' ? '#FFFBEB' :
                                st.status === 'fault' ? '#FEF2F2' : '#F8FAFC';

                              return (
                                <div
                                  key={st.id}
                                  style={{
                                    background: bg,
                                    border: `1px solid ${color}`,
                                    borderRadius: 8,
                                    padding: '7px 9px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 3,
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 11.5, fontWeight: 800, color: BRAND.text }}>{st.id}</span>
                                    <span style={{ fontSize: 10, fontWeight: 700, color }}>
                                      {st.status === 'fault' ? '✕ Falla' : st.pct_vs_median != null ? `${st.pct_vs_median}%` : 'Reposo'}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
                                    {st.voltage_v}V · <strong style={{ color: BRAND.text }}>{st.current_a}A</strong>
                                  </div>
                                  <div style={{ fontSize: 10.5, fontWeight: 800, color }}>
                                    {st.power_w >= 1000 ? `${(st.power_w / 1000).toFixed(2)} kW` : `${st.power_w} W`}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
