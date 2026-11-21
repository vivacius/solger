import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import kpi
import anomalies


def test_kpi_plant_states():
    assert kpi.is_plant_healthy(3) is True
    assert kpi.is_plant_healthy(2) is False
    assert kpi.is_plant_offline(1) is True
    assert kpi.is_plant_faulty(2) is True


def test_kpi_co2_and_specific_yield():
    # 1000 kWh = 1 MWh -> default CO2 factor > 0
    co2 = kpi.calc_co2_tons(1000.0, factor_t_per_mwh=0.22)
    assert co2 == 0.22

    sy = kpi.calc_specific_yield(400.0, 100.0)
    assert sy == 4.0
    assert kpi.calc_specific_yield(400.0, 0.0) is None


def test_anomalies_robust_zscore_and_ewma():
    history = [100.0, 102.0, 99.0, 101.0, 100.0, 98.0, 101.0]
    z_normal = anomalies.calc_robust_zscore(100.5, history)
    z_drop = anomalies.calc_robust_zscore(40.0, history)
    assert z_normal is not None and abs(z_normal) < 1.5
    assert z_drop is not None and z_drop < -3.0

    ewma = anomalies.calc_ewma([100.0, 100.0, 80.0], lam=0.5)
    assert ewma is not None and 85.0 <= ewma <= 95.0


def test_evaluate_portfolio_day_flags_offline_and_underperformance():
    observations = [
        anomalies.PlantDayObservation(
            plant_code="P1", plant_name="Planta OK", fecha="2026-11-21",
            gen_kwh=420.0, kwp_effective=100.0, ghi_sat_kwh_m2=5.0, health_state=3,
        ),
        anomalies.PlantDayObservation(
            plant_code="P2", plant_name="Planta Caida", fecha="2026-11-21",
            gen_kwh=0.0, kwp_effective=100.0, ghi_sat_kwh_m2=5.0, health_state=1,
        ),
        anomalies.PlantDayObservation(
            plant_code="P3", plant_name="Planta Par", fecha="2026-11-21",
            gen_kwh=410.0, kwp_effective=100.0, ghi_sat_kwh_m2=5.0, health_state=3,
        ),
    ]
    res = anomalies.evaluate_portfolio_day(observations, historical_residuals_by_plant={})
    by_code = {item["plant_code"]: item for item in res}
    assert by_code["P1"]["anomalia"] is None
    assert by_code["P2"]["anomalia"] is not None
    assert by_code["P2"]["anomalia"]["tipo"] == "offline"
