"""
SOLGER — Almacén de Facturas (local JSON).

Guarda las facturas de compra de energía (Celsia, etc.) y permite cruzarlas
contra la generación real registrada en FusionSolar.

Archivo de datos: ../data/invoices.json (relativo al backend/)
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("solger.invoices")

_DATA_DIR = Path(__file__).parent.parent / "data"
_INVOICES_FILE = _DATA_DIR / "invoices.json"


def _ensure_file() -> None:
    """Crea el directorio y archivo JSON si no existen."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not _INVOICES_FILE.exists():
        _INVOICES_FILE.write_text("[]", encoding="utf-8")


def _read_all() -> list[dict]:
    _ensure_file()
    try:
        return json.loads(_INVOICES_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write_all(invoices: list[dict]) -> None:
    _ensure_file()
    _INVOICES_FILE.write_text(
        json.dumps(invoices, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ─── CRUD ────────────────────────────────────────────────────────────────────

def list_invoices() -> list[dict]:
    """Retorna todas las facturas ordenadas por fecha descendente."""
    invoices = _read_all()
    return sorted(invoices, key=lambda x: x.get("period", ""), reverse=True)


def get_invoice(invoice_id: str) -> dict | None:
    """Retorna una factura por ID, o None si no existe."""
    for inv in _read_all():
        if inv.get("id") == invoice_id:
            return inv
    return None


def create_invoice(data: dict[str, Any]) -> dict:
    """
    Crea y persiste una nueva factura.

    Campos esperados en data:
      - company       : str  — Empresa compradora (ej. "Celsia")
      - plant_code    : str  — Código de planta FusionSolar
      - plant_name    : str  — Nombre de la planta
      - period        : str  — "YYYY-MM" (mes de la factura)
      - kwh_billed    : float — kWh que aparecen en la factura
      - price_cop_kwh : float — Precio unitario COP/kWh de la factura
      - total_cop     : float — Total factura (COP)
      - notes         : str  — Observaciones opcionales
    """
    invoices = _read_all()
    invoice = {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now().isoformat(),
        **data,
        # Campos de verificación — se llenan cuando se cruza con FusionSolar
        "fusion_kwh": None,
        "difference_kwh": None,
        "difference_cop": None,
        "status": "pending",  # pending | ok | discrepancy | critical
        "verified_at": None,
    }
    invoices.append(invoice)
    _write_all(invoices)
    logger.info(f"Factura creada: {invoice['id']} — {data.get('company')} {data.get('period')}")
    return invoice


def update_verification(
    invoice_id: str,
    fusion_kwh: float,
    *,
    gen_kwh: float | None = None,
    export_kwh: float | None = None,
    import_kwh: float | None = None,
) -> dict | None:
    """
    Actualiza la verificación cruzando kWh facturados vs kWh de FusionSolar.
    Retorna la factura actualizada o None si no existe.
    """
    invoices = _read_all()
    for inv in invoices:
        if inv.get("id") == invoice_id:
            billed = float(inv.get("kwh_billed", 0))
            price = float(inv.get("price_cop_kwh", 0))
            diff_kwh = round(fusion_kwh - billed, 2)
            diff_cop = round(diff_kwh * price, 0)

            # Clasificación de la discrepancia (considerando 1-3% de pérdidas AC/medidor)
            pct = abs(diff_kwh / fusion_kwh * 100) if fusion_kwh else 0
            if pct <= 3:
                status = "ok"
            elif pct <= 7:
                status = "discrepancy"
            else:
                status = "critical"

            inv.update({
                "fusion_kwh": round(fusion_kwh, 2),
                "gen_kwh": gen_kwh,
                "export_kwh": export_kwh,
                "import_kwh": import_kwh,
                "difference_kwh": diff_kwh,
                "difference_cop": diff_cop,
                "status": status,
                "verified_at": datetime.now().isoformat(),
            })
            _write_all(invoices)
            return inv
    return None


def delete_invoice(invoice_id: str) -> bool:
    """Elimina una factura. Retorna True si fue encontrada y eliminada."""
    invoices = _read_all()
    new_list = [i for i in invoices if i.get("id") != invoice_id]
    if len(new_list) == len(invoices):
        return False
    _write_all(new_list)
    return True
