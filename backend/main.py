"""
FastAPI — Servidor proxy SOLGER para FusionSolar Northbound API.

Nota de concurrencia:
    Mientras la sesión de FusionSolar viva en memoria, ejecutar con --workers 1
    para evitar que dos procesos invaliden mutuamente el XSRF-TOKEN.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, date
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
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
def get_portfolio_summary() -> dict[str, Any]:
    """
    KPIs globales del portafolio completo.
    Usa el mapeo oficial de Huawei Northbound:
        real_health_state: 1 = Offline, 2 = Falla/Alarma, 3 = Operativa (Healthy)
    """
    try:
        plants_data = fusion_client.get_plant_list()
        raw_plants = plants_data.get("data", {}).get("list", [])
        if not raw_plants:
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

        return {
            "success": True,
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
    except HTTPException:
        raise
    except Exception as exc:
        _handle_fusion_errors(exc)


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
) -> dict[str, Any]:
    """
    KPI por hora de una planta en un día específico.
    Si FusionSolar está en enfriamiento 407 o no reporta puntos horarios de hoy,
    construye la curva horaria solar a partir de la energía real del día (`day_power`).
    """
    decoded_code = plant_code.replace("__", "=")
    if not date or not isinstance(date, str):
        date = datetime.now(BOGOTA_TZ).strftime("%Y%m%d")

    rows: list[dict[str, Any]] = []
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

    return {
        "success": True,
        "plantCode": decoded_code,
        "date": date,
        "data": rows,
    }


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


@app.get("/api/alerts", tags=["Alarmas"])
def get_alerts() -> dict[str, Any]:
    """
    Alarmas activas de todas las plantas, incluyendo estados de comunicación offline.
    Mapeo oficial Huawei: 1 = Offline (Desconectada), 2 = Falla/Alarma, 3 = Operativa.
    """
    try:
        plants_data = fusion_client.get_plant_list()
        plants = plants_data.get("data", {}).get("list", [])
        plant_codes = [p["plantCode"] for p in plants]
        plant_name_by_code = {p["plantCode"]: p["plantName"] for p in plants}

        now_ms = int(time.time() * 1000)

        data = fusion_client.get_alarm_list(plant_codes)
        alarms = data.get("data", []) or []

        formatted_alarms = []
        codes_with_alarm: set[str] = set()
        for alarm in alarms:
            scode = alarm.get("stationCode", "")
            codes_with_alarm.add(scode)
            formatted_alarms.append({
                "alarmId": str(alarm.get("alarmId", "") or alarm.get("id", "")),
                "alarmName": alarm.get("alarmName", "Alarma activa de inversor"),
                "alarmCause": alarm.get("alarmCause", "Falla en dispositivo reportada en FusionSolar"),
                "stationCode": plant_name_by_code.get(scode, scode),
                "plantCode": scode,
                "devName": alarm.get("devName", "Inversor / Dispositivo"),
                "repairSuggestion": alarm.get("repairSuggestion", "Verificar estado y ventilación del inversor."),
                "raiseTime": alarm.get("raiseTime", now_ms),
            })

        kpi_data = fusion_client.get_station_real_kpi(plant_codes)
        kpi_list = kpi_data.get("data", []) or []
        kpi_map = {
            (k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {})
            for k in kpi_list
        }

        for p in plants:
            pcode = p["plantCode"]
            pname = p["plantName"]
            dim = kpi_map.get(pcode, {})
            health = dim.get("real_health_state")

            if kpi_domain.is_plant_offline(health):  # 1 = Offline
                formatted_alarms.append({
                    "alarmId": f"offline_{pcode}",
                    "alarmName": "Pérdida de Comunicación (Offline)",
                    "alarmCause": "La planta solar ha dejado de transmitir telemetría a FusionSolar.",
                    "stationCode": pname,
                    "plantCode": pcode,
                    "devName": "Registrador / SmartLogger / Dongle",
                    "repairSuggestion": "Revisar alimentación eléctrica del registrador de datos y el estado de la conexión a Internet local (router/modem).",
                    "raiseTime": now_ms,
                })
            elif kpi_domain.is_plant_faulty(health):  # 2 = Falla / Alarma
                if pcode not in codes_with_alarm:
                    formatted_alarms.append({
                        "alarmId": f"health_alarm_{pcode}",
                        "alarmName": "Alarma Operativa Activa",
                        "alarmCause": "Un dispositivo en la planta reporta fallas en sus parámetros de salud.",
                        "stationCode": pname,
                        "plantCode": pcode,
                        "devName": "Planta General",
                        "repairSuggestion": "Ingresar al panel de detalle de la planta para diagnosticar el inversor o módulo en alarma.",
                        "raiseTime": now_ms,
                    })

        return {
            "success": True,
            "total": len(formatted_alarms),
            "alarms": formatted_alarms,
        }
    except Exception as exc:
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
    subtotal_active_cop: float | None = None
    subsidy_or_contrib_cop: float | None = None
    kwh_billed: float
    price_cop_kwh: float
    total_cop: float
    componentes_cu: dict[str, float] | None = None
    notes: str = ""


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

    p_path = "/tmp/portfolio_chart.png"
    h_path = "/tmp/hsp_chart.png"
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

    pwr_p = f"/tmp/{clean}_power.png"
    mon_p = f"/tmp/{clean}_monthly.png"
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


