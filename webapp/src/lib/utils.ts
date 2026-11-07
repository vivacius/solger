// Helpers de formateo y utilidades de dominio solar

import type { HealthState } from '../types/api';

/** Formatea un número con separadores de miles */
export const fmt = (n: number | undefined | null, decimals = 1): string => {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/** Formatea energía con unidad apropiada */
export const fmtEnergy = (kWh: number | undefined | null): string => {
  if (kWh == null || isNaN(kWh)) return '—';
  if (kWh >= 1_000_000) return `${fmt(kWh / 1_000_000)} GWh`;
  if (kWh >= 1_000) return `${fmt(kWh / 1_000)} MWh`;
  return `${fmt(kWh)} kWh`;
};

/** Formatea potencia */
export const fmtPower = (kW: number | undefined | null): string => {
  if (kW == null || isNaN(kW)) return '—';
  if (kW >= 1_000) return `${fmt(kW / 1_000)} MW`;
  return `${fmt(kW)} kW`;
};

// SOLGER brand palette — sincronizado con CSS custom properties en index.css
export const BRAND = {
  green:   '#58AE32',
  greenD:  '#3D8A1F',
  greenL:  '#E6F5DC',
  gold:    '#F5B914',
  goldL:   '#FEF8E0',
  teal:    '#24A5AE',
  tealL:   '#E0F5F6',
  bg:      '#F5F6FA',
  surface: '#ECEEF3',
  card:    '#FFFFFF',
  border:  'rgba(15,23,42,0.08)',
  text:    '#172033',
  muted:   '#64748B',
  dim:     '#94A3B8',
  red:     '#EF4444',
  redL:    '#FEE2E2',
};

// Constantes de estado de salud Huawei FusionSolar Northbound API
export const HEALTH_STATE = {
  OFFLINE: 1,
  ALARM: 2,
  OK: 3,
} as const;

/** Estado de salud → texto y color (SOLGER palette, estándar Huawei: 1=Offline, 2=Alarma, 3=Operativa) */
export const healthInfo = (state: number | undefined): {
  label: string;
  color: string;
  bg: string;
  dot: string;
} => {
  switch (state as HealthState) {
    case 3:
      return { label: 'Operativa', color: '#166534', bg: '#DCFCE7', dot: 'bg-green-600' };
    case 2:
      return { label: 'Alarma', color: '#854D0E', bg: '#FEF08A', dot: 'bg-yellow-500' };
    case 1:
      return { label: 'Offline', color: '#991B1B', bg: '#FEE2E2', dot: 'bg-red-600' };
    default:
      return { label: 'Sin datos', color: BRAND.muted, bg: BRAND.surface, dot: 'bg-slate-400' };
  }
};

/** CO2 evitado en toneladas (factor UPME Res. 000085 2024 inventario: 0.220 tCO2eq/MWh) */
export const calcCO2 = (kWh: number): number =>
  Math.round((kWh * 0.000220) * 100) / 100;

/** Extrae departamento de una dirección de FusionSolar */
export const extractRegion = (address: string | null): string => {
  if (!address) return 'Colombia';
  if (address.includes('Palmira')) return 'Palmira, Valle';
  if (address.includes('Cerrito')) return 'El Cerrito, Valle';
  if (address.includes('Guacarí') || address.includes('Guacari')) return 'Guacarí, Valle';
  if (address.includes('Valle')) return 'Valle del Cauca';
  return 'Colombia';
};

/** Formatea fecha de conexión a la red */
export const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

/** Slug URL-safe del código de planta */
export const plantSlug = (code: string): string =>
  code.replace('=', '__');
