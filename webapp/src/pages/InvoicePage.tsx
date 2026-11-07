import { useState, useEffect, useCallback } from 'react';
import {
  Receipt, Plus, CheckCircle, AlertTriangle, XCircle,
  Clock, Trash2, Zap, RefreshCw, X, FileText, Calendar, Gauge, ArrowRight,
} from 'lucide-react';
import { BRAND, fmt, fmtEnergy } from '../lib/utils';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { Header } from '../components/layout/Header';

// ─── Types ────────────────────────────────────────────────────────────────────
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
  subtotal_active_cop?: number | null;
  subsidy_or_contrib_cop?: number | null;
  componentes_cu?: Record<string, number> | null;
  kwh_billed: number;
  price_cop_kwh: number;
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
}

const BASE = '/api';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_MAP = {
  pending:     { label: 'Pendiente',       color: '#64748B', bg: '#F1F5F9', icon: Clock },
  ok:          { label: 'Conciliado OK ✓', color: '#166534', bg: '#DCFCE7', icon: CheckCircle },
  discrepancy: { label: 'Discrepancia',    color: '#854D0E', bg: '#FEF9C3', icon: AlertTriangle },
  critical:    { label: 'Diferencia Alta', color: '#991B1B', bg: '#FEE2E2', icon: XCircle },
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

const fmtPeriod = (p: string) => {
  const [y, m] = p.split('-');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${months[parseInt(m) - 1] ?? m} ${y}`;
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function InvoicePage() {
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);

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

  const handleVerify = async (inv: Invoice) => {
    setVerifying(inv.id);
    try {
      await fetch(`${BASE}/invoices/${inv.id}/verify`, { method: 'POST' });
      await fetchInvoices();
    } catch (e) {
      console.error('Error verificando:', e);
    } finally {
      setVerifying(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta factura?')) return;
    await fetch(`${BASE}/invoices/${id}`, { method: 'DELETE' });
    setInvoices(prev => prev.filter(i => i.id !== id));
  };

  const total        = invoices.length;
  const pending      = invoices.filter(i => i.status === 'pending').length;
  const issues       = invoices.filter(i => i.status === 'discrepancy' || i.status === 'critical').length;
  const totalDiffCOP = invoices.reduce((s, i) => s + (i.difference_cop ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Header onRefresh={fetchInvoices} loading={loading} />

      {/* ── Encabezado de página ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Auditoría y Conciliación de Facturas (Celsia / CREG 174)
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>
            Extrae automáticamente los datos del recibo PDF de Celsia y crúzalos contra el ciclo exacto de generación e inyección de la planta
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: BRAND.green, color: '#fff', border: 'none', cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(88,174,50,0.25)',
            transition: 'all 0.15s',
          }}
        >
          <Plus size={14} /> Cargar / Registrar Factura
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ── KPI Cards ──────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          {[
            { label: 'Facturas Registradas', value: String(total), icon: Receipt, color: BRAND.teal },
            { label: 'Sin Verificar', value: String(pending), icon: Clock, color: '#94A3B8' },
            { label: 'Con Diferencias', value: String(issues), icon: AlertTriangle, color: BRAND.gold },
            {
              label: 'Diferencia Acumulada',
              value: totalDiffCOP === 0 ? '—' : fmtCOP(totalDiffCOP),
              icon: Zap,
              color: totalDiffCOP < 0 ? BRAND.red : BRAND.green,
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={13} color={color} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
              </div>
              <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* ── Lista de facturas ───────────────────────────────────── */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 40, fontSize: 13 }}>
            Cargando facturas…
          </div>
        ) : invoices.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <Receipt size={36} color="var(--text-tertiary)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontWeight: 600, marginBottom: 6 }}>Sin facturas registradas</p>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              Haz clic en <strong>Cargar / Registrar Factura</strong> y sube el PDF de Celsia.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {invoices.map(inv => {
              const st = STATUS_MAP[inv.status];
              const StatusIcon = st.icon;
              const hasDiff = inv.difference_kwh != null;
              const cu = inv.componentes_cu;

              return (
                <div key={inv.id} className="card" style={{ padding: '18px 20px' }}>
                  {/* ── Header row ── */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontWeight: 800, fontSize: 15, color: BRAND.text }}>{inv.company}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>·</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.teal }}>{inv.plant_name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>·</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{fmtPeriod(inv.period)}</span>
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
                          background: st.bg, color: st.color,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}>
                          <StatusIcon size={11} /> {st.label}
                        </span>
                      </div>

                      {/* Metadatos extraídos del PDF */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                        {inv.period_start && inv.period_end && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: BRAND.surface, color: BRAND.text, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Calendar size={11} color={BRAND.teal} />
                            Ciclo Facturado: {inv.period_start} → {inv.period_end} ({inv.days_billed ?? 30} días)
                          </span>
                        )}
                        {inv.account_code && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: BRAND.surface, color: BRAND.muted }}>
                            Cuenta: <strong>{inv.account_code}</strong>
                          </span>
                        )}
                        {inv.invoice_number && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: BRAND.surface, color: BRAND.muted }}>
                            Factura: <strong>{inv.invoice_number}</strong>
                          </span>
                        )}
                        {inv.meter_number && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: BRAND.surface, color: BRAND.muted }}>
                            Medidor: <strong>{inv.meter_number}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleVerify(inv)}
                        disabled={verifying === inv.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 700,
                          background: `${BRAND.teal}18`, color: BRAND.teal, border: `1px solid ${BRAND.teal}40`,
                          cursor: 'pointer',
                        }}
                      >
                        <RefreshCw size={11} style={{ animation: verifying === inv.id ? 'spin-slow 1s linear infinite' : 'none' }} />
                        {inv.status === 'pending' ? 'Verificar contra Telemetría' : 'Re-verificar Ciclo'}
                      </button>
                      <button
                        onClick={() => handleDelete(inv.id)}
                        style={{
                          width: 30, height: 30, borderRadius: 7,
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

                  {/* ── Tarjetas de datos de la factura y cruce ── */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10, marginTop: 14 }}>
                    {[
                      { label: 'kWh Facturados Celsia', value: fmtEnergy(inv.kwh_billed), color: 'var(--text-primary)' },
                      { label: 'Tarifa Plena (CU)', value: `$${fmt(inv.price_cop_kwh, 2)}/kWh`, color: BRAND.gold },
                      ...(cu?.tarifa_excedente_t1_agpe ? [
                        { label: 'Crédito AGPE (CU−C)', value: `$${fmt(cu.tarifa_excedente_t1_agpe, 2)}/kWh`, color: BRAND.greenD },
                      ] : []),
                      { label: 'Total Energía Factura', value: fmtCOP(inv.total_cop), color: 'var(--text-primary)' },
                      ...(hasDiff ? [
                        { label: 'Registrado Planta (Ciclo)', value: fmtEnergy(inv.fusion_kwh!), color: BRAND.teal },
                        { label: 'Diferencia kWh', value: `${inv.difference_kwh! >= 0 ? '+' : ''}${fmtEnergy(inv.difference_kwh!)}`, color: inv.difference_kwh! >= 0 ? BRAND.green : BRAND.red },
                        { label: 'Impacto Económico', value: `${inv.difference_cop! >= 0 ? '+' : ''}${fmtCOP(inv.difference_cop!)}`, color: inv.difference_cop! >= 0 ? BRAND.green : BRAND.red },
                      ] : []),
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--bg-subtle)', border: `1px solid ${BRAND.border}` }}>
                        <p style={{ fontSize: 9.5, color: 'var(--text-tertiary)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</p>
                        <p style={{ fontSize: 13.5, fontWeight: 800, color }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* ── Barra visual de componentes CU si viene de PDF Celsia ── */}
                  {cu && Object.keys(cu).length > 0 && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: BRAND.surface, border: `1px solid ${BRAND.border}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: BRAND.text }}>
                          Desglose Físico-Tarifario Extraído del PDF (CU = G + C + T + D + PR + R):
                        </span>
                        <span style={{ fontSize: 10.5, color: BRAND.greenD, fontWeight: 700 }}>
                          Excedente Tipo 1 CREG 174 (CU − C): ${fmt(cu.tarifa_excedente_t1_agpe, 2)}/kWh
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

                  {/* ── Alerta de discrepancia ── */}
                  {(inv.status === 'discrepancy' || inv.status === 'critical') && (
                    <div style={{
                      marginTop: 12, padding: '9px 12px', borderRadius: 7,
                      background: inv.status === 'critical' ? '#FEE2E2' : '#FEF9C3',
                      border: `1px solid ${inv.status === 'critical' ? '#FCA5A5' : '#FDE68A'}`,
                      fontSize: 12, color: inv.status === 'critical' ? '#991B1B' : '#854D0E',
                    }}>
                      <strong>{inv.status === 'critical' ? '🚨 Diferencia significativa detectada en el ciclo:' : '⚠️ Diferencia leve en el ciclo:'}</strong>{' '}
                      La telemetría de la planta registró <strong>{fmtEnergy(inv.fusion_kwh!)}</strong> en el ciclo {inv.period_start ? `(${inv.period_start} a ${inv.period_end})` : inv.period}, mientras el recibo de {inv.company} líquida <strong>{fmtEnergy(inv.kwh_billed)}</strong>.
                      Diferencia valorada a tarifa CU: <strong>{fmtCOP(inv.difference_cop)} COP</strong>.
                    </div>
                  )}

                  {inv.notes && (
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, fontStyle: 'italic' }}>
                      {inv.notes}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal nueva factura ──────────────────────────────────── */}
      {showModal && (
        <NewInvoiceModal
          plants={plants}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchInvoices(); }}
        />
      )}
    </div>
  );
}

// ─── Modal con Radiografía Visual del PDF Celsia ──────────────────────────────
function NewInvoiceModal({ plants, onClose, onCreated }: {
  plants: any[];
  onClose: () => void;
  onCreated: () => void;
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
    reading_previous_kwh: null as number | null,
    reading_current_kwh: null as number | null,
    multiplier: null as number | null,
    subtotal_active_cop: null as number | null,
    subsidy_or_contrib_cop: null as number | null,
    kwh_billed: '',
    price_cop_kwh: '',
    componentes_cu: null as Record<string, number> | null,
    has_agpe_template: false,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const total_cop = form.subtotal_active_cop != null && form.subsidy_or_contrib_cop != null
    ? Math.round(form.subtotal_active_cop + form.subsidy_or_contrib_cop)
    : Math.round(parseFloat(form.kwh_billed || '0') * parseFloat(form.price_cop_kwh || '0'));

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
        setForm(f => ({
          ...f,
          company: p.company || f.company,
          period: p.period || f.period,
          period_start: p.period_start || '',
          period_end: p.period_end || '',
          days_billed: p.days_billed ?? null,
          client_name: p.client_name || '',
          account_code: p.account_code || '',
          invoice_number: p.invoice_number || '',
          meter_number: p.meter_number || '',
          reading_previous_kwh: p.reading_previous_kwh ?? null,
          reading_current_kwh: p.reading_current_kwh ?? null,
          multiplier: p.multiplier ?? 1,
          subtotal_active_cop: p.subtotal_active_cop ?? null,
          subsidy_or_contrib_cop: p.subsidy_or_contrib_cop ?? null,
          kwh_billed: p.kwh_billed != null ? String(p.kwh_billed) : f.kwh_billed,
          price_cop_kwh: p.price_cop_kwh != null ? String(p.price_cop_kwh) : f.price_cop_kwh,
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

  const handlePlantChange = (code: string) => {
    const p = plants.find(p => p.plantCode === code);
    setForm(f => ({ ...f, plant_code: code, plant_name: p?.plantName ?? code }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.kwh_billed || !form.price_cop_kwh) return;
    setSaving(true);
    try {
      await fetch(`/api/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          kwh_billed: parseFloat(form.kwh_billed),
          price_cop_kwh: parseFloat(form.price_cop_kwh),
          total_cop,
        }),
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
    background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5,
  };

  const cu = form.componentes_cu;
  const cuTotalNum = parseFloat(form.price_cop_kwh || '0') || 1;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(7,17,31,0.72)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: BRAND.text }}>
              Extractor Inteligente y Registro de Factura Celsia
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Sube el PDF original de Celsia para visualizar cada variable extraída antes de conciliar con la planta
            </p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={14} color="var(--text-secondary)" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* ── Dropzone / Botón de Carga PDF ── */}
          <div style={{
            padding: '14px 16px', borderRadius: 10,
            background: uploadedFileName ? 'rgba(88,174,50,0.08)' : `${BRAND.teal}10`,
            border: uploadedFileName ? `1.5px solid ${BRAND.green}` : `1.5px dashed ${BRAND.teal}70`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 9,
                background: uploadedFileName ? BRAND.green : BRAND.teal,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <FileText size={19} />
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 800, color: BRAND.text, margin: 0 }}>
                  {uploadedFileName ? `PDF Analizado: ${uploadedFileName}` : 'Subir Factura Electrónica PDF (Celsia)'}
                </p>
                <p style={{ fontSize: 11.5, color: BRAND.muted, margin: '2px 0 0 0' }}>
                  {uploadedFileName
                    ? 'Se extrajeron lecturas de medidor, ciclo exacto de días, consumo y componentes tarifarios CU.'
                    : 'Lee directamente el stream del PDF de Celsia (ciclo exacto, lecturas, kWh, CU y componentes G, C, T, D, PR, R).'}
                </p>
              </div>
            </div>
            <label style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
              background: uploadedFileName ? BRAND.greenD : BRAND.teal, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {parsingPdf ? 'Extrayendo datos…' : uploadedFileName ? 'Cambiar PDF' : 'Seleccionar PDF'}
              <input type="file" accept="application/pdf" onChange={handlePdfUpload} style={{ display: 'none' }} />
            </label>
          </div>

          {/* ── RADIOGRAFÍA VISUAL DE LA FACTURA EXTRAÍDA ── */}
          {uploadedFileName && (
            <div style={{
              borderRadius: 10,
              border: `1px solid ${BRAND.border}`,
              background: '#F8FAFC',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${BRAND.border}`, paddingBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: BRAND.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  🔍 Radiografía de Datos Extraídos de la Factura
                </span>
                {form.has_agpe_template && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: BRAND.greenL, color: BRAND.greenD }}>
                    Formato AGPE Solar Detectado
                  </span>
                )}
              </div>

              {/* 1. Identificación del Servicio y Medidor */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                {[
                  { label: 'Titular en Recibo', val: form.client_name || 'Cliente Celsia' },
                  { label: 'Código de Cuenta', val: form.account_code || '—' },
                  { label: 'Factura Electrónica', val: form.invoice_number || '—' },
                  { label: 'Medidor No.', val: form.meter_number || '—' },
                ].map(item => (
                  <div key={item.label} style={{ background: '#fff', padding: '8px 10px', borderRadius: 7, border: `1px solid ${BRAND.border}` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', display: 'block' }}>
                      {item.label}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: BRAND.text }}>
                      {item.val}
                    </span>
                  </div>
                ))}
              </div>

              {/* 2. Ciclo Exacto y Lecturas del Medidor */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {/* Ciclo de Facturación */}
                <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Calendar size={13} color={BRAND.teal} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: BRAND.text }}>
                      Ciclo Exacto de Lectura (Cruza 2 meses)
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: BRAND.surface, padding: '6px 10px', borderRadius: 6 }}>
                    <div>
                      <span style={{ fontSize: 9.5, color: BRAND.muted, display: 'block' }}>Desde</span>
                      <strong style={{ fontSize: 12.5, color: BRAND.text }}>{form.period_start || '—'}</strong>
                    </div>
                    <ArrowRight size={14} color={BRAND.teal} />
                    <div>
                      <span style={{ fontSize: 9.5, color: BRAND.muted, display: 'block' }}>Hasta</span>
                      <strong style={{ fontSize: 12.5, color: BRAND.text }}>{form.period_end || '—'}</strong>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 99, background: BRAND.tealL, color: BRAND.teal }}>
                      {form.days_billed ?? 30} días
                    </span>
                  </div>
                </div>

                {/* Ecuación de Medidor */}
                <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Gauge size={13} color={BRAND.gold} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: BRAND.text }}>
                      Diferencia de Lecturas en Medidor
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: BRAND.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11.5 }}>
                    <div>
                      <span style={{ fontSize: 9.5, color: BRAND.muted, display: 'block' }}>Lect. Actual</span>
                      <strong>{form.reading_current_kwh != null ? fmt(form.reading_current_kwh, 0) : '—'}</strong>
                    </div>
                    <span>−</span>
                    <div>
                      <span style={{ fontSize: 9.5, color: BRAND.muted, display: 'block' }}>Lect. Anterior</span>
                      <strong>{form.reading_previous_kwh != null ? fmt(form.reading_previous_kwh, 0) : '—'}</strong>
                    </div>
                    <span>× {form.multiplier ?? 1} =</span>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 9.5, color: BRAND.greenD, fontWeight: 700, display: 'block' }}>Activa (501)</span>
                      <strong style={{ fontSize: 13, color: BRAND.greenD }}>{form.kwh_billed} kWh</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Desglose Visual de la Tarifa Unitaria CU (CREG 174/2021) */}
              {cu && Object.keys(cu).length > 0 && (
                <div style={{ background: '#fff', padding: '12px 14px', borderRadius: 8, border: `1px solid ${BRAND.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: BRAND.text }}>
                      Composición Tarifaria Extraída (CU = ${fmt(parseFloat(form.price_cop_kwh || '0'), 2)} COP/kWh)
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.greenD, background: BRAND.greenL, padding: '2px 8px', borderRadius: 6 }}>
                      Excedente Solar AGPE T1 (CU − C): ${fmt(cu.tarifa_excedente_t1_agpe, 2)}/kWh
                    </span>
                  </div>

                  {/* Barra proporcional apilada */}
                  <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
                    {CU_PARTS.map(part => {
                      const val = cu[part.key] || 0;
                      const pct = (val / cuTotalNum) * 100;
                      return (
                        <div
                          key={part.key}
                          style={{ width: `${pct}%`, background: part.color }}
                          title={`${part.label} (${part.short}): $${val} COP/kWh (${pct.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>

                  {/* Grilla de los 6 componentes */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 6 }}>
                    {CU_PARTS.map(part => {
                      const val = cu[part.key] ?? 0;
                      const pct = (val / cuTotalNum) * 100;
                      return (
                        <div key={part.key} style={{ padding: '6px 8px', borderRadius: 6, background: BRAND.surface, borderLeft: `3px solid ${part.color}` }}>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted }}>
                            {part.short} · {part.label}
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: BRAND.text, marginTop: 1 }}>
                            ${fmt(val, 2)}
                          </div>
                          <div style={{ fontSize: 9.5, color: BRAND.dim }}>
                            {pct.toFixed(1)}% del CU
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4. Liquidación de Conceptos Extraídos */}
              {form.subtotal_active_cop != null && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <div style={{ background: '#fff', padding: '8px 10px', borderRadius: 7, border: `1px solid ${BRAND.border}` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, display: 'block' }}>
                      501 · Consumo Activa
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: BRAND.text }}>
                      {fmtCOP(form.subtotal_active_cop)}
                    </span>
                  </div>
                  <div style={{ background: '#fff', padding: '8px 10px', borderRadius: 7, border: `1px solid ${BRAND.border}` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.muted, display: 'block' }}>
                      561 · Subsidio / Contrib.
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: (form.subsidy_or_contrib_cop ?? 0) < 0 ? BRAND.greenD : BRAND.text }}>
                      {fmtCOP(form.subsidy_or_contrib_cop ?? 0)}
                    </span>
                  </div>
                  <div style={{ background: BRAND.greenL, padding: '8px 10px', borderRadius: 7, border: `1px solid ${BRAND.green}40` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: BRAND.greenD, display: 'block' }}>
                      Total Energía Celsia
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: BRAND.greenD }}>
                      {fmtCOP(total_cop)} COP
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Formulario Editable de Asociación a Planta ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Comercializador</label>
              <select value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} style={inputStyle}>
                {['Celsia', 'EPM', 'Enel Codensa', 'Afinia', 'Air-e', 'Otro'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Planta Solar a Conciliar</label>
              <select value={form.plant_code} onChange={e => handlePlantChange(e.target.value)} style={inputStyle}>
                {plants.length > 0
                  ? plants.map(p => <option key={p.plantCode} value={p.plantCode}>{p.plantName}</option>)
                  : <option value="">— Sin plantas —</option>
                }
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Mes Factura</label>
              <input
                type="month" value={form.period}
                onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                style={inputStyle} required
              />
            </div>
            <div>
              <label style={labelStyle}>kWh Facturados</label>
              <input
                type="number" step="0.01" placeholder="ej. 455"
                value={form.kwh_billed}
                onChange={e => setForm(f => ({ ...f, kwh_billed: e.target.value }))}
                style={inputStyle} required
              />
            </div>
            <div>
              <label style={labelStyle}>Tarifa CU (COP/kWh)</label>
              <input
                type="number" step="0.01" placeholder="ej. 964.13"
                value={form.price_cop_kwh}
                onChange={e => setForm(f => ({ ...f, price_cop_kwh: e.target.value }))}
                style={inputStyle} required
              />
            </div>
          </div>

          {/* Notas */}
          <div>
            <label style={labelStyle}>Metadatos / Observaciones de Auditoría</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Ciclo de facturación, número de cuenta, medidor..."
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'var(--bg-subtle)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)',
            }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: BRAND.green, color: '#fff', border: 'none', cursor: 'pointer',
              opacity: saving ? 0.7 : 1,
            }}>
              {saving ? 'Guardando…' : 'Guardar Factura y Conciliar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
