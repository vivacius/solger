import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, RefreshCw, Info,
  BarChart3, DollarSign, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { Header } from '../components/layout/Header';
import { BRAND, fmt } from '../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SpotSeries { date: string; avg: number }
interface SpotResponse {
  avg: number; min: number; max: number;
  series: SpotSeries[];
  source: string;
  note: string;
}
interface ContractResponse {
  regulado:    { avg: number | null; label: string };
  no_regulado: { avg: number | null; label: string };
}

const BASE = '/api';

const PERIODS = [
  { label: 'Últimos 7 días',  days: 7  },
  { label: 'Últimos 30 días', days: 30 },
  { label: 'Últimos 60 días', days: 60 },
  { label: 'Últimos 90 días', days: 90 },
];

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, contractPrice }: any) => {
  if (!active || !payload?.length) return null;
  const bolsa = payload.find((p: any) => p.dataKey === 'bolsa')?.value;
  const diff  = contractPrice && bolsa ? bolsa - contractPrice : null;
  return (
    <div style={{
      background: '#0F1929', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ color: '#94A3B8', marginBottom: 6 }}>{label}</p>
      {bolsa != null && (
        <p style={{ color: BRAND.teal, fontWeight: 700 }}>
          Bolsa XM: ${fmt(bolsa, 0)}/kWh
        </p>
      )}
      {contractPrice && (
        <p style={{ color: BRAND.gold, fontWeight: 600 }}>
          Tu contrato: ${fmt(contractPrice, 0)}/kWh
        </p>
      )}
      {diff != null && (
        <p style={{ color: diff >= 0 ? BRAND.green : BRAND.red, marginTop: 4, fontSize: 11 }}>
          {diff >= 0 ? '▲' : '▼'} Bolsa {diff >= 0 ? 'mayor' : 'menor'} ${fmt(Math.abs(diff), 0)}/kWh
        </p>
      )}
    </div>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function MarketPage() {
  const [periodIdx, setPeriodIdx]     = useState(1); // default 30 días
  const [spot, setSpot]               = useState<SpotResponse | null>(null);
  const [contracts, setContracts]     = useState<ContractResponse | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [contractPrice, setContractPrice] = useState<string>('300'); // editable

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const end   = new Date(); end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - PERIODS[periodIdx].days + 1);
      const s = toDateStr(start);
      const e = toDateStr(end);

      const [spotRes, contractRes] = await Promise.all([
        fetch(`${BASE}/market/spot-price?start=${s}&end=${e}`).then(r => r.json()),
        fetch(`${BASE}/market/contract-prices?start=${s}&end=${e}`).then(r => r.json()),
      ]);
      setSpot(spotRes);
      setContracts(contractRes);
    } catch (err: any) {
      setError(err.message || 'Error al cargar datos de mercado');
    } finally {
      setLoading(false);
    }
  }, [periodIdx]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Chart data
  const chartData = (spot?.series ?? []).map(s => ({
    date: s.date.slice(5),       // MM-DD
    bolsa: s.avg,
    contrato: contractPrice ? parseFloat(contractPrice) || undefined : undefined,
  }));

  const cp = parseFloat(contractPrice) || 0;
  const avgBolsa = spot?.avg ?? 0;
  const delta = avgBolsa - cp;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Header onRefresh={fetchData} loading={loading} />

      {/* ── Encabezado de página ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Mercado XM</h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>Precio de Bolsa Nacional — SINERGOX</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: BRAND.green, color: '#fff', border: 'none', cursor: 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin-slow 1s linear infinite' : 'none' }} />
          Actualizar
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Nota informativa ─────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(36,165,174,0.08)', border: '1px solid rgba(36,165,174,0.2)',
        }}>
          <Info size={14} color={BRAND.teal} />
          <p style={{ fontSize: 12, color: '#475569' }}>
            <strong style={{ color: BRAND.teal }}>Fuente: XM SINERGOX</strong> — Precio de Bolsa Nacional (COP/kWh).
            Datos con rezago de 1 día. {spot?.source === 'mock' && '⚠️ Mostrando datos de muestra (pydataxm no conectado).'}
          </p>
        </div>

        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── Período + precio contrato ─────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {PERIODS.map((p, i) => (
              <button
                key={i}
                onClick={() => setPeriodIdx(i)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: i === periodIdx ? BRAND.green : 'var(--card)',
                  color: i === periodIdx ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${i === periodIdx ? BRAND.green : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Precio de contrato configurable */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Tu precio de contrato (COP/kWh):
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#94A3B8' }}>$</span>
              <input
                type="number"
                value={contractPrice}
                onChange={e => setContractPrice(e.target.value)}
                style={{
                  padding: '6px 10px 6px 22px', borderRadius: 7, fontSize: 13, fontWeight: 600,
                  background: 'var(--card)', border: '1px solid var(--border)', color: BRAND.gold,
                  width: 100,
                }}
                placeholder="ej. 300"
              />
            </div>
          </div>
        </div>

        {/* ── KPI Cards ────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {[
            {
              icon: Activity, label: 'Bolsa Prom. Período',
              value: avgBolsa ? `$${fmt(avgBolsa, 0)}` : '—',
              sub: 'COP/kWh', color: BRAND.teal,
            },
            {
              icon: TrendingDown, label: 'Mínimo del período',
              value: spot?.min ? `$${fmt(spot.min, 0)}` : '—',
              sub: 'COP/kWh', color: BRAND.green,
            },
            {
              icon: TrendingUp, label: 'Máximo del período',
              value: spot?.max ? `$${fmt(spot.max, 0)}` : '—',
              sub: 'COP/kWh', color: BRAND.red,
            },
            {
              icon: DollarSign, label: 'Tu precio vs Bolsa',
              value: cp && avgBolsa ? (delta >= 0 ? `+$${fmt(delta, 0)}` : `-$${fmt(Math.abs(delta), 0)}`) : '—',
              sub: delta >= 0 ? 'Bolsa mayor que tu contrato ✓' : 'Bolsa menor que tu contrato',
              color: delta >= 0 ? BRAND.green : BRAND.red,
            },
          ].map(({ icon: Icon, label, value, sub, color }) => (
            <div key={label} className="card" style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={15} color={color} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              </div>
              <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{value}</p>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Gráfico ───────────────────────────────────────────────── */}
        <div className="card" style={{ padding: '20px 20px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <BarChart3 size={15} color={BRAND.teal} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Precio de Bolsa Nacional vs Tu Contrato</span>
          </div>

          {loading ? (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              Cargando datos de XM…
            </div>
          ) : chartData.length === 0 ? (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              Sin datos disponibles
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradBolsa" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={BRAND.teal}  stopOpacity={0.3} />
                    <stop offset="95%" stopColor={BRAND.teal}  stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<CustomTooltip contractPrice={cp} />} />
                <Legend
                  formatter={v => v === 'bolsa' ? 'Bolsa XM (COP/kWh)' : 'Tu contrato (COP/kWh)'}
                  wrapperStyle={{ fontSize: 11 }}
                />
                <Area
                  type="monotone" dataKey="bolsa"
                  stroke={BRAND.teal} strokeWidth={2}
                  fill="url(#gradBolsa)" dot={false}
                />
                {cp > 0 && (
                  <ReferenceLine
                    y={cp} stroke={BRAND.gold} strokeWidth={2}
                    strokeDasharray="6 3"
                    label={{ value: `$${cp}/kWh`, fill: BRAND.gold, fontSize: 11, position: 'right' }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Precios de Contratos del Mercado ─────────────────────── */}
        {contracts && (
          <div className="card" style={{ padding: '18px 20px' }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
              Referencia: Precio Promedio de Contratos en el Mercado
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { data: contracts.regulado,    color: BRAND.green },
                { data: contracts.no_regulado, color: BRAND.gold  },
              ].map(({ data, color }) => (
                <div key={data.label} style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: `${color}0D`, border: `1px solid ${color}30`,
                }}>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{data.label}</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color }}>
                    {data.avg ? `$${fmt(data.avg, 0)}/kWh` : '—'}
                  </p>
                  {data.avg && cp > 0 && (
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      Tu contrato está {cp < data.avg ? 'por debajo' : 'por encima'} del mercado
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tabla histórica ───────────────────────────────────────── */}
        {spot && spot.series.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Histórico diario</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{spot.series.length} días</span>
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    {['Fecha', 'Bolsa XM (COP/kWh)', 'Tu contrato', 'Diferencia'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...spot.series].reverse().map((row, i) => {
                    const diff = cp ? row.avg - cp : null;
                    return (
                      <tr key={row.date} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-subtle)', borderTop: '1px solid var(--border-soft)' }}>
                        <td style={{ padding: '7px 14px', color: 'var(--text-secondary)' }}>{row.date}</td>
                        <td style={{ padding: '7px 14px', fontWeight: 600, color: BRAND.teal }}>${fmt(row.avg, 0)}</td>
                        <td style={{ padding: '7px 14px', color: BRAND.gold }}>{cp ? `$${fmt(cp, 0)}` : '—'}</td>
                        <td style={{ padding: '7px 14px', fontWeight: 600, color: diff == null ? 'var(--text-tertiary)' : diff >= 0 ? BRAND.green : BRAND.red }}>
                          {diff == null ? '—' : `${diff >= 0 ? '+' : ''}$${fmt(diff, 0)}`}
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
