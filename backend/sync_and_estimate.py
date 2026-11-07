"""
SOLGER — Backfill Histórico en Lote (Batch), Estimación de kWp (P90) y Sincronización con Supabase.

Uso:
    python backend/sync_and_estimate.py --months 3

Optimización clave contra el límite de frecuencia (failCode 407) de Huawei FusionSolar:
- Consulta `/thirdData/getKpiStationDay` enviando todos los `stationCodes` separados por coma
  en **1 sola petición HTTP por mes** (en lugar de 16 peticiones por mes).
- Es incremental y reanudable: conserva las estimaciones P90 ya calculadas en
  `data/processed/capacidades_estimadas.json` y en `solger.planta`.
- Si una planta activa tiene `capacity = 0` y la cuota diaria de `getKpiStationDay` está en
  enfriamiento temporal (407), calcula un estimado provisional desde `getStationRealKpi`
  (`month_power` / `day_power`) marcado como `provisional_real_kpi` hasta la siguiente corrida.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from config import settings
from fusionsolar import BOGOTA_TZ, fusion_client
import kpi as kpi_domain

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("solger.sync")

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"
ESTIMATED_CAPS_FILE = PROCESSED_DIR / "capacidades_estimadas.json"


def _recent_months(n_months: int) -> list[str]:
    now = datetime.now(BOGOTA_TZ)
    y, m = now.year, now.month
    months: list[str] = []
    for _ in range(n_months):
        months.append(f"{y:04d}{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(months))


def _supabase_headers() -> dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Profile": settings.DB_SCHEMA,
        "Accept-Profile": settings.DB_SCHEMA,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }


def sync_to_supabase(
    plants: list[dict],
    estimates: dict[str, dict],
    daily_records_by_plant: dict[str, list[dict]],
) -> None:
    if not settings.SUPABASE_URL or not (settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY):
        logger.info("Credenciales de Supabase no configuradas en .env — omitiendo subida a BD.")
        return

    base = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1"
    headers = _supabase_headers()

    r_org = requests.get(f"{base}/organizacion?nombre=eq.SOLGER&select=id", headers=headers, timeout=20)
    r_org.raise_for_status()
    orgs = r_org.json()
    if not orgs:
        r_ins = requests.post(f"{base}/organizacion", headers=headers, json={"nombre": "SOLGER"}, timeout=20)
        r_ins.raise_for_status()
        org_id = r_ins.json()[0]["id"]
    else:
        org_id = orgs[0]["id"]

    plant_rows = []
    for p in plants:
        code = p["plantCode"]
        nom_cap = float(p.get("capacity") or 0.0)
        est_info = estimates.get(code, {})
        est_cap = est_info.get("kwp_estimated")
        plant_rows.append({
            "org_id": org_id,
            "fs_plant_code": code,
            "fs_plant_id": code.replace("NE=", ""),
            "nombre": p.get("plantName", code),
            "kwp_dc_nominal": nom_cap,
            "kwp_dc_estimado": est_cap,
            "metodo_estimacion_kwp": "fusionsolar" if nom_cap > 0 else est_info.get("method", "p90_daily_yield"),
            "kwp_actualizado_en": datetime.now(BOGOTA_TZ).isoformat(),
            "latitud": float(p["latitude"]) if p.get("latitude") else None,
            "longitud": float(p["longitude"]) if p.get("longitude") else None,
            "direccion": p.get("plantAddress"),
            "fecha_conexion": str(p.get("gridConnectionDate"))[:10] if p.get("gridConnectionDate") else None,
            "ultima_sincronizacion_fs": datetime.now(BOGOTA_TZ).isoformat(),
        })

    r_pl = requests.post(
        f"{base}/planta?on_conflict=fs_plant_code",
        headers=headers,
        json=plant_rows,
        timeout=30,
    )
    r_pl.raise_for_status()
    db_plants = {row["fs_plant_code"]: row["id"] for row in r_pl.json()}
    logger.info("Sincronizadas %d plantas en schema '%s'.", len(db_plants), settings.DB_SCHEMA)

    kpi_rows = []
    for code, records in daily_records_by_plant.items():
        planta_id = db_plants.get(code)
        if not planta_id:
            continue
        for rec in records:
            kpi_rows.append({
                "planta_id": planta_id,
                "fecha": rec["fecha"],
                "gen_kwh": rec["gen_kwh"],
                "export_kwh": rec["export_kwh"],
                "import_kwh": rec["import_kwh"],
                "autoconsumo_kwh": rec["autoconsumo_kwh"],
                "yf_kwh_kwp": rec["yf_kwh_kwp"],
                "indice_diseno_pct": rec["indice_diseno_pct"],
            })

    for i in range(0, len(kpi_rows), 500):
        chunk = kpi_rows[i : i + 500]
        r_kpi = requests.post(
            f"{base}/kpi_diario?on_conflict=planta_id,fecha",
            headers=headers,
            json=chunk,
            timeout=30,
        )
        r_kpi.raise_for_status()
    logger.info("Sincronizados %d registros de kpi_diario en Supabase.", len(kpi_rows))


def run_backfill_and_estimate(n_months: int = 3) -> dict[str, Any]:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    existing_estimates: dict[str, dict] = {}
    if ESTIMATED_CAPS_FILE.exists():
        try:
            existing_estimates = json.loads(ESTIMATED_CAPS_FILE.read_text(encoding="utf-8")).get("plants") or {}
        except Exception:
            existing_estimates = {}

    plants_resp = fusion_client.get_plant_list()
    plants = plants_resp.get("data", {}).get("list", [])
    all_codes = [p["plantCode"] for p in plants]

    # Consultar KPIs en tiempo real (1 sola petición para todas las plantas)
    real_kpi_map: dict[str, dict] = {}
    try:
        rk_resp = fusion_client.get_station_real_kpi(all_codes)
        for item in rk_resp.get("data") or []:
            c = item.get("stationCode") or item.get("plantCode")
            if c:
                real_kpi_map[c] = item.get("dataItemMap") or {}
    except Exception as exc:
        logger.warning("No se pudo obtener getStationRealKpi: %s", exc)

    months = _recent_months(n_months)
    pending_codes = [
        p["plantCode"]
        for p in plants
        if not (existing_estimates.get(p["plantCode"], {}).get("sample_days", 0) >= 30)
    ]

    daily_records_by_plant: dict[str, list[dict]] = {c: [] for c in all_codes}

    if pending_codes:
        batch_codes_str = ",".join(pending_codes)
        logger.info(
            "Consultando %d plantas pendientes en LOTE (1 petición por mes) para %s...",
            len(pending_codes),
            months,
        )
        for m in months:
            try:
                time.sleep(2.5)
                resp = fusion_client.get_station_kpi_month(batch_codes_str, m)
                rows = resp.get("data", []) or []
                for row in rows:
                    scode = row.get("stationCode") or row.get("plantCode")
                    collect_ms = row.get("collectTime")
                    if not scode or not collect_ms:
                        continue
                    dt = datetime.fromtimestamp(collect_ms / 1000.0, tz=BOGOTA_TZ).strftime("%Y-%m-%d")
                    dim = row.get("dataItemMap") or {}
                    gen = float(
                        dim.get("inverter_power")
                        or dim.get("inverterYield")
                        or dim.get("PVYield")
                        or 0.0
                    )
                    exp = float(dim.get("ongrid_power") or 0.0)
                    imp = float(dim.get("buyPower") or dim.get("buy_power") or 0.0)
                    auto = max(0.0, gen - exp)
                    daily_records_by_plant.setdefault(scode, []).append({
                        "fecha": dt,
                        "gen_kwh": round(gen, 2),
                        "export_kwh": round(exp, 2),
                        "import_kwh": round(imp, 2),
                        "autoconsumo_kwh": round(auto, 2),
                    })
            except Exception as exc:
                logger.warning("Lote mes %s devolvió advertencia: %s", m, exc)

    estimates: dict[str, dict] = {}
    now_bogota = datetime.now(BOGOTA_TZ)
    days_in_current_month = max(1, now_bogota.day)

    for p in plants:
        code = p["plantCode"]
        name = p.get("plantName", code)
        nom_cap = float(p.get("capacity") or 0.0)
        prev = existing_estimates.get(code, {})

        records = daily_records_by_plant.get(code, [])
        records.sort(key=lambda r: r["fecha"])
        daily_series = [r["gen_kwh"] for r in records]

        if len(daily_series) >= 5:
            est = kpi_domain.estimate_capacity_from_history(daily_series)
        elif prev.get("kwp_estimated"):
            est = {
                "kwp_estimated": prev.get("kwp_estimated"),
                "e_p90_kwh": prev.get("e_p90_kwh"),
                "e_median_kwh": prev.get("e_median_kwh"),
                "sample_days": prev.get("sample_days", 0),
                "method": prev.get("method", "p90_daily_yield"),
            }
        else:
            # Fallback provisional usando energía acumulada del mes / día desde getStationRealKpi
            rdim = real_kpi_map.get(code, {})
            month_p = float(rdim.get("month_power") or 0.0)
            day_p = float(rdim.get("day_power") or 0.0)
            avg_daily = (month_p / days_in_current_month) if month_p > 0 else day_p
            if avg_daily > 1.0:
                kwp_prov = round(avg_daily / (kpi_domain.HSP_REF * kpi_domain.PR_DESIGN), 2)
                est = {
                    "kwp_estimated": kwp_prov,
                    "e_p90_kwh": round(avg_daily, 2),
                    "e_median_kwh": round(avg_daily, 2),
                    "sample_days": days_in_current_month if month_p > 0 else 1,
                    "method": "provisional_month_yield",
                }
            else:
                est = {
                    "kwp_estimated": None,
                    "sample_days": 0,
                    "method": "insufficient_history",
                }

        eff_cap = nom_cap if nom_cap > 0 else float(est.get("kwp_estimated") or 0.0)

        for r in records:
            r["yf_kwh_kwp"] = kpi_domain.calc_specific_yield(r["gen_kwh"], eff_cap)
            r["indice_diseno_pct"] = kpi_domain.calc_design_index(r["gen_kwh"], eff_cap)

        estimates[code] = {
            "plant_code": code,
            "plant_name": name,
            "kwp_nominal": nom_cap,
            "kwp_effective": eff_cap,
            "is_estimated": nom_cap <= 0 and eff_cap > 0,
            **est,
        }
        logger.info(
            "Planta %-24s | nominal=%6.1f kWp | efectivo=%6.1f kWp | metodo=%s",
            name[:24],
            nom_cap,
            eff_cap,
            "fusionsolar" if nom_cap > 0 else est.get("method"),
        )

    payload = {
        "generated_at": datetime.now(BOGOTA_TZ).isoformat(),
        "months_analyzed": months,
        "plants": estimates,
    }
    ESTIMATED_CAPS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Archivo de capacidades estimadas guardado en %s", ESTIMATED_CAPS_FILE)

    sync_to_supabase(plants, estimates, daily_records_by_plant)
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill histórico en lote y estimación de kWp")
    parser.add_argument("--months", type=int, default=3, help="Número de meses hacia atrás a consultar")
    args = parser.parse_args()
    run_backfill_and_estimate(args.months)
