import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { ErrorState, LoadingSpinner } from '../components/ui/States';
import { Header } from '../components/layout/Header';
import { fmtDate, plantSlug, BRAND } from '../lib/utils';

export default function AlertsPage() {
  const { data, loading, error, refresh } = useFetch(
    api.getAlerts, [], { refreshInterval: 5 * 60 * 1000 }
  );

  return (
    <div>
      <Header onRefresh={refresh} loading={loading} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Header section */}
        <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="page-title" style={{ fontSize: 20 }}>Panel de Alertas y Alarmas</h2>
            <p style={{ fontSize: 12.5, color: BRAND.muted, marginTop: 2 }}>
              Monitoreo en tiempo real de fallos o eventos reportados por FusionSolar.
            </p>
          </div>
          {data && (
            <span
              style={{
                padding: '4px 12px',
                borderRadius: 9999,
                fontSize: 11.5,
                fontWeight: 700,
                background: BRAND.redL,
                color: BRAND.red,
                border: `1px solid rgba(239,68,68,0.22)`,
              }}
            >
              {data.total} Alertas Activas
            </span>
          )}
        </div>

        {loading && !data && <LoadingSpinner text="Consultando alarmas..." />}
        {error && <ErrorState message={error} onRetry={refresh} />}

        {/* Safe state */}
        {data && data.alarms.length === 0 && (
          <div
            className="card"
            style={{
              padding: '36px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
                background: BRAND.greenL,
                border: `1px solid rgba(88,174,50,0.18)`,
              }}
            >
              <ShieldCheck style={{ color: BRAND.greenD }} size={24} />
            </div>
            <h3 className="section-title" style={{ fontSize: 15, marginBottom: 4 }}>Sistema en Perfecto Estado</h3>
            <p style={{ fontSize: 12.5, color: BRAND.muted, maxWidth: 360 }}>
              No hay alarmas activas reportadas en ninguna de tus plantas en este momento.
            </p>
          </div>
        )}

        {/* Alarms list table */}
        {data && data.alarms.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                    {['Alarma', 'Planta / Dispositivo', 'Causa Probable', 'Sugerencia', 'Fecha'].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: '8px 14px',
                          textAlign: h === 'Fecha' ? 'right' : 'left',
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
                  {data.alarms.map((alarm, idx) => (
                    <tr
                      key={alarm.alarmId || idx}
                      style={{ borderBottom: `1px solid ${BRAND.border}`, verticalAlign: 'top' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = BRAND.surface}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '12px 14px', minWidth: 170 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <AlertTriangle size={14} style={{ color: BRAND.red, flexShrink: 0, marginTop: 2 }} />
                          <span style={{ fontWeight: 700, fontSize: 12.5, color: BRAND.text, lineHeight: 1.35 }}>
                            {alarm.alarmName || 'Alarma no especificada'}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', minWidth: 160 }}>
                        {alarm.plantCode ? (
                          <Link
                            to={`/plantas/${plantSlug(alarm.plantCode)}`}
                            style={{ fontSize: 12.5, fontWeight: 700, color: BRAND.teal, textDecoration: 'none', display: 'block' }}
                          >
                            {alarm.stationCode}
                          </Link>
                        ) : (
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: BRAND.text }}>{alarm.stationCode}</div>
                        )}
                        <div style={{ fontSize: 11, color: BRAND.muted, marginTop: 2 }}>{alarm.devName || 'Planta General'}</div>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: BRAND.text, minWidth: 240, maxWidth: 340, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.45 }}>
                        {alarm.alarmCause || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: BRAND.muted, minWidth: 260, maxWidth: 380, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.45 }}>
                        {alarm.repairSuggestion || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 11.5, color: BRAND.dim, whiteSpace: 'nowrap' }}>
                        {alarm.raiseTime ? fmtDate(new Date(alarm.raiseTime).toISOString()) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
