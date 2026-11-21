import sys
from pathlib import Path
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "analytics"))

import main
import report_generator as rg


def test_health_endpoint():
    client = TestClient(main.app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "fusionsolar_url" in body


def test_compute_string_action_states():
    rtype, label, _ = main._compute_string_action(10, 0, 2, 0)
    assert rtype == "electrica"
    assert "Inspección" in label

    rtype_low, _, _ = main._compute_string_action(10, 2, 0, 0)
    assert rtype_low == "limpieza"

    rtype_night, _, _ = main._compute_string_action(0, 0, 0, 12)
    assert rtype_night == "night"

    rtype_ok, _, _ = main._compute_string_action(12, 0, 0, 0)
    assert rtype_ok == "ok"

    rtype_pending, _, _ = main._compute_string_action(0, 0, 0, 0)
    assert rtype_pending == "pending"


def test_enrich_alarm_intelligence():
    cause, sugg = main._enrich_alarm_intelligence(
        "Pérdida de comunicación con dispositivo", "", "",
        {"plantName": "Planta Test", "capacity": 100.0},
        {"day_power": 120.0},
    )
    assert "Dongle" in cause or "SmartLogger" in cause or "router" in sugg.lower()

    cause_pv, sugg_pv = main._enrich_alarm_intelligence(
        "Corriente anormal en string PV1", "", "",
        {"plantName": "Planta Test", "capacity": 100.0},
        {"day_power": 0.0},
    )
    assert "string" in cause_pv.lower() or "MC4" in sugg_pv


def test_creg174_in_plant_and_executive_reports():
    plant = {"plantCode": "P1", "plantName": "HDA LA CRUZ", "capacity": 83.5}
    kpi_dim = {
        "day_power": 300.0,
        "month_power": 5000.0,
        "total_power": 120000.0,
        "day_on_grid_energy": 180.0,
        "day_use_energy": 200.0,
        "real_health_state": 3,
    }
    # autoconsumo = 300 - 180 = 120; importado = 200 - 120 = 80
    # Exc Tipo 1 = min(180, 80) = 80.0; Exc Tipo 2 = 180 - 80 = 100.0; Neto Red = 0.0
    month_data = [
        {
            "collectTime": 1763740800000,
            "dataItemMap": {
                "inverter_power": 300.0,
                "ongrid_power": 180.0,
                "selfUsePower": 120.0,
                "buyPower": 80.0,
            },
        }
    ]
    plant_html = rg.build_plant_html_report(
        plant, kpi_dim, month_data=month_data
    )
    assert "Excedentes CREG 174" in plant_html
    assert "80.0" in plant_html
    assert "100.0" in plant_html
    assert "Acumulado del Mes (1d · CREG 174)" in plant_html

    exec_html = rg.build_executive_html_report(
        {
            "summary": {"totalCapacity_kWp": 83.5, "totalEnergyToday_kWh": 300.0},
            "plants": [plant],
            "kpis": [{"plantCode": "P1", "dataItemMap": kpi_dim}],
        }
    )
    assert "CREG 174 Portafolio (Hoy):" in exec_html
    assert "Exc. Tipo 1" in exec_html
    assert "Exc. Tipo 2" in exec_html
