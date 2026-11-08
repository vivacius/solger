import { useEffect, useState, useCallback } from 'react';
import {
  FileText, Send, RefreshCw, Download, Printer, CheckCircle2,
  Clock, Sparkles, Building2, ExternalLink, AlertCircle
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { BRAND } from '../lib/utils';

interface PlantReportMeta {
  safeName: string;
  displayName: string;
  fileName: string;
  updatedAt: string;
  sizeBytes: number;
}

interface ReportsListResponse {
  success: boolean;
  executiveReport: {
    available: boolean;
    fileName: string | null;
    updatedAt: string | null;
  };
  plantReports: PlantReportMeta[];
  automation: {
    telegramConfigured: boolean;
    telegramChatId: string;
    dailySchedule: string;
    workflowFile: string;
  };
}

export function ReportsPage() {
  const [meta, setMeta] = useState<ReportsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<'executive' | string>('executive');
  const [iframeKey, setIframeKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchMeta = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/reports/list');
      if (r.ok) {
        const data = (await r.json()) as ReportsListResponse;
        setMeta(data);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  const previewUrl =
    selectedReport === 'executive'
      ? `/api/reports/preview/executive?v=${iframeKey}`
      : `/api/reports/preview/plant/${encodeURIComponent(selectedReport)}?v=${iframeKey}`;

  const handleGenerate = async (sendTg: boolean) => {
    if (sendTg) setSendingTelegram(true);
    else setGenerating(true);
    setToast(null);
    try {
      const r = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          send_telegram: sendTg,
          send_email: false,
        }),
      });
      const rawText = await r.text();
      let res: any = {};
      try {
        res = rawText ? JSON.parse(rawText) : {};
      } catch {
        res = { detail: rawText.slice(0, 180) || `HTTP ${r.status}` };
      }
      if (r.ok && res.success) {
        await fetchMeta();
        setIframeKey(k => k + 1);
        if (sendTg) {
          const tgOk = res.telegram?.sent;
          setToast({
            ok: Boolean(tgOk),
            text: tgOk
              ? `Reporte Ejecutivo + gráficos enviados a Telegram (${res.telegram?.detail})`
              : `Reportes generados en vivo, pero Telegram respondió: ${res.telegram?.detail || 'Error'}`,
          });
        } else {
          setToast({
            ok: true,
            text: `Reportes generados en el momento (${res.plantsGenerated} plantas + Cierre Ejecutivo).`,
          });
        }
      } else {
        setToast({ ok: false, text: res.detail || `Error generando los reportes (HTTP ${r.status}).` });
      }
    } catch (e: any) {
      setToast({ ok: false, text: e?.message || 'Error de conexión con el servidor.' });
    } finally {
      setGenerating(false);
      setSendingTelegram(false);
    }
  };

  const handlePrint = () => {
    const win = window.open(previewUrl, '_blank');
    if (win) {
      win.onload = () => win.print();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Header onRefresh={fetchMeta} loading={loading} />

      {/* ── Encabezado y Acciones de Automatización ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: BRAND.text, margin: 0 }}>
            Reportes Ejecutivos y Cierre Automatizado
          </h1>
          <p style={{ fontSize: 12, color: BRAND.muted, marginTop: 3 }}>
            Generación de reportes gerenciales e individuales por planta con curvas horarias, HSP real y envío automático por Telegram
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a
            href="/presentacion-solger.html"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 13px',
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              background: BRAND.tealL,
              color: BRAND.teal,
              border: '1px solid rgba(36,165,174,0.25)',
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={13} />
            Presentación Ejecutiva
          </a>

          <button
            onClick={() => handleGenerate(false)}
            disabled={generating || sendingTelegram}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              background: '#FFFFFF',
              color: BRAND.text,
              border: `1px solid ${BRAND.border}`,
              cursor: generating || sendingTelegram ? 'not-allowed' : 'pointer',
              opacity: generating || sendingTelegram ? 0.65 : 1,
            }}
          >
            <RefreshCw
              size={13}
              style={{ animation: generating ? 'spin-slow 1s linear infinite' : 'none' }}
            />
            {generating ? 'Actualizando gráficos…' : 'Actualizar Reportes'}
          </button>

          <button
            onClick={() => handleGenerate(true)}
            disabled={generating || sendingTelegram}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              background: 'linear-gradient(135deg, #24A5AE 0%, #58AE32 100%)',
              color: '#FFFFFF',
              border: 'none',
              cursor: generating || sendingTelegram ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 10px rgba(36,165,174,0.28)',
              opacity: generating || sendingTelegram ? 0.7 : 1,
            }}
          >
            <Send size={13} />
            {sendingTelegram ? 'Enviando a Telegram…' : 'Generar y Enviar por Telegram'}
          </button>
        </div>
      </div>

      {/* ── Notificación de resultado ── */}
      {toast && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: toast.ok ? BRAND.greenL : '#FEE2E2',
            border: `1px solid ${toast.ok ? 'rgba(88,174,50,0.35)' : 'rgba(220,38,38,0.35)'}`,
            color: toast.ok ? BRAND.greenD : BRAND.red,
            fontSize: 12.5,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* ── Barra de Estado de Automatización (Telegram + GitHub Actions) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <div
          className="card"
          style={{
            padding: '12px 16px',
            borderLeft: `3px solid ${BRAND.teal}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: BRAND.tealL,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Send size={15} color={BRAND.teal} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>
              Canal Activo de Despacho
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND.text }}>
              Bot de Telegram Conectado
            </div>
            <div style={{ fontSize: 11, color: BRAND.muted }}>
              Chat ID: <strong>{meta?.automation?.telegramChatId || '5475150163'}</strong> · Resumen + Gráficos + HTML
            </div>
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: '12px 16px',
            borderLeft: `3px solid ${BRAND.green}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: BRAND.greenL,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Clock size={15} color={BRAND.greenD} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>
              Programación Automática
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND.text }}>
              Cierre Diario — 18:00 COT
            </div>
            <div style={{ fontSize: 11, color: BRAND.muted }}>
              Tarea activa en GitHub Actions y servidor local
            </div>
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: '12px 16px',
            borderLeft: `3px solid ${BRAND.gold}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: BRAND.goldL,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Sparkles size={15} color="#B45309" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>
              Reportes Generados
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND.text }}>
              1 Ejecutivo + {meta?.plantReports?.length ?? 0} Plantas
            </div>
            <div style={{ fontSize: 11, color: BRAND.muted }}>
              {meta?.executiveReport?.updatedAt
                ? `Última gen.: ${new Date(meta.executiveReport.updatedAt).toLocaleString('es-CO')}`
                : 'Listos para visualización'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Layout Principal: Selector Lateral + Visor HTML en Vivo ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '270px 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* Selector de Reporte */}
        <div className="card" style={{ padding: '12px' }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: BRAND.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '4px 8px 8px',
            }}
          >
            Reporte Gerencial
          </div>

          <button
            onClick={() => setSelectedReport('executive')}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 8,
              border:
                selectedReport === 'executive'
                  ? `1px solid ${BRAND.green}`
                  : '1px solid transparent',
              background: selectedReport === 'executive' ? BRAND.greenL : 'transparent',
              color: selectedReport === 'executive' ? BRAND.greenD : BRAND.text,
              fontWeight: 700,
              fontSize: 12.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <FileText size={14} />
            <div>
              <div>Cierre Ejecutivo Diario</div>
              <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>
                Portafolio completo + HSP + Alarmas
              </div>
            </div>
          </button>

          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: BRAND.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '8px 8px 6px',
              borderTop: `1px solid ${BRAND.border}`,
            }}
          >
            Reportes por Planta ({meta?.plantReports?.length ?? 0})
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              maxHeight: 520,
              overflowY: 'auto',
            }}
          >
            {(meta?.plantReports || []).map(p => {
              const active = selectedReport === p.safeName;
              return (
                <button
                  key={p.safeName}
                  onClick={() => setSelectedReport(p.safeName)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 10px',
                    borderRadius: 7,
                    border: active ? `1px solid ${BRAND.teal}` : '1px solid transparent',
                    background: active ? BRAND.tealL : 'transparent',
                    color: active ? BRAND.teal : BRAND.text,
                    fontWeight: active ? 700 : 600,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <Building2 size={12} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.displayName}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Visor en vivo del HTML generado */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              padding: '10px 16px',
              borderBottom: `1px solid ${BRAND.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
              background: '#FAFBFC',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} color={BRAND.teal} />
              <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.text }}>
                {selectedReport === 'executive'
                  ? 'Vista Previa — Reporte Ejecutivo de Cierre Operativo'
                  : `Vista Previa — Planta ${selectedReport.replace(/_/g, ' ')}`}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: BRAND.text,
                  background: '#FFFFFF',
                  border: `1px solid ${BRAND.border}`,
                  textDecoration: 'none',
                }}
              >
                <ExternalLink size={12} /> Abrir en pestaña
              </a>
              <a
                href={previewUrl}
                download={
                  selectedReport === 'executive'
                    ? 'SOLGER_Reporte_Ejecutivo.html'
                    : `SOLGER_Reporte_${selectedReport}.html`
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: BRAND.text,
                  background: '#FFFFFF',
                  border: `1px solid ${BRAND.border}`,
                  textDecoration: 'none',
                }}
              >
                <Download size={12} /> Descargar HTML
              </a>
              <button
                onClick={handlePrint}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: BRAND.teal,
                  background: BRAND.tealL,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <Printer size={12} /> Imprimir / Guardar PDF
              </button>
            </div>
          </div>

          <iframe
            key={`${selectedReport}-${iframeKey}`}
            src={previewUrl}
            title="Vista previa del reporte SOLGER"
            style={{
              width: '100%',
              height: 780,
              border: 'none',
              background: '#F0F2F5',
            }}
          />
        </div>
      </div>
    </div>
  );
}
