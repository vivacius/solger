"""
SOLGER — Módulo de Mercado XM.

Integra con la API pública de XM (sin usuario/clave requeridos) para obtener:
  · Precio de Bolsa Nacional (PrecBolsNaci) — promedio 24h y promedio horario solar (06-18h)
  · Precio Promedio Contratos Regulado / No Regulado

Docs API: https://github.com/EquipoAnaliticaXM/API_XM
"""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any

from config import settings

logger = logging.getLogger("solger.market")

# ─── Cache simple (evita llamar XM en cada request) ──────────────────────────
_CACHE: dict[str, tuple[float, Any]] = {}
CACHE_TTL = 3600  # 1 hora
SOLAR_HOURS = {f"Values_Hour{h:02d}" for h in range(6, 18)}


def _cached(key: str, fn, *args, **kwargs) -> Any:
    now = time.time()
    if key in _CACHE:
        ts, val = _CACHE[key]
        if now - ts < CACHE_TTL:
            return val
    val = fn(*args, **kwargs)
    _CACHE[key] = (now, val)
    return val


# ─── Cliente XM ──────────────────────────────────────────────────────────────

def _build_xm_client():
    """Intenta importar pydataxm. Retorna None si no está instalado."""
    try:
        from pydataxm import PYDATAXM  # type: ignore
        return PYDATAXM()
    except ImportError:
        logger.warning("pydataxm no está instalado. Usa: pip install pydataxm")
        return None
    except Exception as exc:
        logger.warning(f"No se pudo inicializar pydataxm: {exc}")
        return None


def _fetch_metric(metric: str, entity: str, start: date, end: date) -> list[dict]:
    """Llama a la API XM y convierte el DataFrame a lista de dicts."""
    xm = _build_xm_client()
    if xm is None:
        return []

    try:
        df = xm.request_data(
            metric=metric,
            entity=entity,
            start_date=start,
            end_date=end,
        )
        if df is None or df.empty:
            return []

        # Columnas horarias: Values_Hour00 .. Values_Hour23
        hour_cols = [c for c in df.columns if c.startswith("Values_Hour")]
        records = []
        for _, row in df.iterrows():
            fecha = str(row.get("Date", row.get("fecha", "")))[:10]
            hourly = {
                col: float(row[col])
                for col in hour_cols
                if row[col] is not None and str(row[col]) != "nan"
            }
            avg = sum(hourly.values()) / len(hourly) if hourly else 0.0
            solar_vals = [v for k, v in hourly.items() if k in SOLAR_HOURS]
            avg_solar = sum(solar_vals) / len(solar_vals) if solar_vals else avg
            records.append({
                "date": fecha,
                "avg": round(avg, 2),
                "avg_solar": round(avg_solar, 2),
                "hourly": hourly,
            })
        return records
    except Exception as exc:
        logger.error(f"Error consultando XM metric={metric}: {exc}")
        return []


# ─── API pública del módulo ───────────────────────────────────────────────────

def get_spot_price(start: date, end: date) -> dict[str, Any]:
    """
    Precio de Bolsa Nacional (COP/kWh) entre start y end.
    Nunca etiqueta datos simulados como si fueran oficiales de XM.
    """
    cache_key = f"spot_{start}_{end}"

    def _fetch():
        records = _fetch_metric("PrecBolsNaci", "Sistema", start, end)
        is_mock = False
        if not records and settings.ALLOW_MOCK_MARKET:
            records = _mock_spot_price(start, end)
            is_mock = True

        values = [r["avg"] for r in records if r["avg"] > 0]
        solar_values = [r.get("avg_solar", r["avg"]) for r in records if r.get("avg", 0) > 0]
        source = "mock" if is_mock else ("XM SINERGOX" if records else "unavailable")

        return {
            "metric": "PrecBolsNaci",
            "unit": "COP/kWh",
            "start": str(start),
            "end": str(end),
            "avg": round(sum(values) / len(values), 2) if values else 0,
            "avg_solar": round(sum(solar_values) / len(solar_values), 2) if solar_values else 0,
            "min": round(min(values), 2) if values else 0,
            "max": round(max(values), 2) if values else 0,
            "series": records,
            "source": source,
            "note": (
                "Datos de demostración (ALLOW_MOCK_MARKET=true)"
                if is_mock
                else "Dato disponible con 1 día de rezago (XM publica D-1)"
            ),
        }

    return _cached(cache_key, _fetch)


def get_contract_prices(start: date, end: date) -> dict[str, Any]:
    """
    Precio Promedio de Contratos Regulado y No Regulado (COP/kWh).
    """
    cache_key = f"contracts_{start}_{end}"

    def _fetch():
        regulado = _fetch_metric("PrecioPromedioContratosRegulado", "Sistema", start, end)
        no_regulado = _fetch_metric("PrecioPromedioContratosNoRegulado", "Sistema", start, end)

        def _avg_series(records):
            vals = [r["avg"] for r in records if r["avg"] > 0]
            return round(sum(vals) / len(vals), 2) if vals else None

        return {
            "start": str(start),
            "end": str(end),
            "regulado": {
                "avg": _avg_series(regulado),
                "series": regulado,
                "label": "Mercado Regulado (distribuidoras)",
            },
            "no_regulado": {
                "avg": _avg_series(no_regulado),
                "series": no_regulado,
                "label": "Mercado No Regulado (industria)",
            },
        }

    return _cached(cache_key, _fetch)


# ─── Mock data (solo si ALLOW_MOCK_MARKET=true) ───────────────────────────────

def _mock_spot_price(start: date, end: date) -> list[dict]:
    """Genera datos mock del precio de bolsa colombiano únicamente cuando se habilita explícitamente."""
    import random
    records = []
    current = start
    base = 480.0
    while current <= end:
        variation = random.gauss(0, 40)
        avg = max(100, round(base + variation, 2))
        base += random.gauss(0, 5)
        records.append({
            "date": str(current),
            "avg": avg,
            "avg_solar": round(avg * 0.96, 2),
            "hourly": {},
        })
        current += timedelta(days=1)
    return records
