// Cliente HTTP para el backend SOLGER
import type {
  AlertsResponse,
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

  /** Alarmas activas de todas las plantas */
  getAlerts: () => apiFetch<AlertsResponse>('/alerts'),

  /** Limpiar cache del proxy */
  clearCache: () =>
    fetch(`${BASE}/cache/clear`, { method: 'POST' }).then((r) => r.json()),
};
