"""
Módulo central de dominio y KPIs de SOLGER (fuente única de verdad).

Estándares aplicados:
- Huawei FusionSolar Northbound API:
    real_health_state: 1 = Desconectada (Offline), 2 = Falla/Alarma, 3 = Operativa (Healthy)
- IEC 61724-1:
    Rendimiento específico: Yf = E_generada (kWh) / P_nominal (kWp)  [kWh/kWp]
    Performance Ratio (con irradiancia): PR = Yf / (H_POA / 1 kW/m²)
    Índice vs. diseño (sin piranómetro): I_dis = Yf / (HSP_ref * PR_dis)
- UPME Resolución 000085 (datos 2024):
    Inventarios GEI (Alcance 2): 0.220 tCO2eq/MWh (0.000220 tCO2eq/kWh)
    Mitigación proyectos solares FNCER: 0.660 tCO2eq/MWh (0.000660 tCO2eq/kWh)
"""
from __future__ import annotations

from statistics import median
from typing import Any

from config import settings

# ─── Estados de salud FusionSolar Northbound ──────────────────────────────────
HEALTH_OFFLINE = 1
HEALTH_FAULT = 2
HEALTH_OK = 3

HEALTH_LABELS: dict[int, str] = {
    HEALTH_OFFLINE: "Offline",
    HEALTH_FAULT: "Alarma",
    HEALTH_OK: "Operativa",
}

# ─── Parámetros de referencia (Valle del Cauca) ───────────────────────────────
HSP_REF: float = 4.5          # Horas Sol Pico de referencia regional (kWh/m²/día)
PR_DESIGN: float = 0.80       # PR de diseño típico (80%)
EXPECTED_YIELD_REF: float = HSP_REF * PR_DESIGN  # 3.6 kWh/kWp/día

INDEX_WARN: float = 75.0      # Umbral de alerta (%)
INDEX_CRIT: float = 60.0      # Umbral crítico (%)


def is_plant_healthy(state: int | None) -> bool:
    return state == HEALTH_OK


def is_plant_offline(state: int | None) -> bool:
    return state == HEALTH_OFFLINE


def is_plant_faulty(state: int | None) -> bool:
    return state == HEALTH_FAULT


def calc_co2_tons(energy_kwh: float, factor_t_per_mwh: float | None = None) -> float:
    """Calcula las toneladas de CO2 evitadas según factor UPME (tCO2eq/MWh)."""
    factor = factor_t_per_mwh if factor_t_per_mwh is not None else settings.CO2_FACTOR_T_PER_MWH
    return round((energy_kwh / 1000.0) * factor, 2)


def calc_specific_yield(energy_kwh: float, capacity_kwp: float) -> float | None:
    """Rendimiento específico Yf = E / Pnom (kWh/kWp)."""
    if capacity_kwp <= 0:
        return None
    return round(energy_kwh / capacity_kwp, 2)


def calc_design_index(
    energy_kwh: float,
    capacity_kwp: float,
    hsp_ref: float = HSP_REF,
    pr_design: float = PR_DESIGN,
) -> float | None:
    """
    Índice de desempeño respecto al diseño (%) cuando no hay sensor de irradiancia en sitio.
    No divide dos veces por eficiencia: compara Yf contra Yf_diseño (HSP_ref * PR_design).
    """
    if capacity_kwp <= 0:
        return None
    expected_kwh = capacity_kwp * hsp_ref * pr_design
    if expected_kwh <= 0:
        return None
    return round((energy_kwh / expected_kwh) * 100.0, 1)


def calc_pr_with_irradiance(
    energy_kwh: float,
    capacity_kwp: float,
    ghi_kwh_m2: float,
) -> float | None:
    """Performance Ratio IEC 61724-1 usando irradiación diaria (kWh/m²)."""
    if capacity_kwp <= 0 or ghi_kwh_m2 <= 0.5:
        return None
    yf = energy_kwh / capacity_kwp
    return round((yf / ghi_kwh_m2) * 100.0, 1)


def estimate_capacity_from_history(
    daily_kwh_series: list[float],
    hsp_p90: float = 5.2,
    pr_clean: float = 0.82,
) -> dict[str, Any]:
    """
    Estima la capacidad instalada (kWp) de una planta sin dato nominal a partir de su
    serie histórica de energía diaria (kWh/día), usando el percentil 90 de días activos
    para evitar días nublados o paros y sin caer en la circularidad de usar solo el día actual.

    kWp_est ≈ E_p90 / (HSP_p90 * PR_clean)
    """
    valid = sorted(x for x in daily_kwh_series if x and x > 1.0)
    if len(valid) < 5:
        return {"kwp_estimated": None, "sample_days": len(valid), "method": "insufficient_history"}

    idx_p90 = min(len(valid) - 1, int(round(0.90 * (len(valid) - 1))))
    e_p90 = valid[idx_p90]
    e_med = median(valid)
    denom = hsp_p90 * pr_clean
    kwp_est = round(e_p90 / denom, 2) if denom > 0 else None

    return {
        "kwp_estimated": kwp_est,
        "e_p90_kwh": round(e_p90, 2),
        "e_median_kwh": round(e_med, 2),
        "sample_days": len(valid),
        "method": "p90_daily_yield",
    }
