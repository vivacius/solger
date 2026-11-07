"""
SOLGER — Cliente ligero de persistencia hacia Supabase (schema: solger).

Garantiza que:
1. Cualquier planta existente o nueva agregada al usuario de FusionSolar se registre
   automáticamente en `solger.planta` (auto-discovery vía ON CONFLICT fs_plant_code).
2. Las plantas con `capacity = 0` en FusionSolar reciban su capacidad efectiva (`kwp_dc_estimado`)
   calculada desde su serie histórica (P90 diario), almacenada en `solger.planta` y en caché local.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from config import settings
from fusionsolar import BOGOTA_TZ

logger = logging.getLogger("solger.supabase")

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"
ESTIMATED_CAPS_FILE = PROCESSED_DIR / "capacidades_estimadas.json"

_LAST_PLANT_SYNC_TS: float = 0.0
_SYNC_INTERVAL_SEC: float = 900.0  # Sincronizar catálogo cada 15 min
_ORG_ID_CACHE: str | None = None
_DB_CAPS_CACHE: dict[str, float] = {}
_PLANT_UUID_CACHE: dict[str, str] = {}
_UUID_PLANT_CACHE: dict[str, str] = {}


def is_configured() -> bool:
    return bool(
        settings.SUPABASE_URL
        and (settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY)
    )


def _headers() -> dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Profile": settings.DB_SCHEMA,
        "Accept-Profile": settings.DB_SCHEMA,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }


def _load_local_estimates() -> dict[str, float]:
    """Lee capacidades estimadas por histórico P90 desde el archivo local de respaldo."""
    if not ESTIMATED_CAPS_FILE.exists():
        return {}
    try:
        payload = json.loads(ESTIMATED_CAPS_FILE.read_text(encoding="utf-8"))
        plants = payload.get("plants") or {}
        return {
            code: float(info["kwp_estimated"])
            for code, info in plants.items()
            if info.get("kwp_estimated")
        }
    except Exception:
        return {}


def _get_org_id() -> str | None:
    global _ORG_ID_CACHE
    if _ORG_ID_CACHE:
        return _ORG_ID_CACHE
    if not is_configured():
        return None
    base = f"{settings.SUPABASE_URL}/rest/v1"
    r = requests.get(
        f"{base}/organizacion?nombre=eq.SOLGER&select=id",
        headers=_headers(),
        timeout=10,
    )
    if r.status_code != 200:
        return None
    rows = r.json()
    if rows:
        _ORG_ID_CACHE = rows[0]["id"]
        return _ORG_ID_CACHE
    r_ins = requests.post(
        f"{base}/organizacion",
        headers=_headers(),
        json={"nombre": "SOLGER"},
        timeout=10,
    )
    if r_ins.status_code in (200, 201) and r_ins.json():
        _ORG_ID_CACHE = r_ins.json()[0]["id"]
    return _ORG_ID_CACHE


def auto_sync_plants(plants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Enriquece la lista de plantas de FusionSolar con las capacidades estimadas por histórico (P90)
    y sincroniza automáticamente cualquier planta nueva o modificada en `solger.planta`.
    """
    global _LAST_PLANT_SYNC_TS, _DB_CAPS_CACHE
    local_ests = _load_local_estimates()

    now = time.monotonic()
    if is_configured() and (now - _LAST_PLANT_SYNC_TS > _SYNC_INTERVAL_SEC):
        try:
            org_id = _get_org_id()
            if org_id:
                base = f"{settings.SUPABASE_URL}/rest/v1"
                rows_to_upsert = []
                for p in plants:
                    code = p.get("plantCode", "")
                    if not code:
                        continue
                    nom_cap = float(p.get("capacity") or 0.0)
                    est_cap = local_ests.get(code) or _DB_CAPS_CACHE.get(code)
                    row: dict[str, Any] = {
                        "org_id": org_id,
                        "fs_plant_code": code,
                        "fs_plant_id": code.replace("NE=", ""),
                        "nombre": p.get("plantName", code),
                        "kwp_dc_nominal": nom_cap,
                        "latitud": float(p["latitude"]) if p.get("latitude") else None,
                        "longitud": float(p["longitude"]) if p.get("longitude") else None,
                        "direccion": p.get("plantAddress"),
                        "fecha_conexion": str(p.get("gridConnectionDate"))[:10] if p.get("gridConnectionDate") else None,
                        "ultima_sincronizacion_fs": datetime.now(BOGOTA_TZ).isoformat(),
                    }
                    if nom_cap > 0:
                        row["metodo_estimacion_kwp"] = "fusionsolar"
                    elif est_cap:
                        row["kwp_dc_estimado"] = est_cap
                        row["metodo_estimacion_kwp"] = "p90_daily_yield"
                    rows_to_upsert.append(row)

                if rows_to_upsert:
                    resp = requests.post(
                        f"{base}/planta?on_conflict=fs_plant_code",
                        headers=_headers(),
                        json=rows_to_upsert,
                        timeout=15,
                    )
                    if resp.status_code in (200, 201):
                        for db_row in resp.json():
                            c = db_row.get("fs_plant_code")
                            uid = db_row.get("id")
                            est = db_row.get("kwp_dc_estimado")
                            if c and uid:
                                _PLANT_UUID_CACHE[c] = uid
                                _UUID_PLANT_CACHE[uid] = c
                            if c and est:
                                _DB_CAPS_CACHE[c] = float(est)
                        _LAST_PLANT_SYNC_TS = now
                        logger.info("Auto-sync de %d plantas en solger.planta completado.", len(rows_to_upsert))
                    else:
                        logger.debug("Supabase solger.planta aún no disponible (%s): %s", resp.status_code, resp.text[:160])
        except Exception as exc:
            logger.debug("Auto-sync con Supabase omitido temporalmente: %s", exc)

    # Enriquecer en memoria cada planta con capacidad efectiva si capacity == 0
    enriched: list[dict[str, Any]] = []
    for p in plants:
        item = dict(p)
        code = item.get("plantCode", "")
        nom_cap = float(item.get("capacity") or 0.0)
        est_cap = _DB_CAPS_CACHE.get(code) or local_ests.get(code)
        if nom_cap <= 0 and est_cap and est_cap > 0:
            item["capacity"] = est_cap
            item["capacityNominal"] = 0.0
            item["capacityEstimated"] = True
            item["capacityEstimationMethod"] = "p90_daily_yield"
        else:
            item["capacityNominal"] = nom_cap
            item["capacityEstimated"] = False
        enriched.append(item)

    return enriched


def _ensure_plant_uuids() -> dict[str, str]:
    """Asegura el mapa fs_plant_code -> UUID desde solger.planta."""
    if _PLANT_UUID_CACHE or not is_configured():
        return _PLANT_UUID_CACHE
    try:
        base = f"{settings.SUPABASE_URL}/rest/v1"
        r = requests.get(
            f"{base}/planta?select=id,fs_plant_code,kwp_dc_estimado",
            headers=_headers(),
            timeout=10,
        )
        if r.status_code == 200:
            for row in r.json():
                c = row.get("fs_plant_code")
                uid = row.get("id")
                if c and uid:
                    _PLANT_UUID_CACHE[c] = uid
                    _UUID_PLANT_CACHE[uid] = c
                if c and row.get("kwp_dc_estimado"):
                    _DB_CAPS_CACHE[c] = float(row["kwp_dc_estimado"])
    except Exception as exc:
        logger.debug("No se pudo cargar mapa de UUIDs de plantas: %s", exc)
    return _PLANT_UUID_CACHE


def fetch_historical_residuals() -> dict[str, list[float]]:
    """
    Obtiene los residuos históricos (indice_diseno_pct / 100.0) por planta desde solger.kpi_diario
    para alimentar el cálculo de z-score robusto (MAD) y EWMA del motor de anomalías.
    """
    if not is_configured():
        return {}
    _ensure_plant_uuids()
    try:
        base = f"{settings.SUPABASE_URL}/rest/v1"
        r = requests.get(
            f"{base}/kpi_diario?select=planta_id,fecha,indice_diseno_pct&order=fecha.asc&limit=2000",
            headers=_headers(),
            timeout=15,
        )
        if r.status_code != 200:
            return {}
        out: dict[str, list[float]] = {}
        for row in r.json():
            uid = row.get("planta_id")
            idx = row.get("indice_diseno_pct")
            code = _UUID_PLANT_CACHE.get(uid, "")
            if code and idx is not None and float(idx) > 0:
                out.setdefault(code, []).append(round(float(idx) / 100.0, 3))
        return out
    except Exception as exc:
        logger.debug("No se pudieron consultar residuos históricos: %s", exc)
        return {}


def save_anomalies(evaluations: list[dict[str, Any]]) -> None:
    """Persiste las anomalías detectadas hoy en solger.anomalia."""
    if not is_configured():
        return
    uuid_map = _ensure_plant_uuids()
    rows = []
    for ev in evaluations:
        anom = ev.get("anomalia")
        if not anom:
            continue
        planta_id = uuid_map.get(ev["plant_code"])
        if not planta_id:
            continue
        rows.append({
            "planta_id": planta_id,
            "fecha_deteccion": ev["fecha"],
            "tipo": anom["tipo"],
            "severidad": anom["severidad"],
            "z_score": ev.get("z_score_robusto"),
            "ratio_pares": ev.get("ratio_pares"),
            "kwh_perdidos": ev.get("kwh_perdidos", 0),
            "cop_perdidos": ev.get("cop_perdidos", 0),
            "descripcion": anom["descripcion"],
            "recomendacion": anom.get("recomendacion"),
        })
    if not rows:
        return
    try:
        base = f"{settings.SUPABASE_URL}/rest/v1"
        requests.post(
            f"{base}/anomalia?on_conflict=planta_id,fecha_deteccion,tipo",
            headers=_headers(),
            json=rows,
            timeout=15,
        )
    except Exception as exc:
        logger.debug("No se pudieron guardar anomalías en Supabase: %s", exc)


def list_work_orders(plant_code: str | None = None) -> list[dict[str, Any]]:
    """Lista las órdenes de trabajo / intervenciones registradas en solger.orden_trabajo."""
    if not is_configured():
        return []
    uuid_map = _ensure_plant_uuids()
    try:
        base = f"{settings.SUPABASE_URL}/rest/v1"
        url = f"{base}/orden_trabajo?select=*&order=created_at.desc&limit=500"
        if plant_code and plant_code in uuid_map:
            url += f"&planta_id=eq.{uuid_map[plant_code]}"
        r = requests.get(url, headers=_headers(), timeout=12)
        if r.status_code != 200:
            return []
        items = []
        for row in r.json():
            uid = row.get("planta_id")
            items.append({
                **row,
                "plant_code": _UUID_PLANT_CACHE.get(uid, ""),
            })
        return items
    except Exception as exc:
        logger.debug("Error listando orden_trabajo: %s", exc)
        return []


def create_work_order(data: dict[str, Any]) -> dict[str, Any] | None:
    """Crea una orden de trabajo / registro de mantenimiento en solger.orden_trabajo."""
    if not is_configured():
        return None
    uuid_map = _ensure_plant_uuids()
    plant_code = data.get("plant_code", "")
    planta_id = uuid_map.get(plant_code)
    if not planta_id:
        return None
    payload = {
        "planta_id": planta_id,
        "tipo": data.get("tipo", "otro"),
        "prioridad": data.get("prioridad", "media"),
        "estado": data.get("estado", "completada"),
        "titulo": data.get("titulo") or f"Mantenimiento {data.get('tipo', 'general')}",
        "descripcion": data.get("descripcion", ""),
        "tecnico_nombre": data.get("tecnico_nombre", ""),
        "fecha_ejecucion": data.get("fecha_ejecucion") or datetime.now(BOGOTA_TZ).strftime("%Y-%m-%d"),
        "costo_cop": data.get("costo_cop"),
    }
    try:
        base = f"{settings.SUPABASE_URL}/rest/v1"
        r = requests.post(f"{base}/orden_trabajo", headers=_headers(), json=payload, timeout=12)
        if r.status_code in (200, 201) and r.json():
            row = r.json()[0]
            row["plant_code"] = plant_code
            return row
    except Exception as exc:
        logger.debug("Error creando orden_trabajo: %s", exc)
    return None


