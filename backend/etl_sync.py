"""
Sincronizador ETL Continuo + Alertas Inmediatas por Cambio de Estado en Horas Solares.
Diseñado para ejecutarse cada 2 horas vía GitHub Actions o cron de servidor:
  1. Sincroniza el catálogo de plantas y sus KPIs actuales en `solger.kpi_diario`.
  2. Consulta la irradiancia satelital real (Open-Meteo Solar Radiation API) por planta.
  3. Ejecuta el motor estadístico de anomalías (4 capas) y persiste en `solger.anomalia_estadistica`.
  4. Si detecta una planta `Offline (1)` o `En Alarma (2)` en plena ventana solar (07:00–17:00 COT),
     despacha una alerta inmediata a Telegram con el impacto económico estimado en COP/hora.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
import requests
from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv(override=True)

from fusionsolar import BOGOTA_TZ, fusion_client  # noqa: E402
import supabase_store  # noqa: E402
import satellite_irradiance  # noqa: E402
import kpi as kpi_domain  # noqa: E402
import main as backend_main  # noqa: E402


def run_hourly_etl_and_alerts() -> dict:
    now_cot = datetime.now(BOGOTA_TZ)
    print(f"[ETL SOLGER] Iniciando sincronización — {now_cot.strftime('%Y-%m-%d %H:%M:%S COT')}")

    summary_resp = backend_main.get_portfolio_summary()
    anom_resp = backend_main.get_portfolio_anomalies()

    plants = summary_resp.get("plants", [])
    kpis = summary_resp.get("kpis", [])
    kpi_map = {
        (k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {})
        for k in kpis
    }

    # Persistir snapshot diario en solger.kpi_diario
    supabase_store.sync_daily_kpis(plants, kpis)

    # Verificar si estamos en ventana solar (07:00 a 17:00 COT) para alertas críticas inmediatas
    is_solar_window = 7 <= now_cot.hour <= 17
    critical_plants = []
    tariff_cop_kwh = 964.13

    for p in plants:
        code = p.get("plantCode")
        name = p.get("plantName", code)
        cap = float(p.get("effectiveCapacity_kWp") or p.get("capacity") or 0.0)
        dim = kpi_map.get(code, {})
        health = int(dim.get("real_health_state") or 3)
        sat = satellite_irradiance.get_satellite_irradiance(p.get("latitude"), p.get("longitude"))
        ghi_w_m2 = float(sat.get("ghi_current_w_m2") or 450.0)

        if health in (1, 2):
            # Pérdida horaria estimada (kW perdidos = kWp * (W/m² / 1000) * PR_base)
            kw_expected_now = cap * (max(ghi_w_m2, 350.0) / 1000.0) * kpi_domain.PR_DESIGN
            loss_cop_per_hour = round(kw_expected_now * tariff_cop_kwh, 0)
            state_label = "OFFLINE (Sin comunicación)" if health == 1 else "ALARMA DE INVERSOR"
            critical_plants.append({
                "name": name,
                "code": code,
                "state": state_label,
                "cap_kwp": cap,
                "loss_cop_h": loss_cop_per_hour,
            })

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
    alert_sent = False

    if is_solar_window and critical_plants and bot_token and chat_id:
        total_loss_h = sum(c["loss_cop_h"] for c in critical_plants)
        lines = [
            f"🚨 <b>ALERTA OPERATIVA EN VENTANA SOLAR ({now_cot.strftime('%H:%M COT')})</b>\n",
            f"Se detectaron <b>{len(critical_plants)} planta(s)</b> con novedad técnica durante horas de sol:\n",
        ]
        for cp in critical_plants:
            lines.append(
                f"• <b>{cp['name']}</b> ({cp['cap_kwp']:.1f} kWp) → <code>{cp['state']}</code> "
                f"(~${cp['loss_cop_h']:,.0f} COP/h en riesgo)"
            )
        lines.append(
            f"\n💰 <b>Impacto estimado total:</b> ~${total_loss_h:,.0f} COP/hora mientras dure la indisponibilidad."
        )
        try:
            r = requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": "\n".join(lines), "parse_mode": "HTML"},
                timeout=12,
            )
            alert_sent = r.status_code == 200
        except Exception as exc:
            print(f"[ETL SOLGER] Error enviando alerta a Telegram: {exc}")

    res = {
        "timestamp": now_cot.isoformat(),
        "plantsSynced": len(plants),
        "anomaliesCount": anom_resp.get("anomaliesCount", 0),
        "criticalInSolarWindow": len(critical_plants),
        "telegramAlertSent": alert_sent,
    }
    print(f"[ETL SOLGER] Completado: {res}")
    return res


if __name__ == "__main__":
    run_hourly_etl_and_alerts()
