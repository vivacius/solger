// Cliente HTTP para el backend SOLGER
import type {
  AlertsResponse,
  AnomaliesResponse,
  DevicesResponse,
  PlantKpiResponse,
  PlantsResponse,
  SummaryResponse,
} from '../types/api';

const BASE = '/api';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Encode plantCode para URL (NE=xxx → NE__xxx)
export const encodePlantCode = (code: string) => code.replace('=', '__');

export const api = {
  /** Resumen global del portafolio */
  getSummary: () => apiFetch<SummaryResponse>('/plants/summary'),

  /** Sumatoria diaria de generación del portafolio (últimos N días) */
  getPortfolioDaily: (days = 30) =>
    apiFetch<{ success: boolean; days: number; series: Array<{ date: string; gen_kwh: number; plants_count: number }> }>(
      `/portfolio/daily-generation?days=${days}`
    ),

  /** Malla horaria de irradiancia satelital (Open-Meteo) para el mapa */
  getIrradianceGrid: () =>
    apiFetch<{
      success: boolean;
      source: string;
      times: string[];
      defaultIndex: number;
      dLat: number;
      dLon: number;
      points: Array<{ lat: number; lon: number; radiation: number[]; cloud: number[] }>;
    }>('/satellite/irradiance-grid'),

  /** Lista de plantas */
  getPlants: () => apiFetch<PlantsResponse>('/plants'),

  /** KPI en tiempo real de una planta */
  getPlantKpi: (plantCode: string) =>
    apiFetch<PlantKpiResponse>(`/plants/${encodePlantCode(plantCode)}/kpi`),

  /** KPI por horas de una planta (opcional: date=YYYYMMDD) */
  getPlantKpiDay: (plantCode: string, date?: string) =>
    apiFetch<{ success: boolean; data: unknown[] }>(
      `/plants/${encodePlantCode(plantCode)}/kpi/day${date ? `?date=${date}` : ''}`
    ),

  /** KPI diario de una planta en un mes (opcional: month=YYYYMM) */
  getPlantKpiMonth: (plantCode: string, month?: string) =>
    apiFetch<{ success: boolean; data: unknown[] }>(
      `/plants/${encodePlantCode(plantCode)}/kpi/month${month ? `?month=${month}` : ''}`
    ),

  /** Lista de dispositivos de una planta */
  getPlantDevices: (plantCode: string) =>
    apiFetch<DevicesResponse>(`/plants/${encodePlantCode(plantCode)}/devices`),

  /** Resumen de salud de strings PV (verdes/amarillos/rojos) por planta */
  getPortfolioStringsSummary: () =>
    apiFetch<{
      success: boolean;
      byPlant: Record<
        string,
        {
          plantCode: string;
          plantName: string;
          ok: number;
          low: number;
          fault: number;
          night: number;
          total: number;
          recommendedType: string;
          recommendedLabel: string;
          actionDetail?: string;
        }
      >;
    }>('/portfolio/strings-summary'),

  /** Distribución en vivo de inversores y strings (PV1..PV36) de una planta */
  getPlantStrings: (plantCode: string) =>
    apiFetch<{
      success: boolean;
      plantCode: string;
      source: string;
      inverters: Array<{
        id: string;
        name: string;
        model: string;
        efficiency: number;
        temperature: number;
        activePower_kw: number;
        mpptPower_kw: number;
        medianCurrent_a: number;
        strings: Array<{
          index: number;
          id: string;
          voltage_v: number;
          current_a: number;
          power_w: number;
          status: 'ok' | 'low' | 'fault' | 'night';
          pct_vs_median: number | null;
        }>;
      }>;
    }>(`/plants/${encodePlantCode(plantCode)}/strings`),

  /** Alarmas activas de todas las plantas */
  getAlerts: () => apiFetch<AlertsResponse>('/alerts'),

  /** Diagnóstico estadístico de anomalías (4 capas + solger.kpi_diario) */
  getAnomalies: () => apiFetch<AnomaliesResponse>('/anomalies'),

  /** Órdenes de trabajo / mantenimientos desde solger.orden_trabajo */
  getMaintenanceOrders: (plantCode?: string) =>
    apiFetch<{ success: boolean; total: number; orders: any[] }>(
      `/maintenance/orders${plantCode ? `?plant_code=${encodeURIComponent(plantCode)}` : ''}`
    ),

  /** Registrar orden de trabajo / mantenimiento en solger.orden_trabajo */
  createMaintenanceOrder: (payload: {
    plant_code: string;
    tipo: string;
    prioridad?: string;
    estado?: string;
    titulo?: string;
    descripcion?: string;
    fecha_ejecucion?: string;
  }) =>
    fetch(`${BASE}/maintenance/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json()),

  /** Limpiar cache del proxy */
  clearCache: () =>
    fetch(`${BASE}/cache/clear`, { method: 'POST' }).then((r) => r.json()),
};
