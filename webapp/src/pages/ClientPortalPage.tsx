import { useState, useEffect, useCallback } from 'react';
import {
  Sun,
  DollarSign,
  Leaf,
  ShieldCheck,
  Wrench,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Award,
  Calendar,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmt, healthInfo, calcCO2 } from '../lib/utils';
import type { Plant, PlantKpi } from '../types/api';

const CELSIA_CU_REF = 964.13; // COP/kWh tarifa plena Celsia Valle del Cauca
const CELSIA_AGPE_CREDIT_REF = 817.07; // COP/kWh crédito AGPE Tipo 1 (CU - C)

interface WorkOrderRow {
  id: string;
  plant_code: string;
  tipo: string;
  estado: string;
  titulo: string;
  descripcion?: string;
  tecnico_nombre?: string;
  fecha_ejecucion: string;
}

interface InvoiceRow {
  id: string;
  company: string;
  plant_code: string;
  plant_name: string;
  period: string;
  kwh_billed: number;
  price_cop_kwh: number;
  total_cop: number;
  difference_kwh: number | null;
  status: 'pending' | 'ok' | 'discrepancy' | 'critical';
}

export default function ClientPortalPage() {
  const { user, setRoleView } = useAuth();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [kpiMap, setKpiMap] = useState<Record<string, PlantKpi>>({});
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | undefined>();
  const [selectedCode, setSelectedCode] = useState<string>(user.assignedPlantCode || 'ALL');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, ordersRes, invRes] = await Promise.all([
        api.getSummary(),
        api.getMaintenanceOrders().catch(() => ({ success: false, total: 0, orders: [] })),
        fetch('/api/invoices')
          .then(r => (r.ok ? r.json() : { invoices: [] }))
          .catch(() => ({ invoices: [] })),
      ]);
      setPlants(summaryRes.plants ?? []);
      const map: Record<string, PlantKpi> = {};
      for (const k of summaryRes.kpis ?? []) {
        const code = k.plantCode || k.stationCode || '';
        if (code) map[code] = k;
      }
      setKpiMap(map);
      setOrders((ordersRes.orders ?? []) as WorkOrderRow[]);
      setInvoices((invRes.invoices ?? []) as InvoiceRow[]);
      setLastUpdated(summaryRes.lastUpdated);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredPlants =
    selectedCode === 'ALL'
      ? plants
      : plants.filter(p => p.plantCode === selectedCode);

  const filteredOrders =
    selectedCode === 'ALL'
      ? orders
      : orders.filter(o => o.plant_code === selectedCode);

  const filteredInvoices =
    selectedCode === 'ALL'
      ? invoices
      : invoices.filter(i => i.plant_code === selectedCode);

  // Agregados del cliente seleccionado
  const totalCapKwp = filteredPlants.reduce((acc, p) => acc + (p.capacity || 0), 0);
  const totalDayKwh = filteredPlants.reduce(
    (acc, p) => acc + Number(kpiMap[p.plantCode]?.dataItemMap?.day_power || 0),
    0
  );
  const totalMonthKwh = filteredPlants.reduce(
    (acc, p) => acc + Number(kpiMap[p.plantCode]?.dataItemMap?.month_power || 0),
    0
  );
  const totalLifeKwh = filteredPlants.reduce(
    (acc, p) => acc + Number(kpiMap[p.plantCode]?.dataItemMap?.total_power || 0),
    0
  );

  // Ahorro económico valorado a tarifa Celsia CU ($964.13 COP/kWh autoconsumo + crédito AGPE)
  const monthSavingsCop = Math.round(totalMonthKwh * CELSIA_CU_REF);
  const lifeSavingsCop = Math.round(totalLifeKwh * CELSIA_CU_REF);

  // Sostenibilidad oficial Res. UPME 000085 de 2024 (0.220 tCO2eq/MWh)
  const monthCo2Ton = calcCO2(totalMonthKwh);
  const lifeCo2Ton = calcCO2(totalLifeKwh);
  const treesEq = Math.round((lifeCo2Ton * 1000) / 21.77);

  const handleSelectPlant = (code: string) => {
    setSelectedCode(code);
    setRoleView('cliente', code === 'ALL' ? null : code);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Header lastUpdated={lastUpdated} onRefresh={loadData} loading={loading} />

      {/* ── Banner Ejecutivo Portal Cliente B2B ────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '20px 24px',
          background: 'linear-gradient(135deg, #0F2440 0%, #163358 60%, #1E4620 100%)',
          color: '#F8FAFC',
          border: 'none',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                padding: '3px 9px',
                borderRadius: 99,
                background: 'rgba(88,174,50,0.22)',
                color: '#86EFAC',
                border: '1px solid rgba(134,239,172,0.3)',
              }}
            >
              Portal Cliente B2B · Contrato O&M SOLGER
            </span>
            <span style={{ fontSize: 11.5, color: '#CBD5E1' }}>
              Certificación IEC 61724-1 · UPME 2024 · CREG 174/2021
            </span>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#FFFFFF' }}>
            Estado de Activos Solares y Retorno Energético
          </h1>
          <p style={{ fontSize: 12.5, color: '#CBD5E1', margin: '4px 0 0 0' }}>
            Seguimiento transparente de generación solar, ahorro en factura Celsia y mantenimiento preventivo ejecutado por SOLGER.
          </p>
        </div>

        {/* Selector de Planta del Cliente */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 260 }}>
          <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>
            Planta / Sede del Cliente:
          </label>
          <select
            value={selectedCode}
            onChange={e => handleSelectPlant(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(15,23,42,0.65)',
              color: '#F8FAFC',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <option value="ALL">Todas las plantas asignadas ({plants.length})</option>
            {plants.map(p => (
              <option key={p.plantCode} value={p.plantCode}>
                {p.plantName} ({fmt(p.capacity, 1)} kWp)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── 4 Tarjetas Ejecutivas para el Dueño de Planta ──────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        {/* Energía Generada */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                Energía Solar este Mes
              </span>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
                {fmt(totalMonthKwh, 0)} <span style={{ fontSize: 14, fontWeight: 600, color: '#64748B' }}>kWh</span>
              </div>
            </div>
            <div style={{ padding: 10, borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#D97706' }}>
              <Sun size={20} />
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
            <span>Hoy: <strong>{fmt(totalDayKwh, 1)} kWh</strong></span>
            <span>Histórico: <strong>{fmt(totalLifeKwh / 1000, 1)} MWh</strong></span>
          </div>
        </div>

        {/* Ahorro Económico Celsia */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                Ahorro Estimado Mes (Tarifa CU)
              </span>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#16A34A', marginTop: 4 }}>
                ${fmt(monthSavingsCop, 0)} <span style={{ fontSize: 13, fontWeight: 600, color: '#64748B' }}>COP</span>
              </div>
            </div>
            <div style={{ padding: 10, borderRadius: 10, background: 'rgba(22,163,74,0.1)', color: '#16A34A' }}>
              <DollarSign size={20} />
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
            <span>CU Ref: <strong>${CELSIA_CU_REF}/kWh</strong></span>
            <span>Acumulado: <strong>${fmt(lifeSavingsCop / 1_000_000, 1)}M COP</strong></span>
          </div>
        </div>

        {/* Huella de Carbono Oficial UPME */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                CO₂ Evitado (Certificable UPME)
              </span>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
                {fmt(lifeCo2Ton, 2)} <span style={{ fontSize: 14, fontWeight: 600, color: '#64748B' }}>tCO₂eq</span>
              </div>
            </div>
            <div style={{ padding: 10, borderRadius: 10, background: 'rgba(16,185,129,0.1)', color: '#059669' }}>
              <Leaf size={20} />
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
            <span>Este mes: <strong>{fmt(monthCo2Ton, 2)} tCO₂</strong></span>
            <span>Equiv: <strong>{fmt(treesEq, 0)} árboles</strong></span>
          </div>
        </div>

        {/* Potencia Instalada y Respaldo O&M */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                Capacidad Solar Activa
              </span>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
                {fmt(totalCapKwp, 1)} <span style={{ fontSize: 14, fontWeight: 600, color: '#64748B' }}>kWp</span>
              </div>
            </div>
            <div style={{ padding: 10, borderRadius: 10, background: 'rgba(59,130,246,0.1)', color: '#2563EB' }}>
              <ShieldCheck size={20} />
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
            <span>Crédito AGPE: <strong>${CELSIA_AGPE_CREDIT_REF}/kWh</strong></span>
            <span>Visitas O&M: <strong>{filteredOrders.length}</strong></span>
          </div>
        </div>
      </div>

      {/* ── Estado de las Plantas del Cliente ──────────────────────────── */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={18} color="#3D8A1F" />
            <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>
              Resumen Operativo por Planta Solar
            </h2>
          </div>
          <span style={{ fontSize: 12, color: '#64748B' }}>
            Monitoreo continuo 24/7 por Centro de Operaciones SOLGER
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', textAlign: 'left', color: '#64748B', fontSize: 11.5 }}>
                <th style={{ padding: '10px 8px' }}>Planta / Sede</th>
                <th style={{ padding: '10px 8px' }}>Estado</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Capacidad (kWp)</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Generación Hoy</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Generación Mes</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Ahorro Mes (COP)</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Cumplimiento P50</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlants.map(p => {
                const dm = kpiMap[p.plantCode]?.dataItemMap;
                const h = healthInfo(dm?.real_health_state);
                const dayKwh = Number(dm?.day_power || 0);
                const monthKwh = Number(dm?.month_power || 0);
                const pr = Number(dm?.performance_ratio || 0);
                const savings = Math.round(monthKwh * CELSIA_CU_REF);
                return (
                  <tr key={p.plantCode} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '11px 8px', fontWeight: 600, color: '#0F172A' }}>
                      {p.plantName}
                      {p.capacityEstimated && (
                        <span
                          title="Capacidad efectiva estimada por histórico P90"
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: '#F1F5F9',
                            color: '#475569',
                          }}
                        >
                          kWp P90
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '11px 8px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '3px 9px',
                          borderRadius: 99,
                          fontSize: 11.5,
                          fontWeight: 600,
                          background: h.bg,
                          color: h.color,
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: h.color }} />
                        {h.label}
                      </span>
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600 }}>
                      {fmt(p.capacity, 1)} kWp
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right' }}>
                      {fmt(dayKwh, 1)} kWh
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600 }}>
                      {fmt(monthKwh, 0)} kWh
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 700, color: '#16A34A' }}>
                      ${fmt(savings, 0)}
                    </td>
                    <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600 }}>
                      {pr > 0 ? `${fmt(pr, 1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dos Columnas: Bitácora O&M y Auditoría de Facturas Celsia ──── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {/* Bitácora de Mantenimiento O&M */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Wrench size={17} color="#3D8A1F" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
              Bitácora de Mantenimiento O&M SOLGER
            </h3>
          </div>
          {filteredOrders.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748B', fontSize: 13 }}>
              <CheckCircle2 size={28} color="#16A34A" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontWeight: 600, color: '#0F172A' }}>
                Sin intervenciones pendientes
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
                Todas las actividades de seguimiento telemétrico se encuentran al día.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredOrders.slice(0, 6).map(order => (
                <div
                  key={order.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                      {order.titulo}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                      {order.descripcion || `Intervención tipo ${order.tipo}`} · Técnico: {order.tecnico_nombre || 'Equipo O&M SOLGER'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 99,
                        background: 'rgba(22,163,74,0.12)',
                        color: '#16A34A',
                      }}
                    >
                      {order.estado}
                    </span>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Calendar size={10} />
                      {order.fecha_ejecucion}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Auditoría de Facturación Celsia */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Receipt size={17} color="#3D8A1F" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
              Auditoría de Facturación Celsia (CREG 174)
            </h3>
          </div>
          {filteredInvoices.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748B', fontSize: 13 }}>
              <Award size={28} color="#2563EB" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontWeight: 600, color: '#0F172A' }}>
                Auditoría Energética Activa
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>
                Cuando Celsia emita la factura del ciclo, el Centro de Operaciones SOLGER verificará cada kWh exportado contra el medidor inteligente.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredInvoices.slice(0, 6).map(inv => (
                <div
                  key={inv.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                      {inv.company} · Periodo {inv.period}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                      {inv.plant_name} · Facturado: {fmt(inv.kwh_billed, 1)} kWh a ${fmt(inv.price_cop_kwh, 2)}/kWh
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {inv.status === 'ok' ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#16A34A', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 size={12} /> Conciliado OK
                      </span>
                    ) : inv.status === 'pending' ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>En verificación</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#D97706', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={12} /> Dif: {fmt(inv.difference_kwh || 0, 1)} kWh
                      </span>
                    )}
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                      ${fmt(inv.total_cop, 0)} COP
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
