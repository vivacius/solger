"""
Punto de entrada Serverless para Vercel (/api/* -> FastAPI).
"""
from __future__ import annotations

import sys
from pathlib import Path

# Añadir el directorio backend al path para resolver los imports internos
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import app  # noqa: E402, F401

