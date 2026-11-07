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

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings
from fusionsolar import APIError, AuthenticationError, BOGOTA_TZ, fusion_client
import kpi as kpi_domain
import market as market_svc
import invoice_store

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
    """Lista completa de plantas solares del portafolio."""
    try:
        data = fusion_client.get_plant_list()
        plants = data.get("data", {}).get("list", [])
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
        plants = plants_data.get("data", {}).get("list", [])
        if not plants:
            raise HTTPException(status_code=404, detail="No se encontraron plantas.")

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
    try:
        decoded_code = plant_code.replace("__", "=")
        data = fusion_client.get_station_real_kpi([decoded_code])
        kpi_list = data.get("data", []) or []
        return {
            "success": True,
            "plantCode": decoded_code,
            "kpi": kpi_list[0] if kpi_list else {},
        }
    except Exception as exc:
        _handle_fusion_errors(exc)


@app.get("/api/plants/{plant_code}/kpi/day", tags=["Plantas"])
def get_plant_kpi_day(
    plant_code: str,
    date: str = Query(
        default=None,
        description="Fecha en formato YYYYMMDD. Si no se especifica, usa hoy (hora Bogotá).",
    ),
) -> dict[str, Any]:
    """KPI por hora de una planta en un día específico."""
    try:
        decoded_code = plant_code.replace("__", "=")
        if not date:
            date = datetime.now(BOGOTA_TZ).strftime("%Y%m%d")
        data = fusion_client.get_station_kpi_day(decoded_code, date)
        return {
            "success": True,
            "plantCode": decoded_code,
            "date": date,
            "data": data.get("data", []),
        }
    except Exception as exc:
        _handle_fusion_errors(exc)


@app.get("/api/plants/{plant_code}/kpi/month", tags=["Plantas"])
def get_plant_kpi_month(
    plant_code: str,
    month: str = Query(
        default=None,
        description="Mes en formato YYYYMM. Si no se especifica, usa el mes actual (hora Bogotá).",
    ),
) -> dict[str, Any]:
    """KPI diario de una planta en un mes específico."""
    try:
        decoded_code = plant_code.replace("__", "=")
        if not month:
            month = datetime.now(BOGOTA_TZ).strftime("%Y%m")
        data = fusion_client.get_station_kpi_month(decoded_code, month)
        return {
            "success": True,
            "plantCode": decoded_code,
            "month": month,
            "data": data.get("data", []),
        }
    except Exception as exc:
        _handle_fusion_errors(exc)


@app.get("/api/plants/{plant_code}/devices", tags=["Dispositivos"])
def get_plant_devices(plant_code: str) -> dict[str, Any]:
    """Lista de inversores y dispositivos de una planta."""
    try:
        decoded_code = plant_code.replace("__", "=")
        data = fusion_client.get_dev_list(decoded_code)
        return {
            "success": True,
            "plantCode": decoded_code,
            "devices": data.get("data", []),
        }
    except Exception as exc:
        _handle_fusion_errors(exc)


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
    kwh_billed: float
    price_cop_kwh: float
    total_cop: float
    notes: str = ""


@app.get("/api/invoices", tags=["Facturación"])
def list_invoices() -> dict[str, Any]:
    """Lista todas las facturas registradas."""
    invoices = invoice_store.list_invoices()
    return {"success": True, "total": len(invoices), "invoices": invoices}


@app.post("/api/invoices", tags=["Facturación"])
def create_invoice(body: InvoiceCreate) -> dict[str, Any]:
    """Registra una nueva factura de compra/liquidación de energía."""
    invoice = invoice_store.create_invoice(body.model_dump())
    return {"success": True, "invoice": invoice}


@app.post("/api/invoices/{invoice_id}/verify", tags=["Facturación"])
def verify_invoice(
    invoice_id: str,
    fusion_kwh: float | None = Query(
        default=None,
        description="Opcional: si se omite, el backend consulta FusionSolar directamente.",
    ),
) -> dict[str, Any]:
    """
    Cruza los kWh del recibo contra los datos mensuales de FusionSolar.
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
        month_str = str(inv.get("period", "")).replace("-", "")
        plant_code = str(inv.get("plant_code", ""))
        try:
            month_data = fusion_client.get_station_kpi_month(plant_code, month_str)
            rows = month_data.get("data", []) or []
            for row in rows:
                dim = row.get("dataItemMap") or {}
                gen_kwh += float(
                    dim.get("inverter_power")
                    or dim.get("inverterYield")
                    or dim.get("PVYield")
                    or 0.0
                )
                export_kwh += float(dim.get("ongrid_power") or 0.0)
                import_kwh += float(dim.get("buyPower") or dim.get("buy_power") or 0.0)
            # Usar exportación si existe medidor bidireccional con lecturas; si no, generación
            fusion_kwh = export_kwh if export_kwh > 0 else gen_kwh
        except Exception as exc:
            _handle_fusion_errors(exc)

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
