"""
Servicio de Irradiancia Satelital Real (GHI / HSP) por coordenadas GPS.
Consulta Open-Meteo Solar Radiation API (sin API key, alta disponibilidad) para obtener
la irradiación global horizontal diaria (`shortwave_radiation_sum` en MJ/m²) y horaria
(`shortwave_radiation` en W/m²) en la ubicación exacta de cada planta en el Valle del Cauca.

Conversión física estándar:
    1 kWh/m² = 3.6 MJ/m²  =>  HSP_sat (kWh/m²/día) = shortwave_radiation_sum_MJ / 3.6
"""
from __future__ import annotations

import logging
import time
from typing import Any
import requests

logger = logging.getLogger("solger.satellite")

# Coordenadas por defecto — Valle del Cauca (Cali / Palmira)
DEFAULT_LAT = 3.4516
DEFAULT_LON = -76.5320
DEFAULT_HSP_REF = 4.5

# Caché en memoria por coordenada redondeada a 2 decimales (~1.1 km de resolución)
_SAT_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SAT_TTL_SECONDS = 3600  # 1 hora


def get_satellite_irradiance(lat: float | None = None, lon: float | None = None) -> dict[str, Any]:
    """
    Obtiene la irradiación solar satelital del día actual y de los últimos 7 días
    para las coordenadas GPS de una planta solar.
    Retorna:
      - `ghi_today_kwh_m2`: HSP satelital real del día de hoy (kWh/m²/día)
      - `ghi_current_w_m2`: Irradiancia instantánea actual (W/m²)
      - `cloud_factor`: Relación entre GHI satelital hoy y HSP de referencia (4.5)
      - `daily_history`: Mapa `{YYYY-MM-DD: kwh_m2}`
      - `source`: 'open_meteo_satellite' | 'fallback_reference'
    """
    use_lat = float(lat) if (lat is not None and abs(float(lat)) > 0.1) else DEFAULT_LAT
    use_lon = float(lon) if (lon is not None and abs(float(lon)) > 0.1) else DEFAULT_LON
    cache_key = f"{use_lat:.2f},{use_lon:.2f}"

    now = time.time()
    cached = _SAT_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _SAT_TTL_SECONDS:
        return cached[1]

    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={use_lat:.4f}&longitude={use_lon:.4f}"
        "&daily=shortwave_radiation_sum"
        "&current=shortwave_radiation,cloud_cover"
        "&past_days=7&forecast_days=1"
        "&timezone=America%2FBogota"
    )
    try:
        r = requests.get(url, timeout=6)
        if r.status_code == 200:
            payload = r.json()
            daily = payload.get("daily") or {}
            dates = daily.get("time") or []
            rad_mj = daily.get("shortwave_radiation_sum") or []

            daily_history: dict[str, float] = {}
            for d_str, mj in zip(dates, rad_mj):
                if mj is not None and float(mj) > 0:
                    daily_history[str(d_str)] = round(float(mj) / 3.6, 2)

            ghi_today = list(daily_history.values())[-1] if daily_history else DEFAULT_HSP_REF
            # Evitar valores extremos irreales
            ghi_today = max(1.2, min(7.5, ghi_today))

            current_block = payload.get("current") or {}
            ghi_w_m2 = float(current_block.get("shortwave_radiation") or 0.0)
            cloud_cover_pct = float(current_block.get("cloud_cover") or 0.0)

            result = {
                "latitude": use_lat,
                "longitude": use_lon,
                "ghi_today_kwh_m2": round(ghi_today, 2),
                "ghi_current_w_m2": round(ghi_w_m2, 1),
                "cloud_cover_pct": round(cloud_cover_pct, 0),
                "cloud_factor": round(ghi_today / DEFAULT_HSP_REF, 2),
                "daily_history": daily_history,
                "source": "open_meteo_satellite",
            }
            _SAT_CACHE[cache_key] = (now, result)
            return result
    except Exception as exc:
        logger.debug("Fallback satelital para (%s, %s): %s", use_lat, use_lon, exc)

    fallback = {
        "latitude": use_lat,
        "longitude": use_lon,
        "ghi_today_kwh_m2": DEFAULT_HSP_REF,
        "ghi_current_w_m2": 0.0,
        "cloud_cover_pct": 0.0,
        "cloud_factor": 1.0,
        "daily_history": {},
        "source": "fallback_reference",
    }
    _SAT_CACHE[cache_key] = (now, fallback)
    return fallback


_GRID_CACHE: tuple[float, dict[str, Any]] | None = None
_GRID_TTL_SECONDS = 1800  # 30 minutos


def get_irradiance_grid() -> dict[str, Any]:
    """
    Obtiene una malla geográfica 5x5 de irradiancia horaria (W/m²) y nubosidad (%)
    sobre el Valle del Cauca desde Open-Meteo en una sola petición HTTP.
    """
    global _GRID_CACHE
    now = time.time()
    if _GRID_CACHE and (now - _GRID_CACHE[0]) < _GRID_TTL_SECONDS:
        return _GRID_CACHE[1]

    lat_steps = [round(3.15 + i * 0.25, 2) for i in range(5)]  # 3.15 .. 4.15
    lon_steps = [round(-76.65 + j * 0.14, 2) for j in range(5)]  # -76.65 .. -76.09
    coords = [(la, lo) for la in lat_steps for lo in lon_steps]

    lats_param = ",".join(str(c[0]) for c in coords)
    lons_param = ",".join(str(c[1]) for c in coords)

    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lats_param}&longitude={lons_param}"
        "&hourly=shortwave_radiation,cloud_cover"
        "&forecast_days=1&timezone=America%2FBogota"
    )
    try:
        r = requests.get(url, timeout=8)
        if r.status_code == 200:
            payload = r.json()
            items = payload if isinstance(payload, list) else [payload]
            raw_times = (items[0].get("hourly") or {}).get("time") or []
            # Filtrar horas solares (06:00 a 18:00)
            solar_indices = [
                idx for idx, t in enumerate(raw_times)
                if len(t) >= 13 and 6 <= int(t[11:13]) <= 18
            ]
            if not solar_indices:
                solar_indices = list(range(len(raw_times)))

            times = [raw_times[idx][11:16] for idx in solar_indices]
            points = []
            for idx, item in enumerate(items):
                if idx >= len(coords):
                    break
                h = item.get("hourly") or {}
                rads = h.get("shortwave_radiation") or []
                clouds = h.get("cloud_cover") or []
                points.append({
                    "lat": coords[idx][0],
                    "lon": coords[idx][1],
                    "radiation": [round(float(rads[i] or 0.0), 0) if i < len(rads) else 0 for i in solar_indices],
                    "cloud": [round(float(clouds[i] or 0.0), 0) if i < len(clouds) else 0 for i in solar_indices],
                })

            from datetime import datetime
            from zoneinfo import ZoneInfo
            now_hour = datetime.now(ZoneInfo("America/Bogota")).strftime("%H:00")
            default_idx = times.index(now_hour) if now_hour in times else max(0, len(times) // 2)

            result = {
                "source": "open_meteo_grid",
                "times": times,
                "defaultIndex": default_idx,
                "dLat": 0.25,
                "dLon": 0.14,
                "points": points,
            }
            _GRID_CACHE = (now, result)
            return result
    except Exception as exc:
        logger.debug("Error consultando malla de irradiancia Open-Meteo: %s", exc)

    return {"source": "unavailable", "times": [], "defaultIndex": 0, "dLat": 0.25, "dLon": 0.14, "points": []}


