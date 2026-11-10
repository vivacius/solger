import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Receipt, Plus, CheckCircle, AlertTriangle, XCircle,
  Clock, Trash2, Zap, RefreshCw, X, FileText,
  Download, ShieldAlert, Sparkles, Check, UploadCloud, Building2, Layers,
  ChevronDown, ChevronUp, Filter, RotateCcw
} from 'lucide-react';
import { BRAND, fmt, fmtEnergy } from '../lib/utils';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { Header } from '../components/layout/Header';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AuditData {
  period_start: string;
  period_end: string;
  days: number;
  imp_celsia: number;
  imp_fusion: number;
  exc_celsia: number;
  exc_fusion: number;
  gen_fusion: number;
  self_fusion: number;
  load_fusion: number;
  exc_1_kwh: number;
  exc_2_kwh: number;
  net_celsia: number;
  net_fusion: number;
  cu_rate: number;
  c_rate: number;
  t1_rate: number;
  xm_spot_price: number;
  val_neto_celsia?: number;
  val_com_celsia?: number;
  val_contrib_celsia?: number;
  costo_neto_fusion?: number;
  comercializacion_fusion?: number;
  contrib_fusion?: number;
  remun_exc1_cop: number;
  remun_exc2_cop: number;
  has_contrib: boolean;
  subtotal_celsia: number;
  subtotal_fusion_creg: number;
  sobrecosto_cop: number;
  daily_series?: Array<{
    fecha: string;
    PVYield: number;
    selfUsePower: number;
    ongrid_power: number;
    buyPower: number;
    use_power: number;
  }>;
}

interface Invoice {
  id: string;
  company: string;
  plant_code: string;
  plant_name: string;
  period: string;
  period_start?: string | null;
  period_end?: string | null;
  days_billed?: number | null;
  client_name?: string | null;
  account_code?: string | null;
  invoice_number?: string | null;
  meter_number?: string | null;
  reading_previous_kwh?: number | null;
  reading_current_kwh?: number | null;
  multiplier?: number | null;
  consumo_importado_cop?: number | null;
  credito_energia_cop?: number | null;
  consumo_neto_kwh?: number | null;
  subtotal_active_cop?: number | null;
  comercializacion_cop?: number | null;
  subsidy_or_contrib_cop?: number | null;
  ajuste_decenas_cop?: number | null;
  subtotal_energia_cop?: number | null;
  otros_cobros_cop?: number | null;
  total_pagar_cop?: number | null;
  componentes_cu?: Record<string, number> | null;
  kwh_billed: number;
  exc_celsia?: number | null;
  credito_energia_kwh?: number | null;
  price_cop_kwh: number;
  c_rate?: number | null;
  total_cop: number;
  notes: string;
  fusion_kwh: number | null;
  gen_kwh?: number | null;
  export_kwh?: number | null;
  import_kwh?: number | null;
  difference_kwh: number | null;
  difference_cop: number | null;
  status: 'pending' | 'ok' | 'discrepancy' | 'critical';
  created_at: string;
  verified_at: string | null;
  audit?: AuditData | null;
}

const BASE = '/api';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_MAP = {
  pending:     { label: 'Pendiente Auditoría', color: '#64748B', bg: '#F1F5F9', icon: Clock },
  ok:          { label: 'Conciliado OK ✓',     color: '#166534', bg: '#DCFCE7', icon: CheckCircle },
  discrepancy: { label: 'Discrepancia Menor',   color: '#854D0E', bg: '#FEF9C3', icon: AlertTriangle },
  critical:    { label: 'Cobro en Exceso',     color: '#991B1B', bg: '#FEE2E2', icon: XCircle },
};

const CU_PARTS = [
  { key: 'G_generacion',       short: 'G',  label: 'Generación',       color: '#2563EB' },
  { key: 'D_distribucion',     short: 'D',  label: 'Distribución',     color: '#0D9488' },
  { key: 'C_comercializacion', short: 'C',  label: 'Comercialización', color: '#F59E0B' },
  { key: 'PR_perdidas',        short: 'PR', label: 'Pérdidas',         color: '#8B5CF6' },
  { key: 'T_transmision',      short: 'T',  label: 'Transmisión',      color: '#10B981' },
  { key: 'R_restricciones',    short: 'R',  label: 'Restricciones',    color: '#EC4899' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtCOP = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

const fmtCOPDec = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPeriod = (p: string) => {
  if (!p) return '—';
  const [y, m] = p.split('-');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${months[parseInt(m, 10) - 1] ?? m} ${y}`;
};

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function InvoicePage() {
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [auditingId, setAuditingId] = useState<string | null>(null);

  const { data: summaryData } = useFetch(api.getSummary, []);
  const plants = summaryData?.plants ?? [];

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/invoices`);
      const d = await r.json();
      setInvoices(d.invoices ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const handleAudit = async (inv: Invoice) => {
    setAuditingId(inv.id);
    try {
      const r = await fetch(`${BASE}/invoices/${inv.id}/audit`, { method: 'POST' });
      if (!r.ok) {
        const text = await r.text();
        let errMsg = `Error del servidor (${r.status})`;
        try {
          const errJson = JSON.parse(text);
          errMsg = errJson.detail || errJson.message || errMsg;
        } catch {
          if (text) errMsg = text.slice(0, 150);
        }
        alert(`Error en auditoría: ${errMsg}`);
        return;
      }
      const d = await r.json();
      if (d?.success && d.invoice) {
        setInvoices(prev => prev.map(item => item.id === inv.id ? d.invoice : item));
      }
    } catch (e: any) {
      console.error('Error auditando factura:', e);
      alert(`Error en auditoría: ${e?.message || e}`);
    } finally {
      setAuditingId(null);
    }
  };

  const handleDownloadPdfReport = (inv: Invoice) => {
    window.open(`${BASE}/invoices/${inv.id}/report/html?download=1`, '_blank');
  };

  const handleDownloadExcel = (inv: Invoice) => {
    window.open(`${BASE}/invoices/${inv.id}/report/excel`, '_blank');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta factura del historial?')) return;
    await fetch(`${BASE}/invoices/${id}`, { method: 'DELETE' });
    setInvoices(prev => prev.filter(i => i.id !== id));
  };

  // ─── Filtros de Plantas y Fechas + Modo Expandir/Minimizar ───
  const [selectedPlant, setSelectedPlant] = useState<string>('ALL');
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Auto-expandir si hay 1 o 2 facturas
  useEffect(() => {
    if (invoices.length > 0 && expandedIds.size === 0) {
      if (invoices.length <= 2) {
        setExpandedIds(new Set(invoices.map(i => i.id)));
      }
    }
  }, [invoices]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = (ids: string[]) => {
    setExpandedIds(new Set(ids));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Opciones únicas de plantas
  const plantOptions = useMemo(() => {
    return Array.from(
      new Set([
        ...plants.map((p: any) => p.plantName || p.plant_name || p.name).filter(Boolean),
        ...invoices.map(i => i.plant_name).filter(Boolean),
      ])
    ).sort();
  }, [plants, invoices]);

  // Opciones únicas de años
  const yearOptions = useMemo(() => {
    return Array.from(
      new Set(
        invoices
          .map(i => i.period?.slice(0, 4) || i.period_start?.slice(0, 4))
          .filter(Boolean)
      )
    ).sort().reverse();
  }, [invoices]);

  const monthOptions = [
    { value: '01', label: '01 - Enero' },
    { value: '02', label: '02 - Febrero' },
    { value: '03', label: '03 - Marzo' },
    { value: '04', label: '04 - Abril' },
    { value: '05', label: '05 - Mayo' },
    { value: '06', label: '06 - Junio' },
    { value: '07', label: '07 - Julio' },
    { value: '08', label: '08 - Agosto' },
    { value: '09', label: '09 - Septiembre' },
    { value: '10', label: '10 - Octubre' },
    { value: '11', label: '11 - Noviembre' },
    { value: '12', label: '12 - Diciembre' },
  ];

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (selectedPlant !== 'ALL') {
        const pName = (inv.plant_name || '').toLowerCase();
        if (pName !== selectedPlant.toLowerCase()) return false;
      }
      const invYear = inv.period?.slice(0, 4) || inv.period_start?.slice(0, 4) || '';
      if (selectedYear !== 'ALL' && invYear !== selectedYear) {
        return false;
      }
      const invMonth = inv.period?.slice(5, 7) || inv.period_start?.slice(5, 7) || '';
      if (selectedMonth !== 'ALL' && invMonth !== selectedMonth) {
        return false;
      }
      return true;
    });
  }, [invoices, selectedPlant, selectedYear, selectedMonth]);

  const hasActiveFilters = selectedPlant !== 'ALL' || selectedYear !== 'ALL' || selectedMonth !== 'ALL';

  const total        = invoices.length;
  const pending      = invoices.filter(i => i.status === 'pending').length;
  const issues       = invoices.filter(i => i.status === 'discrepancy' || i.status === 'critical').length;
  const totalOverbillCOP = invoices.reduce((s, i) => s + (i.audit?.sobrecosto_cop ?? i.difference_cop ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Header onRefresh={fetchInvoices} loading={loading} />

      {/* ── Encabezado de página ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Auditoría Integral de Facturas y Post-Venta (CREG 174 / AGPE)
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>
            Cotejo automático de recibos PDF de Celsia contra telemetría de FusionSolar y precios spot de bolsa XM (Excedentes Tipo 1 y 2)
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: BRAND.green, color: '#fff', border: 'none', cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(88,174,50,0.3)',
            transition: 'all 0.15s',
          }}
        >
          <Plus size={15} /> Subir / Auditar Factura PDF
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ── KPI Cards ──────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          {[
            { label: 'Facturas Auditadas', value: String(total), icon: Receipt, color: BRAND.teal },
            { label: 'Sin Auditar', value: String(pending), icon: Clock, color: '#94A3B8' },
            { label: 'Con Sobrecosto', value: String(issues), icon: AlertTriangle, color: BRAND.gold },
            {
              label: 'Sobrecosto Acumulado',
              value: totalOverbillCOP === 0 ? '—' : fmtCOP(totalOverbillCOP),
              icon: Zap,
              color: totalOverbillCOP > 0 ? BRAND.red : BRAND.green,
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={14} color={color} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
              </div>
              <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* ── Barra de Filtros y Controles de Acordeón ────────────── */}
        <div className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: BRAND.teal, fontWeight: 700, fontSize: 13, marginRight: 2 }}>
              <Filter size={15} /> Filtros:
            </div>

            {/* Planta */}
            <select
              value={selectedPlant}
              onChange={e => setSelectedPlant(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 7, border: `1px solid ${BRAND.border}`,
                background: BRAND.surface, fontSize: 12, fontWeight: 600, color: BRAND.text,
                cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="ALL">Todas las plantas ({plantOptions.length})</option>
              {plantOptions.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            {/* Año */}
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 7, border: `1px solid ${BRAND.border}`,
                background: BRAND.surface, fontSize: 12, fontWeight: 600, color: BRAND.text,
                cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="ALL">Todos los años</option>
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            {/* Mes */}
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 7, border: `1px solid ${BRAND.border}`,
                background: BRAND.surface, fontSize: 12, fontWeight: 600, color: BRAND.text,
                cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="ALL">Todos los meses</option>
              {monthOptions.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                onClick={() => { setSelectedPlant('ALL'); setSelectedYear('ALL'); setSelectedMonth('ALL'); }}
                title="Restablecer filtros"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
                  borderRadius: 6, border: `1px solid ${BRAND.border}`,
                  background: '#0F172A08', color: 'var(--text-secondary)',
                  fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <RotateCcw size={12} /> Limpiar filtros
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
              Mostrando <strong style={{ color: BRAND.text }}>{filteredInvoices.length}</strong> de {invoices.length} facturas
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => expandAll(filteredInvoices.map(i => i.id))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '5px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  background: `${BRAND.teal}14`, color: BRAND.teal, border: `1px solid ${BRAND.teal}30`,
                  cursor: 'pointer',
                }}
              >
                <ChevronDown size={13} /> Expandir todo
              </button>
              <button
                onClick={collapseAll}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '5px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  background: '#0F172A08', color: 'var(--text-secondary)', border: `1px solid ${BRAND.border}`,
                  cursor: 'pointer',
                }}
              >
                <ChevronUp size={13} /> Colapsar todo
              </button>
            </div>
          </div>
        </div>

        {/* ── Lista de facturas ───────────────────────────────────── */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 40, fontSize: 13 }}>
            Cargando historial de facturas y auditorías…
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <Receipt size={42} color="var(--text-tertiary)" style={{ margin: '0 auto 14px' }} />
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              {invoices.length === 0 ? 'Sin facturas registradas en el portafolio' : 'Ninguna factura coincide con los filtros aplicados'}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', maxWidth: 460, margin: '0 auto' }}>
              {invoices.length === 0
                ? 'Haz clic en Subir / Auditar Factura PDF para cargar cualquier recibo de Celsia (formatos 2025 o 2026 CCTT).'
                : 'Intenta cambiar o limpiar los filtros de planta, año o mes para visualizar otras facturas.'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={() => { setSelectedPlant('ALL'); setSelectedYear('ALL'); setSelectedMonth('ALL'); }}
                style={{
                  marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                  background: BRAND.teal, color: '#fff', border: 'none', cursor: 'pointer',
                }}
              >
                <RotateCcw size={13} /> Restablecer filtros
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredInvoices.map(inv => {
              const st = STATUS_MAP[inv.status] || STATUS_MAP.pending;
              const StatusIcon = st.icon;
              const audit = inv.audit;
              const cu = inv.componentes_cu;
              const isAuditing = auditingId === inv.id;
              const sobrecosto = audit?.sobrecosto_cop ?? inv.difference_cop ?? 0;
              const hasCriticalExcess = sobrecosto > 50000;
              const isExpanded = expandedIds.has(inv.id);

              return (
                <div
                  key={inv.id}
                  className="card"
                  style={{
                    padding: isExpanded ? '18px 22px' : '12px 18px',
                    borderLeft: `5px solid ${hasCriticalExcess ? BRAND.red : (audit ? BRAND.green : BRAND.border)}`,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* ── Fila de Encabezado / Resumen (Clic para expandir/colapsar) ── */}
                  <div
                    onClick={() => toggleExpand(inv.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      cursor: 'pointer',
                      userSelect: 'none',
                      flexWrap: 'wrap',
                    }}
                  >
                    {/* Identificación: Chevron + Empresa · Planta · Periodo · Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 280 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: isExpanded ? `${BRAND.teal}18` : '#0F172A08',
                          color: isExpanded ? BRAND.teal : 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 800, fontSize: 14.5, color: BRAND.text }}>{inv.company}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>·</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: BRAND.teal }}>{inv.plant_name}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>·</span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{fmtPeriod(inv.period)}</span>
                          <span style={{
                            fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                            background: st.bg, color: st.color,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            <StatusIcon size={11} /> {st.label}
                          </span>
                        </div>

                        {/* Metadatos extraídos del PDF en línea */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, fontSize: 11, color: BRAND.muted, flexWrap: 'wrap' }}>
                          {inv.invoice_number && <span>Factura: <strong>{inv.invoice_number}</strong></span>}
                          {inv.account_code && <span>Cuenta: <strong>{inv.account_code}</strong></span>}
                          {inv.meter_number && <span>Medidor: <strong>{inv.meter_number}</strong></span>}
                          {inv.period_start && inv.period_end && (
                            <span>Ciclo: <strong>{inv.period_start} → {inv.period_end}</strong> ({inv.days_billed ?? 30}d)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Resumen Métricas + Discrepancia CREG 174 + Acciones */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right', paddingRight: 4 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Consumo Red
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.text }}>
                          {fmtEnergy(inv.kwh_billed)} kWh
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', paddingRight: 4 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Subtotal Energía
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.text }}>
                          {fmtCOP(inv.subtotal_energia_cop ?? inv.total_pagar_cop ?? 0)}
                        </div>
                      </div>

                      {/* Dictamen CREG 174 Pill */}
                      <div style={{ textAlign: 'right', minWidth: 105 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          Auditoría CREG
                        </div>
                        {audit ? (
                          sobrecosto > 0 ? (
                            <span style={{
                              fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 6,
                              background: '#FEF2F2', color: BRAND.red, display: 'inline-block',
                            }}>
                              🔴 +{fmtCOP(sobrecosto)}
                            </span>
                          ) : (
                            <span style={{
                              fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 6,
                              background: '#F0FDF4', color: BRAND.greenD, display: 'inline-block',
                            }}>
                              🟢 Conforme ($0)
                            </span>
                          )
                        ) : (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                            background: '#0F172A08', color: 'var(--text-secondary)', display: 'inline-block',
                          }}>
                            ⚪ Sin auditar
                          </span>
                        )}
                      </div>

                      {/* Botones de acción directos (stopPropagation para no desplegar al dar click) */}
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}
                      >
                        <button
                          onClick={() => handleAudit(inv)}
                          disabled={isAuditing}
                          title="Cruzar contra FusionSolar y XM CREG 174"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '6px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
                            background: `${BRAND.teal}18`, color: BRAND.teal, border: `1px solid ${BRAND.teal}40`,
                            cursor: 'pointer',
                          }}
                        >
                          <RefreshCw size={11} style={{ animation: isAuditing ? 'spin-slow 1s linear infinite' : 'none' }} />
                          {audit ? 'Re-auditar' : 'Auditar'}
                        </button>

                        <button
                          onClick={() => handleDownloadPdfReport(inv)}
                          title="Descargar dictamen pericial en PDF directamente"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '6px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
                            background: `${BRAND.green}18`, color: BRAND.greenD, border: `1px solid ${BRAND.green}50`,
                            cursor: 'pointer',
                          }}
                        >
                          <Download size={12} />
                          PDF
                        </button>

                        <button
                          onClick={() => handleDownloadExcel(inv)}
                          title="Descargar libro Excel (.xlsx) con fórmulas vivas"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '6px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
                            background: '#0F172A10', color: BRAND.text, border: `1px solid ${BRAND.border}`,
                            cursor: 'pointer',
                          }}
                        >
                          <Download size={12} />
                          Excel
                        </button>

                        <button
                          onClick={() => handleDelete(inv.id)}
                          style={{
                            width: 29, height: 29, borderRadius: 6,
                            background: '#FEE2E220', border: '1px solid #FEE2E280',
                            color: BRAND.red, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                          title="Eliminar factura"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── CONTENIDO DETALLADO EXPANDIDO ── */}
                  {isExpanded && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BRAND.border}` }}>
                      {/* ── SEMÁFORO Y DICTAMEN DE AUDITORÍA ── */}
                      {audit && (
                    <div style={{
                      marginTop: 14,
                      padding: '12px 16px',
                      borderRadius: 10,
                      background: hasCriticalExcess ? '#FEF2F2' : '#F0FDF4',
                      border: `1.5px solid ${hasCriticalExcess ? '#F87171' : '#86EFAC'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 8,
                          background: hasCriticalExcess ? '#DC2626' : '#16A34A',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {hasCriticalExcess ? <ShieldAlert size={20} /> : <Check size={20} />}
                        </div>
                        <div>
                          <p style={{
                            margin: 0, fontSize: 13, fontWeight: 800,
                            color: hasCriticalExcess ? '#991B1B' : '#166534',
                          }}>
                            {hasCriticalExcess
                              ? `🔴 COBRO EN EXCESO DETECTADO: +${fmtCOP(sobrecosto)} COP A FAVOR DEL CLIENTE`
                              : '🟢 FACTURA CONCILIADA DENTRO DEL MARGEN OPERATIVO PERMITIDO'}
                          </p>
                          <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: hasCriticalExcess ? '#7F1D1D' : '#14532D' }}>
                            {hasCriticalExcess
                              ? `Celsia facturó ${fmtEnergy(audit.imp_celsia)} importados y reconoció ${fmtEnergy(audit.exc_celsia)} de excedentes. Telemetría FusionSolar registró ${fmtEnergy(audit.imp_fusion)} importados y ${fmtEnergy(audit.exc_fusion)} exportados.`
                              : `La discrepancia entre la factura de ${inv.company} y la telemetría de ${inv.plant_name} no excede el umbral técnico de pérdidas de línea.`}
                          </p>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: hasCriticalExcess ? '#991B1B' : '#166534', textTransform: 'uppercase', display: 'block' }}>
                          Impacto Financiero
                        </span>
                        <span style={{ fontSize: 18, fontWeight: 900, color: hasCriticalExcess ? '#B91C1C' : '#15803D' }}>
                          {hasCriticalExcess ? `+${fmtCOP(sobrecosto)}` : fmtCOP(sobrecosto)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* ── TABLA COMPARATIVA CONCILIACIÓN CREG 174 ── */}
                  {audit && (() => {
                    const valNetoC = audit.val_neto_celsia ?? Math.round(audit.net_celsia * audit.cu_rate);
                    const valComC  = audit.val_com_celsia ?? Math.round(audit.exc_celsia * audit.c_rate);
                    const valConC  = audit.val_contrib_celsia ?? (audit.has_contrib ? Math.round(valNetoC * 0.20) : 0);
                    const valNetoF = audit.costo_neto_fusion ?? Math.round(audit.net_fusion * audit.cu_rate);
                    const valComF  = audit.comercializacion_fusion ?? Math.round(audit.exc_1_kwh * audit.c_rate);
                    const valConF  = audit.contrib_fusion ?? (audit.has_contrib ? Math.round(valNetoF * 0.20) : 0);

                    return (
                      <div style={{ marginTop: 14, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#0F172A', color: '#fff', textAlign: 'left' }}>
                              <th style={{ padding: '8px 12px', borderRadius: '6px 0 0 0' }}>Concepto Técnico / CREG 174</th>
                              <th style={{ padding: '8px 12px' }}>Factura {inv.company}</th>
                              <th style={{ padding: '8px 12px' }}>Telemetría FusionSolar</th>
                              <th style={{ padding: '8px 12px' }}>Diferencia</th>
                              <th style={{ padding: '8px 12px', borderRadius: '0 6px 0 0' }}>Observación Regulatoria</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>Consumo Importado (kWh)</td>
                              <td style={{ padding: '8px 12px', background: '#FFFBEB', fontWeight: 700 }}>{fmtEnergy(audit.imp_celsia)}</td>
                              <td style={{ padding: '8px 12px', background: '#F0FDF4', fontWeight: 700 }}>{fmtEnergy(audit.imp_fusion)}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: (audit.imp_celsia - audit.imp_fusion) > 10 ? BRAND.red : BRAND.green }}>
                                {(audit.imp_celsia - audit.imp_fusion) > 0 ? '+' : ''}{fmtEnergy(audit.imp_celsia - audit.imp_fusion)}
                              </td>
                              <td style={{ padding: '8px 12px', color: BRAND.muted, fontSize: 11 }}>Energía tomada de la red por frontera (Concepto 501).</td>
                            </tr>

                            <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>Excedentes Reconocidos Exp1 (kWh)</td>
                              <td style={{ padding: '8px 12px', background: '#FFFBEB', fontWeight: 700 }}>{fmtEnergy(audit.exc_celsia)}</td>
                              <td style={{ padding: '8px 12px', background: '#F0FDF4', fontWeight: 700 }}>{fmtEnergy(audit.exc_1_kwh)}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: (audit.exc_1_kwh - audit.exc_celsia) > 10 ? BRAND.green : BRAND.muted }}>
                                {(audit.exc_1_kwh - audit.exc_celsia) > 0 ? '+' : ''}{fmtEnergy(audit.exc_1_kwh - audit.exc_celsia)}
                              </td>
                              <td style={{ padding: '8px 12px', color: BRAND.muted, fontSize: 11 }}>Permuta de energía compensada a CU − C (${fmt(audit.t1_rate, 2)}/kWh).</td>
                            </tr>

                            <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>Excedentes Tipo 2 Exp2 (kWh)</td>
                              <td style={{ padding: '8px 12px', background: '#FFFBEB' }}>0,00 kWh</td>
                              <td style={{ padding: '8px 12px', background: '#F0FDF4', fontWeight: 700 }}>{fmtEnergy(audit.exc_2_kwh)}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: audit.exc_2_kwh > 0 ? BRAND.green : BRAND.muted }}>
                                +{fmtEnergy(audit.exc_2_kwh)}
                              </td>
                              <td style={{ padding: '8px 12px', color: BRAND.muted, fontSize: 11 }}>
                                Excedente mayor al importado · Precio Bolsa XM (${fmt(audit.xm_spot_price, 2)}/kWh).
                              </td>
                            </tr>

                            <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>Consumo Neto Facturable (kWh)</td>
                              <td style={{ padding: '8px 12px', background: '#FFFBEB', fontWeight: 700 }}>{fmtEnergy(audit.net_celsia)}</td>
                              <td style={{ padding: '8px 12px', background: '#F0FDF4', fontWeight: 700 }}>{fmtEnergy(audit.net_fusion)}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: (audit.net_celsia - audit.net_fusion) > 10 ? BRAND.red : BRAND.green }}>
                                {(audit.net_celsia - audit.net_fusion) > 0 ? '+' : ''}{fmtEnergy(audit.net_celsia - audit.net_fusion)}
                              </td>
                              <td style={{ padding: '8px 12px', color: BRAND.muted, fontSize: 11 }}>Importado − Excedente Tipo 1.</td>
                            </tr>

                            <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>1. Valor Consumo Neto ($)</td>
                              <td style={{ padding: '8px 12px', background: '#FFFBEB', fontWeight: 700 }}>{fmtCOP(valNetoC)}</td>
                              <td style={{ padding: '8px 12px', background: '#F0FDF4', fontWeight: 700 }}>{fmtCOP(valNetoF)}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: (valNetoC - valNetoF) > 1000 ? BRAND.red : BRAND.green }}>
                                {(valNetoC - valNetoF) > 0 ? '+' : ''}{fmtCOP(valNetoC - valNetoF)}
                              </td>
                              <td style={{ padding: '8px 12px', color: BRAND.muted, fontSize: 11 }}>Consumo Neto × Tarifa Plena CU (${fmt(audit.cu_rate, 2)}/kWh).</td>
                            </tr>

                            <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>2. (+) Comercialización Exp1 ($)</td>
                              <td style={{ padding: '8px 12px', background: '#FFFBEB', fontWeight: 700 }}>{fmtCOP(valComC)}</td>
                              <td style={{ padding: '8px 12px', background: '#F0FDF4', fontWeight: 700 }}>{fmtCOP(valComF)}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 700, color: BRAND.muted }}>
                                {(valComC - valComF) > 0 ? '+' : ''}{fmtCOP(valComC - valComF)}
                              </td>
                              <td style={{ padding: '8px 12px', color: BRAND.muted, fontSize: 11 }}>Excedentes Exp1 × Tarifa Comercialización C (${fmt(audit.c_rate, 2)}/kWh).</td>
                            </tr>

                            <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>3. (+) Contribución Industrial 20% ($)</td>
                              <td style={{ padding: '8px 12px', background: '#FFFBEB', fontWeight: 700 }}>{fmtCOP(valConC)}</td>
                              <td style={{ padding: '8px 12px', background: '#F0FDF4', fontWeight: 700 }}>{fmtCOP(valConF)}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: (valConC - valConF) > 1000 ? BRAND.red : BRAND.green }}>
                                {(valConC - valConF) > 0 ? '+' : ''}{fmtCOP(valConC - valConF)}
                              </td>
                              <td style={{ padding: '8px 12px', color: BRAND.muted, fontSize: 11 }}>20% exclusivamente sobre el Valor Consumo Neto.</td>
                            </tr>

                            <tr style={{ background: '#F8FAFC', fontWeight: 800 }}>
                              <td style={{ padding: '10px 12px', color: BRAND.text }}>(=) Subtotal Liquidado Energía ($)</td>
                              <td style={{ padding: '10px 12px', color: BRAND.text, fontSize: 13 }}>{fmtCOP(audit.subtotal_celsia)}</td>
                              <td style={{ padding: '10px 12px', color: BRAND.greenD, fontSize: 13 }}>{fmtCOP(audit.subtotal_fusion_creg)}</td>
                              <td style={{ padding: '10px 12px', color: sobrecosto > 0 ? BRAND.red : BRAND.greenD, fontSize: 13.5 }}>
                                {sobrecosto > 0 ? `+${fmtCOP(sobrecosto)}` : fmtCOP(sobrecosto)}
                              </td>
                              <td style={{ padding: '10px 12px', color: sobrecosto > 50000 ? BRAND.red : BRAND.greenD, fontSize: 11 }}>
                                {sobrecosto > 50000 ? 'Consumo Neto + Comercialización + Contribución 20%.' : 'Liquidación conforme a CREG 174.'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {/* ── Si no se ha auditado aún con el nuevo motor CREG 174 ── */}
                  {!audit && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10, marginTop: 14 }}>
                      {[
                        { label: 'kWh Facturados Celsia', value: fmtEnergy(inv.kwh_billed), color: 'var(--text-primary)' },
                        { label: 'Tarifa Plena (CU)', value: `$${fmt(inv.price_cop_kwh, 2)}/kWh`, color: BRAND.gold },
                        { label: 'Subtotal Energía Factura', value: fmtCOP(inv.subtotal_energia_cop ?? inv.total_cop), color: 'var(--text-primary)' },
                        { label: 'Estado', value: 'Listo para Auditar', color: BRAND.teal },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--bg-subtle)', border: `1px solid ${BRAND.border}` }}>
                          <p style={{ fontSize: 9.5, color: 'var(--text-tertiary)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</p>
                          <p style={{ fontSize: 13.5, fontWeight: 800, color, margin: 0 }}>{value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Barra visual de componentes CU si viene de PDF Celsia ── */}
                  {cu && Object.keys(cu).length > 0 && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: BRAND.surface, border: `1px solid ${BRAND.border}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: BRAND.text }}>
                          Desglose Tarifario Extraído del PDF (CU = G + C + T + D + PR + R):
                        </span>
                        <span style={{ fontSize: 10.5, color: BRAND.greenD, fontWeight: 700 }}>
                          Excedente Tipo 1 CREG 174 (CU − C): ${fmt(cu.tarifa_excedente_t1_agpe ?? (inv.price_cop_kwh - (cu.C_comercializacion || cu.C || 0)), 2)}/kWh
                        </span>
                      </div>
                      <div style={{ display: 'flex', height: 7, borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                        {CU_PARTS.map(part => {
                          const val = cu[part.key] || 0;
                          const pct = inv.price_cop_kwh > 0 ? (val / inv.price_cop_kwh) * 100 : 0;
                          return <div key={part.key} style={{ width: `${pct}%`, background: part.color }} title={`${part.label}: $${val}`} />;
                        })}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {CU_PARTS.map(part => {
                          const val = cu[part.key];
                          if (val == null) return null;
                          return (
                            <span key={part.key} style={{ fontSize: 10.5, color: BRAND.muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ width: 7, height: 7, borderRadius: 2, background: part.color, display: 'inline-block' }} />
                              <strong>{part.short}</strong> ({part.label}): <strong>${fmt(val, 2)}</strong>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {inv.notes && (
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, fontStyle: 'italic', margin: '8px 0 0 0' }}>
                      {inv.notes}
                    </p>
                  )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal nueva factura y auditoría ──────────────────────── */}
      {showModal && (
        <NewInvoiceModal
          plants={plants}
          onClose={() => setShowModal(false)}
          onAudited={() => { setShowModal(false); fetchInvoices(); }}
        />
      )}
    </div>
  );
}

// ─── Modal con Radiografía Visual del PDF Celsia y Desglose Completo ──────────
function NewInvoiceModal({ plants, onClose, onAudited }: {
  plants: any[];
  onClose: () => void;
  onAudited: () => void;
}) {
  const [form, setForm] = useState({
    company: 'Celsia',
    plant_code: plants[0]?.plantCode ?? '',
    plant_name: plants[0]?.plantName ?? '',
    period: new Date().toISOString().slice(0, 7),
    period_start: '',
    period_end: '',
    days_billed: null as number | null,
    client_name: '',
    account_code: '',
    invoice_number: '',
    meter_number: '',
    consumo_importado_cop: null as number | null,
    credito_energia_kwh: 0,
    credito_energia_cop: null as number | null,
    consumo_neto_kwh: null as number | null,
    subtotal_active_cop: null as number | null,
    comercializacion_cop: null as number | null,
    subsidy_or_contrib_cop: null as number | null,
    ajuste_decenas_cop: null as number | null,
    subtotal_energia_cop: null as number | null,
    otros_cobros_cop: null as number | null,
    total_pagar_cop: null as number | null,
    kwh_billed: '',
    price_cop_kwh: '',
    c_rate: 176.65,
    componentes_cu: null as Record<string, number> | null,
    has_agpe_template: false,
    notes: '',
  });

  const [saving, setSaving] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isAutoMatched, setIsAutoMatched] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Cálculo dinámico exacto: Consumo Neto ($) + Comercialización Exp1 ($) + Contribución 20% ($) + Ajuste a decenas
  const impKwhNum = parseFloat(form.kwh_billed || '0') || 0;
  const excKwhNum = Number(form.credito_energia_kwh || 0);
  const netKwhNum = form.consumo_neto_kwh ?? Math.max(0, Number((impKwhNum - excKwhNum).toFixed(2)));
  const cuNum     = parseFloat(form.price_cop_kwh || '0') || 0;
  const cRateNum  = Number(form.c_rate || form.componentes_cu?.C_comercializacion || 176.65);

  const valNetoCOP    = form.subtotal_active_cop ?? Number((netKwhNum * cuNum).toFixed(2));
  const valComCOP     = form.comercializacion_cop ?? Number((excKwhNum * cRateNum).toFixed(2));
  const valContribCOP = form.subsidy_or_contrib_cop ?? Number((valNetoCOP * 0.20).toFixed(2));
  const ajusteCOP     = form.ajuste_decenas_cop ?? 0;

  const subtotalEnergiaCOP = form.subtotal_energia_cop != null
    ? Math.round(form.subtotal_energia_cop)
    : Math.round(valNetoCOP + valComCOP + valContribCOP + ajusteCOP);

  const processPdfFile = async (file: File) => {
    setUploadedFileName(file.name);
    setParsingPdf(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/invoices/parse-pdf', { method: 'POST', body: fd });
      const d = await r.json();
      if (d?.success && d.parsed) {
        const p = d.parsed;
        const cycleNote = p.period_start && p.period_end
          ? `Extraído de ${file.name} · Ciclo Celsia: ${p.period_start} a ${p.period_end} (${p.days_billed ?? ''} días) · Cuenta ${p.account_code ?? ''} · Factura ${p.invoice_number ?? ''} · Medidor ${p.meter_number ?? ''}`
          : '';

        let chosenCode = form.plant_code;
        let chosenName = form.plant_name;
        let matchedFlag = false;

        if (p.matched_plant_code) {
          chosenCode = p.matched_plant_code;
          const found = plants.find(pl => pl.plantCode === chosenCode);
          chosenName = found?.plantName || p.matched_plant_name || chosenCode;
          matchedFlag = true;
        } else {
          // Si el cliente dice LECHERIA o PROCOA, preseleccionar LA LECHERÍA automáticamente
          const lecheria = plants.find(pl =>
            (pl.plantName || '').toUpperCase().includes('LECHER')
          );
          if (lecheria && ((p.client_name || '').toUpperCase().includes('LECHER') || (p.client_name || '').toUpperCase().includes('PROCOA'))) {
            chosenCode = lecheria.plantCode;
            chosenName = lecheria.plantName;
          }
        }

        setIsAutoMatched(matchedFlag);

        setForm(f => ({
          ...f,
          plant_code: chosenCode,
          plant_name: chosenName,
          company: p.company || f.company,
          period: p.period || f.period,
          period_start: p.period_start || '',
          period_end: p.period_end || '',
          days_billed: p.days_billed ?? null,
          client_name: p.client_name || '',
          account_code: p.account_code || '',
          invoice_number: p.invoice_number || '',
          meter_number: p.meter_number || '',
          consumo_importado_cop: p.consumo_importado_cop ?? null,
          credito_energia_kwh: p.credito_energia_kwh ?? 0,
          credito_energia_cop: p.credito_energia_cop ?? null,
          consumo_neto_kwh: p.consumo_neto_kwh ?? null,
          subtotal_active_cop: p.subtotal_active_cop ?? null,
          comercializacion_cop: p.comercializacion_cop ?? null,
          subsidy_or_contrib_cop: p.subsidy_or_contrib_cop ?? null,
          ajuste_decenas_cop: p.ajuste_decenas_cop ?? null,
          subtotal_energia_cop: p.subtotal_energia_cop ?? null,
          otros_cobros_cop: p.otros_cobros_cop ?? null,
          total_pagar_cop: p.total_pagar_cop ?? null,
          kwh_billed: p.kwh_billed != null ? String(p.kwh_billed) : f.kwh_billed,
          price_cop_kwh: p.price_cop_kwh != null ? String(p.price_cop_kwh) : f.price_cop_kwh,
          c_rate: p.c_rate ?? 176.65,
          componentes_cu: p.componentes_cu || null,
          has_agpe_template: Boolean(p.has_agpe_template),
          notes: cycleNote || f.notes,
        }));
      }
    } catch (err) {
      console.error('Error leyendo PDF Celsia:', err);
    } finally {
      setParsingPdf(false);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processPdfFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      await processPdfFile(file);
    }
  };

  const handlePlantChange = (code: string) => {
    const p = plants.find(p => p.plantCode === code);
    setForm(f => ({ ...f, plant_code: code, plant_name: p?.plantName ?? code }));
  };

  const handleSaveAndAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.kwh_billed || !form.price_cop_kwh) {
      alert('Por favor ingresa los kWh facturados y la tarifa CU.');
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch(`/api/invoices/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          kwh_billed: parseFloat(form.kwh_billed),
          price_cop_kwh: parseFloat(form.price_cop_kwh),
          exc_celsia: form.credito_energia_kwh,
          subtotal_active_cop: valNetoCOP,
          comercializacion_cop: valComCOP,
          subsidy_or_contrib_cop: valContribCOP,
          subtotal_energia_cop: subtotalEnergiaCOP,
          total_cop: subtotalEnergiaCOP,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        let errMsg = `Error del servidor (${resp.status})`;
        try {
          const errJson = JSON.parse(text);
          errMsg = errJson.detail || errJson.message || errMsg;
        } catch {
          if (text) errMsg = text.slice(0, 150);
        }
        alert(`Error en auditoría: ${errMsg}`);
        return;
      }
      const data = await resp.json();
      if (data?.success) {
        onAudited();
      } else {
        alert(`Error al auditar: ${data?.detail || 'Revisa la conexión de red'}`);
      }
    } catch (err: any) {
      alert(`Error en auditoría: ${err?.message}`);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5,
  };

  const cu = form.componentes_cu;
  const cuTotalNum = cuNum || 1;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(7,17,31,0.78)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 820, maxHeight: '94vh', overflowY: 'auto', padding: 0, borderRadius: 16, overflowX: 'hidden' }}>
        {/* ── Banner Superior Oscuro ── */}
        <div style={{
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
          padding: '18px 24px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '3px solid #58AE32',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(88,174,50,0.2)', border: '1px solid rgba(88,174,50,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#58AE32',
            }}>
              <Receipt size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#fff', margin: 0 }}>
                Auditoría Inteligente de Factura Celsia (CREG 174)
              </h2>
              <p style={{ fontSize: 11.5, color: '#94A3B8', margin: '2px 0 0 0' }}>
                Extracción directa del stream PDF · Desglose de Consumo Neto + Comercialización + Contribución 20%
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={15} color="#CBD5E1" />
          </button>
        </div>

        <form onSubmit={handleSaveAndAudit} style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Paso 1: Dropzone Interactiva Drag & Drop ── */}
          <div
            onDragOver={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            style={{
              padding: uploadedFileName ? '14px 18px' : '22px 20px',
              borderRadius: 12,
              background: dragActive
                ? 'rgba(36,165,174,0.14)'
                : uploadedFileName
                  ? 'linear-gradient(135deg, rgba(88,174,50,0.08) 0%, rgba(36,165,174,0.06) 100%)'
                  : '#F8FAFC',
              border: dragActive
                ? `2px dashed ${BRAND.teal}`
                : uploadedFileName
                  ? `1.5px solid ${BRAND.green}`
                  : `2px dashed #CBD5E1`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 46, height: 46, borderRadius: 12,
                background: uploadedFileName ? BRAND.green : BRAND.teal,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: uploadedFileName ? '0 4px 12px rgba(88,174,50,0.28)' : '0 4px 12px rgba(36,165,174,0.25)',
                flexShrink: 0,
              }}>
                {uploadedFileName ? <FileText size={23} /> : <UploadCloud size={24} />}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: BRAND.text }}>
                    {parsingPdf
                      ? 'Analizando estructura del PDF de Celsia…'
                      : uploadedFileName
                        ? uploadedFileName
                        : 'Arrastra aquí el PDF de la factura Celsia o haz clic para seleccionarlo'}
                  </span>
                  {uploadedFileName && !parsingPdf && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99,
                      background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC',
                    }}>
                      ✓ LECTURA EXITOSA
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 11.5, color: BRAND.muted, margin: '3px 0 0 0' }}>
                  {uploadedFileName
                    ? `Factura ${form.invoice_number || 'detectada'} · Cuenta ${form.account_code || '—'} · Medidor ${form.meter_number || '—'}`
                    : 'Extrae automáticamente Consumo Importado, Crédito Exp1, Consumo Neto, Comercialización, Contribución 20% y Componentes CU.'}
                </p>
              </div>
            </div>

            <label style={{
              padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
              background: uploadedFileName ? '#0F172A' : BRAND.teal,
              color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <UploadCloud size={15} />
              {parsingPdf ? 'Extrayendo…' : uploadedFileName ? 'Cambiar Archivo PDF' : 'Explorar PDF'}
              <input type="file" accept="application/pdf" onChange={handlePdfUpload} style={{ display: 'none' }} />
            </label>
          </div>

          {/* ── Paso 2: Selector Fluido de Planta Solar ── */}
          <div style={{
            background: '#F8FAFC',
            padding: '14px 16px',
            borderRadius: 12,
            border: `1px solid ${BRAND.border}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <label style={{ ...labelStyle, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Building2 size={13} color={BRAND.teal} />
                Planta Solar FusionSolar a Conciliar
              </label>
              {isAutoMatched && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, color: '#166534', background: '#DCFCE7',
                  padding: '2px 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <Sparkles size={11} /> Vinculada por Cuenta #{form.account_code}
                </span>
              )}
            </div>

            <select
              value={form.plant_code}
              onChange={e => handlePlantChange(e.target.value)}
              style={{ ...inputStyle, fontWeight: 700, fontSize: 13.5, color: BRAND.text, background: '#fff' }}
              required
            >
              {plants.length > 0 ? (
                plants.map(p => (
                  <option key={p.plantCode} value={p.plantCode}>
                    {p.plantName} {p.capacity ? `(${p.capacity} kWp)` : ''} {p.plantAddress ? `· ${p.plantAddress}` : ''}
                  </option>
                ))
              ) : (
                <option value="">— Sin plantas disponibles —</option>
              )}
            </select>
          </div>

          {/* ── Paso 3: RADIOGRAFÍA COMPLETA DEL RECIBO (ENERGÍA + LIQUIDACIÓN MONETARIA) ── */}
          {uploadedFileName && (
            <div style={{
              borderRadius: 12,
              border: `1.5px solid ${BRAND.border}`,
              background: '#FFFFFF',
              overflow: 'hidden',
            }}>
              {/* Sub-header */}
              <div style={{
                background: '#F1F5F9',
                padding: '10px 16px',
                borderBottom: `1px solid ${BRAND.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: BRAND.text, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={14} color={BRAND.teal} />
                  Radiografía Financiera y Energética Extraída de la Factura
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {form.period_start && form.period_end && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 6, background: '#fff', color: BRAND.text, border: `1px solid ${BRAND.border}` }}>
                      Ciclo: {form.period_start} → {form.period_end} ({form.days_billed ?? 30} días)
                    </span>
                  )}
                  {form.has_agpe_template && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 9px', borderRadius: 99, background: BRAND.greenL, color: BRAND.greenD }}>
                      Autogenerador AGPE CREG 174
                    </span>
                  )}
                </div>
              </div>

              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Bloque A: Ecuación de Balance de Energía Facturada (kWh) */}
                <div style={{
                  background: '#F8FAFC',
                  borderRadius: 10,
                  padding: '12px 14px',
                  border: `1px solid ${BRAND.border}`,
                }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    A. Balance de Energía Reconocido por Celsia en Factura (kWh)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                    <div style={{ background: '#fff', padding: '8px 12px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                      <span style={{ fontSize: 10, color: BRAND.muted, fontWeight: 700, display: 'block' }}>
                        501 · Consumo Importado
                      </span>
                      <strong style={{ fontSize: 15, color: BRAND.text }}>{fmtEnergy(impKwhNum)}</strong>
                      <span style={{ fontSize: 10.5, color: BRAND.muted, display: 'block', marginTop: 1 }}>
                        a ${fmt(cuNum, 2)}/kWh = {fmtCOP(form.consumo_importado_cop ?? impKwhNum * cuNum)}
                      </span>
                    </div>

                    <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.muted }}>−</div>

                    <div style={{ background: '#fff', padding: '8px 12px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                      <span style={{ fontSize: 10, color: BRAND.teal, fontWeight: 700, display: 'block' }}>
                        238 · Crédito Energía Exp1
                      </span>
                      <strong style={{ fontSize: 15, color: BRAND.teal }}>{fmtEnergy(excKwhNum)}</strong>
                      <span style={{ fontSize: 10.5, color: BRAND.muted, display: 'block', marginTop: 1 }}>
                        a −${fmt(cuNum, 2)}/kWh = −{fmtCOP(Math.abs(form.credito_energia_cop ?? excKwhNum * cuNum))}
                      </span>
                    </div>

                    <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.muted }}>=</div>

                    <div style={{ background: '#FFFBEB', padding: '8px 12px', borderRadius: 8, border: '1px solid #FDE68A' }}>
                      <span style={{ fontSize: 10, color: '#92400E', fontWeight: 800, display: 'block' }}>
                        Consumo Neto Facturado
                      </span>
                      <strong style={{ fontSize: 15, color: '#92400E' }}>{fmtEnergy(netKwhNum)}</strong>
                      <span style={{ fontSize: 10.5, color: '#B45309', fontWeight: 700, display: 'block', marginTop: 1 }}>
                        Base neta a CU = {fmtCOPDec(valNetoCOP)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bloque B: Cascada de Liquidación Monetaria de Energía Celsia ($ COP) */}
                <div style={{
                  background: '#F8FAFC',
                  borderRadius: 10,
                  padding: '12px 14px',
                  border: `1px solid ${BRAND.border}`,
                }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    B. Liquidación Monetaria de Energía Celsia (Suma Completa con Comercialización)
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 8 }}>
                    {/* 1. Valor Consumo Neto */}
                    <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', display: 'block' }}>
                        1. Valor Consumo Neto
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: BRAND.text, display: 'block', marginTop: 2 }}>
                        {fmtCOPDec(valNetoCOP)}
                      </span>
                      <span style={{ fontSize: 10, color: BRAND.muted }}>
                        {fmt(netKwhNum, 2)} kWh × ${fmt(cuNum, 2)}
                      </span>
                    </div>

                    {/* 2. Comercialización Exp1 */}
                    <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: '1px solid #FDE68A' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: '#B45309', textTransform: 'uppercase', display: 'block' }}>
                        2. (+) Comercialización Exp1
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#B45309', display: 'block', marginTop: 2 }}>
                        +{fmtCOPDec(valComCOP)}
                      </span>
                      <span style={{ fontSize: 10, color: '#92400E' }}>
                        {fmt(excKwhNum, 2)} kWh × ${fmt(cRateNum, 2)}
                      </span>
                    </div>

                    {/* 3. Contribución 20% */}
                    <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', display: 'block' }}>
                        3. (+) Contribución 20%
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: BRAND.text, display: 'block', marginTop: 2 }}>
                        +{fmtCOPDec(valContribCOP)}
                      </span>
                      <span style={{ fontSize: 10, color: BRAND.muted }}>
                        20% de {fmtCOP(valNetoCOP)}
                      </span>
                    </div>

                    {/* 4. Subtotal Energía Celsia */}
                    <div style={{
                      background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1.5px solid #34D399',
                    }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: '#065F46', textTransform: 'uppercase', display: 'block' }}>
                        (=) Subtotal Energía Celsia
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 900, color: '#047857', display: 'block', marginTop: 2 }}>
                        {fmtCOP(subtotalEnergiaCOP)} COP
                      </span>
                      <span style={{ fontSize: 10, color: '#065F46', fontWeight: 600 }}>
                        {ajusteCOP !== 0 ? `Incluye ajuste decena ($${fmt(ajusteCOP, 2)})` : '1 + 2 + 3 conciliado'}
                      </span>
                    </div>
                  </div>

                  {/* Nota de otros cobros ajenos a energía (Alumbrado / Tasa Seguridad) */}
                  {form.total_pagar_cop != null && form.total_pagar_cop > subtotalEnergiaCOP && (
                    <div style={{
                      marginTop: 8, padding: '6px 10px', borderRadius: 6,
                      background: '#FFF', border: `1px dashed ${BRAND.border}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                      fontSize: 11, color: BRAND.muted,
                    }}>
                      <span>
                        <strong>Otros cobros municipales (Alumbrado Público + Tasa Seguridad):</strong> {fmtCOP(form.otros_cobros_cop)}
                      </span>
                      <span>
                        <strong>Total General Documento a Pagar:</strong> <strong style={{ color: BRAND.text }}>{fmtCOP(form.total_pagar_cop)} COP</strong>
                      </span>
                    </div>
                  )}
                </div>

                {/* Bloque C: Composición Tarifaria CU */}
                {cu && Object.keys(cu).length > 0 && (
                  <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: BRAND.text }}>
                        Componentes del Costo Unitario CU (${fmt(cuNum, 2)} COP/kWh)
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: BRAND.greenD, background: BRAND.greenL, padding: '2px 8px', borderRadius: 6 }}>
                        Remuneración Neta Exp1 (CU − C): ${fmt(cuNum - cRateNum, 2)}/kWh
                      </span>
                    </div>
                    <div style={{ display: 'flex', height: 7, borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                      {CU_PARTS.map(part => {
                        const val = cu[part.key] || 0;
                        const pct = (val / cuTotalNum) * 100;
                        return (
                          <div key={part.key} style={{ width: `${pct}%`, background: part.color }} title={`${part.label}: $${val}`} />
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {CU_PARTS.map(part => {
                        const val = cu[part.key];
                        if (val == null) return null;
                        return (
                          <span key={part.key} style={{ fontSize: 10.5, color: BRAND.muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 2, background: part.color, display: 'inline-block' }} />
                            <strong>{part.short}:</strong> ${fmt(val, 2)}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Campos editables de verificación rápida ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Mes Consumo</label>
              <input
                type="month" value={form.period}
                onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                style={inputStyle} required
              />
            </div>
            <div>
              <label style={labelStyle}>Importado Celsia (kWh)</label>
              <input
                type="number" step="0.01" placeholder="ej. 4269.10"
                value={form.kwh_billed}
                onChange={e => setForm(f => ({ ...f, kwh_billed: e.target.value, consumo_neto_kwh: null, subtotal_active_cop: null, subtotal_energia_cop: null }))}
                style={inputStyle} required
              />
            </div>
            <div>
              <label style={labelStyle}>Excedentes Exp1 (kWh)</label>
              <input
                type="number" step="0.01" placeholder="ej. 1564.92"
                value={form.credito_energia_kwh}
                onChange={e => setForm(f => ({ ...f, credito_energia_kwh: parseFloat(e.target.value || '0'), consumo_neto_kwh: null, comercializacion_cop: null, subtotal_energia_cop: null }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Tarifa CU ($/kWh)</label>
              <input
                type="number" step="0.01" placeholder="ej. 977.59"
                value={form.price_cop_kwh}
                onChange={e => setForm(f => ({ ...f, price_cop_kwh: e.target.value, subtotal_active_cop: null, subtotal_energia_cop: null }))}
                style={inputStyle} required
              />
            </div>
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4, borderTop: `1px solid ${BRAND.border}`, paddingTop: 14 }}>
            <button type="button" onClick={onClose} style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'var(--bg-subtle)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)',
            }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} style={{
              padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: BRAND.green, color: '#fff', border: 'none', cursor: 'pointer',
              opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 2px 10px rgba(88,174,50,0.3)',
            }}>
              {saving ? <RefreshCw size={14} className="spin-slow" /> : <Zap size={14} />}
              {saving ? 'Auditando contra FusionSolar + XM…' : 'Guardar y Auditar Factura (CREG 174)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
