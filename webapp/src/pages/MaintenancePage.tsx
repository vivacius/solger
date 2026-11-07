import { useState, useMemo } from 'react';
import {
  Wrench, AlertTriangle, ShieldCheck, Clock,
  X, Plus, Info, Settings, Activity,
} from 'lucide-react';

import { api } from '../lib/api';
import { useFetch } from '../hooks/useFetch';
import { Header } from '../components/layout/Header';
import { LoadingSpinner } from '../components/ui/States';
import { fmt, BRAND } from '../lib/utils';
import type { AlarmItem } from '../types/api';

/* ── Constantes de dominio ─────────────────────────────────────── */
const HSP = 4.5;          // Horas sol pico Valle del Cauca
const EFF = 0.80;          // Factor de pérdidas típico de sistema
const PR_WARN = 70;        // PR% por debajo del cual → alerta
const PR_CRIT = 50;        // PR% crítico

/* ── Card style compartido ─────────────────────────────────────── */
const SC = {
  background: BRAND.card,
  border: `1px solid ${BRAND.border}`,
  borderRadius: 10,
  boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
  overflow: 'hidden',
} as const;

/* ── Definición de tareas de mantenimiento ─────────────────────── */
const MAINT_DEFS = [
  { value: 'limpieza',     label: 'Limpieza de Módulos',      icon: '🧹', color: '#24A5AE', intervalMonths: 6  },
  { value: 'electrica',   label: 'Inspección Eléctrica',      icon: '⚡', color: '#F5B914', intervalMonths: 12 },
  { value: 'termografia', label: 'Termografía Infrarroja',    icon: '🌡️', color: '#EF4444', intervalMonths: 24 },
  { value: 'correctivo',  label: 'Mantenimiento Correctivo',  icon: '🔧', color: '#94A3B8', intervalMonths: null },
  { value: 'otro',        label: 'Otro',                      icon: '📋', color: '#94A3B8', intervalMonths: null },
] as const;

type MaintType = 'limpieza' | 'electrica' | 'termografia' | 'correctivo' | 'otro';

interface MaintenanceRecord {
  id: string;
  date: string; // YYYY-MM-DD
  type: MaintType;
  notes: string;
}

/* ── localStorage helpers ──────────────────────────────────────── */
const getMaintLog = (plantCode: string): MaintenanceRecord[] => {
  try {
    const raw = localStorage.getItem(`solger_maint_${plantCode}`);
    return raw ? (JSON.parse(raw) as MaintenanceRecord[]) : [];
  } catch { return []; }
};

const saveMaintLog = (plantCode: string, records: MaintenanceRecord[]) => {
  localStorage.setItem(`solger_maint_${plantCode}`, JSON.stringify(records));
};

/* ── Clasificación de alarmas ──────────────────────────────────── */
// Palabras clave que indican que la alarma REQUIERE revisión técnica
const CRITICAL_KW = [
  'inversor', 'inverter', 'comunicaci', 'communication', 'string',
  'aislamiento', 'insulation', 'fallo', 'fault', 'error', 'offline',
  'falla', 'failure', 'sobretensión', 'overcurrent', 'cortocircuito',
  'short', 'arco', 'arc', 'temperatura alta', 'overtemp', 'protección',
];
// Palabras clave que indican una alarma informativa / ambiental
const GENERIC_KW = [
  'radiaci', 'radiation', 'sombreado', 'shading', 'irradiancia',
  'irradiance', 'noche', 'night', 'baja generación', 'low generation',
];

const classifyAlarm = (alarm: AlarmItem): 'REVISAR' | 'GENERICA' => {
  const text = `${alarm.alarmName ?? ''} ${alarm.alarmCause ?? ''}`.toLowerCase();
  if (GENERIC_KW.some(k => text.includes(k))) return 'GENERICA';
  if (CRITICAL_KW.some(k => text.includes(k))) return 'REVISAR';
  return 'REVISAR'; // Desconocida → revisar por precaución
};

/* ── Cálculo de próximas tareas preventivas ────────────────────── */
type NextTask = {
  type: MaintType;
  label: string;
  icon: string;
  color: string;
  dueDate: Date;
  daysUntil: number;
  isOverdue: boolean;
  priority: 'alta' | 'media' | 'ok';
  count: number;
  lastDate: string | null;
};

const calcNextTasks = (gridDate: string | null, records: MaintenanceRecord[]): NextTask[] => {
  // Si no hay fecha de conexión, asumimos instalación hace 1 año (caso conservador)
  const baseline = gridDate
    ? new Date(gridDate)
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const now = new Date();

  return MAINT_DEFS.filter(m => m.intervalMonths !== null).map(mt => {
    const typeRecs = records
      .filter(r => r.type === mt.value)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const lastDate = typeRecs.length > 0 ? new Date(typeRecs[0].date) : baseline;
    const nextDate = new Date(lastDate);
    nextDate.setMonth(nextDate.getMonth() + (mt.intervalMonths as number));

    const daysUntil = Math.ceil((nextDate.getTime() - now.getTime()) / 86_400_000);
    const isOverdue = daysUntil < 0;
    const priority: 'alta' | 'media' | 'ok' = isOverdue
      ? 'alta'
      : daysUntil <= 45 ? 'media' : 'ok';

    return {
      type: mt.value as MaintType,
      label: mt.label,
      icon: mt.icon,
      color: mt.color,
      dueDate: nextDate,
      daysUntil,
      isOverdue,
      priority,
      count: typeRecs.length,
      lastDate: typeRecs.length > 0 ? typeRecs[0].date : null,
    };
  });
};

/* ═══════════════════════════════════════════════════════════════ */
/*  MAIN PAGE                                                       */
/* ═══════════════════════════════════════════════════════════════ */
export default function MaintenancePage() {
  const { data: summary, loading: summaryLoading, refresh } = useFetch(
    api.getSummary, [], { refreshInterval: 5 * 60 * 1000 }
  );
  const { data: alertsData, loading: alertsLoading } = useFetch(
    api.getAlerts, [], { refreshInterval: 5 * 60 * 1000 }
  );
  const { data: anomaliesData } = useFetch(
    api.getAnomalies, [], { refreshInterval: 5 * 60 * 1000 }
  );
  const { data: ordersData } = useFetch(
    () => api.getMaintenanceOrders(), [], { refreshInterval: 5 * 60 * 1000 }
  );

  // Clave para forzar re-render tras guardar en localStorage
  const [refreshKey, setRefreshKey] = useState(0);

  // Planta seleccionada para modal de historial
  const [modalPlant, setModalPlant] = useState<{ code: string; name: string } | null>(null);

  /* ── Clasificación de alarmas ─── */
  const classifiedAlarms = useMemo(() => {
    if (!alertsData?.alarms) return { revisar: [] as AlarmItem[], genericas: [] as AlarmItem[] };
    return {
      revisar:   alertsData.alarms.filter(a => classifyAlarm(a) === 'REVISAR'),
      genericas: alertsData.alarms.filter(a => classifyAlarm(a) === 'GENERICA'),
    };
  }, [alertsData]);

  /* ── Datos de salud por planta ─── */
  const plantHealth = useMemo(() => {
    if (!summary) return [];

    return summary.plants.map(plant => {
      const kpi = summary.kpis.find(
        k => k.plantCode === plant.plantCode || k.stationCode === plant.plantCode
      );
      const dim = kpi?.dataItemMap ?? {};

      const anomEval  = anomaliesData?.evaluations?.find(e => e.plant_code === plant.plantCode);
      const rawDayPower  = dim.day_power ?? 0;
      const monthPower   = dim.month_power ?? 0;
      const daysElapsed  = Math.max(1, new Date().getDate());
      const dayPower     = rawDayPower > 0 ? rawDayPower : (anomEval?.gen_kwh || (monthPower > 0 ? monthPower / daysElapsed : 0));
      const capacity     = plant.capacity ?? 0;
      const capEstimated = Boolean(plant.capacityEstimated) || (plant.capacityNominal ?? capacity) <= 0;

      // Índice de desempeño vs. diseño usando capacidad efectiva (nominal o P90 histórica desde solger.planta)
      const expectedGen = capacity * HSP * EFF;
      const pr = expectedGen > 0
        ? Math.min(150, (dayPower / expectedGen) * 100)
        : null;

      const kwhPerKwp = capacity > 0 ? dayPower / capacity : null;

      const health   = dim.real_health_state ?? 0;
      const hasAlarm = alertsData?.alarms.some(
        a => classifyAlarm(a) === 'REVISAR' && (a.plantCode === plant.plantCode || a.stationCode === plant.plantCode || a.stationCode === plant.plantName)
      ) ?? false;

      const dbOrders = (ordersData?.orders ?? [])
        .filter((o: any) => o.plant_code === plant.plantCode)
        .map((o: any) => ({
          id: String(o.id),
          date: String(o.fecha_ejecucion || o.created_at || '').slice(0, 10),
          type: (o.tipo || 'otro') as MaintType,
          notes: o.descripcion || o.titulo || '',
        }));
      const localRecs = getMaintLog(plant.plantCode);
      const records   = dbOrders.length > 0 ? dbOrders : localRecs;
      const nextTasks = calcNextTasks(plant.gridConnectionDate, records);
      const urgentTask   = nextTasks.find(t => t.priority === 'alta');
      const upcomingTask = nextTasks.find(t => t.priority === 'media');
      const nextTask     = urgentTask ?? upcomingTask ?? nextTasks[0];

      // Prioridad global de la planta (Huawei: 1=Offline, 2=Alarma, 3=Operativa + motor estadístico)
      let overallPriority: 'urgente' | 'atencion' | 'ok';
      if (health === 1 || hasAlarm || anomEval?.anomalia?.severidad === 'critica' || (pr !== null && pr < PR_CRIT) || !!urgentTask) {
        overallPriority = 'urgente';
      } else if (health === 2 || anomEval?.anomalia?.severidad === 'atencion' || (pr !== null && pr < PR_WARN) || !!upcomingTask) {
        overallPriority = 'atencion';
      } else {
        overallPriority = 'ok';
      }

      return {
        plant, dim, dayPower, capacity, capEstimated,
        pr, kwhPerKwp, health, hasAlarm, anomEval,
        records, nextTasks, nextTask, overallPriority,
      };
    }).sort((a, b) => {
      const o = { urgente: 0, atencion: 1, ok: 2 };
      return o[a.overallPriority] - o[b.overallPriority];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, alertsData, anomaliesData, ordersData, refreshKey]);

  /* ── Semáforo portafolio ─── */
  const counts = useMemo(() => ({
    ok:       plantHealth.filter(p => p.overallPriority === 'ok').length,
    atencion: plantHealth.filter(p => p.overallPriority === 'atencion').length,
    urgente:  plantHealth.filter(p => p.overallPriority === 'urgente').length,
  }), [plantHealth]);

  /* ─────────────────────────────── RENDER ─────────────────────── */
  return (
    <div>
      <Header onRefresh={refresh} loading={summaryLoading} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Encabezado ─────────────────────────────────────────── */}
        <div>
          <h2 className="page-title" style={{ fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wrench size={17} color={BRAND.teal} strokeWidth={2.2} />
            Mantenimiento Post-Venta
          </h2>
          <p style={{ fontSize: 12, color: BRAND.muted, marginTop: 3 }}>
            Seguimiento, monitoreo y control O&M del portafolio solar.
            Diagnóstico automático por comportamiento y alarmas activas.
          </p>
        </div>

        {/* ── Semáforo portafolio ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {([
            { count: counts.ok,       label: 'Sin novedad',        icon: <ShieldCheck size={18} color={BRAND.greenD} />, top: BRAND.green,  bg: BRAND.greenL, valColor: BRAND.greenD },
            { count: counts.atencion, label: 'Requieren atención', icon: <Clock size={18} color="#92400E" />,            top: BRAND.gold,   bg: BRAND.goldL,  valColor: '#92400E'   },
            { count: counts.urgente,  label: 'Acción urgente',     icon: <AlertTriangle size={18} color="#991B1B" />,    top: BRAND.red,    bg: BRAND.redL,   valColor: '#991B1B'   },
          ] as const).map(({ count, label, icon, top, bg, valColor }) => (
            <div key={label} style={{ ...SC, overflow: 'visible', borderTop: `3px solid ${top}` }}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {icon}
                </div>
                <div>
                  <p style={{ fontSize: 24, fontWeight: 800, color: valColor, letterSpacing: '-0.03em', lineHeight: 1 }}>
                    {summaryLoading ? '—' : count}
                  </p>
                  <p style={{ fontSize: 11, color: BRAND.muted, fontWeight: 600, marginTop: 2 }}>{label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── PANEL DE DIAGNÓSTICO ESTADÍSTICO DE ANOMALÍAS (4 CAPAS — SUPABASE) ─── */}
        <div style={{ ...SC, borderTop: `3px solid ${BRAND.teal}` }}>
          <div style={{
            padding: '10px 16px',
            borderBottom: `1px solid ${BRAND.border}`,
            background: 'linear-gradient(90deg, rgba(36,165,174,0.06) 0%, rgba(88,174,50,0.04) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={15} color={BRAND.teal} />
              <div>
                <p className="section-title" style={{ fontSize: 13.5, margin: 0 }}>
                  Motor Estadístico de Detección de Anomalías (4 Capas · Supabase <code>solger.kpi_diario</code>)
                </p>
                <p style={{ fontSize: 11, color: BRAND.muted, margin: 0 }}>
                  Evalúa cada planta sin piranómetro cruzando: (1) Reglas duras, (2) Esperado físico P50, (3) Ratio vs. plantas vecinas del Valle y (4) Z-Score robusto MAD + EWMA (Soiling)
                </p>
              </div>
            </div>
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
              background: BRAND.tealL, color: BRAND.teal,
            }}>
              {anomaliesData?.anomaliesCount ?? 0} anomalías detectadas hoy
            </span>
          </div>

          {/* Resumen de las 4 capas estadísticas */}
          {(() => {
            const evals = anomaliesData?.evaluations ?? [];
            const validYfs = evals.map(e => e.yf_kwh_kwp).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
            const medianYf = validYfs.length > 0 ? validYfs[Math.floor(validYfs.length / 2)] : 0;
            const totalLostKwh = evals.reduce((s, e) => s + (e.kwh_perdidos || 0), 0);
            const totalLostCop = evals.reduce((s, e) => s + (e.cop_perdidos || 0), 0);
            const lowPeerCount = evals.filter(e => e.ratio_pares != null && e.ratio_pares < 0.85).length;

            return (
              <div style={{ padding: '12px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: BRAND.surface, border: `1px solid ${BRAND.border}` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>
                      Capa 3 · Mediana Clúster Valle
                    </span>
                    <div style={{ fontSize: 18, fontWeight: 800, color: BRAND.teal, marginTop: 2 }}>
                      {fmt(medianYf, 2)} <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.muted }}>kWh/kWp·día</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: BRAND.dim, marginTop: 2 }}>
                      Referencia solar real entre pares sin piranómetro
                    </div>
                  </div>

                  <div style={{ padding: '10px 12px', borderRadius: 8, background: BRAND.surface, border: `1px solid ${BRAND.border}` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>
                      Desviación entre Pares (&lt;85%)
                    </span>
                    <div style={{ fontSize: 18, fontWeight: 800, color: lowPeerCount > 0 ? '#92400E' : BRAND.greenD, marginTop: 2 }}>
                      {lowPeerCount} <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.muted }}>plantas</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: BRAND.dim, marginTop: 2 }}>
                      Plantas por debajo del 85% de sus vecinas hoy
                    </div>
                  </div>

                  <div style={{ padding: '10px 12px', borderRadius: 8, background: BRAND.surface, border: `1px solid ${BRAND.border}` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>
                      Energía No Capturada Est.
                    </span>
                    <div style={{ fontSize: 18, fontWeight: 800, color: totalLostKwh > 0 ? BRAND.red : BRAND.text, marginTop: 2 }}>
                      {fmt(totalLostKwh, 1)} <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.muted }}>kWh/día</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: BRAND.dim, marginTop: 2 }}>
                      Brecha respecto al esperado físico P50 ({(HSP * EFF).toFixed(1)} kWh/kWp)
                    </div>
                  </div>

                  <div style={{ padding: '10px 12px', borderRadius: 8, background: BRAND.surface, border: `1px solid ${BRAND.border}` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase' }}>
                      Impacto Económico (Tarifa Celsia)
                    </span>
                    <div style={{ fontSize: 18, fontWeight: 800, color: totalLostCop > 0 ? BRAND.red : BRAND.greenD, marginTop: 2 }}>
                      ${Math.round(totalLostCop).toLocaleString('es-CO')} <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.muted }}>COP/día</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: BRAND.dim, marginTop: 2 }}>
                      Valorado a Costo Unitario Celsia ($964.13/kWh)
                    </div>
                  </div>
                </div>

                {/* Tabla compacta de resultados del motor estadístico */}
                <div style={{ overflowX: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: BRAND.surface, borderBottom: `1px solid ${BRAND.border}` }}>
                        {['Planta', 'Gen. (kWh/día)', 'Esp. P50', 'Yf (kWh/kWp)', 'Ratio vs Pares', 'Z-Score MAD', 'EWMA (Soiling)', 'Pérdida COP/día', 'Diagnóstico Estadístico'].map(col => (
                          <th key={col} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {evals.map(ev => {
                        const peerPct = ev.ratio_pares != null ? Math.round(ev.ratio_pares * 100) : null;
                        const peerColor = peerPct == null ? BRAND.dim : peerPct < 75 ? BRAND.red : peerPct < 88 ? BRAND.gold : BRAND.green;
                        const zVal = ev.z_score_robusto;
                        const zColor = zVal == null ? BRAND.dim : zVal < -2.2 ? BRAND.red : zVal < -1.5 ? '#92400E' : BRAND.greenD;
                        return (
                          <tr key={ev.plant_code} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                            <td style={{ padding: '7px 10px', fontWeight: 700, color: BRAND.text }}>{ev.plant_name}</td>
                            <td style={{ padding: '7px 10px', fontWeight: 600 }}>{fmt(ev.gen_kwh, 1)}</td>
                            <td style={{ padding: '7px 10px', color: BRAND.muted }}>{ev.expected_kwh > 0 ? fmt(ev.expected_kwh, 1) : '—'}</td>
                            <td style={{ padding: '7px 10px', fontWeight: 700 }}>{ev.yf_kwh_kwp != null ? fmt(ev.yf_kwh_kwp, 2) : '—'}</td>
                            <td style={{ padding: '7px 10px', minWidth: 110 }}>
                              {peerPct != null ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 48, height: 5, borderRadius: 3, background: BRAND.surface, overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.min(100, peerPct)}%`, height: '100%', background: peerColor }} />
                                  </div>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: peerColor }}>{peerPct}%</span>
                                </div>
                              ) : '—'}
                            </td>
                            <td style={{ padding: '7px 10px', fontWeight: 700, color: zColor }}>
                              {zVal != null ? `${zVal > 0 ? '+' : ''}${zVal.toFixed(2)}σ` : '—'}
                            </td>
                            <td style={{ padding: '7px 10px', color: BRAND.muted }}>
                              {ev.ewma_residuo != null ? `${Math.round(ev.ewma_residuo * 100)}%` : '—'}
                            </td>
                            <td style={{ padding: '7px 10px', fontWeight: 700, color: ev.cop_perdidos > 0 ? BRAND.red : BRAND.dim }}>
                              {ev.cop_perdidos > 0 ? `-$${Math.round(ev.cop_perdidos).toLocaleString('es-CO')}` : '$0'}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              {ev.anomalia ? (
                                <div>
                                  <span style={{
                                    display: 'inline-block', padding: '2px 7px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                                    background: ev.anomalia.severidad === 'critica' ? BRAND.redL : '#FEF9C3',
                                    color: ev.anomalia.severidad === 'critica' ? '#991B1B' : '#92400E',
                                  }}>
                                    ⚡ {ev.anomalia.tipo.replace(/_/g, ' ').toUpperCase()}
                                  </span>
                                  <div style={{ fontSize: 10, color: BRAND.muted, marginTop: 2 }}>
                                    {ev.anomalia.recomendacion}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.greenD }}>✓ Producción en rango normal</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Tabla de salud por planta ───────────────────────────── */}
        <div style={SC}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={13} color={BRAND.teal} />
            <p className="section-title" style={{ fontSize: 13 }}>Estado de Salud por Planta</p>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: BRAND.dim }}>
              PR = Rendimiento real vs. esperado ({(HSP * EFF).toFixed(1)} kWh/kWp·día ref.)
            </span>
          </div>

          {summaryLoading && !summary ? (
            <div style={{ padding: 24 }}><LoadingSpinner text="Analizando portafolio..." /></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                    {['Planta', 'Estado', 'PR Hoy', 'kWh/kWp', 'Intervenciones', 'Próxima Tarea', 'Prioridad', ''].map(h => (
                      <th key={h} style={{
                        padding: '7px 12px', textAlign: 'left',
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                        textTransform: 'uppercase', color: BRAND.muted,
                        background: BRAND.surface, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plantHealth.map(ph => {
                    const { plant, pr, kwhPerKwp, health, capEstimated, capacity, anomEval, records, nextTask, overallPriority } = ph;

                    const healthMap = {
                      3: { label: 'Operativa', color: BRAND.greenD, bg: BRAND.greenL },
                      2: { label: 'Alarma',    color: '#92400E',     bg: '#FEF9C3'    },
                      1: { label: 'Offline',   color: '#991B1B',     bg: BRAND.redL   },
                      0: { label: 'Sin datos', color: BRAND.muted,   bg: BRAND.surface},
                    };
                    const hc = healthMap[health as keyof typeof healthMap] ?? healthMap[0];

                    const prioMap = {
                      urgente:  { label: 'Urgente',  color: '#991B1B',    bg: BRAND.redL   },
                      atencion: { label: 'Atención', color: '#92400E',    bg: '#FEF9C3'    },
                      ok:       { label: 'OK',       color: BRAND.greenD, bg: BRAND.greenL },
                    };
                    const ps = prioMap[overallPriority];

                    const prColor = pr == null ? BRAND.dim
                      : pr < PR_CRIT ? BRAND.red
                      : pr < PR_WARN ? BRAND.gold
                      : BRAND.green;

                    const sortedRecs = [...records].sort(
                      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
                    );

                    return (
                      <tr
                        key={plant.plantCode}
                        style={{ borderBottom: `1px solid ${BRAND.border}` }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = BRAND.surface}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      >
                        {/* Planta */}
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ fontWeight: 700, fontSize: 12.5, color: BRAND.text, lineHeight: 1.2 }}>
                            {plant.plantName}
                          </div>
                          <div style={{ fontSize: 10.5, color: BRAND.muted, marginTop: 2 }}>
                            {capEstimated ? (
                              <>
                                <span title="Capacidad estimada a partir de generación de hoy y HSP">
                                  ~{capacity > 0 ? capacity.toFixed(1) : '?'} kWp
                                </span>
                                {' '}
                                <span style={{ color: BRAND.gold, fontWeight: 700 }}>*estimado</span>
                              </>
                            ) : `${capacity.toFixed(1)} kWp`}
                          </div>
                        </td>

                        {/* Estado operación */}
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 20,
                            fontSize: 10.5, fontWeight: 700,
                            color: hc.color, background: hc.bg,
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: hc.color, display: 'inline-block' }} />
                            {hc.label}
                          </span>
                        </td>

                        {/* PR */}
                        <td style={{ padding: '9px 12px', minWidth: 110 }}>
                          {pr == null ? (
                            <span style={{ fontSize: 10.5, color: BRAND.dim, fontStyle: 'italic' }}>
                              Cap. no config.
                            </span>
                          ) : (
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: prColor }}>{fmt(pr, 0)}%</span>
                              </div>
                              <div style={{ height: 5, borderRadius: 3, background: BRAND.surface, overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%', width: `${Math.min(100, pr)}%`,
                                  background: prColor, borderRadius: 3,
                                  transition: 'width 0.5s ease',
                                }} />
                              </div>
                              <div style={{ fontSize: 9.5, color: BRAND.dim, marginTop: 2 }}>
                                vs. {fmt(capacity * HSP * EFF, 1)} kWh esp.
                              </div>
                            </div>
                          )}
                        </td>

                        {/* kWh/kWp + Diagnóstico estadístico de pares */}
                        <td style={{ padding: '9px 12px' }}>
                          {kwhPerKwp != null ? (
                            <div>
                              <span style={{
                                fontSize: 13, fontWeight: 800,
                                color: kwhPerKwp < 2.0 ? BRAND.gold : BRAND.text,
                              }}>{fmt(kwhPerKwp, 1)}</span>
                              <span style={{ fontSize: 10, color: BRAND.muted }}> kWh/kWp</span>
                              {anomEval?.ratio_pares != null && (
                                <div style={{ fontSize: 9.5, color: BRAND.dim, marginTop: 1 }}>
                                  Pares: <b>{(anomEval.ratio_pares * 100).toFixed(0)}%</b>
                                  {anomEval.z_score_robusto != null && ` · z=${anomEval.z_score_robusto}`}
                                </div>
                              )}
                              {anomEval?.anomalia ? (
                                <div title={anomEval.anomalia.descripcion} style={{ fontSize: 10, color: BRAND.red, fontWeight: 700, marginTop: 2 }}>
                                  ⚡ {anomEval.anomalia.tipo.replace('_', ' ')}
                                  {anomEval.cop_perdidos > 0 && ` (-$${Math.round(anomEval.cop_perdidos).toLocaleString('es-CO')})`}
                                </div>
                              ) : kwhPerKwp < 2.0 ? (
                                <div style={{ fontSize: 10, color: BRAND.gold, marginTop: 1 }}>⚠ Bajo rendimiento</div>
                              ) : null}
                            </div>
                          ) : <span style={{ color: BRAND.dim, fontSize: 11 }}>—</span>}
                        </td>

                        {/* Historial de intervenciones */}
                        <td style={{ padding: '9px 12px', minWidth: 130 }}>
                          {records.length === 0 ? (
                            <span style={{ fontSize: 11, color: BRAND.dim, fontStyle: 'italic' }}>Sin registros</span>
                          ) : (
                            <div>
                              <span style={{ fontSize: 13, fontWeight: 800, color: BRAND.text }}>{records.length}</span>
                              <span style={{ fontSize: 10.5, color: BRAND.muted }}> intervenciones</span>
                              <div style={{ fontSize: 10, color: BRAND.dim, marginTop: 1 }}>
                                Últ: {new Date(sortedRecs[0].date).toLocaleDateString('es-CO', {
                                  day: '2-digit', month: 'short', year: 'numeric',
                                })}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Próxima tarea */}
                        <td style={{ padding: '9px 12px', minWidth: 160 }}>
                          {nextTask ? (
                            <div>
                              <div style={{
                                fontSize: 11.5, fontWeight: 700,
                                color: nextTask.priority === 'alta' ? BRAND.red
                                  : nextTask.priority === 'media' ? '#92400E'
                                  : BRAND.muted,
                              }}>
                                {nextTask.icon} {nextTask.label}
                              </div>
                              <div style={{ fontSize: 10, color: BRAND.dim, marginTop: 2 }}>
                                {nextTask.isOverdue
                                  ? `⏰ Vencida hace ${Math.abs(nextTask.daysUntil)} días`
                                  : `📅 En ${nextTask.daysUntil} días (${nextTask.dueDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })})`}
                              </div>
                              <div style={{ fontSize: 9.5, color: BRAND.dim, marginTop: 1 }}>
                                {nextTask.count} veces realizad{nextTask.count === 1 ? 'a' : 'as'}
                              </div>
                            </div>
                          ) : <span style={{ fontSize: 11, color: BRAND.dim }}>—</span>}
                        </td>

                        {/* Prioridad global */}
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{
                            display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                            fontSize: 11, fontWeight: 700,
                            color: ps.color, background: ps.bg,
                          }}>{ps.label}</span>
                        </td>

                        {/* Botón historial */}
                        <td style={{ padding: '9px 12px' }}>
                          <button
                            onClick={() => setModalPlant({ code: plant.plantCode, name: plant.plantName })}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', borderRadius: 6,
                              border: `1px solid ${BRAND.border}`,
                              background: 'transparent', cursor: 'pointer',
                              fontSize: 11, fontWeight: 600, color: BRAND.muted,
                              transition: 'all 0.15s', whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLElement).style.background = BRAND.tealL;
                              (e.currentTarget as HTMLElement).style.color = BRAND.teal;
                              (e.currentTarget as HTMLElement).style.borderColor = BRAND.teal;
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLElement).style.background = 'transparent';
                              (e.currentTarget as HTMLElement).style.color = BRAND.muted;
                              (e.currentTarget as HTMLElement).style.borderColor = BRAND.border;
                            }}
                          >
                            <Settings size={11} /> Historial
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Alarmas clasificadas ────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>

          {/* Panel: Alarmas a Revisar */}
          <div style={SC}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={13} color={BRAND.red} />
              <p className="section-title" style={{ fontSize: 13 }}>Alarmas a Revisar</p>
              <span style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                color: BRAND.red, background: BRAND.redL,
                padding: '1px 8px', borderRadius: 20,
              }}>{classifiedAlarms.revisar.length}</span>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {alertsLoading ? (
                <div style={{ padding: 16 }}><LoadingSpinner text="Consultando alarmas..." /></div>
              ) : classifiedAlarms.revisar.length === 0 ? (
                <div style={{ padding: '28px 16px', textAlign: 'center' }}>
                  <ShieldCheck size={28} color={BRAND.greenD} style={{ margin: '0 auto 8px' }} />
                  <p style={{ fontSize: 12, color: BRAND.muted }}>Sin alarmas activas que requieran revisión técnica</p>
                </div>
              ) : (
                classifiedAlarms.revisar.map((alarm, i) => (
                  <AlarmCard
                    key={alarm.alarmId ?? i}
                    alarm={alarm}
                    isLast={i === classifiedAlarms.revisar.length - 1}
                    variant="revisar"
                  />
                ))
              )}
            </div>
          </div>

          {/* Panel: Alarmas Genéricas */}
          <div style={SC}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Info size={13} color={BRAND.muted} />
              <p className="section-title" style={{ fontSize: 13 }}>Alarmas Genéricas / Informativas</p>
              <span style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                color: BRAND.muted, background: BRAND.surface,
                padding: '1px 8px', borderRadius: 20,
              }}>{classifiedAlarms.genericas.length}</span>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {alertsLoading ? (
                <div style={{ padding: 16 }}><LoadingSpinner text="Consultando..." /></div>
              ) : classifiedAlarms.genericas.length === 0 ? (
                <div style={{ padding: '28px 16px', textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: BRAND.muted }}>Sin alertas genéricas activas</p>
                </div>
              ) : (
                classifiedAlarms.genericas.map((alarm, i) => (
                  <AlarmCard
                    key={alarm.alarmId ?? i}
                    alarm={alarm}
                    isLast={i === classifiedAlarms.genericas.length - 1}
                    variant="generica"
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Nota sobre capacidades estimadas ───────────────────── */}
        {plantHealth.some(p => p.capEstimated) && (
          <div style={{
            padding: '8px 14px', borderRadius: 8,
            background: BRAND.goldL, border: `1px solid rgba(245,185,20,0.25)`,
            fontSize: 11.5, color: '#78350F', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Info size={13} />
            <span>
              <strong>* Capacidad estimada por histórico (P90):</strong> Para plantas con capacidad nominal en 0 en FusionSolar, se utiliza su capacidad estimada desde la serie histórica en <code>solger.planta</code>, habilitando el cálculo de índice de desempeño, kWh/kWp y detección de anomalías contra plantas vecinas.
            </span>
          </div>
        )}

      </div>

      {/* ── Modal de historial de mantenimiento ─────────────────── */}
      {modalPlant && (
        <MaintenanceModal
          plantCode={modalPlant.code}
          plantName={modalPlant.name}
          onClose={() => {
            setModalPlant(null);
            setRefreshKey(k => k + 1); // Re-procesar tabla con datos actualizados
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  ALARM CARD                                                      */
/* ═══════════════════════════════════════════════════════════════ */
function AlarmCard({
  alarm, isLast, variant,
}: {
  alarm: AlarmItem;
  isLast: boolean;
  variant: 'revisar' | 'generica';
}) {
  const dotColor = variant === 'revisar' ? BRAND.red : BRAND.dim;
  const hoursActive = alarm.raiseTime
    ? Math.floor((Date.now() - alarm.raiseTime) / 3_600_000)
    : null;

  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: isLast ? 'none' : `1px solid ${BRAND.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, marginTop: 5, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: BRAND.text }}>
            {alarm.alarmName || 'Alarma sin nombre'}
          </div>
          <div style={{ fontSize: 11, color: BRAND.muted, marginTop: 2 }}>
            {alarm.devName || 'Dispositivo —'} · <span style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{alarm.stationCode}</span>
          </div>
          {alarm.alarmCause && (
            <div style={{ fontSize: 11, color: BRAND.dim, marginTop: 4, fontStyle: 'italic' }}>
              📌 {alarm.alarmCause}
            </div>
          )}
          {alarm.repairSuggestion && variant === 'revisar' && (
            <div style={{
              fontSize: 11, marginTop: 5, padding: '4px 9px', borderRadius: 5,
              background: 'rgba(36,165,174,0.06)', border: `1px solid ${BRAND.tealL}`,
              color: BRAND.teal, fontWeight: 600,
            }}>
              🔧 {alarm.repairSuggestion}
            </div>
          )}
          {hoursActive !== null && (
            <div style={{ fontSize: 10, color: BRAND.dim, marginTop: 4 }}>
              🕐 {new Date(alarm.raiseTime!).toLocaleString('es-CO', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
              {' — '}
              <strong style={{ color: hoursActive > 24 ? BRAND.red : BRAND.muted }}>
                {hoursActive}h activa
              </strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  MAINTENANCE MODAL                                               */
/* ═══════════════════════════════════════════════════════════════ */
function MaintenanceModal({
  plantCode, plantName, onClose,
}: {
  plantCode: string;
  plantName: string;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<MaintenanceRecord[]>(
    () => getMaintLog(plantCode).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  );
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: 'limpieza' as MaintType,
    notes: '',
  });

  const addRecord = async () => {
    if (!form.date) return;
    const updated = [
      ...records,
      { ...form, id: Date.now().toString() },
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setRecords(updated);
    saveMaintLog(plantCode, updated);
    try {
      await api.createMaintenanceOrder({
        plant_code: plantCode,
        tipo: form.type,
        estado: 'completada',
        titulo: `Mantenimiento: ${form.type}`,
        descripcion: form.notes,
        fecha_ejecucion: form.date,
      });
    } catch (err) {
      console.error('Error guardando en solger.orden_trabajo:', err);
    }
    setForm({ date: new Date().toISOString().slice(0, 10), type: 'limpieza', notes: '' });
  };

  const deleteRecord = (id: string) => {
    const updated = records.filter(r => r.id !== id);
    setRecords(updated);
    saveMaintLog(plantCode, updated);
  };

  // Resumen por tipo de mantenimiento
  const summary = useMemo(() => {
    return MAINT_DEFS.map(md => ({
      ...md,
      count: records.filter(r => r.type === md.value).length,
    }));
  }, [records]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: BRAND.card, borderRadius: 14, width: '100%', maxWidth: 580,
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        border: `1px solid ${BRAND.border}`,
        boxShadow: '0 24px 60px rgba(15,23,42,0.22)',
      }}>

        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: `1px solid ${BRAND.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: BRAND.text }}>
              📋 Historial de Mantenimiento
            </p>
            <p style={{ fontSize: 11.5, color: BRAND.muted, marginTop: 2 }}>{plantName}</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND.dim, borderRadius: 6, padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Contadores por tipo */}
        <div style={{ padding: '10px 20px', borderBottom: `1px solid ${BRAND.border}`, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {summary.map(s => (
            <div key={s.value} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20,
              background: BRAND.surface, border: `1px solid ${BRAND.border}`,
              fontSize: 11, fontWeight: 600, color: BRAND.muted,
            }}>
              {s.icon}
              <span style={{ color: s.count > 0 ? BRAND.text : BRAND.dim }}>
                {s.label}: <strong>{s.count}</strong>
              </span>
            </div>
          ))}
        </div>

        {/* Lista de registros */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: BRAND.dim, fontSize: 12 }}>
              <Wrench size={28} color={BRAND.dim} style={{ margin: '0 auto 8px', display: 'block' }} />
              Sin registros de mantenimiento. Agrega el primero ↓
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {records.map(r => {
                const def = MAINT_DEFS.find(m => m.value === r.type);
                return (
                  <div key={r.id} style={{
                    padding: '10px 14px', borderRadius: 8,
                    border: `1px solid ${BRAND.border}`,
                    background: BRAND.bg,
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{def?.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: BRAND.text }}>{def?.label}</span>
                        <span style={{ fontSize: 11, color: BRAND.muted, flexShrink: 0 }}>
                          {new Date(r.date).toLocaleDateString('es-CO', {
                            day: '2-digit', month: 'long', year: 'numeric',
                          })}
                        </span>
                      </div>
                      {r.notes && (
                        <p style={{ fontSize: 11.5, color: BRAND.muted, marginTop: 3 }}>{r.notes}</p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteRecord(r.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: BRAND.dim, padding: 2, borderRadius: 4, flexShrink: 0,
                      }}
                      title="Eliminar registro"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Formulario de nuevo registro */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${BRAND.border}`,
          background: BRAND.bg, borderRadius: '0 0 14px 14px',
        }}>
          <p style={{ fontSize: 10.5, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Registrar intervención
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              style={{
                padding: '7px 10px', borderRadius: 7, border: `1px solid ${BRAND.border}`,
                fontSize: 12.5, color: BRAND.text, background: BRAND.card, outline: 'none',
                width: '100%', boxSizing: 'border-box',
              }}
            />
            <select
              value={form.type}
              onChange={e => setForm(p => ({ ...p, type: e.target.value as MaintType }))}
              style={{
                padding: '7px 10px', borderRadius: 7, border: `1px solid ${BRAND.border}`,
                fontSize: 12.5, color: BRAND.text, background: BRAND.card, outline: 'none',
                width: '100%', boxSizing: 'border-box',
              }}
            >
              {MAINT_DEFS.map(m => (
                <option key={m.value} value={m.value}>{m.icon} {m.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Notas u observaciones (opcional)..."
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addRecord()}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 7,
                border: `1px solid ${BRAND.border}`,
                fontSize: 12.5, color: BRAND.text, background: BRAND.card, outline: 'none',
              }}
            />
            <button
              onClick={addRecord}
              disabled={!form.date}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 16px', borderRadius: 7, border: 'none',
                background: form.date ? BRAND.green : BRAND.surface,
                color: form.date ? '#fff' : BRAND.dim,
                fontSize: 12.5, fontWeight: 700, cursor: form.date ? 'pointer' : 'default',
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (form.date) (e.currentTarget as HTMLElement).style.opacity = '0.88'; }}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
            >
              <Plus size={13} /> Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
