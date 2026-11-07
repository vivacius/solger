import { useState, useMemo } from 'react';
import { BarChart3, Zap, TrendingUp, TrendingDown, CheckCircle, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ReferenceLine } from 'recharts';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { ErrorState, LoadingSpinner } from '../components/ui/States';
import { Header } from '../components/layout/Header';
import { BRAND, fmt } from '../lib/utils';

// Parámetros de diseño Valle del Cauca — igual que en MaintenancePage
const HSP = 4.5;  // Horas Solares Pico promedio diario
const EFF = 0.80; // Eficiencia de sistema (pérdidas de red, temperatura, etc.)

export default function ComparePage() {

  const { data, loading, error, refresh } = useFetch(api.getSummary, []);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'yield' | 'deviation'>('yield');

  const plants = data?.plants ?? [];

  // Toggle selection of individual plant
  const handleToggle = (code: string) => {
    setSelectedCodes(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  // Select all / none
  const handleSelectAll = () => {
    setSelectedCodes(plants.map(p => p.plantCode));
  };
  const handleSelectNone = () => {
    setSelectedCodes([]);
  };

  // Determine current day of the month for daily averages
  const dayOfMonth = useMemo(() => {
    return new Date().getDate() || 1;
  }, []);

  // Filtered and processed comparative data
  const chartData = useMemo(() => {
    const activeList = selectedCodes.length > 0 
      ? plants.filter(p => selectedCodes.includes(p.plantCode))
      : plants.slice(0, 6); // Default to showing first 6 plants if none selected

    return activeList.map(p => {
      const kpi = data?.kpis.find(k => k.plantCode === p.plantCode || k.stationCode === p.plantCode);
      const dim = kpi?.dataItemMap ?? {};

      const genToday = dim.day_power ?? 0;
      const genMonth = dim.month_power ?? 0;
      const rawCap = p.capacity ?? 0;

      // Si la planta no tiene capacidad configurada, la estimamos igual que en
      // MaintenancePage: capacity ≈ genHoy / (HSP × EFF)
      const capEstimated = rawCap <= 0;
      const capacity = capEstimated
        ? (genToday > 0 ? +(genToday / (HSP * EFF)).toFixed(1) : 0)
        : rawCap;

      // Generación esperada de diseño: capacidad × 4.5 HSP × 80% eficiencia de sistema
      // Si la capacidad fue estimada, la expected coincide con la real (desviación = 0 vs mes)
      const expectedToday = !capEstimated && capacity > 0 ? capacity * HSP * EFF : genToday;
      const avgDailyMonth = genMonth > 0 ? genMonth / dayOfMonth : 0;

      // Deviations
      const deviationExpected = expectedToday > 0 ? ((genToday - expectedToday) / expectedToday) * 100 : 0;
      const deviationMonth = avgDailyMonth > 0 ? ((genToday - avgDailyMonth) / avgDailyMonth) * 100 : 0;

      // Real peak sun hours (HSP) today — normalized indicator
      const hspReal = capacity > 0 ? genToday / capacity : 0;


      // Status classification
      let statusLabel = 'Normal';
      let statusColor = BRAND.muted;
      let statusBg = BRAND.surface;
      if (deviationMonth < -15) {
        statusLabel = 'Bajo Rendimiento';
        statusColor = BRAND.red;
        statusBg = BRAND.redL;
      } else if (deviationMonth > 15) {
        statusLabel = 'Rendimiento Alto';
        statusColor = BRAND.greenD;
        statusBg = BRAND.greenL;
      }

      return {
        code: p.plantCode,
        name: p.plantName.replace(/^HDA\s+|^HACIENDA\s+/i, '').slice(0, 14),
        fullName: p.plantName,
        capacity,
        capEstimated,
        genToday,
        expectedToday,
        avgDailyMonth,
        hspReal,
        deviationExpected,
        deviationMonth,

        statusLabel,
        statusColor,
        statusBg,
      };
    });
  }, [selectedCodes, plants, data, dayOfMonth]);

  // Overall summary metrics of the selected plants
  const summaryMetrics = useMemo(() => {
    if (!chartData.length) return { avgDev: 0, avgHsp: 0, countLow: 0 };
    const totalDev = chartData.reduce((acc, curr) => acc + curr.deviationMonth, 0);
    const totalHsp = chartData.reduce((acc, curr) => acc + curr.hspReal, 0);
    const countLow = chartData.filter(c => c.deviationMonth < -15).length;
    return {
      avgDev: totalDev / chartData.length,
      avgHsp: totalHsp / chartData.length,
      countLow,
    };
  }, [chartData]);

  return (
    <div>
      <Header onRefresh={refresh} loading={loading} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {/* Header Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="page-title">Comparador de Rendimiento O&M</h2>
            <p style={{ fontSize: 13, color: BRAND.muted, marginTop: 4 }}>
              Analiza el rendimiento normalizado por capacidad (HSP) y la desviación de generación respecto al promedio mensual.
            </p>
          </div>
        </div>

        {loading && !data && <LoadingSpinner text="Cargando datos comparativos..." />}
        {error && <ErrorState message={error} onRetry={refresh} />}

        {data && (
          <>
            {/* ── 1. KPI Cards Comparativos (Mini) ───────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div className="card" style={{ padding: '12px 16px', borderLeft: `4px solid ${BRAND.green}` }}>
                <p className="label-xs" style={{ color: BRAND.muted, marginBottom: 2 }}>Desviación Promedio vs Mes</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {summaryMetrics.avgDev >= 0 ? <TrendingUp size={16} color={BRAND.green} /> : <TrendingDown size={16} color={BRAND.red} />}
                  <span style={{ fontSize: 18, fontWeight: 800, color: summaryMetrics.avgDev >= 0 ? BRAND.greenD : BRAND.red }}>
                    {summaryMetrics.avgDev >= 0 ? '+' : ''}{fmt(summaryMetrics.avgDev, 1)}%
                  </span>
                </div>
                <p style={{ fontSize: 10, color: BRAND.muted, marginTop: 4 }}>Producción promedio del grupo hoy</p>
              </div>

              <div className="card" style={{ padding: '12px 16px', borderLeft: `4px solid ${BRAND.gold}` }}>
                <p className="label-xs" style={{ color: BRAND.muted, marginBottom: 2 }}>HSP Promedio Hoy</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={15} color={BRAND.gold} />
                  <span style={{ fontSize: 18, fontWeight: 800, color: BRAND.text }}>
                    {fmt(summaryMetrics.avgHsp, 2)} h/día
                  </span>
                </div>
                <p style={{ fontSize: 10, color: BRAND.muted, marginTop: 4 }}>Normalizado por capacidad instalada</p>
              </div>

              <div className="card" style={{ padding: '12px 16px', borderLeft: `4px solid ${summaryMetrics.countLow > 0 ? BRAND.red : BRAND.green}` }}>
                <p className="label-xs" style={{ color: BRAND.muted, marginBottom: 2 }}>Alertas de Rendimiento</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {summaryMetrics.countLow > 0 ? <AlertTriangle size={16} color={BRAND.red} /> : <CheckCircle size={16} color={BRAND.green} />}
                  <span style={{ fontSize: 18, fontWeight: 800, color: summaryMetrics.countLow > 0 ? BRAND.red : BRAND.greenD }}>
                    {summaryMetrics.countLow} {summaryMetrics.countLow === 1 ? 'planta' : 'plantas'}
                  </span>
                </div>
                <p style={{ fontSize: 10, color: BRAND.muted, marginTop: 4 }}>Con desviación inferior al -15%</p>
              </div>
            </div>

            {/* ── 2. Selector de Plantas ─────────────────────────────────── */}
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h3 className="label-xs" style={{ color: BRAND.text, margin: 0 }}>
                  Seleccionar Plantas a Comparar ({selectedCodes.length || 'mostrando 6 por defecto'})
                </h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleSelectAll} style={btnSecondaryStyle}>Seleccionar Todas</button>
                  <button onClick={handleSelectNone} style={btnSecondaryStyle}>Deseleccionar</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {plants.map(p => {
                  const isSelected = selectedCodes.includes(p.plantCode);
                  return (
                    <button
                      key={p.plantCode}
                      onClick={() => handleToggle(p.plantCode)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.12s',
                        background: isSelected ? 'rgba(88,174,50,0.1)' : BRAND.surface,
                        color: isSelected ? BRAND.greenD : BRAND.muted,
                        border: `1px solid ${isSelected ? 'rgba(88,174,50,0.28)' : BRAND.border}`,
                      }}
                    >
                      {p.plantName}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── 3. Gráfico Principal con Pestañas ──────────────────────── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Tab Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${BRAND.border}`, background: 'rgba(15,23,42,0.01)', padding: '0 20px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    onClick={() => setActiveTab('yield')}
                    style={{
                      padding: '14px 20px',
                      fontSize: 13,
                      fontWeight: 650,
                      background: 'none',
                      border: 'none',
                      borderBottom: `2.5px solid ${activeTab === 'yield' ? BRAND.green : 'transparent'}`,
                      color: activeTab === 'yield' ? BRAND.greenD : BRAND.muted,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    Generación Real vs Esperada (kWh)
                  </button>
                  <button
                    onClick={() => setActiveTab('deviation')}
                    style={{
                      padding: '14px 20px',
                      fontSize: 13,
                      fontWeight: 650,
                      background: 'none',
                      border: 'none',
                      borderBottom: `2.5px solid ${activeTab === 'deviation' ? BRAND.green : 'transparent'}`,
                      color: activeTab === 'deviation' ? BRAND.greenD : BRAND.muted,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    Desviación vs Promedio Diario del Mes (%)
                  </button>
                </div>
                <div style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: BRAND.muted }}>
                  <BarChart3 size={13} color={BRAND.green} />
                  <span>Meta de diseño: 4.5 HSP</span>
                </div>
              </div>

              {/* Tab Content */}
              <div style={{ padding: '24px 20px 16px' }}>
                <div style={{ height: 350 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {activeTab === 'yield' ? (
                      <BarChart data={chartData} barSize={16}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.04)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: BRAND.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: BRAND.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} unit=" kWh" />
                        <Tooltip content={<CustomYieldTooltip />} />
                        <Legend
                          iconType="circle"
                          iconSize={6}
                          formatter={v => <span style={{ color: BRAND.muted, fontSize: 11.5 }}>{v}</span>}
                        />
                        <Bar name="Generación Real" dataKey="genToday" fill={BRAND.green} radius={[3, 3, 0, 0]} />
                        <Bar name="Generación Esperada" dataKey="expectedToday" fill={BRAND.teal} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    ) : (
                      <BarChart data={chartData} barSize={16}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.04)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: BRAND.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: BRAND.muted, fontSize: 10.5 }} axisLine={false} tickLine={false} unit=" %" />
                        <Tooltip content={<CustomDevTooltip />} />
                        <ReferenceLine y={0} stroke="rgba(15,23,42,0.2)" strokeDasharray="3 3" />
                        <Bar name="Desviación (%)" dataKey="deviationMonth">
                          {chartData.map((entry, index) => {
                            const isNegative = entry.deviationMonth < 0;
                            return (
                              <Cell
                                key={`cell-${index}`}
                                fill={isNegative ? BRAND.red : BRAND.green}
                              />
                            );
                          })}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ── 4. Tabla de Resumen O&M ────────────────────────────────── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BRAND.border}` }}>
                <h3 className="section-title">Análisis de Rendimiento Detallado</h3>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(15,23,42,0.015)', borderBottom: `1px solid ${BRAND.border}` }}>
                      <th style={thStyle}>Planta</th>
                      <th style={thStyle}>Capacidad (kWp)</th>
                      <th style={thStyle}>Gen. Hoy (kWh)</th>
                      <th style={thStyle}>Esperada Hoy (kWh)</th>
                      <th style={thStyle}>Prom. Diario Mes (kWh)</th>
                      <th style={thStyle}>Desviación vs Mes</th>
                      <th style={thStyle}>HSP Real Hoy</th>
                      <th style={thStyle}>Estado O&M</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map(c => (
                      <tr key={c.code} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                        <td style={{ ...tdStyle, fontWeight: 700, color: BRAND.text }}>{c.fullName}</td>
                        <td style={tdStyle}>
                          {c.capEstimated ? '~' : ''}{fmt(c.capacity, 1)} kWp
                          {c.capEstimated && <span title="Capacidad estimada desde la producción de hoy" style={{ marginLeft: 4, fontSize: 9, color: BRAND.dim, cursor: 'help' }}>est.</span>}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{fmt(c.genToday, 1)} kWh</td>
                        <td style={tdStyle}>
                          {c.capEstimated
                            ? <span style={{ color: BRAND.dim, fontSize: 11 }} title="Sin capacidad configurada en FusionSolar">Sin dato</span>
                            : `${fmt(c.expectedToday, 1)} kWh`
                          }
                        </td>
                        <td style={tdStyle}>{fmt(c.avgDailyMonth, 1)} kWh</td>
                        <td style={{ ...tdStyle, fontWeight: 700, color: c.deviationMonth >= 0 ? BRAND.greenD : BRAND.red }}>
                          {c.deviationMonth >= 0 ? '+' : ''}{fmt(c.deviationMonth, 1)}%
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 650 }}>{fmt(c.hspReal, 2)} h/día</td>
                        <td style={tdStyle}>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 9px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 700,
                            color: c.statusColor,
                            background: c.statusBg,
                          }}>
                            {c.statusLabel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Styles & Components helper ───────────────────────────────────────────────
const btnSecondaryStyle: React.CSSProperties = {
  background: 'white',
  border: `1px solid ${BRAND.border}`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11.5,
  fontWeight: 600,
  color: BRAND.muted,
  cursor: 'pointer',
  transition: 'all 0.15s',
  boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
};

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 10.5,
  fontWeight: 700,
  color: BRAND.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 12.5,
  color: '#334155',
};

// Tooltip renderers
function CustomYieldTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const real = payload[0].value;
  const expected = payload[1]?.value ?? 0;
  const capEstimated = payload[0].payload.capEstimated;
  const dev = !capEstimated && expected > 0 ? ((real - expected) / expected) * 100 : null;
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(15,23,42,0.09)', borderRadius: 10, padding: '10px 14px', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: BRAND.text, marginBottom: 6 }}>{payload[0].payload.fullName}</p>
      <p style={{ fontSize: 11.5, color: BRAND.green, margin: '2px 0' }}>Generación Real: <b>{fmt(real, 1)} kWh</b></p>
      {capEstimated
        ? <p style={{ fontSize: 11, color: BRAND.dim, marginTop: 4, fontStyle: 'italic' }}>Sin capacidad configurada — no se puede calcular meta de diseño</p>
        : <>
            <p style={{ fontSize: 11.5, color: BRAND.teal, margin: '2px 0' }}>Esperada (Diseño 4.5 HSP): <b>{fmt(expected, 1)} kWh</b></p>
            {dev !== null && (
              <p style={{ fontSize: 11.5, color: dev >= 0 ? BRAND.greenD : BRAND.red, marginTop: 4, fontWeight: 700 }}>
                Desviación vs Diseño: {dev >= 0 ? '+' : ''}{fmt(dev, 1)}%
              </p>
            )}
          </>
      }
    </div>
  );
}

function CustomDevTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const dev = payload[0].value;
  const data = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(15,23,42,0.09)', borderRadius: 10, padding: '10px 14px', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: BRAND.text, marginBottom: 6 }}>{data.fullName}</p>
      <p style={{ fontSize: 11.5, color: BRAND.text, margin: '2px 0' }}>Generación Hoy: <b>{fmt(data.genToday, 1)} kWh</b></p>
      <p style={{ fontSize: 11.5, color: BRAND.muted, margin: '2px 0' }}>Promedio Diario Mes: <b>{fmt(data.avgDailyMonth, 1)} kWh</b></p>
      <p style={{ fontSize: 11.5, color: dev >= 0 ? BRAND.greenD : BRAND.red, marginTop: 4, fontWeight: 700 }}>
        Desviación vs Mes: {dev >= 0 ? '+' : ''}{fmt(dev, 1)}%
      </p>
    </div>
  );
}
