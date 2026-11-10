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
    try:
        _ensure_file()
        _INVOICES_FILE.write_text(
            json.dumps(invoices, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except (OSError, PermissionError):
        # En entornos serverless de solo lectura (como Vercel /var/task), ignorar error de escritura en disco
        pass
    except Exception as exc:
        logger.debug(f"Error escribiendo cache local de facturas: {exc}")


# ─── CRUD ────────────────────────────────────────────────────────────────────

def list_invoices() -> list[dict]:
    """Retorna todas las facturas ordenadas por fecha descendente desde Supabase (fallback local)."""
    try:
        from supabase_store import load_invoices_from_supabase, is_configured
        if is_configured():
            db_invoices = load_invoices_from_supabase()
            if db_invoices:
                return sorted(db_invoices, key=lambda x: x.get("period", ""), reverse=True)
    except Exception as exc:
        logger.debug(f"Fallo al leer de Supabase, usando local: {exc}")

    invoices = _read_all()
    return sorted(invoices, key=lambda x: x.get("period", ""), reverse=True)


def get_invoice(invoice_id: str) -> dict | None:
    """Retorna una factura por ID, o None si no existe."""
    try:
        from supabase_store import load_invoices_from_supabase, is_configured
        if is_configured():
            for inv in load_invoices_from_supabase():
                if inv.get("id") == invoice_id:
                    return inv
    except Exception:
        pass

    for inv in _read_all():
        if inv.get("id") == invoice_id:
            return inv
    return None


def create_invoice(data: dict[str, Any]) -> dict:
    """
    Crea y persiste una nueva factura en Supabase (con respaldo local).
    """
    inv_id = str(data.get("id") or uuid.uuid4())
    invoice = {
        "id": inv_id,
        "created_at": datetime.now().isoformat(),
        **data,
        "fusion_kwh": data.get("fusion_kwh"),
        "difference_kwh": data.get("difference_kwh"),
        "difference_cop": data.get("difference_cop"),
        "status": data.get("status", "pending"),
        "verified_at": data.get("verified_at"),
        "audit": data.get("audit"),
    }
    # 1. Supabase primero (persistencia cloud)
    try:
        from supabase_store import sync_invoice_to_supabase
        sync_invoice_to_supabase(invoice)
    except Exception as exc:
        logger.error(f"Error persistiendo factura en Supabase: {exc}")

    # 2. Respaldo local
    try:
        invoices = _read_all()
        invoices.append(invoice)
        _write_all(invoices)
    except Exception:
        pass

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
    Actualiza la verificación cruzando kWh facturados vs kWh de FusionSolar en Supabase y local.
    """
    inv = get_invoice(invoice_id)
    if not inv:
        return None

    billed = float(inv.get("kwh_billed", 0))
    price = float(inv.get("price_cop_kwh", 0))
    diff_kwh = round(fusion_kwh - billed, 2)
    diff_cop = round(diff_kwh * price, 0)

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

    # 1. Supabase primero
    try:
        from supabase_store import sync_invoice_to_supabase
        sync_invoice_to_supabase(inv)
    except Exception as exc:
        logger.error(f"Error sincronizando verificación a Supabase: {exc}")

    # 2. Respaldo local
    try:
        invoices = _read_all()
        for i, item in enumerate(invoices):
            if item.get("id") == invoice_id:
                invoices[i] = inv
                break
        _write_all(invoices)
    except Exception:
        pass

    return inv


def update_audit(invoice_id: str, audit_data: dict[str, Any]) -> dict | None:
    """
    Actualiza la factura con el informe completo de auditoría CREG 174
    (incluyendo daily_series, excedentes Tipo 1 y 2, precio XM, sobrecosto COP).
    Garantiza funcionamiento en Vercel Serverless actualizando en Supabase directamente.
    """
    inv = get_invoice(invoice_id)
    if not inv:
        return None

    sobrecosto = float(audit_data.get("sobrecosto_cop", 0.0))
    imp_celsia = float(audit_data.get("imp_celsia", 0.0))
    imp_fusion = float(audit_data.get("imp_fusion", 0.0))
    diff_kwh = round(imp_celsia - imp_fusion, 2)

    if abs(sobrecosto) > 50000 or (imp_celsia > 0 and abs(diff_kwh / imp_celsia) > 0.07):
        status = "critical"
    elif abs(sobrecosto) > 10000 or (imp_celsia > 0 and abs(diff_kwh / imp_celsia) > 0.03):
        status = "discrepancy"
    else:
        status = "ok"

    inv.update({
        "audit": audit_data,
        "fusion_kwh": imp_fusion,
        "gen_kwh": audit_data.get("gen_fusion"),
        "export_kwh": audit_data.get("exc_fusion"),
        "import_kwh": imp_fusion,
        "difference_kwh": diff_kwh,
        "difference_cop": round(sobrecosto, 0),
        "status": status,
        "verified_at": datetime.now().isoformat(),
    })

    # 1. Supabase primero (esencial en Vercel)
    try:
        from supabase_store import sync_invoice_to_supabase
        sync_invoice_to_supabase(inv)
    except Exception as exc:
        logger.error(f"Error sincronizando auditoría a Supabase: {exc}")

    # 2. Respaldo local
    try:
        invoices = _read_all()
        found = False
        for i, item in enumerate(invoices):
            if item.get("id") == invoice_id:
                invoices[i] = inv
                found = True
                break
        if not found:
            invoices.append(inv)
        _write_all(invoices)
    except Exception:
        pass

    return inv


def delete_invoice(invoice_id: str) -> bool:
    """Elimina una factura en Supabase y localmente. Retorna True si fue eliminada."""
    try:
        from supabase_store import delete_invoice_from_supabase
        delete_invoice_from_supabase(invoice_id)
    except Exception:
        pass

    invoices = _read_all()
    new_list = [i for i in invoices if i.get("id") != invoice_id]
    if len(new_list) == len(invoices):
        return True
    _write_all(new_list)
    return True
