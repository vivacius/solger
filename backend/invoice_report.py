"""
SOLGER — Generador de Informes de Auditoría de Facturas y Post-Venta (CREG 174).

Genera:
1. Informe formal ejecutivo en HTML (imprimible a PDF con un clic) con branding SOLGER,
   desglose CREG 174 (Exp1 a CU - C, Exp2 a Precio de Bolsa XM), gráfica SVG de balance diario
   y dictamen de ingeniería para sustentar la reclamación.
2. Libro de Excel (.xlsx) con fórmulas vivas de auditoría.
"""
from __future__ import annotations

import base64
import os
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BRAND_DARK = "#0F172A"
BRAND_TEAL = "#24A5AE"
BRAND_GREEN = "#58AE32"
BRAND_GOLD = "#F5B914"
BRAND_RED = "#DC2626"

ROOT = Path(__file__).resolve().parent.parent


def _get_logo_base64() -> str:
    candidates = [
        ROOT / "analytics" / "logo.png",
        ROOT / "webapp" / "public" / "logo.png",
        Path(__file__).parent / "logo.png",
    ]
    for c in candidates:
        if c.exists():
            try:
                b64 = base64.b64encode(c.read_bytes()).decode("utf-8")
                return f"data:image/png;base64,{b64}"
            except Exception:
                pass
    return "/logo.png"


def _fmt_cop(n: float | None) -> str:
    if n is None:
        return "—"
    return f"${n:,.0f}".replace(",", ".")


def _fmt_kwh(n: float | None) -> str:
    if n is None:
        return "—"
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def build_invoice_audit_svg_chart(daily_series: list[dict]) -> str:
    """Genera una gráfica proporcional de balance diario SVG para formato A4 de una sola página."""
    if not daily_series:
        return ""

    width = 720
    height = 140  # Proporción ideal que aprovecha el espacio vertical sin desbordar A4
    pad_left = 38
    pad_right = 16
    pad_top = 18
    pad_bot = 22

    n = len(daily_series)
    max_val = max(
        max(
            (r.get("PVYield") or 0.0),
            (r.get("use_power") or 0.0),
            (r.get("buyPower") or 0.0),
            (r.get("ongrid_power") or 0.0),
        )
        for r in daily_series
    )
    if max_val <= 0:
        max_val = 100.0
    max_y = max_val * 1.15

    plot_w = width - pad_left - pad_right
    plot_h = height - pad_top - pad_bot

    def y_coord(val: float) -> float:
        return pad_top + plot_h - (val / max_y * plot_h)

    def x_coord(i: int) -> float:
        return pad_left + (i / max(1, n - 1)) * plot_w

    pts_pv = []
    pts_buy = []
    pts_exp = []
    pts_self = []

    for i, r in enumerate(daily_series):
        x = x_coord(i)
        pts_pv.append(f"{x:.1f},{y_coord(r.get('PVYield') or 0.0):.1f}")
        pts_buy.append(f"{x:.1f},{y_coord(r.get('buyPower') or 0.0):.1f}")
        pts_exp.append(f"{x:.1f},{y_coord(r.get('ongrid_power') or 0.0):.1f}")
        pts_self.append(f"{x:.1f},{y_coord(r.get('selfUsePower') or 0.0):.1f}")

    x_ticks = ""
    step = max(1, n // 8)
    for i in range(0, n, step):
        x = x_coord(i)
        f_str = str(daily_series[i].get("fecha", ""))
        day_lbl = f_str[-2:] if len(f_str) >= 10 else str(i + 1)
        x_ticks += f'<text x="{x:.1f}" y="{height - 6}" font-size="8.5" fill="#94A3B8" text-anchor="middle">D{day_lbl}</text>'
        x_ticks += f'<line x1="{x:.1f}" y1="{pad_top}" x2="{x:.1f}" y2="{pad_top + plot_h}" stroke="#F1F5F9" stroke-width="1" />'

    y_ticks = ""
    for y_v in [0, max_y * 0.5, max_y]:
        y = y_coord(y_v)
        y_ticks += f'<text x="{pad_left - 5}" y="{y + 3:.1f}" font-size="8.5" fill="#94A3B8" text-anchor="end">{y_v:.0f}</text>'
        y_ticks += f'<line x1="{pad_left}" y1="{y:.1f}" x2="{width - pad_right}" y2="{y:.1f}" stroke="#E2E8F0" stroke-dasharray="2,2" />'

    svg = f"""<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" style="background:#FFFFFF;border-radius:6px;display:block;" xmlns="http://www.w3.org/2000/svg">
      {y_ticks}
      {x_ticks}
      <polyline points="{' '.join(pts_pv)}" fill="none" stroke="{BRAND_GOLD}" stroke-width="2.2" />
      <polyline points="{' '.join(pts_buy)}" fill="none" stroke="#2563EB" stroke-width="1.8" stroke-dasharray="3,2" />
      <polyline points="{' '.join(pts_exp)}" fill="none" stroke="{BRAND_TEAL}" stroke-width="1.8" />
      <polyline points="{' '.join(pts_self)}" fill="none" stroke="{BRAND_GREEN}" stroke-width="1.6" />
      <g transform="translate({pad_left + 15}, 11)">
        <circle cx="0" cy="0" r="3.5" fill="{BRAND_GOLD}"/>
        <text x="7" y="3" font-size="9" fill="#334155" font-weight="bold">Generación FV</text>
        <circle cx="95" cy="0" r="3.5" fill="#2563EB"/>
        <text x="102" y="3" font-size="9" fill="#334155" font-weight="bold">Importado Red</text>
        <circle cx="190" cy="0" r="3.5" fill="{BRAND_TEAL}"/>
        <text x="197" y="3" font-size="9" fill="#334155" font-weight="bold">Exportado Red</text>
        <circle cx="280" cy="0" r="3.5" fill="{BRAND_GREEN}"/>
        <text x="287" y="3" font-size="9" fill="#334155" font-weight="bold">Autoconsumo</text>
      </g>
    </svg>"""
    return svg


def generate_invoice_audit_html(inv: dict[str, Any], audit: dict[str, Any], plant: dict[str, Any]) -> str:
    """Construye el informe HTML Post-Venta con membrete de SOLGER y dictamen CREG 174."""
    logo_src = _get_logo_base64()
    now_str = datetime.now().strftime("%d/%m/%Y · %H:%M")

    sobrecosto = audit.get("sobrecosto_cop", 0.0)
    is_excess = sobrecosto > 50000

    status_badge = (
        f'<span style="background:#FEE2E2;color:#991B1B;padding:6px 14px;border-radius:20px;font-weight:800;font-size:12px;border:1px solid #FCA5A5;">'
        f'🔴 DISCREPANCIA CRÍTICA — COBRO EN EXCESO DETECTADO</span>'
        if is_excess else
        f'<span style="background:#DCFCE7;color:#166534;padding:6px 14px;border-radius:20px;font-weight:800;font-size:12px;border:1px solid #86EFAC;">'
        f'🟢 FACTURA CONCILIADA DENTRO DEL MARGEN PERMITIDO</span>'
    )

    svg_chart = build_invoice_audit_svg_chart(audit.get("daily_series", []))

    # Formateo
    imp_c = _fmt_kwh(audit.get("imp_celsia"))
    imp_f = _fmt_kwh(audit.get("imp_fusion"))
    diff_imp = (audit.get("imp_celsia", 0) - audit.get("imp_fusion", 0))

    exc_c = _fmt_kwh(audit.get("exc_celsia"))
    exc_f = _fmt_kwh(audit.get("exc_fusion"))
    diff_exc = (audit.get("exc_fusion", 0) - audit.get("exc_celsia", 0))

    exc1_kwh = _fmt_kwh(audit.get("exc_1_kwh"))
    exc2_kwh = _fmt_kwh(audit.get("exc_2_kwh"))
    xm_price = _fmt_cop(audit.get("xm_spot_price"))
    cu_rate = _fmt_cop(audit.get("cu_rate"))
    c_rate = _fmt_cop(audit.get("c_rate"))

    sub_c = _fmt_cop(audit.get("subtotal_celsia"))
    sub_f = _fmt_cop(audit.get("subtotal_fusion_creg"))
    sobre_fmt = _fmt_cop(abs(sobrecosto))

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>SOLGER — Informe de Auditoría CREG 174 Factura {inv.get('invoice_number') or ''}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <style>
    @page {{
      size: A4 portrait;
      margin: 6mm 7mm;
    }}
    @media print {{
      html, body {{
        margin: 0 !important;
        padding: 0 !important;
        background: #FFF !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }}
      .no-print {{ display: none !important; }}
      .page-card {{
        box-shadow: none !important;
        border: 1px solid #CBD5E1 !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }}
    }}
    body {{
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      background: #F1F5F9;
      color: #0F172A;
      margin: 0;
      padding: 12px 6px;
    }}
    .page-card {{
      max-width: 794px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 8px;
      border: 1px solid #CBD5E1;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }}
    /* Encabezado limpio en una sola barra horizontal */
    .header-bar {{
      background: linear-gradient(135deg, {BRAND_DARK} 0%, #1E293B 100%);
      padding: 10px 18px;
      color: #FFF;
      border-bottom: 3.5px solid {BRAND_TEAL};
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }}
    .content {{ padding: 12px 18px 14px 18px; }}
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin: 10px 0;
    }}
    .kpi-box {{
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 7px;
      padding: 8px 12px;
    }}
    .kpi-title {{ font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #64748B; letter-spacing: 0.04em; }}
    .kpi-val {{ font-size: 18px; font-weight: 800; color: #0F172A; margin: 2px 0; }}
    .kpi-desc {{ font-size: 9.5px; color: #64748B; }}
    table.audit-table {{
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      font-size: 10.5px;
      border: 1.5px solid #94A3B8;
    }}
    table.audit-table th {{
      background: #F1F5F9;
      color: #0F172A;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 9px;
      letter-spacing: 0.03em;
      padding: 5px 8px;
      border: 1px solid #94A3B8;
      text-align: left;
    }}
    table.audit-table td {{
      padding: 4.5px 8px;
      border: 1px solid #CBD5E1;
      vertical-align: middle;
    }}
    table.audit-table tbody tr:nth-child(even) {{
      background: #F8FAFC;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      text-decoration: none;
      transition: all 0.15s ease;
    }}
    .btn:hover {{
      opacity: 0.92;
      transform: translateY(-1px);
    }}
  </style>
</head>
<body>
  <!-- Barra superior de acciones (no se imprime ni va al PDF) -->
  <div class="no-print" style="max-width: 794px; margin: 0 auto 8px auto; padding: 8px 14px; background: #0F172A; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; gap: 10px; box-shadow: 0 4px 12px rgba(15,23,42,0.15);">
    <span style="font-size: 11.5px; color: #E2E8F0; font-weight: 600; display: flex; align-items: center; gap: 7px;">
      <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: {BRAND_TEAL};"></span>
      SOLGER Post-Venta · Dictamen Pericial CREG 174
    </span>
    <div style="display: flex; gap: 6px; align-items: center;">
      <button id="btn-download-pdf" onclick="descargarPDFDirecto()" class="btn" style="background: {BRAND_TEAL}; color: #FFF; box-shadow: 0 2px 6px rgba(36, 165, 174, 0.4);">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Descargar PDF Directo
      </button>
      <button onclick="window.print()" class="btn" style="background: #334155; color: #FFF;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Imprimir
      </button>
      <button onclick="window.close()" class="btn" style="background: #1E293B; color: #94A3B8; border: 1px solid #475569;">✕ Cerrar</button>
    </div>
  </div>

  <!-- Documento principal A4 de una sola página -->
  <div id="report-document" class="page-card">
    <!-- Encabezado en UNA SOLA BARRA ESTRICTA: Logo izquierda, Título centrado, Fecha emisión derecha -->
    <div class="header-bar">
      <!-- Izquierda: Solo logo de SOLGER -->
      <div style="flex: 0 0 130px; display: flex; align-items: center;">
        <img src="{logo_src}" alt="SOLGER" style="height: 30px; background: rgba(255,255,255,0.96); padding: 2px 8px; border-radius: 5px;" />
      </div>

      <!-- Centro: Título pericial centrado -->
      <div style="flex: 1; text-align: center; padding: 0 10px;">
        <div style="font-size: 14.5px; font-weight: 800; color: #FFFFFF; letter-spacing: 0.02em; text-transform: uppercase; line-height: 1.15;">
          Informe Pericial de Auditoría y Conciliación Energética
        </div>
        <div style="font-size: 10px; color: #94A3B8; margin-top: 2px;">
          Resolución CREG 174 de 2021 (AGPE) · Comparativo Medición Frontera Celsia vs FusionSolar
        </div>
      </div>

      <!-- Derecha: Fecha de Emisión en una sola línea -->
      <div style="flex: 0 0 130px; text-align: right; font-size: 9.5px; color: #94A3B8; font-weight: 600;">
        Emisión: <span style="color: #FFFFFF; font-weight: 700;">{now_str}</span>
      </div>
    </div>

    <div class="content">
      <!-- Dictamen Técnico Destacado (Banda Ejecutiva a ancho completo justo después de la barra) -->
      <div style="background: {'#FEF2F2' if is_excess else '#F0FDF4'}; border: 1.5px solid {'#FCA5A5' if is_excess else '#86EFAC'}; border-radius: 7px; padding: 7px 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: {'#991B1B' if is_excess else '#166534'}; padding: 2px 7px; background: {'#FEE2E2' if is_excess else '#DCFCE7'}; border-radius: 4px; border: 1px solid {'#FCA5A5' if is_excess else '#86EFAC'};">
            {'🔴 DICTAMEN: DISCREPANCIA DETECTADA' if is_excess else '🟢 DICTAMEN: CONFORME CON REGULACIÓN'}
          </span>
          <span style="font-size: 11px; font-weight: 700; color: {'#991B1B' if is_excess else '#15803D'};">
            {'Cobro indebido en subtotal de energía frente a telemetría de autoconsumo y red.' if is_excess else 'Factura liquidada conforme a la norma CREG 174 dentro del margen tolerable.'}
          </span>
        </div>
        <div style="font-size: 12px; font-weight: 800; color: {'#B91C1C' if is_excess else '#15803D'}; white-space: nowrap;">
          {'Diferencia Reclamable: +' + sobre_fmt + ' COP' if is_excess else 'Diferencia: $0 COP'}
        </div>
      </div>

      <!-- Datos de la Planta y la Factura -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 7px; padding: 8px 12px; font-size: 10.5px; line-height: 1.45;">
        <div>
          <div><strong>Activo Fotovoltaico:</strong> {plant.get('plantName', 'LA LECHERÍA')} ({plant.get('capacity', 63.8)} kWp)</div>
          <div><strong>Titular / Cliente:</strong> {inv.get('client_name') or 'PROCOA SAS.'}</div>
          <div><strong>Código Cuenta Celsia:</strong> {inv.get('account_code') or '9290482506'} · <strong>NIU:</strong> {inv.get('niu') or '20240135486'}</div>
        </div>
        <div>
          <div><strong>Factura Analizada:</strong> {inv.get('invoice_number') or 'CC...'}</div>
          <div><strong>Periodo de Consumo:</strong> {inv.get('period_start')} al {inv.get('period_end')} ({inv.get('days_billed', 30)} días)</div>
          <div><strong>Medidor Asignado:</strong> {inv.get('meter_number') or '2222170715'} (Frontera)</div>
        </div>
      </div>

      <!-- Cajas KPI Principales -->
      <div class="kpi-grid">
        <div class="kpi-box" style="border-left: 3.5px solid {BRAND_RED};">
          <div class="kpi-title">Importado en Exceso</div>
          <div class="kpi-val" style="color: {BRAND_RED};">+{diff_imp:,.1f} kWh</div>
          <div class="kpi-desc">Cobrados: {imp_c} vs Real: {imp_f} kWh</div>
        </div>
        <div class="kpi-box" style="border-left: 3.5px solid {BRAND_GOLD};">
          <div class="kpi-title">Excedentes No Reconocidos</div>
          <div class="kpi-val" style="color: #B45309;">−{diff_exc:,.1f} kWh</div>
          <div class="kpi-desc">Acreditados: {exc_c} vs Real: {exc_f} kWh</div>
        </div>
        <div class="kpi-box" style="border-left: 3.5px solid {BRAND_TEAL};">
          <div class="kpi-title">Cobro en Exceso Reclamable</div>
          <div class="kpi-val" style="color: {BRAND_RED if is_excess else BRAND_GREEN};">{sobre_fmt} COP</div>
          <div class="kpi-desc">Subtotal Celsia vs Real CREG 174</div>
        </div>
      </div>

      <!-- Tabla Comparativa Detallada -->
      <div style="margin-top: 10px;">
        <div style="font-size: 11.5px; font-weight: 800; color: #0F172A; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px;">
          1. Conciliación Energética y Liquidación CREG 174
        </div>
        <table class="audit-table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th style="text-align: right;">Factura Celsia</th>
              <th style="text-align: right;">Telemetría FusionSolar</th>
              <th style="text-align: right;">Discrepancia</th>
              <th>Regulación / Criterio Aplicado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Consumo Importado de Red</strong></td>
              <td style="text-align: right;">{imp_c} kWh</td>
              <td style="text-align: right; color: {BRAND_GREEN}; font-weight: 700;">{imp_f} kWh</td>
              <td style="text-align: right; color: {BRAND_RED}; font-weight: 700;">+{diff_imp:,.1f} kWh</td>
              <td style="font-size: 9px; color: #64748B;">Lectura real por frontera de medición.</td>
            </tr>
            <tr>
              <td><strong>Excedentes Tipo 1 (Exp1 ≤ Importado)</strong></td>
              <td style="text-align: right;">{exc_c} kWh</td>
              <td style="text-align: right; color: {BRAND_TEAL}; font-weight: 700;">{exc1_kwh} kWh</td>
              <td style="text-align: right; font-weight: 700;">—</td>
              <td style="font-size: 9px; color: #64748B;">Permuta valorada a CU − C ({cu_rate} − {c_rate}).</td>
            </tr>
            <tr>
              <td><strong>Excedentes Tipo 2 (Exp2 > Importado)</strong></td>
              <td style="text-align: right;">0,00 kWh</td>
              <td style="text-align: right; color: {BRAND_TEAL}; font-weight: 700;">{exc2_kwh} kWh</td>
              <td style="text-align: right; font-weight: 700;">—</td>
              <td style="font-size: 9px; color: #64748B;">Valorados a Precio de Bolsa XM ({xm_price}/kWh).</td>
            </tr>
            <tr>
              <td><strong>Consumo Neto Facturable</strong></td>
              <td style="text-align: right;">{_fmt_kwh(audit.get('net_celsia'))} kWh</td>
              <td style="text-align: right; color: {BRAND_GREEN}; font-weight: 700;">{_fmt_kwh(audit.get('net_fusion'))} kWh</td>
              <td style="text-align: right; color: {BRAND_RED}; font-weight: 700;">+{audit.get('net_celsia', 0) - audit.get('net_fusion', 0):,.1f} kWh</td>
              <td style="font-size: 9px; color: #64748B;">Base neta para liquidar Costo Unitario CU.</td>
            </tr>
            <tr>
              <td><strong>Valor Consumo Neto ($)</strong></td>
              <td style="text-align: right;">{_fmt_cop(audit.get('val_neto_celsia'))}</td>
              <td style="text-align: right; color: {BRAND_GREEN}; font-weight: 700;">{_fmt_cop(audit.get('costo_neto_fusion'))}</td>
              <td style="text-align: right; color: {BRAND_RED}; font-weight: 700;">{_fmt_cop((audit.get('val_neto_celsia') or 0) - (audit.get('costo_neto_fusion') or 0))}</td>
              <td style="font-size: 9px; color: #64748B;">(Importado − Exp1) × CU ({cu_rate}/kWh).</td>
            </tr>
            <tr>
              <td><strong>Comercialización Excedentes Exp1 ($)</strong></td>
              <td style="text-align: right;">{_fmt_cop(audit.get('val_com_celsia'))}</td>
              <td style="text-align: right; color: {BRAND_TEAL}; font-weight: 700;">{_fmt_cop(audit.get('comercializacion_fusion'))}</td>
              <td style="text-align: right; font-weight: 700;">{_fmt_cop((audit.get('val_com_celsia') or 0) - (audit.get('comercializacion_fusion') or 0))}</td>
              <td style="font-size: 9px; color: #64748B;">Exp1 × Tarifa Comercialización C ({c_rate}/kWh).</td>
            </tr>
            <tr>
              <td><strong>Contribución Industrial 20% ($)</strong></td>
              <td style="text-align: right;">{_fmt_cop(audit.get('val_contrib_celsia'))}</td>
              <td style="text-align: right; color: {BRAND_GREEN}; font-weight: 700;">{_fmt_cop(audit.get('contrib_fusion'))}</td>
              <td style="text-align: right; color: {BRAND_RED}; font-weight: 700;">{_fmt_cop((audit.get('val_contrib_celsia') or 0) - (audit.get('contrib_fusion') or 0))}</td>
              <td style="font-size: 9px; color: #64748B;">20% sobre el Valor Consumo Neto.</td>
            </tr>
            <tr style="background: #F1F5F9; font-weight: 800;">
              <td style="border-top: 1.5px solid #0F172A; border-bottom: 1.5px solid #0F172A;"><strong>Subtotal Liquidado Energía ($)</strong></td>
              <td style="text-align: right; border-top: 1.5px solid #0F172A; border-bottom: 1.5px solid #0F172A;">{sub_c}</td>
              <td style="text-align: right; color: {BRAND_GREEN}; border-top: 1.5px solid #0F172A; border-bottom: 1.5px solid #0F172A;">{sub_f}</td>
              <td style="text-align: right; color: {BRAND_RED}; font-size: 11.5px; border-top: 1.5px solid #0F172A; border-bottom: 1.5px solid #0F172A;">+{sobre_fmt}</td>
              <td style="font-size: 9px; color: #334155; border-top: 1.5px solid #0F172A; border-bottom: 1.5px solid #0F172A;">Consumo Neto + Comercialización + Contribución 20% − Exp2.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Curva Diaria de Balance Energético -->
      <div style="margin-top: 10px;">
        <div style="font-size: 11.5px; font-weight: 800; color: #0F172A; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px;">
          2. Comportamiento Diario en FusionSolar (Ciclo Facturado)
        </div>
        <div style="border: 1px solid #CBD5E1; border-radius: 6px; padding: 4px; background: #FFF;">
          {svg_chart}
        </div>
      </div>

      <!-- Dictamen Pericial / Argumentación de PQR -->
      <div style="margin-top: 10px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; padding: 8px 12px; font-size: 9.5px; color: #92400E; line-height: 1.45;">
        <div style="font-weight: 800; text-transform: uppercase; margin-bottom: 2px;">⚖️ Dictamen Pericial para Solicitud de Reliquidación (PQR):</div>
        De conformidad con la <strong>Resolución CREG 174 de 2021</strong>, los autogeneradores a pequeña escala tienen derecho a la liquidación integral de excedentes (Tipo 1 a CU − C y Tipo 2 a precio XM).
        La discrepancia evidenciada arroja un saldo cobrado indebidamente por valor de <strong>{sobre_fmt} COP</strong>. Se solicita formalmente la revisión del equipo de frontera y la expedición de nota crédito a favor del usuario.
      </div>

      <!-- Firma del Informe -->
      <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #E2E8F0; padding-top: 6px; font-size: 9px; color: #64748B;">
        <div>
          <div style="font-weight: 800; color: #0F172A; font-size: 10px;">SOLGER Gestión Solar</div>
          <div>Dirección de Regulación y Post-Venta Fotovoltaica · Valle del Cauca, Colombia · www.solger.com.co</div>
        </div>
        <div style="text-align: right;">
          <div>Documento Pericial Automatizado · Hash: {inv.get('id', '')[:12]}</div>
          <div>Telemetría oficial Huawei SmartLogger / FusionSolar</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function descargarPDFDirecto() {{
      const btn = document.getElementById('btn-download-pdf');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {{
        btn.innerHTML = '⏳ Generando PDF...';
        btn.disabled = true;
      }}

      const element = document.getElementById('report-document');
      const invoiceRaw = "{inv.get('invoice_number') or 'Factura'}";
      const cleanNum = invoiceRaw.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = 'SOLGER_Auditoria_CREG174_' + cleanNum + '.pdf';

      const opt = {{
        margin: [4, 4, 4, 4],
        filename: filename,
        image: {{ type: 'jpeg', quality: 0.98 }},
        html2canvas: {{ scale: 2, useCORS: true, logging: false }},
        jsPDF: {{ unit: 'mm', format: 'a4', orientation: 'portrait' }},
        pagebreak: {{ mode: ['avoid-all'] }}
      }};

      if (window.html2pdf) {{
        html2pdf().set(opt).from(element).save().then(function() {{
          if (btn) {{
            btn.innerHTML = origHtml;
            btn.disabled = false;
          }}
        }}).catch(function(err) {{
          console.error('Error al generar PDF con html2pdf:', err);
          if (btn) {{
            btn.innerHTML = origHtml;
            btn.disabled = false;
          }}
          window.print();
        }});
      }} else {{
        if (btn) {{
          btn.innerHTML = origHtml;
          btn.disabled = false;
        }}
        window.print();
      }}
    }}

    // Auto-descargar si se abre con ?download=1
    window.addEventListener('DOMContentLoaded', function() {{
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('download') === '1') {{
        setTimeout(descargarPDFDirecto, 400);
      }}
    }});
  </script>
</body>
</html>"""


def generate_invoice_audit_excel_bytes(plant: dict, inv: dict, audit: dict) -> bytes:
    """Genera en memoria los bytes del Excel (.xlsx) con fórmulas vivas de auditoría."""
    wb = Workbook()
    wsd = wb.active
    wsd.title = "FusionSolar diario"

    DARK, TEAL, GREEN, GOLD = "0F172A", "24A5AE", "58AE32", "F5B914"
    HDR = PatternFill("solid", fgColor=DARK)
    INV = PatternFill("solid", fgColor="FFF7E0")
    FUS = PatternFill("solid", fgColor="E6F5DC")
    BAD = PatternFill("solid", fgColor="FEE2E2")
    thin = Side(style="thin", color="D5DCE4")
    BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
    KWH = '#,##0.00'
    COP = '"$"#,##0.00'
    PCT = '0.0%'

    def style_header(ws, row: int, ncols: int) -> None:
        for c in range(1, ncols + 1):
            cell = ws.cell(row=row, column=c)
            cell.fill = HDR
            cell.font = Font(bold=True, color="FFFFFF")
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = BOX

    heads = ["Fecha", "Generación FV (kWh)", "Autoconsumo (kWh)", "Exportado a red (kWh)", "Importado de red (kWh)", "Consumo total (kWh)"]
    wsd.append(heads)
    style_header(wsd, 1, len(heads))

    daily = audit.get("daily_series", [])
    for i, r in enumerate(daily, start=2):
        wsd.cell(row=i, column=1, value=str(r.get("fecha", "")))
        wsd.cell(row=i, column=2, value=r.get("PVYield")).number_format = KWH
        wsd.cell(row=i, column=3, value=r.get("selfUsePower")).number_format = KWH
        wsd.cell(row=i, column=4, value=r.get("ongrid_power")).number_format = KWH
        wsd.cell(row=i, column=5, value=r.get("buyPower")).number_format = KWH
        wsd.cell(row=i, column=6, value=r.get("use_power")).number_format = KWH

    last = max(len(daily) + 1, 2)
    tot = last + 1
    wsd.cell(row=tot, column=1, value="TOTAL PERIODO").font = Font(bold=True)
    for j in range(2, 7):
        col = get_column_letter(j)
        c = wsd.cell(row=tot, column=j, value=f"=SUM({col}2:{col}{last})")
        c.number_format = KWH
        c.font = Font(bold=True)
        c.fill = FUS

    # Hoja Resumen
    ws = wb.create_sheet("Resumen Auditoría CREG 174", 0)
    ws["A1"] = f"Auditoría CREG 174 Factura {inv.get('invoice_number', '')} — {plant.get('plantName', 'Planta')}"
    ws["A1"].font = Font(bold=True, size=14, color=DARK)
    ws["A2"] = f"Periodo: {inv.get('period_start')} al {inv.get('period_end')} · Cliente: {inv.get('client_name', 'PROCOA SAS.')}"
    ws["A2"].font = Font(italic=True, color="64748B")

    r_hdr = ["Concepto", "Factura Celsia", "Telemetría FusionSolar", "Diferencia", "Diagnóstico Técnico CREG 174"]
    for j, h in enumerate(r_hdr, start=1):
        ws.cell(row=4, column=j, value=h)
    style_header(ws, 4, len(r_hdr))

    rows_data = [
        ("Consumo Importado (kWh)", audit.get("imp_celsia"), audit.get("imp_fusion"), KWH, "Energía tomada de la red por frontera."),
        ("Excedentes Reconocidos Exp1 (kWh)", audit.get("exc_celsia"), audit.get("exc_1_kwh"), KWH, "Compensación a CU − C."),
        ("Excedentes Tipo 2 Exp2 (kWh)", 0.0, audit.get("exc_2_kwh"), KWH, f"Valorados a Precio de Bolsa XM ({_fmt_cop(audit.get('xm_spot_price'))}/kWh)."),
        ("Consumo Neto (kWh)", audit.get("net_celsia"), audit.get("net_fusion"), KWH, "Base neta liquidable a CU."),
        ("Valor Consumo Neto ($)", audit.get("val_neto_celsia"), audit.get("costo_neto_fusion"), COP, "(Importado − Exp1) × CU."),
        ("Comercialización Exp1 ($)", audit.get("val_com_celsia"), audit.get("comercializacion_fusion"), COP, "Exp1 × Comercialización C."),
        ("Contribución Industrial 20% ($)", audit.get("val_contrib_celsia"), audit.get("contrib_fusion"), COP, "20% sobre el Valor Consumo Neto."),
        ("Subtotal Energía ($)", audit.get("subtotal_celsia"), audit.get("subtotal_fusion_creg"), COP, "Consumo Neto + Comercialización + Contribución 20% − Exp2."),
    ]

    for i, (lbl, vc, vf, fmt, note) in enumerate(rows_data, start=5):
        ws.cell(row=i, column=1, value=lbl).font = Font(bold=True)
        c1 = ws.cell(row=i, column=2, value=vc)
        c1.number_format = fmt
        c1.fill = INV
        c2 = ws.cell(row=i, column=3, value=vf)
        c2.number_format = fmt
        c2.fill = FUS
        c3 = ws.cell(row=i, column=4, value=f"=B{i}-C{i}")
        c3.number_format = fmt
        c3.font = Font(bold=True)
        ws.cell(row=i, column=5, value=note).font = Font(size=9, color="64748B")
        for j in range(1, 6):
            ws.cell(row=i, column=j).border = BOX

    ws.cell(row=14, column=1, value="COBRO EN EXCESO ESTIMADO ($)").font = Font(bold=True, color="B91C1C", size=11)
    diff_tot = ws.cell(row=14, column=4, value="=D12")
    diff_tot.number_format = COP
    diff_tot.font = Font(bold=True, color="B91C1C", size=12)
    diff_tot.fill = BAD

    for j, w in enumerate([36, 20, 24, 22, 50], start=1):
        ws.column_dimensions[get_column_letter(j)].width = w

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()

