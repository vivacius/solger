// Tipos TypeScript para la API de FusionSolar / SOLGER

export interface Plant {
  plantCode: string;
  plantName: string;
  capacity: number;
  latitude: string | null;
  longitude: string | null;
  plantAddress: string | null;
  gridConnectionDate: string | null;
  contactPerson: string | null;
  contactMethod: string | null;
}

export interface KpiDataItemMap {
  // Energía
  day_power?: number;        // Energía hoy (kWh)
  month_power?: number;      // Energía mes (kWh)
  total_power?: number;      // Energía total (kWh)
  day_on_grid_energy?: number; // Energía exportada hoy (kWh)
  day_use_energy?: number;    // Consumo de la carga hoy (kWh)
  // Potencia
  active_power?: number;     // Potencia activa actual (kW)
  // Ingresos
  day_income?: number;
  total_income?: number;
  // Estado (Huawei Northbound: 1=Offline/Desconectada, 2=Falla/Alarma, 3=Operativa/Healthy)
  real_health_state?: number;
  // PR / Rendimiento
  performance_ratio?: number;
  theoretical_yield?: number;
}

export interface PlantKpi {
  plantCode?: string;
  stationCode?: string;
  dataItemMap: KpiDataItemMap;
}

export interface PortfolioSummary {
  totalCapacity_kWp: number;
  totalPlants: number;
  activePlants: number;
  totalEnergyToday_kWh: number;
  totalEnergyMonth_kWh: number;
  totalEnergyTotal_kWh: number;
  co2Avoided_ton: number;
}

export interface SummaryResponse {
  success: boolean;
  lastUpdated: string;
  summary: PortfolioSummary;
  plants: Plant[];
  kpis: PlantKpi[];
}

export interface PlantsResponse {
  success: boolean;
  total: number;
  plants: Plant[];
}

export interface PlantKpiResponse {
  success: boolean;
  plantCode: string;
  kpi: PlantKpi;
}

export interface DeviceInfo {
  id: string;
  devName: string;
  devTypeId?: number;
  softwareVersion?: string;
  portName?: string;
}

export interface DevicesResponse {
  success: boolean;
  plantCode: string;
  devices: DeviceInfo[];
}

export interface AlarmItem {
  alarmId?: string;
  alarmName?: string;
  alarmCause?: string;
  stationCode?: string;
  plantCode?: string;
  devName?: string;
  repairSuggestion?: string;
  raiseTime?: number;
}

export interface AlertsResponse {
  success: boolean;
  total: number;
  alarms: AlarmItem[];
}

export type HealthState = 1 | 2 | 3; // 1=offline, 2=alarm, 3=ok (Huawei Northbound)
