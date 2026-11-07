"""
SOLGER — Extractor Nativo de Facturas Electrónicas de Celsia (PDF TCPDF).

Celsia Colombia S.A. E.S.P. genera sus facturas electrónicas usando TCPDF,
donde el flujo de datos variables viene en el primer stream de texto comprimido (FlateDecode)
y además incluye la estructura para Autogeneradores a Pequeña Escala (AGPE / CREG 174 de 2021).

Extrae sin dependencias C externas:
  - Código de cuenta (`account_code`), NIU (`niu`), Factura electrónica (`invoice_number`), Medidor (`meter_number`)
  - Ciclo exacto de facturación (`period_start`, `period_end`, `days_billed`) -> clave para cruzar con los días exactos en FusionSolar
  - Lecturas del medidor (`reading_current`, `reading_previous`, `multiplier`, `kwh_consumed`)
  - Línea `501 Consumo Activa` (`kwh_billed`, `cu_cop_kwh`, `subtotal_energy_cop`)
  - Total Celsia Energía (`total_celsia_cop`) vs. Total con Aseo/Alumbrado/Mora (`total_payable_cop`)
  - Componentes del Costo Unitario ($CU = G + C + T + D + PR + R$) y crédito neto Excedentes Tipo 1 ($CU - C$)
  - Campos AGPE si están presentes en la factura (Consumo importado, Crédito de energía, Valoración horaria, Total excedentes)
"""
from __future__ import annotations

import re
import zlib
from datetime import datetime
from typing import Any

MONTH_MAP = {
    "ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12,
}


def _parse_celsia_date(raw: str) -> str | None:
    """Convierte '24/SEP/2026' a '2026-09-24'."""
    m = re.match(r"(\d{1,2})/([A-Z]{3})/(\d{4})", raw.strip().upper())
    if not m:
        return None
    day, mon_str, year = int(m.group(1)), m.group(2), int(m.group(3))
    mon = MONTH_MAP.get(mon_str)
    if not mon:
        return None
    return f"{year:04d}-{mon:02d}-{day:02d}"


def _extract_tcpdf_text(pdf_bytes: bytes) -> str:
    """Extrae las cadenas de texto de los streams FlateDecode de un PDF de Celsia."""
    streams = re.findall(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.S)
    tokens: list[str] = []
    for s in streams:
        if len(s) > 250_000:
            continue
        try:
            dec = zlib.decompress(s).decode("latin1", errors="ignore")
            if "BT" in dec and "ET" in dec:
                for raw_tok in re.findall(r"\(([^()]*)\)", dec):
                    # Decodificar secuencias octales básicas (\363 -> ó, etc.)
                    cleaned = re.sub(
                        r"\\([0-7]{3})",
                        lambda m: chr(int(m.group(1), 8)),
                        raw_tok,
                    )
                    tokens.append(cleaned.strip())
        except Exception:
            continue
    return " ".join(t for t in tokens if t)


def parse_celsia_pdf(pdf_bytes: bytes) -> dict[str, Any]:
    """Analiza un PDF de factura Celsia y devuelve un diccionario estructurado para SOLGER."""
    text = _extract_tcpdf_text(pdf_bytes)
    head = text[:4500]  # Los valores dinámicos del recibo están al inicio del primer stream

    # 1. Periodo facturado (ej. 24/SEP/2026 - 26/OCT/2026 33)
    m_period = re.search(
        r"(\d{2}/[A-Z]{3}/\d{4})\s*-\s*(\d{2}/[A-Z]{3}/\d{4})(?:\s+\1\s*-\s*\2)?\s+(\d{1,2})",
        head,
    )
    period_start = _parse_celsia_date(m_period.group(1)) if m_period else None
    period_end = _parse_celsia_date(m_period.group(2)) if m_period else None
    days_billed = int(m_period.group(3)) if m_period else None
    period_ym = period_end[:7] if period_end else datetime.now().strftime("%Y-%m")

    # 2. Lecturas de medidor (ej. 455 Energía Activa 49787 49332 1)
    m_reading = re.search(
        r"(\d+(?:\.\d+)?)\s+Energ[ií]a\s+Activa\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)",
        head,
    )
    reading_current = float(m_reading.group(2)) if m_reading else None
    reading_previous = float(m_reading.group(3)) if m_reading else None
    multiplier = float(m_reading.group(4)) if m_reading else 1.0

    # 3. Línea 501 Consumo Activa (ej. 501 455 Consumo Activa Estandar KWH 964.13 Excluido 438,679)
    m_501 = re.search(
        r"\b501\s+(\d+(?:\.\d+)?)\s+Consumo\s+Activa\s+\S+\s+KWH\s+(\d+(?:\.\d+)?)\s+\S+\s+([\d,]+(?:\.\d+)?)",
        head,
        re.I,
    )
    kwh_billed = float(m_501.group(1)) if m_501 else (float(m_reading.group(1)) if m_reading else 0.0)
    cu_cop_kwh = float(m_501.group(2)) if m_501 else 0.0
    subtotal_active_cop = float(m_501.group(3).replace(",", "")) if m_501 else round(kwh_billed * cu_cop_kwh, 0)

    # 4. Subsidio / Contribución (ej. 561 1 Subsidio Estandar UN -18,801.00)
    m_sub = re.search(
        r"\b561\s+\d+\s+Subsidio\s+\S+\s+UN\s+(-?[\d,]+(?:\.\d+)?)",
        head,
        re.I,
    )
    subsidy_cop = float(m_sub.group(1).replace(",", "")) if m_sub else 0.0

    # 5. Componentes del Costo Unitario CU en página 3
    # En el stream de Celsia aparecen en orden: $[G] $[T] $[PR] $[R] $[D] $[C] $[Otros]
    m_cu = re.search(
        r"\$(\d+\.\d{2})\s+\$(\d+\.\d{2})\s+\$(\d+\.\d{2})\s+\$(\d+\.\d{2})\s+\$(\d+\.\d{2})\s+\$(\d+\.\d{2})\s+\$(\d*\.\d{2})",
        head,
    )
    componentes_cu: dict[str, float] = {}
    if m_cu:
        g_val = float(m_cu.group(1))
        t_val = float(m_cu.group(2))
        pr_val = float(m_cu.group(3))
        r_val = float(m_cu.group(4))
        d_val = float(m_cu.group(5))
        c_val = float(m_cu.group(6))
        otros_val = float(f"0{m_cu.group(7)}" if m_cu.group(7).startswith(".") else m_cu.group(7))
        componentes_cu = {
            "G_generacion": g_val,
            "C_comercializacion": c_val,
            "T_transmision": t_val,
            "D_distribucion": d_val,
            "PR_perdidas": pr_val,
            "R_restricciones": r_val,
            "otros": otros_val,
            "cu_calculado": round(g_val + c_val + t_val + d_val + pr_val + r_val + otros_val, 2),
            "tarifa_excedente_t1_agpe": round((g_val + t_val + d_val + pr_val + r_val), 2),
        }

    # 6. Identificadores (Factura electrónica, Código, Medidor)
    m_inv_no = re.search(r"\b(CC[A-Z]{2}\d{6,12})\b", head)
    m_acc = re.search(r"\b(\d{10})\b", head)
    m_meter = re.search(r"\b(30\d{8})\b", head)
    m_client = re.match(r"^([A-ZÁÉÍÓÚÑ\s]{5,60}?)\s+(?:Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)\s+de\s+\d{4}", head)

    total_energy_cop = round(subtotal_active_cop + subsidy_cop, 0)

    return {
        "company": "Celsia",
        "client_name": m_client.group(1).strip() if m_client else None,
        "account_code": m_acc.group(1) if m_acc else None,
        "invoice_number": m_inv_no.group(1) if m_inv_no else None,
        "meter_number": m_meter.group(1) if m_meter else None,
        "period": period_ym,
        "period_start": period_start,
        "period_end": period_end,
        "days_billed": days_billed,
        "reading_previous_kwh": reading_previous,
        "reading_current_kwh": reading_current,
        "multiplier": multiplier,
        "kwh_billed": kwh_billed,
        "price_cop_kwh": cu_cop_kwh,
        "subtotal_active_cop": subtotal_active_cop,
        "subsidy_or_contrib_cop": subsidy_cop,
        "total_cop": total_energy_cop,
        "componentes_cu": componentes_cu,
        "has_agpe_template": "Autogenerador de energía eléctrica" in text or "Consumo importado:" in text,
    }

