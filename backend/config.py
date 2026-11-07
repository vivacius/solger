"""
Configuración central del backend SOLGER.
Carga las variables de entorno desde el archivo .env del proyecto.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# El .env está un nivel arriba del directorio backend/
_PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(_PROJECT_ROOT / ".env", override=True)


class Settings:
    """Configuración global del servidor proxy y plataforma SOLGER."""

    # FusionSolar
    BASE_URL: str = os.getenv(
        "FUSIONSOLAR_BASE_URL", "https://la5.fusionsolar.huawei.com"
    ).rstrip("/")
    USERNAME: str = os.getenv("FUSIONSOLAR_USERNAME", "")
    PASSWORD: str = os.getenv("FUSIONSOLAR_PASSWORD", "")
    VERIFY_SSL: bool = (
        os.getenv("FUSIONSOLAR_VERIFY_SSL", "true").strip().lower()
        in {"true", "1", "yes"}
    )
    TIMEOUT: int = int(os.getenv("FUSIONSOLAR_TIMEOUT", "60"))

    # Cache (segundos)
    CACHE_TTL: int = int(os.getenv("CACHE_TTL_SECONDS", "300"))  # 5 minutos

    # Mercado XM
    ALLOW_MOCK_MARKET: bool = (
        os.getenv("ALLOW_MOCK_MARKET", "false").strip().lower()
        in {"true", "1", "yes"}
    )

    # Factor CO2 UPME (tCO2eq / MWh) — Res. UPME 000085 (2024) inventario Alcance 2 = 0.220
    CO2_FACTOR_T_PER_MWH: float = float(
        os.getenv("CO2_FACTOR_T_PER_MWH", "0.220")
    )

    # Supabase (schema: solger) — soporta prefijo SUPABASE_ y VITE_SUPABASE_
    SUPABASE_URL: str = (
        os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or ""
    ).rstrip("/")
    SUPABASE_ANON_KEY: str = (
        os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or ""
    )
    SUPABASE_SERVICE_ROLE_KEY: str = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    DB_SCHEMA: str = os.getenv("DB_SCHEMA", "solger")

    # CORS — orígenes permitidos
    ALLOWED_ORIGINS: list[str] = [
        o.strip()
        for o in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173",
        ).split(",")
        if o.strip()
    ]


settings = Settings()
