"""
SOLGER — Extractor Universal de Facturas Electrónicas de Celsia (PDF TCPDF).

Soporta las 3 generaciones de plantillas de Celsia:
1. Plantilla 2025 temprana (Formato numérico CO: '4.269,10', 'Consumo Importado', 'Crédito de energía').
2. Plantilla 2025 tardía (Formato numérico US: '2,974.61', 'Consumo importado:', 'Total excedentes:').
3. Plantilla 2026 CCTT (Formato CCTT: '501 Consumo Activa', '238 Venta Energia Exp1', '01/ABR/2026 - 30/ABR/2026').

Extrae de forma robusta y sin dependencias C externas:
- Identificadores: Factura, Código de cuenta/cliente, NIU, Medidor, Cliente.
- Ciclo exacto facturado: Periodo inicio, fin y días facturados.
- Datos de medición: Importado (kWh), Excedentes reconocidos (kWh).
- Tarifas: Costo Unitario CU ($/kWh), Comercialización C ($/kWh) y componentes G, T, D, PR, R.
- Liquidación completa de energía:
  * Consumo Importado Bruto ($)
  * Crédito de Energía Exp1 (-$)
  * (=) Valor Consumo Neto ($)
  * (+) Comercialización sobre Exp1 ($)
  * (+) Contribución Industrial 20% ($)
  * (+) Ajuste a decenas ($)
  * (=) Subtotal Energía Celsia ($)
  * (+) Otros cobros terceros (Alumbrado / Seguridad / Aseo) ($)
  * (=) Total Factura a Pagar ($)
"""
from __future__ import annotations

import re
import zlib
from datetime import datetime
from typing import Any

MESES = {
    "ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "SEP": 9, "SEPT": 9, "OCT": 10, "NOV": 11, "DIC": 12,
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6,
    "JULIO": 7, "AGOSTO": 8, "SEPTIEMBRE": 9, "OCTUBRE": 10, "NOVIEMBRE": 11, "DICIEMBRE": 12,
}


def _extract_tcpdf_text(pdf_bytes: bytes) -> str:
    """Extrae y decodifica las cadenas de texto de los streams FlateDecode de TCPDF."""
    streams = re.findall(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.S)
    tokens: list[str] = []
    for s in streams:
        if len(s) > 250_000:
            continue
        try:
            dec = zlib.decompress(s).decode("latin1", errors="ignore")
            if "BT" in dec and "ET" in dec:
                for raw in re.findall(r"\(([^()]*)\)", dec):
                    cleaned = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), raw)
                    cleaned = cleaned.replace("\\r", " ").replace("\\n", " ").replace("\\t", " ")
                    tokens.append(cleaned.strip())
        except Exception:
            pass
    return " ".join(t for t in tokens if t)


def _to_num(s: str | None) -> float | None:
    """Convierte cadenas numéricas tanto en formato colombiano como anglosajón a float."""
    if not s:
        return None
    s = s.strip().replace("$", "").replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):  # 1.529.850,14
            s = s.replace(".", "").replace(",", ".")
        else:  # 1,529,850.14
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) in (1, 2):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return float(s)
    except Exception:
        return None


def parse_celsia_pdf(pdf_bytes: bytes) -> dict[str, Any]:
    """Analiza una factura de Celsia y devuelve un diccionario normalizado para SOLGER."""
    raw_text = _extract_tcpdf_text(pdf_bytes)
    text = re.sub(r"\s+", " ", raw_text)

    # 1. Periodo facturado
    p_start, p_end = None, None
    m_p_month = re.search(r"(\d{2})/([A-Z]{3})/(\d{4})\s*(?:al|-)\s*(\d{2})/([A-Z]{3})/(\d{4})", text)
    m_p_num = re.search(r"(\d{2}/\d{2}/\d{4})\s*(?:al|-)\s*(\d{2}/\d{2}/\d{4})", text)

    if m_p_month and int(m_p_month.group(6)) - int(m_p_month.group(3)) <= 1:
        m1 = MESES.get(m_p_month.group(2).upper(), 1)
        m2 = MESES.get(m_p_month.group(5).upper(), 1)
        p_start = f"{m_p_month.group(3)}-{m1:02d}-{m_p_month.group(1)}"
        p_end = f"{m_p_month.group(6)}-{m2:02d}-{m_p_month.group(4)}"
    elif m_p_num:
        y1 = int(m_p_num.group(1)[-4:])
        y2 = int(m_p_num.group(2)[-4:])
        if y2 - y1 <= 1:
            d1, mo1, yr1 = m_p_num.group(1).split("/")
            d2, mo2, yr2 = m_p_num.group(2).split("/")
            p_start = f"{yr1}-{mo1}-{d1}"
            p_end = f"{yr2}-{mo2}-{d2}"

    m_d = re.search(r"D[^\w\s]{0,4}as\s+[Ff]acturados:?\s*(\d+)", text, re.I)
    days_billed = int(m_d.group(1)) if m_d else 30
    period_ym = p_end[:7] if p_end else datetime.now().strftime("%Y-%m")

    # 2. Identificadores
    m_inv = re.search(r"\b(CC[A-Z0-9]{8,12})\b", text)
    inv_no = m_inv.group(1) if m_inv else None

    m_cli = re.search(r"C[ÓO\s]{1,5}DIGO:?\s*(\d{8,12})|\b(929\d{7})\b", text, re.I)
    cod_cli = (m_cli.group(1) or m_cli.group(2)) if m_cli else None

    m_niu = re.search(r"NIU:\s*(\d+)", text, re.I)
    niu = m_niu.group(1) if m_niu else None

    m_met = re.search(r"(?:STAR INSTRUMENT-?\s*|Medidor\s+)(\d{8,10})|\b(2222\d{6})\b", text, re.I)
    meter = (m_met.group(1) or m_met.group(2)) if m_met else None

    m_client = re.search(r"(?:PROCOA SAS\.?|LECHERIA[^\n\r]{0,30})", text, re.I)
    client_name = m_client.group(0).strip() if m_client else "PROCOA SAS."

    m_fncer = re.search(r"Capacidad del sistema FNCER,?\s*([\d\.,]+)\s*kW", text, re.I)
    fncer_kw = _to_num(m_fncer.group(1)) if m_fncer else 40.0

    # 3. Energía Importada (kWh)
    imp_kwh = None
    m_imp1 = re.search(r"Consumo\s+importado:?\s*(-?[\d\.,]+)", text, re.I)
    m_imp2 = re.search(r"\b501\s+([\d\.,]+)\s+Consumo\s+Activa", text, re.I)
    m_imp3 = re.search(r"Tu\s+consumo(?:\s+mes)?:?\s*(-?[\d\.,]+)\s*kWh", text, re.I)

    if m_imp1: imp_kwh = _to_num(m_imp1.group(1))
    elif m_imp2: imp_kwh = _to_num(m_imp2.group(1))
    elif m_imp3: imp_kwh = _to_num(m_imp3.group(1))
    imp_kwh = imp_kwh or 0.0

    # 4. Excedentes / Exportado reconocido por Celsia (kWh)
    exc_kwh = None
    m_exc1 = re.search(r"Total\s+excedentes:?\s*(-?[\d\.,]+)", text, re.I)
    m_exc2 = re.search(r"Cr[^\w\s]{0,4}dito\s+de\s+energ[^\w\s]{0,4}a:?\s*(-?[\d\.,]+)", text, re.I)
    m_exc3 = re.search(r"(-?[\d\.,]+)\s+Venta\s+Energia\s+Exp1", text, re.I)
    m_exc4 = re.search(r"238\s+1\s+Venta Energia Exp1.*?UN\s+(-?[\d\.,]+)", text, re.I)

    if m_exc1: exc_kwh = abs(_to_num(m_exc1.group(1)) or 0.0)
    elif m_exc3: exc_kwh = abs(_to_num(m_exc3.group(1)) or 0.0)
    elif m_exc2: exc_kwh = abs(_to_num(m_exc2.group(1)) or 0.0)
    elif m_exc4: exc_kwh = abs(_to_num(m_exc4.group(1)) or 0.0)
    else: exc_kwh = 0.0

    # 5. Tarifas Costo Unitario CU y Comercialización C ($/kWh)
    cu_rate = None
    m_cu1 = re.search(r"Valor consumo neto:.*?a \$([\d\.,]+)", text, re.I)
    m_cu2 = re.search(r"Consumo Activa.*?KWH\s+([\d\.,]+)", text, re.I)
    m_cu3 = re.search(r"Consumo Importado:?\s*[\d\.,]+\s+([\d\.,]+)", text, re.I)
    if m_cu1: cu_rate = _to_num(m_cu1.group(1))
    elif m_cu2: cu_rate = _to_num(m_cu2.group(1))
    elif m_cu3: cu_rate = _to_num(m_cu3.group(1))
    if not cu_rate or cu_rate < 400 or cu_rate > 2000:
        cu_rate = 977.59

    c_rate = None
    m_cr1 = re.search(r"Comercializacion:?\s*[\d\.,]+kWh\s*a\s*\$?([\d\.,]+)\s*(?:por\s*kWh|/kWh)", text, re.I)
    m_cr2 = re.search(r"Comercializacion Exp1.*?UN\s+([\d\.,]+)", text, re.I)
    m_cr3 = re.search(r"TARIFA ENERGIA.*?Comercializaci[óo\s]{1,4}n:\s*([\d\.,]+)", text, re.I)
    m_cr4 = re.search(r"Comercializaci[óo\s]{1,4}n:\s*([\d\.,]+)", text, re.I)
    candidates_c = [
        _to_num(m.group(1))
        for m in [m_cr1, m_cr2, m_cr3, m_cr4]
        if m and _to_num(m.group(1)) and 40.0 <= (_to_num(m.group(1)) or 0) <= 350.0
    ]
    c_rate = candidates_c[0] if candidates_c else 176.65

    # Componentes adicionales de CU si están en el texto
    def _extract_comp(pattern: str, default: float) -> float:
        m = re.search(pattern, text, re.I)
        if m:
            val = _to_num(m.group(1))
            if val is not None and 0 < val < 800:
                return val
        return default

    g_rate = _extract_comp(r"Generaci[óo\s]{1,4}n:\s*([\d\.,]+)", 394.80)
    t_rate = _extract_comp(r"Transmisi[óo\s]{1,4}n:\s*([\d\.,]+)", 58.19)
    r_rate = _extract_comp(r"Restricciones:\s*([\d\.,]+)", 9.90)
    d_rate = _extract_comp(r"Distribuci[óo\s]{1,4}n:\s*([\d\.,]+)", 264.32)
    pr_rate = _extract_comp(r"P[ée\s]{1,4}rdidas:\s*([\d\.,]+)", 73.73)

    # 6. Liquidación completa de Energía Celsia
    consumo_imp_cop = round(imp_kwh * cu_rate, 2)
    credito_exp1_cop = round(-exc_kwh * cu_rate, 2)
    net_kwh = round(imp_kwh - exc_kwh, 2)
    val_neto = round(net_kwh * cu_rate, 2)
    val_com = round(exc_kwh * c_rate, 2)
    val_contrib = round(val_neto * 0.20, 2)

    # Subtotal de energía impreso en recibo (o suma exacta de los 3 conceptos: Consumo Neto + Comercialización + Contribución 20%)
    m_sub1 = re.search(r"Subtotal:?\s*\$?\s*([\d\.,]+)\s*Producto", text, re.I)
    sub_energy_calc = round(val_neto + val_com + val_contrib, 0)
    sub_energy = _to_num(m_sub1.group(1)) if m_sub1 else None
    if not sub_energy or abs(sub_energy - sub_energy_calc) > 50000:
        sub_energy = sub_energy_calc

    ajuste_decenas = round(sub_energy - (val_neto + val_com + val_contrib), 2)

    m_tot = re.search(r"(?:TOTAL A PAGAR|VALOR A PAGAR)[\s:]*\$?\s*([\d\.,]+)", text, re.I)
    tot_pagar = _to_num(m_tot.group(1)) if m_tot else sub_energy
    otros_cobros_cop = round(max(0.0, (tot_pagar or sub_energy) - sub_energy), 2)

    componentes_cu = {
        "G_generacion": g_rate,
        "C_comercializacion": c_rate,
        "T_transmision": t_rate,
        "D_distribucion": d_rate,
        "PR_perdidas": pr_rate,
        "R_restricciones": r_rate,
        "cu_calculado": cu_rate,
        "tarifa_excedente_t1_agpe": round(cu_rate - c_rate, 2),
    }

    return {
        "company": "Celsia",
        "client_name": client_name,
        "account_code": cod_cli,
        "account_number": cod_cli,
        "niu": niu,
        "invoice_number": inv_no,
        "meter_number": meter,
        "period": period_ym,
        "period_start": p_start,
        "period_end": p_end,
        "days_billed": days_billed,
        "capacidad_fncer_kw": fncer_kw,
        "consumo_importado_kwh": imp_kwh,
        "consumo_importado_cop": consumo_imp_cop,
        "kwh_billed": imp_kwh,
        "exc_celsia": exc_kwh,
        "credito_energia_kwh": exc_kwh,
        "credito_energia_cop": credito_exp1_cop,
        "total_excedentes_kwh": exc_kwh,
        "consumo_neto_kwh": net_kwh,
        "price_cop_kwh": cu_rate,
        "cu_rate": cu_rate,
        "c_rate": c_rate,
        "subtotal_active_cop": val_neto,
        "comercializacion_cop": val_com,
        "subsidy_or_contrib_cop": val_contrib,
        "ajuste_decenas_cop": ajuste_decenas,
        "subtotal_energia_cop": sub_energy,
        "otros_cobros_cop": otros_cobros_cop,
        "total_cop": sub_energy,
        "total_pagar_cop": tot_pagar,
        "componentes_cu": componentes_cu,
        "has_agpe_template": True,
    }
