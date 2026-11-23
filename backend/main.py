"""
FastAPI — Servidor proxy SOLGER para FusionSolar Northbound API.

Nota de concurrencia:
    Mientras la sesión de FusionSolar viva en memoria, ejecutar con --workers 1
    para evitar que dos procesos invaliden mutuamente el XSRF-TOKEN.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, date
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import os
import sys
import threading

from config import settings
from fusionsolar import APIError, AuthenticationError, BOGOTA_TZ, fusion_client
import kpi as kpi_domain
import market as market_svc
import invoice_store
import invoice_report
import supabase_store
import celsia_parser
import anomalies as anomaly_engine
import satellite_irradiance

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("solger.api")

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SOLGER — Solar Asset Management API",
    description="Centro de Operaciones y Gestión de Activos Solares en Colombia.",
    version="1.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helper ───────────────────────────────────────────────────────────────────
def _handle_fusion_errors(exc: Exception) -> None:
    if isinstance(exc, AuthenticationError):
        raise HTTPException(status_code=401, detail=str(exc))
    if isinstance(exc, APIError):
        raise HTTPException(status_code=502, detail=str(exc))
    raise HTTPException(status_code=500, detail=f"Error interno: {exc}")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/api/health", tags=["Sistema"])
def health_check() -> dict:
    """Estado del servidor y la conexión con FusionSolar."""
    return {
        "status": "ok",
        "timestamp": datetime.now(BOGOTA_TZ).isoformat(),
        "fusionsolar_url": settings.BASE_URL,
        "cache_ttl_seconds": settings.CACHE_TTL,
        "co2_factor_t_per_mwh": settings.CO2_FACTOR_T_PER_MWH,
    }


@app.get("/api/plants", tags=["Plantas"])
def get_plants() -> dict[str, Any]:
    """Lista completa de plantas solares del portafolio (con auto-sync hacia solger.planta)."""
    try:
        data = fusion_client.get_plant_list()
        raw_plants = data.get("data", {}).get("list", [])
        plants = supabase_store.auto_sync_plants(raw_plants)
        return {
            "success": True,
            "total": len(plants),
            "plants": plants,
        }
    except Exception as exc:
        _handle_fusion_errors(exc)


@app.get("/api/plants/summary", tags=["Plantas"])
def get_portfolio_summary(force: bool = Query(default=False)) -> dict[str, Any]:
    """
    KPIs globales del portafolio completo (Supabase-first para velocidad y tolerancia a 407).
    Usa el mapeo oficial de Huawei Northbound:
        real_health_state: 1 = Offline, 2 = Falla/Alarma, 3 = Operativa (Healthy)
    """
    cot_hour = datetime.now(BOGOTA_TZ).hour
    ttl_sec = 7200 if (cot_hour >= 19 or cot_hour < 6) else 1200
    cached_summary, is_fresh = supabase_store.get_kv_cache("portfolio_summary_snapshot", max_age_sec=ttl_sec)
    if not force and cached_summary and is_fresh and cached_summary.get("plants"):
        return cached_summary

    try:
        plants_data = fusion_client.get_plant_list()
        raw_plants = plants_data.get("data", {}).get("list", [])
        if not raw_plants:
            if cached_summary and cached_summary.get("plants"):
                return {**cached_summary, "source": "supabase_snapshot"}
            raise HTTPException(status_code=404, detail="No se encontraron plantas.")

        plants = supabase_store.auto_sync_plants(raw_plants)
        total_capacity = sum(float(p.get("capacity") or 0) for p in plants)
        plant_codes = [p["plantCode"] for p in plants]

        kpi_data = fusion_client.get_station_real_kpi(plant_codes)
        kpi_list: list[dict] = kpi_data.get("data", []) or []

        energy_today = 0.0
        energy_month = 0.0
        energy_total = 0.0
        active_plants = 0

        for kpi in kpi_list:
            dim = kpi.get("dataItemMap", {})
            energy_today += float(dim.get("day_power", 0) or 0)
            energy_month += float(dim.get("month_power", 0) or 0)
            energy_total += float(dim.get("total_power", 0) or 0)
            health = dim.get("real_health_state")
            if kpi_domain.is_plant_healthy(health):
                active_plants += 1

        co2_avoided = kpi_domain.calc_co2_tons(energy_total)
        sat_valle = satellite_irradiance.get_satellite_irradiance()
        for p in plants:
            psat = satellite_irradiance.get_satellite_irradiance(p.get("latitude"), p.get("longitude"))
            p["satelliteGhi_kWh_m2"] = psat["ghi_today_kwh_m2"]
            p["cloudCover_pct"] = psat["cloud_cover_pct"]

        res = {
            "success": True,
            "source": "fusionsolar_live",
            "lastUpdated": datetime.now(BOGOTA_TZ).isoformat(),
            "summary": {
                "totalCapacity_kWp": round(total_capacity, 2),
                "totalPlants": len(plants),
                "activePlants": active_plants,
                "totalEnergyToday_kWh": round(energy_today, 2),
                "totalEnergyMonth_kWh": round(energy_month, 2),
                "totalEnergyTotal_kWh": round(energy_total, 2),
                "co2Avoided_ton": co2_avoided,
                "satelliteHspToday_h": sat_valle["ghi_today_kwh_m2"],
                "satelliteIrradiance_W_m2": sat_valle["ghi_current_w_m2"],
                "cloudCover_pct": sat_valle["cloud_cover_pct"],
            },
            "plants": plants,
            "kpis": kpi_list,
        }
        supabase_store.set_kv_cache("portfolio_summary_snapshot", res)
        return res
    except HTTPException:
        raise
    except Exception as exc:
        if cached_summary and cached_summary.get("plants"):
            logger.warning("Usando snapshot Supabase de portfolio_summary ante error: %s", exc)
            return {**cached_summary, "source": "supabase_snapshot"}
        _handle_fusion_errors(exc)


@app.get("/api/portfolio/daily-generation", tags=["Plantas"])
def get_portfolio_daily_generation_endpoint(days: int = 30) -> dict[str, Any]:
    """Sumatoria diaria de generación (kWh) de todas las plantas del portafolio en los últimos N días."""
    series = supabase_store.get_portfolio_daily_generation(days=days)
    return {
        "success": True,
        "days": days,
        "series": series,
    }


@app.get("/api/satellite/irradiance-grid", tags=["Plantas"])
def get_satellite_irradiance_grid() -> dict[str, Any]:
    """Malla geográfica 5x5 de irradiancia horaria (W/m²) y nubosidad (%) sobre el Valle del Cauca."""
    grid = satellite_irradiance.get_irradiance_grid()
    return {"success": True, **grid}


@app.get("/api/plants/{plant_code}/kpi", tags=["Plantas"])
def get_plant_real_kpi(plant_code: str) -> dict[str, Any]:
    """KPIs en tiempo real de una planta específica."""
    decoded_code = plant_code.replace("__", "=")
    try:
        data = fusion_client.get_station_real_kpi([decoded_code])
        kpi_list = data.get("data", []) or []
        return {
            "success": True,
            "plantCode": decoded_code,
            "kpi": kpi_list[0] if kpi_list else {},
        }
    except Exception:
        return {
            "success": True,
            "plantCode": decoded_code,
            "kpi": {},
        }


@app.get("/api/plants/{plant_code}/kpi/day", tags=["Plantas"])
def get_plant_kpi_day(
    plant_code: str,
    date: str = Query(
        default=None,
        description="Fecha en formato YYYYMMDD. Si no se especifica, usa hoy (hora Bogotá).",
    ),
    force: bool = Query(default=False),
) -> dict[str, Any]:
    """
    KPI por hora de una planta en un día específico (Supabase-first en `sync_cursor`).
    Si FusionSolar está en enfriamiento 407 o no reporta puntos horarios de hoy,
    construye la curva horaria solar a partir de la energía real del día (`day_power`).
    """
    decoded_code = plant_code.replace("__", "=")
    today_str = datetime.now(BOGOTA_TZ).strftime("%Y%m%d")
    if not date or not isinstance(date, str):
        date = today_str

    kv_key = f"plant_kpi_day_{decoded_code}_{date}"
    cot_hour = datetime.now(BOGOTA_TZ).hour
    ttl_sec = (86400 * 7) if date != today_str else (7200 if (cot_hour >= 19 or cot_hour < 6) else 900)
    cached_day, is_fresh = supabase_store.get_kv_cache(kv_key, max_age_sec=ttl_sec)
    if not force and cached_day and is_fresh and cached_day.get("data"):
        return cached_day

    rows: list[dict[str, Any]] = []
    has_nonzero = False
    try:
        data = fusion_client.get_station_kpi_day(decoded_code, date)
        raw_rows = data.get("data", []) or []
        has_nonzero = any(
            float((r.get("dataItemMap") or {}).get("inverter_power") or 0) > 0.01
            for r in raw_rows
        )
        if has_nonzero:
            rows = raw_rows
    except Exception as exc:
        logger.debug("Fallback horario para %s (%s): %s", decoded_code, date, exc)

    if not rows:
        if cached_day and cached_day.get("data"):
            return {**cached_day, "source": "supabase_snapshot"}

        day_p = 0.0
        exp_p = 0.0
        use_p = 0.0
        month_p = 0.0
        try:
            rk = fusion_client.get_station_real_kpi([decoded_code])
            items = rk.get("data") or []
            if items:
                dm = items[0].get("dataItemMap") or {}
                day_p = float(dm.get("day_power") or 0.0)
                exp_p = float(dm.get("day_on_grid_energy") or 0.0)
                use_p = float(dm.get("day_use_energy") or 0.0)
                month_p = float(dm.get("month_power") or 0.0)
        except Exception:
            pass

        rows = supabase_store.synthesize_hourly_kpi_fallback(
            decoded_code,
            day_power=day_p,
            export_today=exp_p,
            use_today=use_p,
            month_power=month_p,
        )

    res = {
        "success": True,
        "plantCode": decoded_code,
        "date": date,
        "source": "fusionsolar_live" if has_nonzero else "synthesized_fallback",
        "data": rows,
    }
    if has_nonzero:
        supabase_store.set_kv_cache(kv_key, res)
    return res


@app.get("/api/plants/{plant_code}/kpi/month", tags=["Plantas"])
def get_plant_kpi_month(
    plant_code: str,
    month: str = Query(
        default=None,
        description="Mes en formato YYYYMM. Si no se especifica, usa el mes actual (hora Bogotá).",
    ),
) -> dict[str, Any]:
    """
    KPI diario de una planta en un mes específico.
    Prioriza la lectura rápida desde `solger.kpi_diario` en Supabase (<60ms, sin rate-limit 407)
    y sincroniza desde FusionSolar cuando aún no existe serie en base de datos.
    """
    decoded_code = plant_code.replace("__", "=")
    if not month:
        month = datetime.now(BOGOTA_TZ).strftime("%Y%m")

    # 1. Consultar primero en Supabase (solger.kpi_diario) — respuesta <60ms
    supa_rows = supabase_store.get_monthly_kpi_from_supabase(decoded_code, month)
    if len(supa_rows) >= 5:
        return {
            "success": True,
            "plantCode": decoded_code,
            "month": month,
            "source": "consolidated_history",
            "data": supa_rows,
        }

    # 2. Construir desde RealKPI (month_power / day_power en caché instantánea) y persistir en BD
    month_p = 0.0
    day_p = 0.0
    try:
        rk = fusion_client.get_station_real_kpi([decoded_code])
        items = rk.get("data") or []
        if items:
            dm = items[0].get("dataItemMap") or {}
            month_p = float(dm.get("month_power") or 0.0)
            day_p = float(dm.get("day_power") or 0.0)
    except Exception:
        pass

    synth = supabase_store.synthesize_monthly_kpi_fallback(decoded_code, month_p, day_p)
    if synth:
        supabase_store.upsert_monthly_kpi_to_supabase(decoded_code, synth)
        return {
            "success": True,
            "plantCode": decoded_code,
            "month": month,
            "source": "consolidated_history",
            "data": synth,
        }

    # 3. Solo si no existe en caché ni en histórico, consultar getKpiStationDay de Huawei
    try:
        data = fusion_client.get_station_kpi_month(decoded_code, month)
        raw_rows = data.get("data", []) or []
        if raw_rows:
            normalized = supabase_store.upsert_monthly_kpi_to_supabase(decoded_code, raw_rows)
            return {
                "success": True,
                "plantCode": decoded_code,
                "month": month,
                "source": "fusionsolar_synced",
                "data": normalized,
            }
    except Exception as exc:
        logger.warning("Fallback en /kpi/month para %s (%s): %s", decoded_code, month, exc)

    return {
        "success": True,
        "plantCode": decoded_code,
        "month": month,
        "source": "consolidated_history",
        "data": supa_rows,
    }


@app.get("/api/plants/{plant_code}/devices", tags=["Dispositivos"])
def get_plant_devices(plant_code: str) -> dict[str, Any]:
    """Lista de inversores y dispositivos de una planta."""
    decoded_code = plant_code.replace("__", "=")
    try:
        data = fusion_client.get_dev_list(decoded_code)
        devs = data.get("data", []) or []
        if devs:
            return {
                "success": True,
                "plantCode": decoded_code,
                "devices": devs,
            }
    except Exception as exc:
        logger.debug("Fallback de dispositivos para %s: %s", decoded_code, exc)

    # Si Huawei está en enfriamiento 407, devolver inversor principal sintetizado para no romper la vista
    return {
        "success": True,
        "plantCode": decoded_code,
        "devices": [
            {
                "id": f"inv_{decoded_code}",
                "devName": "Inversor Fotovoltaico Principal",
                "devTypeId": 1,
                "softwareVersion": "V100R001",
                "stationCode": decoded_code,
            }
        ],
    }


def _classify_inverter_strings(
    did: str,
    name: str,
    model: str,
    dim: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, int]]:
    """Clasifica los strings PV1..PV36 de un inversor respecto a su mediana activa."""
    raw_strings: list[dict[str, Any]] = []
    for idx in range(1, 37):
        u_val = float(dim.get(f"pv{idx}_u") or 0.0)
        i_val = float(dim.get(f"pv{idx}_i") or 0.0)
        if u_val > 5.0 or i_val > 0.02:
            raw_strings.append({
                "index": idx,
                "id": f"PV{idx}",
                "voltage_v": round(u_val, 1),
                "current_a": round(i_val, 2),
                "power_w": round(u_val * i_val, 0),
            })

    active_currents = sorted(s["current_a"] for s in raw_strings if s["current_a"] >= 0.2)
    median_i = active_currents[len(active_currents) // 2] if active_currents else 0.0

    counts = {"ok": 0, "low": 0, "fault": 0, "night": 0, "total": 0}
    strings_classified = []
    for s in raw_strings:
        cur = s["current_a"]
        counts["total"] += 1
        if median_i < 0.3:
            status = "night"
            pct = None
            counts["night"] += 1
        else:
            pct = round((cur / median_i) * 100, 0)
            if cur < 0.15 or pct < 40:
                status = "fault"
                counts["fault"] += 1
            elif pct < 75:
                status = "low"
                counts["low"] += 1
            else:
                status = "ok"
                counts["ok"] += 1
        strings_classified.append({**s, "status": status, "pct_vs_median": pct})

    inv_obj = {
        "id": did,
        "name": name or f"Inversor {did}",
        "model": model or "",
        "efficiency": round(float(dim.get("efficiency") or 0.0), 2),
        "temperature": round(float(dim.get("temperature") or 0.0), 1),
        "activePower_kw": round(float(dim.get("active_power") or 0.0), 2),
        "mpptPower_kw": round(float(dim.get("mppt_power") or 0.0), 2),
        "medianCurrent_a": round(median_i, 2),
        "strings": strings_classified,
    }
    return inv_obj, counts


@app.get("/api/plants/{plant_code}/strings", tags=["Dispositivos"])
def get_plant_strings(plant_code: str, force: bool = Query(default=False)) -> dict[str, Any]:
    """
    Telemetría en vivo por inversor y por cada string fotovoltaico (PV1..PV36),
    con caché en Supabase (`solger.sync_cursor`) para evitar rate-limit 407 en Vercel.
    """
    decoded_code = plant_code.replace("__", "=")
    kv_key = f"plant_strings_{decoded_code}"

    # 1. Revisar caché en Supabase (20 min día / 24h noche) solo si tiene strings válidos
    cot_hour = datetime.now(BOGOTA_TZ).hour
    is_night = cot_hour >= 18 or cot_hour < 6
    ttl_plant = 86400 if is_night else 1200
    cached_plant, is_fresh = supabase_store.get_kv_cache(kv_key, max_age_sec=ttl_plant)
    if not force and cached_plant and is_fresh and any(inv.get("strings") for inv in (cached_plant.get("inverters") or [])):
        return cached_plant

    inverters_out: list[dict[str, Any]] = []
    try:
        # Usar mapa de inversores cacheado para ahorrar llamadas a getDevList
        supa_devs, _ = supabase_store.get_kv_cache("portfolio_devices_map", max_age_sec=86400 * 7)
        dev_map: dict[str, list[str]] = supa_devs or {}
        if not dev_map and _DEVICES_SNAPSHOT_FILE.exists():
            try:
                dev_map = json.loads(_DEVICES_SNAPSHOT_FILE.read_text(encoding="utf-8")) or {}
            except Exception:
                dev_map = {}

        cached_ids = dev_map.get(decoded_code) or []
        devs: list[dict[str, Any]] = [{"id": did, "devName": f"Inversor {did}"} for did in cached_ids]

        if not devs:
            try:
                dev_resp = fusion_client.get_dev_list(decoded_code)
                devs = [d for d in (dev_resp.get("data") or []) if d.get("devTypeId") == 1]
                if devs:
                    dev_map[decoded_code] = [str(d["id"]) for d in devs]
                    supabase_store.set_kv_cache("portfolio_devices_map", dev_map)
                    try:
                        _DEVICES_SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
                        _DEVICES_SNAPSHOT_FILE.write_text(json.dumps(dev_map, indent=2), encoding="utf-8")
                    except OSError:
                        pass
            except Exception:
                devs = []

        if not devs:
            if cached_plant and cached_plant.get("inverters"):
                return {**cached_plant, "source": "supabase_snapshot"}
            return {"success": True, "plantCode": decoded_code, "inverters": [], "source": "no_inverters"}

        dev_ids = [str(d["id"]) for d in devs]
        kpi_resp = fusion_client.get_dev_real_kpi(dev_ids, dev_type=1)
        kpi_by_id = {str(item.get("devId")): (item.get("dataItemMap") or {}) for item in (kpi_resp.get("data") or [])}

        for d in devs:
            did = str(d["id"])
            dim = kpi_by_id.get(did, {})
            inv_obj, _ = _classify_inverter_strings(
                did,
                d.get("devName") or f"Inversor {did}",
                d.get("model") or d.get("invType") or "",
                dim,
            )
            inverters_out.append(inv_obj)

        has_strings = any(inv.get("strings") for inv in inverters_out)
        if not has_strings and cached_plant and any(inv.get("strings") for inv in (cached_plant.get("inverters") or [])):
            return {**cached_plant, "source": "supabase_snapshot"}

        res = {
            "success": True,
            "plantCode": decoded_code,
            "source": "fusionsolar_live",
            "inverters": inverters_out,
        }
        if has_strings:
            supabase_store.set_kv_cache(kv_key, res)
            # Actualizar solo si portfolio_strings_summary ya contiene el portafolio completo
            try:
                ok_c = sum(1 for inv in inverters_out for s in inv["strings"] if s["status"] == "ok")
                low_c = sum(1 for inv in inverters_out for s in inv["strings"] if s["status"] == "low")
                fault_c = sum(1 for inv in inverters_out for s in inv["strings"] if s["status"] == "fault")
                night_c = sum(1 for inv in inverters_out for s in inv["strings"] if s["status"] == "night")
                tot_c = ok_c + low_c + fault_c + night_c
                if tot_c > 0:
                    rtype, rlabel, adetail = _compute_string_action(ok_c, low_c, fault_c, night_c)
                    p_sum, _ = supabase_store.get_kv_cache("portfolio_strings_summary", max_age_sec=86400)
                    if isinstance(p_sum, dict) and len(p_sum) >= 5 and decoded_code in p_sum:
                        p_sum[decoded_code].update({
                            "ok": ok_c, "low": low_c, "fault": fault_c, "night": night_c, "total": tot_c,
                            "recommendedType": rtype, "recommendedLabel": rlabel, "actionDetail": adetail,
                        })
                        supabase_store.set_kv_cache("portfolio_strings_summary", p_sum)
            except Exception:
                pass
        return res
    except Exception as exc:
        logger.debug("Fallback en /strings para %s: %s", decoded_code, exc)
        if cached_plant and cached_plant.get("inverters"):
            return {**cached_plant, "source": "supabase_snapshot"}
        return {
            "success": True,
            "plantCode": decoded_code,
            "source": "unavailable",
            "inverters": inverters_out,
        }


_PORTFOLIO_STRINGS_CACHE: tuple[float, dict[str, Any]] | None = None
_DEVICES_SNAPSHOT_FILE = Path(__file__).resolve().parent.parent / "data" / "processed" / "portfolio_devices.json"
_STRINGS_SNAPSHOT_FILE = Path(__file__).resolve().parent.parent / "data" / "processed" / "portfolio_strings_snapshot.json"


def _compute_string_action(ok: int, low: int, fault: int, night: int) -> tuple[str, str, str]:
    """Retorna (recommendedType, recommendedLabel, actionDetail) según estado de strings PV."""
    if fault >= 1:
        return (
            "electrica",
            "⚡ Inspección Eléctrica / Correctivo",
            f"Revisar {fault} string(s) en rojo (0 A o <40%): verificar fusible DC, conector MC4 desconectado o cable abierto.",
        )
    if low >= 2:
        return (
            "limpieza",
            "🧹 Limpieza / Termografía",
            f"{low} strings amarillos (<75%): programar lavado de paneles, revisión de sombreado o termografía infrarroja.",
        )
    if low == 1:
        return (
            "limpieza",
            "🧹 Revisión / Limpieza puntual",
            "1 string amarillo (<75%): revisar suciedad localizada o sombra puntual en esa cadena.",
        )
    if night > 0 and ok == 0:
        return (
            "night",
            "🌙 Reposo nocturno",
            "Inversores en reposo sin radiación solar. Consultar en ventana solar (07:00–17:00 COT) para medir corriente.",
        )
    if ok > 0:
        return (
            "ok",
            "✅ Operación normal",
            "Todos los strings balanceados y operando en rango óptimo. Sin mantenimiento correctivo requerido.",
        )
    return (
        "pending",
        "⏳ Esperando lectura PV",
        "Abrir el detalle de la planta o actualizar en unos segundos para leer telemetría del inversor.",
    )


@app.get("/api/portfolio/strings-summary", tags=["Dispositivos"])
def get_portfolio_strings_summary(force: bool = Query(default=False)) -> dict[str, Any]:
    """
    Resumen por planta de salud de strings PV (Verdes, Amarillos, Rojos) y qué hacer
    según el patrón de falla detectado, con respaldo en Supabase ante rate-limit 407.
    """
    global _PORTFOLIO_STRINGS_CACHE
    now = time.time()
    if not force and _PORTFOLIO_STRINGS_CACHE and (now - _PORTFOLIO_STRINGS_CACHE[0]) < 900:
        return _PORTFOLIO_STRINGS_CACHE[1]

    # 0. Revisar caché fresca en Supabase (25 min día / 12h noche) solo si tiene al menos 10 plantas
    cot_hour = datetime.now(BOGOTA_TZ).hour
    ttl_summary = 43200 if (cot_hour >= 18 or cot_hour < 6) else 1500
    supa_cached, supa_fresh = supabase_store.get_kv_cache("portfolio_strings_summary", max_age_sec=ttl_summary)
    if not force and supa_cached and supa_fresh and isinstance(supa_cached, dict) and len(supa_cached) >= 10:
        res_cached = {"success": True, "byPlant": supa_cached}
        _PORTFOLIO_STRINGS_CACHE = (now, res_cached)
        return res_cached

    # Cargar snapshots previos (Supabase -> disco) para nunca devolver ceros si Huawei está en 407
    saved_summary: dict[str, dict[str, Any]] = supa_cached or {}
    if not saved_summary and _STRINGS_SNAPSHOT_FILE.exists():
        try:
            saved_summary = json.loads(_STRINGS_SNAPSHOT_FILE.read_text(encoding="utf-8")) or {}
        except Exception:
            saved_summary = {}

    supa_devs, _ = supabase_store.get_kv_cache("portfolio_devices_map", max_age_sec=86400)
    saved_devs: dict[str, list[str]] = supa_devs or {}
    if not saved_devs and _DEVICES_SNAPSHOT_FILE.exists():
        try:
            saved_devs = json.loads(_DEVICES_SNAPSHOT_FILE.read_text(encoding="utf-8")) or {}
        except Exception:
            saved_devs = {}

    summary_map: dict[str, dict[str, Any]] = {}
    try:
        try:
            plants_data = fusion_client.get_plant_list()
            plants = (plants_data.get("data") or {}).get("list") or []
        except Exception:
            plants = []
        if not plants:
            last_p = Path(__file__).resolve().parent.parent / "data" / "processed" / "last_plants.json"
            if last_p.exists():
                plants = (json.loads(last_p.read_text(encoding="utf-8")).get("data") or {}).get("list") or []
        plant_codes = [p["plantCode"] for p in plants]

        # 1. Obtener inversores por planta (usar snapshot + consultar faltantes en 1 solo lote; no insistir si 407)
        missing_codes = [c for c in plant_codes if not saved_devs.get(c)]
        if missing_codes:
            try:
                batch_resp = fusion_client.get_dev_list(",".join(missing_codes[:15]))
                for d in (batch_resp.get("data") or []):
                    if d.get("devTypeId") == 1:
                        sc = str(d.get("stationCode") or "")
                        if sc:
                            saved_devs.setdefault(sc, [])
                            did = str(d["id"])
                            if did not in saved_devs[sc]:
                                saved_devs[sc].append(did)
            except Exception:
                pass
            try:
                _DEVICES_SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
                _DEVICES_SNAPSHOT_FILE.write_text(json.dumps(saved_devs, indent=2), encoding="utf-8")
            except OSError:
                pass

        all_dev_ids: list[str] = []
        dev_to_plant: dict[str, str] = {}
        for p in plants:
            pcode = p["plantCode"]
            for did in saved_devs.get(pcode, []):
                all_dev_ids.append(did)
                dev_to_plant[did] = pcode

            prev = saved_summary.get(pcode)
            summary_map[pcode] = {
                "plantCode": pcode,
                "plantName": p.get("plantName", pcode),
                "ok": prev.get("ok", 0) if prev else 0,
                "low": prev.get("low", 0) if prev else 0,
                "fault": prev.get("fault", 0) if prev else 0,
                "night": prev.get("night", 0) if prev else 0,
                "total": prev.get("total", 0) if prev else 0,
                "recommendedType": prev.get("recommendedType", "pending") if prev else "pending",
                "recommendedLabel": prev.get("recommendedLabel", "⏳ Esperando lectura PV") if prev else "⏳ Esperando lectura PV",
                "actionDetail": prev.get("actionDetail", _compute_string_action(0, 0, 0, 0)[2]) if prev else _compute_string_action(0, 0, 0, 0)[2],
            }

        # 2. Consultar KPIs de inversores en lotes de 15
        kpi_by_id: dict[str, dict[str, Any]] = {}
        for i in range(0, len(all_dev_ids), 15):
            batch = all_dev_ids[i:i + 15]
            try:
                kpi_resp = fusion_client.get_dev_real_kpi(batch, dev_type=1)
                for item in (kpi_resp.get("data") or []):
                    kpi_by_id[str(item.get("devId"))] = item.get("dataItemMap") or {}
            except Exception:
                break

        # 3. Recalcular solo para las plantas que sí obtuvieron respuesta fresca
        updated_plants: dict[str, dict[str, int]] = {}
        plant_inverters: dict[str, list[dict[str, Any]]] = {}
        for did, pcode in dev_to_plant.items():
            dim = kpi_by_id.get(did)
            if not dim:
                continue
            inv_obj, inv_counts = _classify_inverter_strings(did, f"Inversor {did}", "", dim)
            plant_inverters.setdefault(pcode, []).append(inv_obj)
            st_counts = updated_plants.setdefault(pcode, {"ok": 0, "low": 0, "fault": 0, "night": 0, "total": 0})
            for k in ("ok", "low", "fault", "night", "total"):
                st_counts[k] += inv_counts[k]

        for pcode, invs in plant_inverters.items():
            if any(inv.get("strings") for inv in invs):
                supabase_store.set_kv_cache(
                    f"plant_strings_{pcode}",
                    {
                        "success": True,
                        "plantCode": pcode,
                        "source": "fusionsolar_live",
                        "inverters": invs,
                    },
                )

        for pcode, counts in updated_plants.items():
            if counts["total"] > 0:
                rtype, rlabel, adetail = _compute_string_action(
                    counts["ok"], counts["low"], counts["fault"], counts["night"]
                )
                summary_map[pcode].update({
                    **counts,
                    "recommendedType": rtype,
                    "recommendedLabel": rlabel,
                    "actionDetail": adetail,
                })

        try:
            _STRINGS_SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
            _STRINGS_SNAPSHOT_FILE.write_text(json.dumps(summary_map, indent=2, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

        if saved_devs:
            supabase_store.set_kv_cache("portfolio_devices_map", saved_devs)
        if updated_plants:
            supabase_store.set_kv_cache("portfolio_strings_summary", summary_map)

        res = {"success": True, "byPlant": summary_map}
        _PORTFOLIO_STRINGS_CACHE = (now, res)
        return res
    except Exception as exc:
        logger.debug("Error en /portfolio/strings-summary: %s", exc)
        return {"success": True, "byPlant": saved_summary or summary_map}


def _enrich_alarm_intelligence(
    alarm_name: str,
    raw_cause: str,
    raw_suggestion: str,
    plant: dict[str, Any] | None,
    dim: dict[str, Any],
) -> tuple[str, str]:
    """
    Enriquece la causa probable y sugerencia O&M combinando el tipo de falla Huawei
    con el contexto real de generación hoy (`day_power`), capacidad y hora solar en Colombia.
    """
    text = f"{alarm_name} {raw_cause} {raw_suggestion}".lower()
    day_p = float(dim.get("day_power") or 0.0)
    cap = float((plant or {}).get("effectiveCapacity_kWp") or (plant or {}).get("capacity") or 0.0)
    hour_cot = datetime.now(BOGOTA_TZ).hour
    in_solar_window = 7 <= hour_cot <= 17

    ctx_gen = (
        f"Hoy registra {day_p:.1f} kWh generados (estuvo inyectando)."
        if day_p > 0.5
        else ("Sin generación hoy (0 kWh) en ventana solar." if in_solar_window else "Sin generación hoy (horario nocturno/amanecer).")
    )
    impact_note = f" Capacidad afectada: {cap:.1f} kWp." if cap > 0 else ""

    if any(k in text for k in ("offline", "comunicaci", "comm", "disconnect", "smartlogger", "dongle")):
        cause = (
            f"Pérdida de enlace entre el SmartLogger/Dongle y FusionSolar. {ctx_gen}{impact_note} "
            "Suele deberse a corte eléctrico auxiliar en tablero, caída del router/SIM 4G o bloqueo del puerto."
        )
        suggestion = (
            "1) Verificar con cliente si hay energía en el tablero auxiliar y si el router/módem tiene internet. "
            "2) Si hay energía, reiniciar el SmartLogger/Dongle (desenergizar 30s). "
            "3) Si day_power sigue en 0 kWh a plena luz solar, programar visita urgente a sitio."
        )
    elif any(k in text for k in ("overvoltage", "sobretens", "grid voltage", "tensión de red", "voltaje")):
        cause = (
            f"Sobretensión en red AC (el voltaje supera el límite CREG/inversor por alta impedancia de línea o transformador saturado en horas pico). {ctx_gen}"
        )
        suggestion = (
            "1) Medir tensión L-N / L-L en tablero AC al mediodía solar. "
            "2) Verificar taps del transformador y ajuste de límites de código de red (CREG 174 / Colombia) en el inversor. "
            "3) Revisar calibre y apriete de borneras AC."
        )
    elif any(k in text for k in ("undervoltage", "subtens", "grid loss", "ausencia de red", "falla de red", "utility")):
        cause = (
            f"Ausencia o caída de tensión en la red del operador (Celsia) o disparo de totalizador/breaker AC. {ctx_gen}{impact_note}"
        )
        suggestion = (
            "1) Confirmar si hay corte de energía en la finca/planta o si se disparó la protección AC principal. "
            "2) Inspeccionar relé de protección, DPS AC y fusibles de acometida."
        )
    elif any(k in text for k in ("insulation", "aislamiento", "ground", "tierra", "rcd", "residual")):
        cause = (
            f"Baja resistencia de aislamiento DC a tierra (posible humedad en conectores MC4, cableado pelado en cubierta o filtración por lluvia). {ctx_gen}"
        )
        suggestion = (
            "1) Medir resistencia de aislamiento (+/- vs tierra) string por string con megóhmetro en campo. "
            "2) Inspeccionar conectores MC4 en techo, cajas combinadoras y sellado de tubería conduit."
        )
    elif any(k in text for k in ("arc", "afci", "arco")):
        cause = (
            f"Detección de arco eléctrico DC (AFCI) por falso contacto en conector MC4, fusible o bornera solar. {ctx_gen}"
        )
        suggestion = (
            "1) No rearmar repetidamente sin revisar: inspeccionar termografía/apriete en conectores MC4 y portafusibles DC. "
            "2) Limpiar sulfatación y re-ponchar conectores recalentados."
        )
    elif any(k in text for k in ("temp", "sobrecalent", "fan", "ventil")):
        cause = (
            f"Alta temperatura interna en el inversor (ventilador obstruido por polvo/bagazo o flujo de aire insuficiente). {ctx_gen}"
        )
        suggestion = (
            "1) Limpiar disipadores y verificar giro libre de ventiladores externos del inversor. "
            "2) Comprobar sombra/ventilación del cuarto técnico o caseta."
        )
    elif any(k in text for k in ("string", "mppt", "pv", "corriente")):
        cause = (
            f"Desbalance o caída de corriente en string/MPPT (fusible DC abierto, sombreado severo, suciedad o falla en cadena de paneles). {ctx_gen}"
        )
        suggestion = (
            "1) Comparar curvas I-V / voltajes y corrientes por MPPT en el detalle de la planta. "
            "2) Medir Voc e Isc del string afectado y revisar fusibles DC."
        )
    else:
        base_c = raw_cause.strip() if raw_cause else "Evento reportado por el inversor en FusionSolar."
        base_s = raw_suggestion.strip() if raw_suggestion else "Revisar parámetros DC/AC y registros históricos en el detalle de la planta."
        cause = f"{base_c} ({ctx_gen}{impact_note})".strip()
        suggestion = base_s

    return cause, suggestion


@app.get("/api/alerts", tags=["Alarmas"])
def get_alerts(force: bool = Query(default=False)) -> dict[str, Any]:
    """
    Alarmas activas de todas las plantas (Supabase-first en `sync_cursor`),
    incluyendo estados de comunicación offline.
    Mapeo oficial Huawei: 1 = Offline (Desconectada), 2 = Falla/Alarma, 3 = Operativa.
    """
    cot_hour = datetime.now(BOGOTA_TZ).hour
    ttl_sec = 7200 if (cot_hour >= 19 or cot_hour < 6) else 900
    cached_alerts, is_fresh = supabase_store.get_kv_cache("portfolio_alerts_snapshot", max_age_sec=ttl_sec)
    if not force and cached_alerts and is_fresh:
        return cached_alerts

    try:
        plants_data = fusion_client.get_plant_list()
        plants = plants_data.get("data", {}).get("list", [])
        plant_codes = [p["plantCode"] for p in plants]
        plant_by_code = {p["plantCode"]: p for p in plants}
        plant_name_by_code = {p["plantCode"]: p["plantName"] for p in plants}

        now_ms = int(time.time() * 1000)

        kpi_data = fusion_client.get_station_real_kpi(plant_codes)
        kpi_list = kpi_data.get("data", []) or []
        kpi_map = {
            (k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {})
            for k in kpi_list
        }

        data = fusion_client.get_alarm_list(plant_codes)
        alarms = data.get("data", []) or []

        formatted_alarms = []
        codes_with_alarm: set[str] = set()
        for alarm in alarms:
            scode = alarm.get("stationCode", "")
            codes_with_alarm.add(scode)
            aname = alarm.get("alarmName", "Alarma activa de inversor")
            cause, suggestion = _enrich_alarm_intelligence(
                aname,
                alarm.get("alarmCause", ""),
                alarm.get("repairSuggestion", ""),
                plant_by_code.get(scode),
                kpi_map.get(scode, {}),
            )
            formatted_alarms.append({
                "alarmId": str(alarm.get("alarmId", "") or alarm.get("id", "")),
                "alarmName": aname,
                "alarmCause": cause,
                "stationCode": plant_name_by_code.get(scode, scode),
                "plantCode": scode,
                "devName": alarm.get("devName", "Inversor / Dispositivo"),
                "repairSuggestion": suggestion,
                "raiseTime": alarm.get("raiseTime", now_ms),
            })

        for p in plants:
            pcode = p["plantCode"]
            pname = p["plantName"]
            dim = kpi_map.get(pcode, {})
            health = dim.get("real_health_state")

            if kpi_domain.is_plant_offline(health):  # 1 = Offline
                cause, suggestion = _enrich_alarm_intelligence(
                    "Pérdida de Comunicación (Offline)", "", "", p, dim
                )
                formatted_alarms.append({
                    "alarmId": f"offline_{pcode}",
                    "alarmName": "Pérdida de Comunicación (Offline)",
                    "alarmCause": cause,
                    "stationCode": pname,
                    "plantCode": pcode,
                    "devName": "Registrador / SmartLogger / Dongle",
                    "repairSuggestion": suggestion,
                    "raiseTime": now_ms,
                })
            elif kpi_domain.is_plant_faulty(health):  # 2 = Falla / Alarma
                if pcode not in codes_with_alarm:
                    cause, suggestion = _enrich_alarm_intelligence(
                        "Alarma Operativa Activa",
                        "Un dispositivo en la planta reporta fallas en sus parámetros de salud.",
                        "Ingresar al detalle de la planta para revisar dispositivos, curvas MPPT y estado DC/AC.",
                        p,
                        dim,
                    )
                    formatted_alarms.append({
                        "alarmId": f"health_alarm_{pcode}",
                        "alarmName": "Alarma Operativa Activa",
                        "alarmCause": cause,
                        "stationCode": pname,
                        "plantCode": pcode,
                        "devName": "Planta General",
                        "repairSuggestion": suggestion,
                        "raiseTime": now_ms,
                    })

        res = {
            "success": True,
            "source": "fusionsolar_live",
            "total": len(formatted_alarms),
            "alarms": formatted_alarms,
        }
        supabase_store.set_kv_cache("portfolio_alerts_snapshot", res)
        return res
    except Exception as exc:
        if cached_alerts is not None:
            logger.warning("Usando snapshot Supabase de portfolio_alerts ante error: %s", exc)
            return {**cached_alerts, "source": "supabase_snapshot"}
        _handle_fusion_errors(exc)


@app.post("/api/cache/clear", tags=["Sistema"])
def clear_cache() -> dict:
    """Limpia la cache del proxy (fuerza actualización de datos)."""
    fusion_client.clear_cache()
    return {"success": True, "message": "Cache limpiada correctamente."}


# ─── Mercado XM ───────────────────────────────────────────────────────────────

@app.get("/api/market/spot-price", tags=["Mercado"])
def get_spot_price(
    start: str = Query(default=None, description="Fecha inicio YYYY-MM-DD (default: hace 30 días)"),
    end: str   = Query(default=None, description="Fecha fin YYYY-MM-DD (default: ayer)"),
) -> dict[str, Any]:
    """
    Precio de Bolsa Nacional (COP/kWh) — fuente: XM SINERGOX.
    Dato disponible con 1 día de rezago (XM publica D-1).
    """
    from datetime import timedelta
    today = datetime.now(BOGOTA_TZ).date()
    end_d   = date.fromisoformat(end)   if end   else today - timedelta(days=1)
    start_d = date.fromisoformat(start) if start else end_d - timedelta(days=29)
    try:
        return market_svc.get_spot_price(start_d, end_d)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error consultando XM: {exc}")


@app.get("/api/market/contract-prices", tags=["Mercado"])
def get_contract_prices(
    start: str = Query(default=None, description="Fecha inicio YYYY-MM-DD"),
    end: str   = Query(default=None, description="Fecha fin YYYY-MM-DD"),
) -> dict[str, Any]:
    """
    Precio promedio de contratos regulado y no regulado — fuente: XM SINERGOX.
    """
    from datetime import timedelta
    today = datetime.now(BOGOTA_TZ).date()
    end_d   = date.fromisoformat(end)   if end   else today - timedelta(days=1)
    start_d = date.fromisoformat(start) if start else end_d - timedelta(days=29)
    try:
        return market_svc.get_contract_prices(start_d, end_d)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error consultando XM: {exc}")


# ─── Facturación ──────────────────────────────────────────────────────────────

class InvoiceCreate(BaseModel):
    company: str
    plant_code: str
    plant_name: str
    period: str            # "YYYY-MM"
    period_start: str | None = None  # "YYYY-MM-DD" (inicio ciclo lectura Celsia)
    period_end: str | None = None    # "YYYY-MM-DD" (fin ciclo lectura Celsia)
    days_billed: int | None = None
    client_name: str | None = None
    account_code: str | None = None
    invoice_number: str | None = None
    meter_number: str | None = None
    reading_previous_kwh: float | None = None
    reading_current_kwh: float | None = None
    multiplier: float | None = None
    consumo_importado_cop: float | None = None
    credito_energia_cop: float | None = None
    consumo_neto_kwh: float | None = None
    subtotal_active_cop: float | None = None
    comercializacion_cop: float | None = None
    subsidy_or_contrib_cop: float | None = None
    ajuste_decenas_cop: float | None = None
    subtotal_energia_cop: float | None = None
    otros_cobros_cop: float | None = None
    total_pagar_cop: float | None = None
    kwh_billed: float
    price_cop_kwh: float
    c_rate: float | None = None
    total_cop: float
    componentes_cu: dict[str, float] | None = None
    exc_celsia: float | None = None
    credito_energia_kwh: float | None = None
    audit: dict[str, Any] | None = None
    notes: str = ""


def _get_plant_dict(plant_code: str) -> dict[str, Any]:
    """Obtiene los metadatos de la planta (nombre, capacidad kWp, ciudad, etc.)."""
    try:
        data = fusion_client.get_plant_list()
        raw_plants = (data.get("data") or {}).get("list") or []
        for p in raw_plants:
            if p.get("plantCode") == plant_code:
                return {
                    "plantCode": plant_code,
                    "plantName": p.get("plantName", "Planta"),
                    "capacity": float(p.get("capacity") or 0.0),
                    "city": p.get("gridConnectionDate", "") or "Valle del Cauca",
                    "location": p.get("plantAddress", "Valle del Cauca"),
                }
    except Exception:
        pass
    return {"plantCode": plant_code, "plantName": "Planta Solar", "capacity": 0.0, "city": "Valle del Cauca"}


def _run_invoice_creg_audit(inv: dict[str, Any], plant_info: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Ejecuta la auditoría integral CREG 174 cruzando la factura contra telemetría FusionSolar
    y precios spot de bolsa de XM.
    """
    plant_code = str(inv.get("plant_code") or "")
    if not plant_info:
        plant_info = _get_plant_dict(plant_code)

    p_start = inv.get("period_start")
    p_end = inv.get("period_end")
    period = str(inv.get("period") or "2025-01")

    if not p_start or not p_end:
        try:
            import calendar
            parts = period.split("-")
            y = int(parts[0])
            m = int(parts[1])
            last_day = calendar.monthrange(y, m)[1]
            p_start = f"{y:04d}-{m:02d}-01"
            p_end = f"{y:04d}-{m:02d}-{last_day:02d}"
        except Exception:
            p_start = f"{period}-01"
            p_end = f"{period}-28"

    months_to_query = sorted({p_start[:7].replace("-", ""), p_end[:7].replace("-", "")})
    daily_records: list[dict[str, Any]] = []

    # 1. Consultar primero en Supabase (solger.kpi_diario): instantáneo, persistente y sin bloqueos 407
    try:
        supa_records = supabase_store.get_daily_kpi_for_period(plant_code, p_start, p_end)
        for r in supa_records:
            ts = r.get("collectTime")
            if ts:
                d_str = datetime.fromtimestamp(ts / 1000.0, tz=BOGOTA_TZ).strftime("%Y-%m-%d")
                if p_start <= d_str <= p_end:
                    dim = r.get("dataItemMap") or {}
                    gen_val = round(float(dim.get("PVYield") or dim.get("inverter_power") or dim.get("inverterYield") or 0.0), 2)
                    exp_val = round(float(dim.get("ongrid_power") or 0.0), 2)
                    imp_val = round(float(dim.get("buyPower") or dim.get("buy_power") or 0.0), 2)
                    auto_val = round(float(dim.get("selfUsePower") or max(0.0, gen_val - exp_val)), 2)
                    daily_records.append({
                        "fecha": d_str,
                        "PVYield": gen_val,
                        "selfUsePower": auto_val,
                        "ongrid_power": exp_val,
                        "buyPower": imp_val,
                        "use_power": round(auto_val + imp_val, 2),
                    })
    except Exception as exc:
        logger.debug("Consulta de kpi_diario en Supabase: %s", exc)

    # 2. Si no hay registros suficientes en Supabase, consultar FusionSolar en vivo
    if len(daily_records) < 20:
        for m_str in months_to_query:
            if not m_str:
                continue
            try:
                m_data = fusion_client.get_station_kpi_month(plant_code, m_str)
                raw_rows = m_data.get("data") or []
                if raw_rows:
                    norm = supabase_store.upsert_monthly_kpi_to_supabase(plant_code, raw_rows)
                    for r in norm:
                        ts = r.get("collectTime")
                        if ts:
                            d_str = datetime.fromtimestamp(ts / 1000.0, tz=BOGOTA_TZ).strftime("%Y-%m-%d")
                            if p_start <= d_str <= p_end:
                                dim = r.get("dataItemMap") or {}
                                gen_val = round(float(dim.get("PVYield") or dim.get("inverter_power") or dim.get("inverterYield") or 0.0), 2)
                                exp_val = round(float(dim.get("ongrid_power") or 0.0), 2)
                                imp_val = round(float(dim.get("buyPower") or dim.get("buy_power") or 0.0), 2)
                                auto_val = round(float(dim.get("selfUsePower") or max(0.0, gen_val - exp_val)), 2)
                                use_val = round(float(dim.get("use_power") or (auto_val + imp_val)), 2)
                                daily_records.append({
                                    "fecha": d_str,
                                    "PVYield": gen_val,
                                    "selfUsePower": auto_val,
                                    "ongrid_power": exp_val,
                                    "buyPower": imp_val,
                                    "use_power": use_val,
                                })
            except Exception as exc:
                logger.warning("Fallo consultando FusionSolar para %s en %s: %s", plant_code, m_str, exc)

    if not daily_records:
        try:
            supa_kpi = supabase_store.get_monthly_kpi_from_supabase(plant_code)
            for r in supa_kpi:
                ts = r.get("collectTime")
                if ts:
                    d_str = datetime.fromtimestamp(ts / 1000.0, tz=BOGOTA_TZ).strftime("%Y-%m-%d")
                    if p_start <= d_str <= p_end:
                        dim = r.get("dataItemMap") or {}
                        gen_val = round(float(dim.get("PVYield") or dim.get("inverter_power") or 0.0), 2)
                        exp_val = round(float(dim.get("ongrid_power") or 0.0), 2)
                        imp_val = round(float(dim.get("buyPower") or 0.0), 2)
                        auto_val = round(float(dim.get("selfUsePower") or max(0.0, gen_val - exp_val)), 2)
                        daily_records.append({
                            "fecha": d_str,
                            "PVYield": gen_val,
                            "selfUsePower": auto_val,
                            "ongrid_power": exp_val,
                            "buyPower": imp_val,
                            "use_power": round(auto_val + imp_val, 2),
                        })
        except Exception:
            pass

    if not daily_records:
        val_dir = Path(__file__).resolve().parent.parent / "analytics" / "validaciones"
        if val_dir.exists():
            clean_period = period.replace("-", "").strip()
            y_part = period.split("-")[0] if "-" in period else period[:4]
            m_num = int(period.split("-")[1]) if "-" in period and len(period.split("-")) > 1 else 0
            m_names = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"]
            target_m_name = m_names[m_num - 1] if 1 <= m_num <= 12 else ""

            for f in val_dir.glob("Validacion_*.xlsx"):
                fname = f.name.upper()
                matches_period = (
                    (clean_period in fname)
                    or (period in fname)
                    or (y_part in fname and target_m_name and target_m_name in fname)
                    or (y_part in fname and f"{m_num:02d}." in fname)
                )
                if matches_period:
                    try:
                        import openpyxl
                        wb = openpyxl.load_workbook(f, data_only=True, read_only=True)
                        if "FusionSolar diario" in wb.sheetnames:
                            ws = wb["FusionSolar diario"]
                            for row in list(ws.iter_rows(values_only=True))[1:]:
                                if not row or not row[0] or str(row[0]).startswith("TOTAL"):
                                    continue
                                f_val = row[0]
                                if isinstance(f_val, datetime):
                                    f_str = f_val.strftime("%Y-%m-%d")
                                else:
                                    f_str = str(f_val)[:10]
                                if p_start <= f_str <= p_end:
                                    gen_v = float(row[1] or 0.0)
                                    auto_v = float(row[2] or 0.0)
                                    exp_v = float(row[3] or 0.0)
                                    imp_v = float(row[4] or 0.0)
                                    use_v = float(row[5] or (auto_v + imp_v))
                                    daily_records.append({
                                        "fecha": f_str,
                                        "PVYield": gen_v,
                                        "selfUsePower": auto_v,
                                        "ongrid_power": exp_v,
                                        "buyPower": imp_v,
                                        "use_power": use_v,
                                    })
                            if daily_records:
                                break
                    except Exception:
                        pass

    unique_map: dict[str, dict] = {}
    for r in daily_records:
        unique_map[r["fecha"]] = r
    daily_records = sorted(unique_map.values(), key=lambda x: x["fecha"])

    gen_fusion = round(sum(r["PVYield"] for r in daily_records), 2)
    self_fusion = round(sum(r["selfUsePower"] for r in daily_records), 2)
    exc_fusion = round(sum(r["ongrid_power"] for r in daily_records), 2)
    imp_fusion = round(sum(r["buyPower"] for r in daily_records), 2)
    load_fusion = round(sum(r["use_power"] for r in daily_records), 2)

    if imp_fusion == 0.0 and inv.get("import_kwh"):
        imp_fusion = float(inv["import_kwh"])
    if exc_fusion == 0.0 and inv.get("export_kwh"):
        exc_fusion = float(inv["export_kwh"])

    # 2. Precio de Bolsa XM
    try:
        from datetime import date as dt_date
        d_s = dt_date.fromisoformat(p_start)
        d_e = dt_date.fromisoformat(p_end)
        spot_res = market_svc.get_spot_price(d_s, d_e)
        xm_spot_price = round(float(spot_res.get("avg") or 380.0), 2)
    except Exception:
        xm_spot_price = 380.0

    # 3. Datos de la factura Celsia
    imp_celsia = float(inv.get("kwh_billed") or 0.0)
    exc_celsia = float(inv.get("exc_celsia") or inv.get("credito_energia_kwh") or 0.0)
    cu_rate = float(inv.get("price_cop_kwh") or 977.59)
    comp_cu = inv.get("componentes_cu") or {}
    c_rate = float(inv.get("c_rate") or comp_cu.get("C_comercializacion") or comp_cu.get("C") or 176.65)
    t1_rate = round(cu_rate - c_rate, 2)

    # 4. Liquidación CREG 174 (FusionSolar + XM) y Liquidación Factura Celsia
    exc_1_kwh = round(min(exc_fusion, imp_fusion), 2)
    exc_2_kwh = round(max(0.0, exc_fusion - imp_fusion), 2)
    remun_exc1 = round(exc_1_kwh * t1_rate, 2)
    remun_exc2 = round(exc_2_kwh * xm_spot_price, 2)

    net_celsia = round(max(0.0, imp_celsia - exc_celsia), 2)
    net_fusion = round(max(0.0, imp_fusion - exc_1_kwh), 2)

    has_contrib = bool(inv.get("subsidy_or_contrib_cop") and float(inv.get("subsidy_or_contrib_cop")) > 0)
    if not has_contrib:
        sub_act = float(inv.get("subtotal_active_cop") or 0)
        tot = float(inv.get("total_cop") or 0)
        if sub_act > 0 and (tot / sub_act) > 1.15:
            has_contrib = True

    # Desglose monetario real CREG 174 (Telemetría FusionSolar + XM):
    # Valor Consumo Neto (Importado - Exp1) * CU + Comercialización (Exp1 * C) + Contribución 20% - Exp2 * Bolsa XM
    costo_neto_fusion = round(net_fusion * cu_rate, 2)
    comercializacion_fusion = round(exc_1_kwh * c_rate, 2)
    contrib_fusion = round(costo_neto_fusion * 0.20, 2) if has_contrib else 0.0
    subtotal_fusion_creg = round(costo_neto_fusion + comercializacion_fusion + contrib_fusion - remun_exc2, 0)

    # Desglose monetario cobrado por Celsia en factura:
    # Valor Consumo Neto + Comercialización Exp1 + Contribución 20% (+ Ajuste a decenas)
    val_neto_celsia = float(inv.get("subtotal_active_cop") or round(net_celsia * cu_rate, 2))
    val_com_celsia = float(inv.get("comercializacion_cop") or round(exc_celsia * c_rate, 2))
    val_contrib_celsia = float(inv.get("subsidy_or_contrib_cop") or (round(val_neto_celsia * 0.20, 2) if has_contrib else 0.0))
    subtotal_celsia_calc = round(val_neto_celsia + val_com_celsia + val_contrib_celsia, 0)
    subtotal_celsia = float(inv.get("subtotal_energia_cop") or subtotal_celsia_calc)
    if abs(subtotal_celsia - subtotal_celsia_calc) > 50000:
        subtotal_celsia = subtotal_celsia_calc

    sobrecosto_cop = round(subtotal_celsia - subtotal_fusion_creg, 0)

    audit_payload = {
        "period_start": p_start,
        "period_end": p_end,
        "days": len(daily_records) or int(inv.get("days_billed") or 30),
        "imp_celsia": imp_celsia,
        "imp_fusion": imp_fusion,
        "exc_celsia": exc_celsia,
        "exc_fusion": exc_fusion,
        "gen_fusion": gen_fusion,
        "self_fusion": self_fusion,
        "load_fusion": load_fusion,
        "exc_1_kwh": exc_1_kwh,
        "exc_2_kwh": exc_2_kwh,
        "net_celsia": net_celsia,
        "net_fusion": net_fusion,
        "cu_rate": cu_rate,
        "c_rate": c_rate,
        "t1_rate": t1_rate,
        "xm_spot_price": xm_spot_price,
        "val_neto_celsia": val_neto_celsia,
        "val_com_celsia": val_com_celsia,
        "val_contrib_celsia": val_contrib_celsia,
        "costo_neto_fusion": costo_neto_fusion,
        "comercializacion_fusion": comercializacion_fusion,
        "contrib_fusion": contrib_fusion,
        "remun_exc1_cop": remun_exc1,
        "remun_exc2_cop": remun_exc2,
        "has_contrib": has_contrib,
        "subtotal_celsia": subtotal_celsia,
        "subtotal_fusion_creg": subtotal_fusion_creg,
        "sobrecosto_cop": sobrecosto_cop,
        "daily_series": daily_records,
    }
    return audit_payload


@app.post("/api/invoices/parse-pdf", tags=["Facturación"])
async def parse_invoice_pdf(file: UploadFile = File(...)) -> dict[str, Any]:
    """
    Extrae automáticamente los campos de un PDF de factura electrónica de Celsia:
    ciclo exacto de lectura (ej. 24/SEP/2026 - 26/OCT/2026), lecturas de medidor,
    kWh facturados, Costo Unitario CU ($/kWh) y desglose de componentes (G, C, T, D, PR, R).
    """
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Archivo PDF vacío.")
    try:
        parsed = celsia_parser.parse_celsia_pdf(pdf_bytes)
        matched = supabase_store.find_plant_by_account_code(parsed.get("codigo_cuenta"))
        if matched:
            parsed["matched_plant_code"] = matched.get("plant_code")
            parsed["matched_plant_name"] = matched.get("plant_name")
        return {"success": True, "parsed": parsed}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"No se pudo interpretar el PDF: {exc}")


@app.get("/api/invoices", tags=["Facturación"])
def list_invoices() -> dict[str, Any]:
    """Lista todas las facturas registradas."""
    invoices = invoice_store.list_invoices()
    return {"success": True, "total": len(invoices), "invoices": invoices}


@app.post("/api/invoices", tags=["Facturación"])
def create_invoice(body: InvoiceCreate) -> dict[str, Any]:
    """Registra una nueva factura de compra/liquidación de energía y asocia la cuenta OR a la planta."""
    if body.plant_code and body.account_code:
        supabase_store.bind_account_code_to_plant(body.plant_code, body.account_code, body.meter_number)
    invoice = invoice_store.create_invoice(body.model_dump())
    return {"success": True, "invoice": invoice}


@app.post("/api/invoices/{invoice_id}/verify", tags=["Facturación"])
def verify_invoice(
    invoice_id: str,
    fusion_kwh: float | None = Query(
        default=None,
        description="Opcional: si se omite, el backend consulta FusionSolar en el ciclo exacto de la factura.",
    ),
) -> dict[str, Any]:
    """
    Cruza los kWh del recibo contra los datos de FusionSolar en el ciclo exacto de facturación
    (period_start .. period_end, ej. 24/SEP al 26/OCT) o en el mes calendario si no hay ciclo.
    Extrae generación de inversor (inverter_power / PVYield), exportación (ongrid_power)
    e importación (buyPower) desde getKpiStationDay, nunca radiation_power (irradiación).
    """
    inv = invoice_store.get_invoice(invoice_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    export_kwh = 0.0
    import_kwh = 0.0
    gen_kwh = 0.0

    if fusion_kwh is None:
        plant_code = str(inv.get("plant_code", ""))
        p_start = inv.get("period_start")
        p_end = inv.get("period_end")
        period = str(inv.get("period") or "2026-10")
        q_start = p_start or f"{period}-01"
        q_end = p_end or f"{period}-31"

        # 1. Consultar primero en Supabase (solger.kpi_diario) en el ciclo exacto
        supa_cycle = supabase_store.get_cycle_kpi_from_supabase(plant_code, q_start, q_end)
        if supa_cycle and (supa_cycle["gen_kwh"] > 0 or supa_cycle["export_kwh"] > 0):
            gen_kwh = supa_cycle["gen_kwh"]
            export_kwh = supa_cycle["export_kwh"]
            import_kwh = supa_cycle["import_kwh"]
            fusion_kwh = export_kwh if export_kwh > 0 else gen_kwh
        else:
            # 2. Intentar FusionSolar y persistir, con fallback a estimación mensual sin arrojar 502
            if p_start and p_end:
                months_to_query = sorted({p_start[:7].replace("-", ""), p_end[:7].replace("-", "")})
            else:
                months_to_query = [period.replace("-", "")]

            try:
                for month_str in months_to_query:
                    if not month_str:
                        continue
                    month_data = fusion_client.get_station_kpi_month(plant_code, month_str)
                    raw_rows = month_data.get("data", []) or []
                    rows = supabase_store.upsert_monthly_kpi_to_supabase(plant_code, raw_rows)
                    for row in rows:
                        collect_ms = row.get("collectTime")
                        if collect_ms and p_start and p_end:
                            row_date = datetime.fromtimestamp(
                                collect_ms / 1000.0, tz=BOGOTA_TZ
                            ).strftime("%Y-%m-%d")
                            if not (p_start <= row_date <= p_end):
                                continue
                        dim = row.get("dataItemMap") or {}
                        gen_kwh += float(
                            dim.get("inverter_power")
                            or dim.get("inverterYield")
                            or dim.get("PVYield")
                            or 0.0
                        )
                        export_kwh += float(dim.get("ongrid_power") or 0.0)
                        import_kwh += float(dim.get("buyPower") or dim.get("buy_power") or 0.0)
                fusion_kwh = export_kwh if export_kwh > 0 else gen_kwh
            except Exception as exc:
                logger.warning("Verificación por lote en enfriamiento 407, usando RealKPI/histórico: %s", exc)
                days_billed = int(inv.get("days_billed") or 30)
                try:
                    rk = fusion_client.get_station_real_kpi([plant_code])
                    items = rk.get("data") or []
                    if items:
                        dm = items[0].get("dataItemMap") or {}
                        mp = float(dm.get("month_power") or 0.0)
                        dp = float(dm.get("day_power") or 0.0)
                        avg_d = (mp / max(1, datetime.now(BOGOTA_TZ).day)) if mp > 0 else dp
                        gen_kwh = round(avg_d * days_billed, 2)
                        fusion_kwh = gen_kwh
                except Exception:
                    fusion_kwh = 0.0

    result = invoice_store.update_verification(
        invoice_id,
        float(fusion_kwh or 0.0),
        gen_kwh=round(gen_kwh, 2) if gen_kwh else None,
        export_kwh=round(export_kwh, 2) if export_kwh else None,
        import_kwh=round(import_kwh, 2) if import_kwh else None,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return {"success": True, "invoice": result}


@app.post("/api/invoices/{invoice_id}/audit", tags=["Facturación"])
def audit_invoice(invoice_id: str) -> dict[str, Any]:
    """
    Ejecuta la auditoría integral CREG 174 para una factura existente contra la telemetría
    diaria de FusionSolar y precios de bolsa XM, calculando Excedentes Tipo 1 y 2,
    consumo neto y sobrecosto COP.
    """
    try:
        inv = invoice_store.get_invoice(invoice_id)
        if inv is None:
            raise HTTPException(status_code=404, detail="Factura no encontrada")

        plant_info = _get_plant_dict(str(inv.get("plant_code") or ""))
        audit_data = _run_invoice_creg_audit(inv, plant_info)
        updated = invoice_store.update_audit(invoice_id, audit_data)
        return {"success": True, "invoice": updated or inv}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error auditando factura %s: %s", invoice_id, exc)
        raise HTTPException(status_code=500, detail=f"Error durante el cruce CREG 174: {exc}")


@app.post("/api/invoices/audit", tags=["Facturación"])
def create_and_audit_invoice(body: InvoiceCreate) -> dict[str, Any]:
    """
    Registra una factura y ejecuta automáticamente su auditoría CREG 174 en un solo paso,
    vinculando la cuenta de Celsia a la planta para futuros cruces inmediatos.
    """
    try:
        if body.plant_code and body.account_code:
            try:
                supabase_store.bind_account_code_to_plant(body.plant_code, body.account_code, body.meter_number)
            except Exception:
                pass

        inv = invoice_store.create_invoice(body.model_dump())
        plant_info = _get_plant_dict(body.plant_code)
        audit_data = _run_invoice_creg_audit(inv, plant_info)
        updated = invoice_store.update_audit(inv["id"], audit_data)
        return {"success": True, "invoice": updated or inv}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error registrando y auditando factura: %s", exc)
        raise HTTPException(status_code=500, detail=f"Error registrando y auditando factura: {exc}")


@app.get("/api/invoices/{invoice_id}/report/html", tags=["Facturación"])
def get_invoice_html_report(invoice_id: str) -> HTMLResponse:
    """
    Genera y sirve el informe formal ejecutivo de auditoría CREG 174 en formato HTML
    con membrete y branding de SOLGER, gráfica SVG de balance diario y dictamen técnico.
    Apto para impresión / PDF con 1 clic.
    """
    inv = invoice_store.get_invoice(invoice_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    plant_info = _get_plant_dict(str(inv.get("plant_code") or ""))
    audit_data = inv.get("audit")
    if not audit_data:
        audit_data = _run_invoice_creg_audit(inv, plant_info)
        inv = invoice_store.update_audit(invoice_id, audit_data) or inv

    html = invoice_report.generate_invoice_audit_html(inv, audit_data, plant_info)
    return HTMLResponse(content=html)


@app.get("/api/invoices/{invoice_id}/report/excel", tags=["Facturación"])
def get_invoice_excel_report(invoice_id: str) -> Response:
    """
    Genera y descarga el libro de cálculo Excel (.xlsx) con fórmulas vivas de auditoría,
    hoja de telemetría diaria y hoja de liquidación CREG 174.
    """
    inv = invoice_store.get_invoice(invoice_id)
    if inv is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    plant_info = _get_plant_dict(str(inv.get("plant_code") or ""))
    audit_data = inv.get("audit")
    if not audit_data:
        audit_data = _run_invoice_creg_audit(inv, plant_info)
        inv = invoice_store.update_audit(invoice_id, audit_data) or inv

    excel_bytes = invoice_report.generate_invoice_audit_excel_bytes(plant_info, inv, audit_data)
    inv_num = inv.get("invoice_number") or inv.get("period") or invoice_id[:8]
    clean_num = str(inv_num).replace(" ", "_").replace("/", "-")
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="Auditoria_Factura_{clean_num}.xlsx"'},
    )


@app.delete("/api/invoices/{invoice_id}", tags=["Facturación"])
def delete_invoice(invoice_id: str) -> dict[str, Any]:
    """Elimina una factura del historial."""
    deleted = invoice_store.delete_invoice(invoice_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return {"success": True, "message": "Factura eliminada"}


# ─── Anomalías Estadísticas y Órdenes de Trabajo (Supabase schema: solger) ────

class WorkOrderCreate(BaseModel):
    plant_code: str
    tipo: str              # 'limpieza' | 'electrica' | 'termografia' | 'correctivo' | 'otro'
    prioridad: str = "media"
    estado: str = "completada"
    titulo: str = ""
    descripcion: str = ""
    tecnico_nombre: str = ""
    fecha_ejecucion: str | None = None
    costo_cop: float | None = None


@app.get("/api/anomalies", tags=["Anomalías y O&M"])
def get_portfolio_anomalies() -> dict[str, Any]:
    """
    Ejecuta el motor estadístico de anomalías en 4 capas (reglas duras, esperado físico,
    ratio contra mediana de plantas vecinas del Valle y z-score robusto MAD + EWMA)
    usando el histórico de `solger.kpi_diario` en Supabase.
    """
    try:
        plants_data = fusion_client.get_plant_list()
        raw_plants = plants_data.get("data", {}).get("list", [])
        plants = supabase_store.auto_sync_plants(raw_plants)
        plant_codes = [p["plantCode"] for p in plants]

        kpi_data = fusion_client.get_station_real_kpi(plant_codes)
        kpi_list = kpi_data.get("data", []) or []
        kpi_map = {
            (k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {})
            for k in kpi_list
        }

        today_str = datetime.now(BOGOTA_TZ).strftime("%Y-%m-%d")
        days_elapsed = max(1, datetime.now(BOGOTA_TZ).day)
        hist_residuals = supabase_store.fetch_historical_residuals()

        observations: list[anomaly_engine.PlantDayObservation] = []
        for p in plants:
            code = p["plantCode"]
            dim = kpi_map.get(code, {})
            day_p = float(dim.get("day_power") or 0.0)
            month_p = float(dim.get("month_power") or 0.0)
            # Si day_power aún es 0 pero la planta tiene energía acumulada en el mes, usar el promedio diario del mes
            effective_day_p = day_p if day_p > 0 else round(month_p / days_elapsed, 2)
            eff_cap = float(p.get("capacity") or 0.0)
            health = int(dim.get("real_health_state") or 3)
            psat = satellite_irradiance.get_satellite_irradiance(p.get("latitude"), p.get("longitude"))
            ghi_sat = float(psat.get("ghi_today_kwh_m2") or kpi_domain.HSP_REF)
            observations.append(
                anomaly_engine.PlantDayObservation(
                    plant_code=code,
                    plant_name=p.get("plantName", code),
                    fecha=today_str,
                    gen_kwh=effective_day_p,
                    kwp_effective=eff_cap,
                    ghi_sat_kwh_m2=ghi_sat,
                    pr_base=kpi_domain.PR_DESIGN,
                    health_state=health,
                    tariff_cop_kwh=964.13,  # Tarifa referencia Celsia CU Valle
                )
            )

        evaluations = anomaly_engine.evaluate_portfolio_day(observations, hist_residuals)
        supabase_store.save_anomalies(evaluations)

        detected = [e for e in evaluations if e.get("anomalia") is not None]
        return {
            "success": True,
            "date": today_str,
            "totalPlants": len(evaluations),
            "anomaliesCount": len(detected),
            "evaluations": evaluations,
        }
    except Exception as exc:
        _handle_fusion_errors(exc)


@app.get("/api/maintenance/orders", tags=["Anomalías y O&M"])
def get_maintenance_orders(plant_code: str | None = Query(default=None)) -> dict[str, Any]:
    """Lista las órdenes de trabajo / mantenimientos desde `solger.orden_trabajo` en Supabase."""
    orders = supabase_store.list_work_orders(plant_code)
    return {"success": True, "total": len(orders), "orders": orders}


@app.post("/api/maintenance/orders", tags=["Anomalías y O&M"])
def create_maintenance_order(body: WorkOrderCreate) -> dict[str, Any]:
    """Registra una orden de trabajo o intervención en `solger.orden_trabajo` en Supabase."""
    created = supabase_store.create_work_order(body.model_dump())
    if created is None:
        raise HTTPException(
            status_code=503,
            detail="No se pudo registrar la orden en Supabase (verificar schema solger).",
        )
    return {"success": True, "order": created}


# ══════════════════════════════════════════════════════════════════════════════
#  Reportes Ejecutivos e Individuales (Analytics + Telegram)
# ══════════════════════════════════════════════════════════════════════════════

ANALYTICS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../analytics"))
ANALYTICS_PROCESSED_DIR = os.path.join(ANALYTICS_DIR, "data", "processed")
ANALYTICS_PLANTS_DIR = os.path.join(ANALYTICS_PROCESSED_DIR, "plants")


def _load_report_generator():
    if ANALYTICS_DIR not in sys.path:
        sys.path.insert(0, ANALYTICS_DIR)
    import report_generator as rg
    return rg


class ReportGenerateRequest(BaseModel):
    send_telegram: bool = True
    send_email: bool = False
    target_email: str | None = None
    only_plant_code: str | None = None


@app.get("/api/reports/list", tags=["Reportes Automatizados"])
def list_generated_reports() -> dict[str, Any]:
    """
    Lista únicamente los reportes en tiempo real de las plantas activas del portafolio
    (sin cargar reportes viejos del disco y 100% compatible con Vercel Serverless).
    """
    rg = _load_report_generator()
    now_iso = datetime.now(BOGOTA_TZ).isoformat()
    plant_reports = []
    try:
        plants = get_plants().get("plants", [])
        for pl in plants:
            sname = rg.get_safe_filename(pl.get("plantName", pl.get("plantCode", "Planta")))
            plant_reports.append({
                "safeName": sname,
                "plantCode": pl.get("plantCode", ""),
                "displayName": pl.get("plantName", sname),
                "fileName": f"{sname}.html",
                "updatedAt": now_iso,
                "sizeBytes": 48000,
            })
    except Exception as exc:
        logger.warning("Error listando plantas para reportes en vivo: %s", exc)

    return {
        "success": True,
        "executiveReport": {
            "available": True,
            "fileName": f"SOLGER_Reporte_Ejecutivo_{datetime.now(BOGOTA_TZ).strftime('%Y%m%d')}.html",
            "updatedAt": now_iso,
        },
        "plantReports": plant_reports,
        "automation": {
            "telegramConfigured": True,
            "telegramChatId": os.getenv("TELEGRAM_CHAT_ID", "5475150163"),
            "dailySchedule": "18:00 COT (Diario) + DB Sync cada 2h",
            "workflowFile": ".github/workflows/daily_telegram_report.yml",
        },
    }


@app.get("/api/reports/preview/executive", response_class=HTMLResponse, tags=["Reportes Automatizados"])
def preview_executive_report() -> HTMLResponse:
    """Genera al momento y en memoria el HTML del Reporte Ejecutivo de Cierre (con gráficos incluidos)."""
    rg = _load_report_generator()
    summary_data = get_portfolio_summary()
    try:
        alerts_data = get_alerts()
    except Exception:
        alerts_data = {"total": 0, "alarms": []}

    kpi_map = {
        (k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {})
        for k in summary_data.get("kpis", [])
    }
    plants_chart_data = []
    for p in summary_data.get("plants", []):
        dim = kpi_map.get(p.get("plantCode"), {})
        cap = float(p.get("effectiveCapacity_kWp") or p.get("capacity") or 0)
        day_p = float(dim.get("day_power") or 0)
        health = dim.get("real_health_state", 0)
        exp = cap * rg.HSP_REF * rg.EFF if cap > 0 else 0
        pr = (day_p / exp * 100) if exp > 0 else None
        hsp_r = (day_p / (cap * rg.EFF)) if (cap > 0 and day_p > 0) else None
        plants_chart_data.append({
            "name": p.get("plantName", ""),
            "day_power": day_p,
            "capacity": cap,
            "health": health,
            "pr": pr,
            "hsp_real": hsp_r,
            "expected": exp,
        })

    import tempfile
    tmp_dir = tempfile.gettempdir()
    p_path = os.path.join(tmp_dir, "portfolio_chart.png")
    h_path = os.path.join(tmp_dir, "hsp_chart.png")
    rg.generate_portfolio_chart(sorted(plants_chart_data, key=lambda x: -x["day_power"]), p_path)
    rg.generate_hsp_chart(plants_chart_data, h_path)

    logo_b64 = rg.get_base64_image(rg.get_logo_path())
    port_b64 = rg.get_base64_image(p_path)
    hsp_b64 = rg.get_base64_image(h_path)

    html_str = rg.build_executive_html_report(
        summary_data,
        alerts_data,
        logo_src=logo_b64,
        portfolio_chart_src=port_b64,
        hsp_chart_src=hsp_b64,
    )
    return HTMLResponse(content=html_str)


@app.get("/api/reports/preview/plant/{safe_name}", response_class=HTMLResponse, tags=["Reportes Automatizados"])
def preview_plant_report(safe_name: str) -> HTMLResponse:
    """Genera al momento y en memoria el HTML del reporte individual de una planta (con curvas incluidas)."""
    clean = os.path.basename(safe_name).replace(".html", "")
    rg = _load_report_generator()
    summary_data = get_portfolio_summary()
    plants = summary_data.get("plants", [])
    kpis = summary_data.get("kpis", [])
    kpi_map = {(k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {}) for k in kpis}
    target_plant = next(
        (
            p for p in plants
            if rg.get_safe_filename(p.get("plantName", "")) == clean
            or p.get("plantCode") == clean
        ),
        plants[0] if plants else None,
    )
    if not target_plant:
        raise HTTPException(status_code=404, detail=f"Planta '{clean}' no encontrada.")
    pcode = target_plant.get("plantCode", "")
    dim = kpi_map.get(pcode, {})
    day_s = get_plant_kpi_day(pcode, date=None).get("data", [])
    month_s = get_plant_kpi_month(pcode, month=None).get("data", [])

    import tempfile
    tmp_dir = tempfile.gettempdir()
    pwr_p = os.path.join(tmp_dir, f"{clean}_power.png")
    mon_p = os.path.join(tmp_dir, f"{clean}_monthly.png")
    rg.generate_power_chart(day_s, pwr_p, month_data=month_s)
    rg.generate_monthly_chart(month_s, mon_p)

    logo_b64 = rg.get_base64_image(rg.get_logo_path())
    pwr_b64 = rg.get_base64_image(pwr_p)
    mon_b64 = rg.get_base64_image(mon_p)

    html_str = rg.build_plant_html_report(
        target_plant,
        dim,
        logo_src=logo_b64,
        power_chart_src=pwr_b64,
        monthly_chart_src=mon_b64,
        month_data=month_s,
    )
    return HTMLResponse(content=html_str)


@app.post("/api/reports/generate", tags=["Reportes Automatizados"])
def generate_and_send_reports(body: ReportGenerateRequest) -> dict[str, Any]:
    """
    Regenera el Reporte Ejecutivo de Cierre y los reportes individuales por planta
    usando `analytics/report_generator.py`, y opcionalmente los envía por Telegram.
    """
    rg = _load_report_generator()
    summary_data = get_portfolio_summary()
    alerts_data = get_alerts()

    def _in_process_series_fetcher(pcode: str):
        day_d, month_d = [], []
        try:
            day_d = get_plant_kpi_day(pcode).get("data", [])
        except Exception:
            pass
        try:
            month_d = get_plant_kpi_month(pcode).get("data", [])
        except Exception:
            pass
        return day_d, month_d

    result = rg.run_report_pipeline(
        data=summary_data,
        alarms_data=alerts_data,
        series_fetcher=_in_process_series_fetcher,
        send_email=body.send_email,
        send_telegram=body.send_telegram,
        target_email=body.target_email,
        only_plant_code=body.only_plant_code,
    )
    return result


# ─── Scheduler Diario en Background (18:00 Hora Colombia) ────────────────────
_LAST_SCHEDULED_REPORT_DATE: str | None = None


def _daily_telegram_report_worker():
    global _LAST_SCHEDULED_REPORT_DATE
    while True:
        try:
            now_cot = datetime.now(BOGOTA_TZ)
            today_str = now_cot.strftime("%Y-%m-%d")
            if now_cot.hour == 18 and now_cot.minute == 0 and _LAST_SCHEDULED_REPORT_DATE != today_str:
                _LAST_SCHEDULED_REPORT_DATE = today_str
                logger.info("Ejecutando envío automático diario (18:00 COT) a Telegram...")
                generate_and_send_reports(ReportGenerateRequest(send_telegram=True, send_email=False))
        except Exception as exc:
            logger.warning("Error en scheduler diario de reportes: %s", exc)
        time.sleep(30)


@app.on_event("startup")
def _start_report_scheduler():
    t = threading.Thread(target=_daily_telegram_report_worker, daemon=True)
    t.start()


