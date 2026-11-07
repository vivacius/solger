"""
SOLGER — Motor Estadístico de Detección de Anomalías (sin sensor de irradiancia en sitio).

Implementa 4 capas complementarias:
  1. Reglas duras: planta desconectada (health=1), generación nula en día soleado, alarma crítica.
  2. Modelo físico esperado con irradiancia satelital (Open-Meteo):
       E_esp = kWp_efectivo * GHI_sat (kWh/m²) * PR_base_planta
  3. Comparación con pares del portafolio regional (Valle del Cauca, ~40 km):
       ratio_pares = Yf_planta / mediana(Yf_portafolio)
     Cancela el efecto de nubosidad regional cuando no hay piranómetro en sitio.
  4. Control estadístico de procesos sobre el residuo (E_real / E_esp):
       - z-score robusto usando mediana y MAD (Median Absolute Deviation)
       - EWMA (λ=0.2) para detectar derivas lentas (suciedad / soiling)
"""
from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Any


@dataclass
class PlantDayObservation:
    plant_code: str
    plant_name: str
    fecha: str
    gen_kwh: float
    kwp_effective: float
    ghi_sat_kwh_m2: float | None
    pr_base: float = 0.80
    health_state: int = 3
    tariff_cop_kwh: float = 750.0


def calc_robust_zscore(value: float, history: list[float]) -> float | None:
    """
    Calcula el z-score robusto usando mediana y MAD (1.4826 * mediana(|x - med|)).
    Resistente a valores atípicos previos en el histórico.
    """
    clean = [x for x in history if x is not None and x > 0]
    if len(clean) < 7:
        return None
    med = median(clean)
    abs_devs = [abs(x - med) for x in clean]
    mad = median(abs_devs)
    sigma_rob = 1.4826 * mad
    if sigma_rob < 1e-3:
        return 0.0
    return round((value - med) / sigma_rob, 2)


def calc_ewma(series: list[float], lam: float = 0.2) -> float | None:
    """Media móvil exponencialmente ponderada (EWMA) para detectar caída gradual por suciedad."""
    clean = [x for x in series if x is not None and x >= 0]
    if not clean:
        return None
    ewma_val = clean[0]
    for x in clean[1:]:
        ewma_val = lam * x + (1.0 - lam) * ewma_val
    return round(ewma_val, 3)


def evaluate_portfolio_day(
    observations: list[PlantDayObservation],
    historical_residuals_by_plant: dict[str, list[float]] | None = None,
) -> list[dict[str, Any]]:
    """
    Evalúa todas las plantas del portafolio en un día cerrado y devuelve las métricas
    normalizadas y anomalías detectadas.
    """
    historical_residuals_by_plant = historical_residuals_by_plant or {}

    # 1. Calcular rendimiento específico Yf (kWh/kWp) de cada planta con capacidad válida
    yfs: dict[str, float] = {}
    for obs in observations:
        if obs.kwp_effective > 0 and obs.gen_kwh >= 0:
            yfs[obs.plant_code] = obs.gen_kwh / obs.kwp_effective

    active_yfs = [v for v in yfs.values() if v > 0.3]
    portfolio_median_yf = median(active_yfs) if len(active_yfs) >= 3 else None

    results: list[dict[str, Any]] = []

    for obs in observations:
        yf = yfs.get(obs.plant_code)
        ghi = obs.ghi_sat_kwh_m2 if (obs.ghi_sat_kwh_m2 and obs.ghi_sat_kwh_m2 > 0.5) else 4.5
        expected_kwh = obs.kwp_effective * ghi * obs.pr_base if obs.kwp_effective > 0 else 0.0
        residual = (obs.gen_kwh / expected_kwh) if expected_kwh > 0 else None

        ratio_pares = (
            round(yf / portfolio_median_yf, 3)
            if (yf is not None and portfolio_median_yf and portfolio_median_yf > 0)
            else None
        )

        hist = historical_residuals_by_plant.get(obs.plant_code, [])
        z_rob = calc_robust_zscore(residual, hist) if residual is not None else None
        ewma_val = calc_ewma(hist + ([residual] if residual is not None else []))

        kwh_lost = max(0.0, round(expected_kwh - obs.gen_kwh, 2)) if expected_kwh > 0 else 0.0
        cop_lost = round(kwh_lost * obs.tariff_cop_kwh, 0)

        anomaly: dict[str, Any] | None = None

        # Capa 1: Reglas duras (Offline o generación cero)
        if obs.health_state == 1 or (obs.kwp_effective > 0 and obs.gen_kwh <= 0.1 and ghi >= 2.5):
            anomaly = {
                "tipo": "offline",
                "severidad": "critica",
                "descripcion": "Planta sin comunicación o sin generación durante un día con radiación disponible.",
                "recomendacion": "Verificar SmartLogger/Dongle, protecciones AC/DC y alimentación de red.",
            }
        # Capa 2 + 3 + 4: Caída súbita confirmada tanto contra esperado físico como contra plantas vecinas
        elif (
            residual is not None
            and ratio_pares is not None
            and residual < 0.70
            and ratio_pares < 0.75
            and (z_rob is None or z_rob <= -2.5)
        ):
            anomaly = {
                "tipo": "caida_subita",
                "severidad": "critica" if residual < 0.50 else "atencion",
                "descripcion": (
                    f"Generación {round((1 - residual) * 100)}% por debajo de lo esperado y "
                    f"{round((1 - ratio_pares) * 100)}% por debajo de las plantas vecinas."
                ),
                "recomendacion": "Revisar strings desconectados, disparo de inversor o limitación de potencia.",
            }
        # Capa 4: Deriva gradual (EWMA baja sostenida) -> Suciedad / Soiling
        elif (
            ewma_val is not None
            and ewma_val < 0.85
            and ratio_pares is not None
            and ratio_pares < 0.85
            and len(hist) >= 14
        ):
            anomaly = {
                "tipo": "suciedad_soiling",
                "severidad": "atencion",
                "descripcion": (
                    f"Declive gradual sostenido (EWMA={ewma_val:.2f}, ratio vs. pares={ratio_pares:.2f})."
                ),
                "recomendacion": "Programar limpieza de módulos fotovoltaicos o inspección de sombreado.",
            }

        results.append({
            "plant_code": obs.plant_code,
            "plant_name": obs.plant_name,
            "fecha": obs.fecha,
            "gen_kwh": round(obs.gen_kwh, 2),
            "expected_kwh": round(expected_kwh, 2),
            "yf_kwh_kwp": round(yf, 2) if yf is not None else None,
            "ratio_pares": ratio_pares,
            "residual": round(residual, 3) if residual is not None else None,
            "z_score_robusto": z_rob,
            "ewma_residuo": ewma_val,
            "kwh_perdidos": kwh_lost if anomaly else 0.0,
            "cop_perdidos": cop_lost if anomaly else 0.0,
            "anomalia": anomaly,
        })

    return results

