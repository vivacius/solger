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
                            est = db_row.get("kwp_dc_estimado")
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

