"""
Cliente FusionSolar Northbound con gestión de sesión y cache integrado.
Maneja automáticamente la autenticación y renovación del token XSRF.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests
from requests import Response, Session
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import settings

logger = logging.getLogger("solger.fusionsolar")
BOGOTA_TZ = ZoneInfo("America/Bogota")


class FusionSolarError(Exception):
    """Error base del cliente FusionSolar."""


class AuthenticationError(FusionSolarError):
    """Error de autenticación."""


class APIError(FusionSolarError):
    """Error de la API FusionSolar."""


class CacheEntry:
    """Entrada de cache con TTL."""

    def __init__(self, data: Any, ttl: int = 300) -> None:
        self.data = data
        self.expires_at = time.monotonic() + ttl

    def is_valid(self) -> bool:
        return time.monotonic() < self.expires_at


class FusionSolarClient:
    """
    Cliente para la API Northbound de FusionSolar.

    Maneja:
    - Sesión HTTP con reintentos
    - Autenticación y renovación automática del XSRF-TOKEN
    - Cache en memoria con TTL configurable
    - Thread-safe para uso en FastAPI
    """

    def __init__(self) -> None:
        self._session: Session | None = None
        self._xsrf_token: str | None = None
        self._token_expires_at: float = 0.0
        self._cache: dict[str, CacheEntry] = {}
        self._lock = threading.RLock()
        self._last_login_time: float = 0.0
        self._last_request_time: float = 0.0

    # ─── Sesión HTTP ──────────────────────────────────────────────────────────

    def _create_session(self) -> Session:
        session = requests.Session()
        retry = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["POST"],
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=5, pool_maxsize=5)
        session.mount("https://", adapter)
        session.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json;charset=UTF-8",
                "User-Agent": "SOLGER-Dashboard/1.0",
            }
        )
        return session

    @property
    def session(self) -> Session:
        if self._session is None:
            self._session = self._create_session()
        return self._session

    # ─── Autenticación ────────────────────────────────────────────────────────

    def _is_token_valid(self) -> bool:
        return (
            self._xsrf_token is not None
            and time.monotonic() < self._token_expires_at
        )

    def _login(self) -> None:
        """Realiza el login y establece la sesión autenticada."""
        url = f"{settings.BASE_URL}/thirdData/login"
        payload = {
            "userName": settings.USERNAME,
            "systemCode": settings.PASSWORD,
        }
        try:
            self.session.cookies.clear()
            response = self.session.post(
                url,
                json=payload,
                timeout=settings.TIMEOUT,
                verify=settings.VERIFY_SSL,
            )
        except requests.RequestException as exc:
            raise AuthenticationError(f"Error de conexión al login: {exc}") from exc

        if response.status_code != 200:
            raise AuthenticationError(
                f"Login respondió HTTP {response.status_code}: {response.text[:200]}"
            )

        body = {}
        try:
            body = response.json()
        except Exception:
            pass

        # La API puede responder {success: true} o {"failCode": 0}
        # También puede devolver failCode 407 si hay demasiadas solicitudes
        fail_code = body.get("failCode", 0)
        is_success = body.get("success", True)

        if fail_code == 407:
            raise AuthenticationError("Frecuencia de login demasiado alta (407). Esperando...")
        if fail_code not in (0, None) or is_success is False:
            raise AuthenticationError(
                f"Login falló con failCode={fail_code}: {body.get('data', '')}"
            )

        # FusionSolar devuelve el token en header 'xsrf-token' (minúsculas)
        # y también lo guarda como cookie 'XSRF-TOKEN'
        # requests.Response.headers es case-insensitive
        token = (
            response.headers.get("xsrf-token")
            or response.headers.get("XSRF-TOKEN")
            or self.session.cookies.get("XSRF-TOKEN")
            or self.session.cookies.get("xsrf-token")
        )

        if not token:
            # Verificar que sí tenemos cookies de sesión como respaldo
            if not self.session.cookies:
                raise AuthenticationError("Login exitoso pero no se recibieron cookies ni token.")
            logger.warning("No se encontró XSRF-TOKEN; usando sólo cookies de sesión")
            token = "SESSION_COOKIE_AUTH"

        self._xsrf_token = token
        if token != "SESSION_COOKIE_AUTH":
            self.session.headers.update({"XSRF-TOKEN": token})
        # Token válido por 18 minutos (la sesión expira a los 20 según Max-Age=1200)
        self._token_expires_at = time.monotonic() + 1080
        self._last_login_time = time.monotonic()
        logger.info("Login FusionSolar OK — sesión establecida (token=%s...)", token[:20] if token else "None")

    def _ensure_authenticated(self) -> None:
        with self._lock:
            if not self._is_token_valid():
                self._login()

    # ─── Peticiones a la API ──────────────────────────────────────────────────

    def _post(self, endpoint: str, payload: dict | None = None) -> Any:
        """Petición POST autenticada con reintento de login si el token expiró."""
        with self._lock:
            # Politeness Delay: asegurar al menos 1.0 segundos entre peticiones API
            now = time.monotonic()
            elapsed = now - self._last_request_time
            if elapsed < 1.0:
                sleep_time = 1.0 - elapsed
                logger.debug("Espaciando petición API %.2fs para cumplir tasa de límite", sleep_time)
                time.sleep(sleep_time)

            self._ensure_authenticated()
            endpoint = endpoint if endpoint.startswith("/") else f"/{endpoint}"
            url = f"{settings.BASE_URL}{endpoint}"

            for attempt in range(3):
                self._last_request_time = time.monotonic()
                try:
                    response: Response = self.session.post(
                        url,
                        json=payload or {},
                        timeout=settings.TIMEOUT,
                        verify=settings.VERIFY_SSL,
                    )
                except requests.RequestException as exc:
                    raise APIError(f"Error de red en {endpoint}: {exc}") from exc

                body = response.json() if response.content else {}

                # Si es un error de límite de frecuencia (407), esperamos y reintentamos sin desloguear
                if body.get("failCode") == 407:
                    if attempt < 2:
                        sleep_time = 2.0 + attempt * 1.5
                        logger.warning("Frecuencia de acceso demasiado alta (407) en %s. Reintentando en %.1fs...", endpoint, sleep_time)
                        time.sleep(sleep_time)
                        continue
                    raise APIError("Frecuencia de solicitudes demasiado alta en FusionSolar (407). Por favor, espera unos segundos.")

                # Si el token expiró (401 o 305), reautenticamos
                needs_reauth = response.status_code == 401 or body.get("failCode") in (305, 401)
                if needs_reauth:
                    if attempt < 2:
                        # Solo re-autenticar si no lo hizo otro hilo hace poco
                        if time.monotonic() - self._last_login_time > 10:
                            logger.warning("Sesión expirada (failCode=%s) — reautenticando...", body.get("failCode"))
                            self._xsrf_token = None
                            self._login()
                        else:
                            logger.info("Sesión renovada recientemente por otro hilo — reintentando")
                        # Actualizar header con el token actual (puede ser nuevo)
                        if self._xsrf_token and self._xsrf_token != "SESSION_COOKIE_AUTH":
                            self.session.headers.update({"XSRF-TOKEN": self._xsrf_token})
                        continue
                    raise AuthenticationError("No se pudo reautenticar después de varios intentos.")

                if not body.get("success", True) and body.get("failCode", 0) not in (0, None):
                    fail = body.get("failCode")
                    msg = body.get("message", "Error desconocido")
                    raise APIError(f"API error ({fail}): {msg}")

                return body

            raise APIError("Número máximo de reintentos alcanzado.")

    # ─── Cache ────────────────────────────────────────────────────────────────

    def _cache_get(self, key: str) -> Any | None:
        entry = self._cache.get(key)
        if entry and entry.is_valid():
            return entry.data
        return None

    def _cache_set(self, key: str, data: Any, ttl: int | None = None) -> None:
        self._cache[key] = CacheEntry(data, ttl or settings.CACHE_TTL)

    # ─── Endpoints de Negocio ─────────────────────────────────────────────────

    def get_plant_list(self, page: int = 1, page_size: int = 100) -> dict:
        """Obtiene la lista completa de plantas (stations), paginando si supera page_size."""
        cache_key = f"plants_p{page}_{page_size}"
        if cached := self._cache_get(cache_key):
            return cached
        data = self._post(
            "/thirdData/stations",
            {"pageNo": page, "pageSize": page_size},
        )
        # Si se pide la primera página, recorrer páginas adicionales si existen
        if page == 1:
            body_data = data.get("data") or {}
            plants = list(body_data.get("list") or [])
            page_count = int(body_data.get("pageCount") or 1)
            for p in range(2, page_count + 1):
                more = self._post(
                    "/thirdData/stations",
                    {"pageNo": p, "pageSize": page_size},
                )
                plants.extend((more.get("data") or {}).get("list") or [])
            if isinstance(data.get("data"), dict):
                data["data"]["list"] = plants
        self._cache_set(cache_key, data)
        return data

    def get_station_real_kpi(self, plant_codes: list[str]) -> dict:
        """KPIs en tiempo real para una o varias plantas (en lotes de hasta 100)."""
        codes_str = ",".join(plant_codes)
        cache_key = f"real_kpi_{codes_str}"
        if cached := self._cache_get(cache_key):
            return cached
        all_items: list[dict] = []
        last_resp: dict = {"success": True, "data": []}
        for i in range(0, len(plant_codes), 100):
            chunk = ",".join(plant_codes[i : i + 100])
            resp = self._post(
                "/thirdData/getStationRealKpi",
                {"stationCodes": chunk},
            )
            last_resp = resp
            all_items.extend(resp.get("data") or [])
        last_resp["data"] = all_items
        self._cache_set(cache_key, last_resp, ttl=900)  # 15 min
        return last_resp

    def get_station_kpi_day(self, plant_code: str, date: str) -> dict:
        """KPI por hora de una planta en un día (YYYYMMDD) en hora Colombia."""
        cache_key = f"kpi_day_{plant_code}_{date}"
        if cached := self._cache_get(cache_key):
            return cached
        dt_bogota = datetime.strptime(date, "%Y%m%d").replace(tzinfo=BOGOTA_TZ)
        ts = int(dt_bogota.timestamp() * 1000)
        data = self._post(
            "/thirdData/getKpiStationHour",
            {
                "stationCodes": plant_code,
                "collectTime": ts,
            },
        )
        self._cache_set(cache_key, data, ttl=14400)  # 4 horas
        return data

    def get_station_kpi_month(self, plant_code: str, date: str) -> dict:
        """KPI diario de una planta en un mes (YYYYMM) en hora Colombia."""
        cache_key = f"kpi_month_{plant_code}_{date}"
        if cached := self._cache_get(cache_key):
            return cached
        dt_bogota = datetime.strptime(date + "01", "%Y%m%d").replace(tzinfo=BOGOTA_TZ)
        ts = int(dt_bogota.timestamp() * 1000)
        data = self._post(
            "/thirdData/getKpiStationDay",
            {
                "stationCodes": plant_code,
                "collectTime": ts,
            },
        )
        self._cache_set(cache_key, data, ttl=21600)  # 6 horas
        return data

    def get_dev_list(self, plant_code: str) -> dict:
        """Lista de dispositivos (inversores) de una planta."""
        cache_key = f"devices_{plant_code}"
        if cached := self._cache_get(cache_key):
            return cached
        data = self._post(
            "/thirdData/getDevList",
            {"stationCodes": plant_code},
        )
        self._cache_set(cache_key, data, ttl=3600)  # 1 hora
        return data

    def get_dev_real_kpi(self, dev_ids: list[str], dev_type: int = 1) -> dict:
        """KPIs en tiempo real de inversores."""
        ids_str = ",".join(str(i) for i in dev_ids)
        cache_key = f"dev_kpi_{ids_str}"
        if cached := self._cache_get(cache_key):
            return cached
        data = self._post(
            "/thirdData/getDevRealKpi",
            {"devIds": ids_str, "devTypeId": dev_type},
        )
        self._cache_set(cache_key, data, ttl=900)  # 15 min
        return data

    def get_alarm_list(self, plant_codes: list[str], begin_time: int | None = None, end_time: int | None = None) -> dict:
        """Lista de alarmas activas."""
        codes_str = ",".join(plant_codes)
        cache_key = f"alarms_{codes_str}_{begin_time or 0}_{end_time or 0}"
        if cached := self._cache_get(cache_key):
            return cached
        payload = {"stationCodes": codes_str, "language": "es_ES"}
        if begin_time is not None:
            payload["beginTime"] = begin_time
        if end_time is not None:
            payload["endTime"] = end_time
        data = self._post("/thirdData/getAlarmList", payload)
        self._cache_set(cache_key, data, ttl=900)  # 15 min
        return data

    def clear_cache(self) -> None:
        """Limpia toda la cache."""
        self._cache.clear()
        logger.info("Cache limpiada.")


# Instancia global (singleton para FastAPI)
fusion_client = FusionSolarClient()
