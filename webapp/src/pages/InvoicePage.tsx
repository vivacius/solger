import { useState, useEffect, useCallback } from 'react';
import {
  Receipt, Plus, CheckCircle, AlertTriangle, XCircle,
  Clock, Trash2, Zap, RefreshCw, X,
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
  kwh_billed: number;
  price_cop_kwh: number;
  total_cop: number;
  notes: string;
  fusion_kwh: number | null;
  difference_kwh: number | null;
  difference_cop: number | null;
  status: 'pending' | 'ok' | 'discrepancy' | 'critical';
  created_at: string;
  verified_at: string | null;
}

const BASE = '/api';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_MAP = {
  pending:     { label: 'Pendiente',     color: '#64748B', bg: '#F1F5F9', icon: Clock },
  ok:          { label: 'OK ✓',          color: '#166534', bg: '#DCFCE7', icon: CheckCircle },
  discrepancy: { label: 'Discrepancia',  color: '#854D0E', bg: '#FEF9C3', icon: AlertTriangle },
  critical:    { label: 'Diferencia Alta',color: '#991B1B', bg: '#FEE2E2', icon: XCircle },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtCOP = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
const fmtPeriod = (p: string) => {
  const [y, m] = p.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${months[parseInt(m) - 1]} ${y}`;
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function InvoicePage() {
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);

  // Plants from FusionSolar for selector
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

  // Auto-verify: delega al backend la extracción mensual desde FusionSolar (inverter_power / ongrid_power)
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

  // Summary stats
  const total       = invoices.length;
  const pending     = invoices.filter(i => i.status === 'pending').length;
  const issues      = invoices.filter(i => i.status === 'discrepancy' || i.status === 'critical').length;
  const totalDiffCOP = invoices.reduce((s, i) => s + (i.difference_cop ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Header onRefresh={fetchInvoices} loading={loading} />

      {/* ── Encabezado de página ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Facturación</h1>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>Verifica que te paguen lo que generaste</p>
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
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#2e6b14'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = BRAND.green}
        >
          <Plus size={14} /> Nueva Factura
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── KPI Cards ──────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          {[
            { label: 'Facturas', value: String(total), icon: Receipt, color: BRAND.teal },
            { label: 'Sin verificar', value: String(pending), icon: Clock, color: '#94A3B8' },
            { label: 'Con diferencias', value: String(issues), icon: AlertTriangle, color: BRAND.gold },
            {
              label: 'Diferencia total',
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
              Haz clic en <strong>Nueva Factura</strong> para registrar el primer recibo de Celsia.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {invoices.map(inv => {
              const st  = STATUS_MAP[inv.status];
              const StatusIcon = st.icon;
              const hasDiff = inv.difference_kwh != null;

              return (
                <div key={inv.id} className="card" style={{ padding: '16px 18px' }}>
                  {/* ── Header row ── */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{inv.company}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>·</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtPeriod(inv.period)}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                          background: st.bg, color: st.color,
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          <StatusIcon size={10} /> {st.label}
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{inv.plant_name}</p>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      {inv.status === 'pending' && (
                        <button
                          onClick={() => handleVerify(inv)}
                          disabled={verifying === inv.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                            background: `${BRAND.teal}18`, color: BRAND.teal, border: `1px solid ${BRAND.teal}40`,
                            cursor: 'pointer',
                          }}
                        >
                          <RefreshCw size={11} style={{ animation: verifying === inv.id ? 'spin-slow 1s linear infinite' : 'none' }} />
                          Verificar vs FusionSolar
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(inv.id)}
                        style={{
                          width: 28, height: 28, borderRadius: 7,
                          background: '#FEE2E210', border: '1px solid #FEE2E250',
                          color: BRAND.red, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* ── Datos ── */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 14 }}>
                    {[
                      { label: 'kWh Facturados', value: fmtEnergy(inv.kwh_billed), color: 'var(--text-primary)' },
                      { label: 'Precio unitario', value: `$${fmt(inv.price_cop_kwh, 0)}/kWh`, color: BRAND.gold },
                      { label: 'Total factura', value: fmtCOP(inv.total_cop), color: 'var(--text-primary)' },
                      ...(hasDiff ? [
                        { label: 'FusionSolar real', value: fmtEnergy(inv.fusion_kwh!), color: BRAND.teal },
                        { label: 'Diferencia kWh', value: `${inv.difference_kwh! >= 0 ? '+' : ''}${fmtEnergy(inv.difference_kwh!)}`, color: inv.difference_kwh! >= 0 ? BRAND.green : BRAND.red },
                        { label: 'Diferencia COP', value: `${inv.difference_cop! >= 0 ? '+' : ''}${fmtCOP(inv.difference_cop!)}`, color: inv.difference_cop! >= 0 ? BRAND.green : BRAND.red },
                      ] : []),
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ padding: '8px 10px', borderRadius: 7, background: 'var(--bg-subtle)' }}>
                        <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</p>
                        <p style={{ fontSize: 13, fontWeight: 700, color }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* ── Alerta de discrepancia ── */}
                  {(inv.status === 'discrepancy' || inv.status === 'critical') && (
                    <div style={{
                      marginTop: 12, padding: '8px 12px', borderRadius: 7,
                      background: inv.status === 'critical' ? '#FEE2E2' : '#FEF9C3',
                      border: `1px solid ${inv.status === 'critical' ? '#FCA5A5' : '#FDE68A'}`,
                      fontSize: 12, color: inv.status === 'critical' ? '#991B1B' : '#854D0E',
                    }}>
                      <strong>{inv.status === 'critical' ? '🚨 Diferencia significativa:' : '⚠️ Diferencia leve:'}</strong>{' '}
                      FusionSolar registró {fmtEnergy(inv.fusion_kwh!)} pero te facturaron {fmtEnergy(inv.kwh_billed)}.
                      Diferencia: {fmtCOP(inv.difference_cop)} COP.
                      {inv.status === 'critical' && ' Considera contactar a tu comercializador.'}
                    </div>
                  )}

                  {inv.notes && (
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8, fontStyle: 'italic' }}>
                      Nota: {inv.notes}
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

// ─── Modal ────────────────────────────────────────────────────────────────────
function NewInvoiceModal({ plants, onClose, onCreated }: {
  plants: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    company: 'Celsia',
    plant_code: plants[0]?.plantCode ?? '',
    plant_name: plants[0]?.plantName ?? '',
    period: new Date().toISOString().slice(0, 7),  // YYYY-MM
    period_start: '',
    period_end: '',
    days_billed: null as number | null,
    account_code: '',
    invoice_number: '',
    meter_number: '',
    kwh_billed: '',
    price_cop_kwh: '',
    componentes_cu: null as Record<string, number> | null,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);

  const total_cop = parseFloat(form.kwh_billed || '0') * parseFloat(form.price_cop_kwh || '0');

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsingPdf(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/invoices/parse-pdf', { method: 'POST', body: fd });
      const d = await r.json();
      if (d?.success && d.parsed) {
        const p = d.parsed;
        const cycleNote = p.period_start && p.period_end
          ? `Ciclo Celsia: ${p.period_start} a ${p.period_end} (${p.days_billed ?? ''} días) · Cuenta ${p.account_code ?? ''} · Medidor ${p.meter_number ?? ''}`
          : '';
        setForm(f => ({
          ...f,
          company: p.company || f.company,
          period: p.period || f.period,
          period_start: p.period_start || '',
          period_end: p.period_end || '',
          days_billed: p.days_billed ?? null,
          account_code: p.account_code || '',
          invoice_number: p.invoice_number || '',
          meter_number: p.meter_number || '',
          kwh_billed: p.kwh_billed != null ? String(p.kwh_billed) : f.kwh_billed,
          price_cop_kwh: p.price_cop_kwh != null ? String(p.price_cop_kwh) : f.price_cop_kwh,
          componentes_cu: p.componentes_cu || null,
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
    fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(7,17,31,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Registrar Factura</h2>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Ingresa los datos del recibo de tu comercializador
            </p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={14} color="var(--text-secondary)" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Auto-lectura PDF Celsia */}
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: `${BRAND.teal}10`, border: `1px dashed ${BRAND.teal}60`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                Auto-lectura de PDF Celsia
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                Extrae ciclo exacto, kWh, tarifa CU y componentes (G, C, T, D, PR, R)
              </p>
            </div>
            <label style={{
              padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: BRAND.teal, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {parsingPdf ? 'Leyendo…' : 'Cargar PDF'}
              <input type="file" accept="application/pdf" onChange={handlePdfUpload} style={{ display: 'none' }} />
            </label>
          </div>

          {form.componentes_cu && Object.keys(form.componentes_cu).length > 0 && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 11,
              background: 'var(--bg-subtle)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}>
              <strong>Desglose CU extraído:</strong> G=${form.componentes_cu.G_generacion} · C=${form.componentes_cu.C_comercializacion} · T=${form.componentes_cu.T_transmision} · D=${form.componentes_cu.D_distribucion} · PR=${form.componentes_cu.PR_perdidas} · R=${form.componentes_cu.R_restricciones}
              <br />
              <span style={{ color: BRAND.green, fontWeight: 600 }}>
                Crédito neto Excedente Tipo 1 AGPE (CU − C): ${form.componentes_cu.tarifa_excedente_t1_agpe}/kWh
              </span>
            </div>
          )}

          {/* Empresa */}
          <div>
            <label style={labelStyle}>Empresa compradora</label>
            <select value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} style={inputStyle}>
              {['Celsia', 'EPM', 'Codensa', 'Electrohuila', 'Otro'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Planta */}
          <div>
            <label style={labelStyle}>Planta solar</label>
            <select value={form.plant_code} onChange={e => handlePlantChange(e.target.value)} style={inputStyle}>
              {plants.length > 0
                ? plants.map(p => <option key={p.plantCode} value={p.plantCode}>{p.plantName}</option>)
                : <option value="">— Sin plantas —</option>
              }
            </select>
          </div>

          {/* Período */}
          <div>
            <label style={labelStyle}>Período (mes de la factura)</label>
            <input
              type="month" value={form.period}
              onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
              style={inputStyle} required
            />
          </div>

          {/* kWh y precio */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>kWh facturados</label>
              <input
                type="number" step="0.01" placeholder="ej. 48320"
                value={form.kwh_billed}
                onChange={e => setForm(f => ({ ...f, kwh_billed: e.target.value }))}
                style={inputStyle} required
              />
            </div>
            <div>
              <label style={labelStyle}>Precio COP/kWh</label>
              <input
                type="number" step="0.01" placeholder="ej. 300"
                value={form.price_cop_kwh}
                onChange={e => setForm(f => ({ ...f, price_cop_kwh: e.target.value }))}
                style={inputStyle} required
              />
            </div>
          </div>

          {/* Total calculado */}
          {total_cop > 0 && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: `${BRAND.green}0D`, border: `1px solid ${BRAND.green}30` }}>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total factura (calculado)</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: BRAND.green }}>{fmtCOP(total_cop)} COP</p>
            </div>
          )}

          {/* Notas */}
          <div>
            <label style={labelStyle}>Notas (opcional)</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Observaciones sobre esta factura..."
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
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: BRAND.green, color: '#fff', border: 'none', cursor: 'pointer',
              opacity: saving ? 0.7 : 1,
            }}>
              {saving ? 'Guardando…' : 'Guardar Factura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
