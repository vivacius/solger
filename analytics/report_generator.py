"""
SOLGER Gestión Solar — Generador de Reporte Ejecutivo de Cierre.
Genera y envía por correo un reporte profesional de nivel gerencial con:
  · KPIs del portafolio
  · Diagnóstico de rendimiento por planta (PR + HSP real)
  · Gráficos matplotlib: portafolio, HSP y perfiles de potencia
  · Clasificación de alarmas: Operativas vs. Pérdida de Comunicación
  · Calendario de mantenimiento preventivo estimado

Uso:
    python report_generator.py
"""

import os
import sys
import base64
import smtplib
import requests
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from datetime import datetime
from dotenv import load_dotenv

def get_base64_image(path: str) -> str:
    """Convierte una imagen local a formato data URI base64 para visualización directa en navegador."""
    if path and os.path.exists(path):
        try:
            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")
                ext = os.path.splitext(path)[1].lower().replace(".", "")
                mime = "image/jpeg" if ext in ("jpg", "jpeg") else "image/svg+xml" if ext == "svg" else "image/png"
                return f"data:{mime};base64,{b64}"
        except Exception:
            pass
    return ""

def get_logo_path() -> str:
    """Busca la ruta del logo de SOLGER."""
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../webapp/public/logo.png")),
        os.path.abspath(os.path.join(os.getcwd(), "../webapp/public/logo.png")),
        os.path.abspath(os.path.join(os.getcwd(), "webapp/public/logo.png")),
        "../webapp/public/logo.png",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "../webapp/public/logo.png"

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

load_dotenv(override=True)

# ─── Variables de entorno ────────────────────────────────────────────────────
FUSIONSOLAR_BASE_URL = os.getenv("FUSIONSOLAR_BASE_URL", "https://la5.fusionsolar.huawei.com")
FUSIONSOLAR_USERNAME = os.getenv("FUSIONSOLAR_USERNAME", "")
FUSIONSOLAR_PASSWORD = os.getenv("FUSIONSOLAR_PASSWORD", "")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
EMAIL_TO  = os.getenv("EMAIL_TO", "")

# ─── Constantes de dominio solar ─────────────────────────────────────────────
HSP_REF  = 4.5   # Horas sol pico referencia — Valle del Cauca
EFF      = 0.80  # Factor de pérdidas típico (inversor + cableado + suciedad base)
PR_WARN  = 70    # PR% umbral de alerta
PR_CRIT  = 50    # PR% umbral crítico

# ─── Paleta de colores SOLGER ─────────────────────────────────────────────────
C_GOLD   = '#F5B914'
C_GREEN  = '#58AE32'
C_TEAL   = '#24A5AE'
C_RED    = '#EF4444'
C_DARK   = '#172033'
C_BG     = '#FAF8F2'
C_MUTED  = '#64748B'
C_DIM    = '#94A3B8'
C_BORDER = '#E2E8F0'

# ─── Clasificación de alarmas ─────────────────────────────────────────────────
# Pérdida de comunicación: problema de conectividad del logger, NO del inversor
_COMM_KW = [
    'comunicaci', 'communication', 'pérdida de comuni', 'perdida de comuni',
    'connection lost', 'link down', 'desconect', 'offline',
]
# Alarmas operativas: requieren revisión técnica presencial o remota
_CRITICAL_KW = [
    'operativa', 'inversor', 'inverter', 'string', 'aislamiento', 'insulation',
    'fallo', 'fault', 'sobretensión', 'overcurrent', 'cortocircuito', 'short',
    'arco', 'arc', 'overtemp', 'sobretemperatura', 'protección', 'alarma act',
]
_GENERIC_KW = [
    'radiaci', 'sombreado', 'irradiancia', 'irradiance', 'noche', 'night',
    'baja generaci',
]

def classify_alarm(name: str, cause: str = '') -> str:
    """
    Clasifica una alarma en:
      REVISAR   → Alarma operativa que requiere atención técnica.
      MONITOREO → Pérdida de comunicación del logger (no es falla de equipo).
      GENERICA  → Evento ambiental/informativo.
    """
    text = f"{name or ''} {cause or ''}".lower()
    if any(k in text for k in _COMM_KW):
        return 'MONITOREO'
    if any(k in text for k in _GENERIC_KW):
        return 'GENERICA'
    if any(k in text for k in _CRITICAL_KW):
        return 'REVISAR'
    return 'REVISAR'  # Por precaución: desconocida → revisar


# ─── Mantenimiento preventivo ─────────────────────────────────────────────────
_MAINT_SCHEDULE = [
    {'type': 'limpieza',    'label': 'Limpieza de Módulos',    'icon': '🧹', 'interval': 6 },
    {'type': 'electrica',   'label': 'Inspección Eléctrica',   'icon': '⚡', 'interval': 12},
    {'type': 'termografia', 'label': 'Termografía Infrarroja', 'icon': '🌡️', 'interval': 24},
]

def _add_months(dt: datetime, months: int) -> datetime:
    m = dt.month - 1 + months
    y = dt.year + m // 12
    m = m % 12 + 1
    days_in_month = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
                     31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return datetime(y, m, min(dt.day, days_in_month))

def calc_maintenance_due(grid_date_str) -> list:
    """Calcula tareas de mantenimiento preventivo pendientes desde la fecha de conexión."""
    if not grid_date_str:
        return []
    try:
        gd = datetime.strptime(str(grid_date_str)[:10], '%Y-%m-%d')
    except Exception:
        return []
    now = datetime.now()
    months_since = (now.year - gd.year) * 12 + (now.month - gd.month)
    results = []
    for task in _MAINT_SCHEDULE:
        iv = task['interval']
        cycles = months_since // iv
        months_until = (cycles + 1) * iv - months_since
        next_dt = _add_months(gd, (cycles + 1) * iv)
        is_overdue = months_until <= 0
        priority = 'alta' if (is_overdue or months_until <= 1) else 'media' if months_until <= 3 else 'baja'
        results.append({
            'label': task['label'], 'icon': task['icon'],
            'months_until': months_until, 'next_due': next_dt.strftime('%d/%m/%Y'),
            'is_overdue': is_overdue, 'priority': priority, 'cycles': cycles,
        })
    return results


# ─── Fetch de datos del proxy ─────────────────────────────────────────────────
def fetch_data_from_proxy():
    """Consulta el portafolio completo desde el backend proxy."""
    try:
        r = requests.get("http://localhost:8000/api/plants/summary", timeout=10)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def fetch_alerts_from_proxy():
    """Consulta las alarmas activas desde el backend proxy."""
    try:
        r = requests.get("http://localhost:8000/api/alerts", timeout=10)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def fetch_series_from_proxy(plant_code: str):
    """Consulta las series horarias y mensuales de una planta."""
    day_data, month_data = [], []
    enc = plant_code.replace("=", "__")
    try:
        r = requests.get(f"http://localhost:8000/api/plants/{enc}/kpi/day", timeout=10)
        if r.status_code == 200:
            day_data = r.json().get("data", [])
    except Exception:
        pass
    try:
        r = requests.get(f"http://localhost:8000/api/plants/{enc}/kpi/month", timeout=10)
        if r.status_code == 200:
            month_data = r.json().get("data", [])
    except Exception:
        pass
    return day_data, month_data


# ─── Helpers de matplotlib ────────────────────────────────────────────────────
def _setup_ax(fig, ax):
    fig.patch.set_facecolor(C_BG)
    ax.set_facecolor('#FFFFFF')
    for sp in ['top', 'right', 'left', 'bottom']:
        ax.spines[sp].set_visible(False)
    ax.tick_params(colors='none', which='both')

def get_safe_filename(name: str) -> str:
    return "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in name).strip('_')


def generate_power_chart(day_data: list, filename: str, month_data: list | None = None) -> bool:
    """Curva de potencia activa horaria (kW): Generación FV, Exportación, Autoconsumo, Importación."""
    buy_today = 0.0
    load_today = 0.0
    if month_data:
        latest = month_data[-1].get("dataItemMap", {}) if month_data else {}
        gen_d = float(latest.get("inverterYield") or 0)
        exp_d = min(float(latest.get("ongrid_power") or 0), gen_d)
        self_d = max(0.0, gen_d - exp_d)
        buy_today = float(latest.get("buyPower") or 0)
        load_today = float(latest.get("use_power") or (self_d + buy_today))

    raw_items = [
        item for item in day_data
        if 5 <= datetime.fromtimestamp(item.get("collectTime", 0) / 1000).hour <= 20
    ]
    has_direct_buy = any(
        float((item.get("dataItemMap", {}) or {}).get("buy_power") or (item.get("dataItemMap", {}) or {}).get("buyPower") or 0) > 0.01
        for item in raw_items
    )
    count = len(raw_items)
    avg_load_kw = (load_today / count) if (count > 0 and load_today > 0) else 0.0

    series = []
    for item in raw_items:
        dt = datetime.fromtimestamp(item.get("collectTime", 0) / 1000)
        d = item.get("dataItemMap", {}) or {}
        gen  = max(0.0, float(d.get("inverter_power") or 0))
        exp  = min(max(0.0, float(d.get("ongrid_power") or 0)), gen)
        self_use = min(float(d.get("selfProvide") or max(0.0, gen - exp)), gen)
        buy  = max(0.0, float(d.get("buy_power") or d.get("buyPower") or 0))
        if not has_direct_buy and buy_today > 0:
            buy = max(0.0, avg_load_kw - self_use)

        series.append({"time": dt.strftime("%H:%M"), "gen": gen, "exp": exp,
                       "self": self_use, "buy": buy})

    fig, ax = plt.subplots(figsize=(7, 3), dpi=120)
    _setup_ax(fig, ax)

    if not series:
        ax.text(0.5, 0.5, 'Sin datos horarios disponibles hoy',
                ha='center', va='center', color=C_DIM, fontsize=10)
        ax.set_xticks([]); ax.set_yticks([])
        plt.tight_layout()
        plt.savefig(filename, facecolor=C_BG, bbox_inches='tight')
        plt.close()
        return False

    times = [s["time"] for s in series]
    xi = np.linspace(0, len(times) - 1, 6, dtype=int)

    ax.plot(times, [s["gen"]  for s in series], color=C_GOLD,  label='Generación FV',  linewidth=1.8)
    ax.fill_between(times, [s["gen"]  for s in series], color=C_GOLD,  alpha=0.12)
    ax.plot(times, [s["exp"]  for s in series], color=C_TEAL,  label='Exportación',     linewidth=1.3)
    ax.fill_between(times, [s["exp"]  for s in series], color=C_TEAL,  alpha=0.10)
    ax.plot(times, [s["self"] for s in series], color=C_GREEN, label='Autoconsumo',     linewidth=1.3)
    ax.fill_between(times, [s["self"] for s in series], color=C_GREEN, alpha=0.10)
    ax.plot(times, [s["buy"]  for s in series], color=C_RED,   label='Importación',     linewidth=1.3)
    ax.fill_between(times, [s["buy"]  for s in series], color=C_RED,   alpha=0.10)

    ax.set_xticks(xi)
    ax.set_xticklabels([times[i] for i in xi], color=C_MUTED, fontsize=8)
    ax.yaxis.set_tick_params(labelcolor=C_MUTED, labelsize=8)
    ax.yaxis.grid(True, linestyle='--', alpha=0.4, color=C_BORDER)
    ax.legend(frameon=False, loc='upper left', fontsize=8, labelcolor=C_MUTED, ncol=4)
    plt.tight_layout()
    plt.savefig(filename, facecolor=C_BG, bbox_inches='tight')
    plt.close()
    return True


# ─── GRÁFICO 2: Balance mensual de energía (por planta) ──────────────────────
def generate_monthly_chart(month_data: list, filename: str) -> bool:
    """Barras agrupadas: Autoconsumo + Exportación vs. Importación por día del mes."""
    days, self_v, exp_v, buy_v = [], [], [], []
    for item in month_data:
        ts = item.get("collectTime", 0)
        dt = datetime.fromtimestamp(ts / 1000)
        d  = item.get("dataItemMap", {}) or {}
        gen  = max(0.0, float(d.get("inverterYield") or 0))
        exp  = min(max(0.0, float(d.get("ongrid_power") or 0)), gen)
        self_use = min(float(d.get("selfUsePower") or d.get("selfProvide") or max(0.0, gen - exp)), gen)
        buy  = max(0.0, float(d.get("buyPower") or 0))
        days.append(dt.strftime("%d %b"))
        self_v.append(self_use); exp_v.append(exp); buy_v.append(buy)

    fig, ax = plt.subplots(figsize=(7, 3), dpi=120)
    _setup_ax(fig, ax)

    if not days:
        ax.text(0.5, 0.5, 'Sin datos mensuales disponibles',
                ha='center', va='center', color=C_DIM, fontsize=10)
        ax.set_xticks([]); ax.set_yticks([])
        plt.tight_layout()
        plt.savefig(filename, facecolor=C_BG, bbox_inches='tight')
        plt.close()
        return False

    x = np.arange(len(days)); w = 0.35
    ax.bar(x - w/2, self_v, w, label='Autoconsumo',     color=C_GREEN, alpha=0.9, zorder=3)
    ax.bar(x - w/2, exp_v,  w, bottom=self_v, label='Exportación Red', color=C_TEAL, alpha=0.9, zorder=3)
    ax.bar(x + w/2, buy_v,  w, label='Importación Red', color=C_RED,   alpha=0.9, zorder=3)

    step = max(1, len(days) // 6)
    xi = np.arange(0, len(days), step)
    ax.set_xticks(xi)
    ax.set_xticklabels([days[i] for i in xi], color=C_MUTED, fontsize=8)
    ax.yaxis.set_tick_params(labelcolor=C_MUTED, labelsize=8)
    ax.yaxis.grid(True, linestyle='--', alpha=0.4, color=C_BORDER)
    ax.legend(frameon=False, loc='upper right', fontsize=8, labelcolor=C_MUTED)
    plt.tight_layout()
    plt.savefig(filename, facecolor=C_BG, bbox_inches='tight')
    plt.close()
    return True


# ─── GRÁFICO 3: Comparativo de generación del portafolio ─────────────────────
def generate_portfolio_chart(plants_data: list, filename: str) -> bool:
    """
    Barra horizontal por planta: generación real vs esperada.
    Color por estado de salud. Muestra PR% como etiqueta.
    """
    if not plants_data:
        return False

    fig_h = max(3.0, len(plants_data) * 0.6 + 1.2)
    fig, ax = plt.subplots(figsize=(8, fig_h), dpi=120)
    _setup_ax(fig, ax)

    names    = [d['name'].replace('HDA ', '').replace('HACIENDA ', '')[:20] for d in plants_data]
    actual   = [d['day_power']  for d in plants_data]
    expected = [d['expected']   for d in plants_data]
    colors   = [C_GREEN if d['health'] == 3 else C_GOLD if d['health'] == 2 else C_RED
                for d in plants_data]

    y = np.arange(len(names))
    ax.barh(y, expected, height=0.55, color='#E2E8F0', zorder=2, label='Generación esperada')
    ax.barh(y, actual,   height=0.35, color=colors,    zorder=3, label='Generación real')

    x_max = max(max(expected + [1.0]), max(actual + [1.0])) * 1.22
    for i, d in enumerate(plants_data):
        pr = d.get('pr')
        lbl = f"{pr:.0f}% PR" if pr is not None else "sin cap."
        clr = C_GREEN if (pr and pr >= PR_WARN) else C_GOLD if (pr and pr >= PR_CRIT) else C_RED if pr else C_DIM
        ax.text(max(actual[i], 0.5) + x_max * 0.012, i, lbl,
                va='center', ha='left', fontsize=8, color=clr, fontweight='bold')

    ax.set_yticks(y)
    ax.set_yticklabels(names, fontsize=9, color=C_DARK)
    ax.set_xlim(0, x_max)
    ax.set_xlabel('kWh generados hoy', fontsize=8, color=C_MUTED)
    ax.xaxis.set_tick_params(labelcolor=C_MUTED, labelsize=8)
    ax.xaxis.grid(True, linestyle='--', alpha=0.4, color=C_BORDER)

    legend_patches = [
        mpatches.Patch(color='#E2E8F0', label='Generación esperada'),
        mpatches.Patch(color=C_GREEN,   label='Operativa'),
        mpatches.Patch(color=C_GOLD,    label='En alarma'),
        mpatches.Patch(color=C_RED,     label='Offline'),
    ]
    ax.legend(handles=legend_patches, frameon=False, loc='lower right',
              fontsize=7.5, labelcolor=C_MUTED, ncol=2)
    plt.tight_layout()
    plt.savefig(filename, facecolor=C_BG, bbox_inches='tight')
    plt.close()
    return True


# ─── GRÁFICO 4: HSP real por planta ──────────────────────────────────────────
def generate_hsp_chart(plants_data: list, filename: str) -> bool:
    """
    Barras de HSP real por planta (calculado desde generación/capacidad).
    Línea de referencia en 4.5 h/día. Coloreado por nivel de rendimiento.
    """
    data = [d for d in plants_data if d.get('capacity', 0) > 0 and d.get('day_power', 0) > 0]
    if not data:
        return False

    fig, ax = plt.subplots(figsize=(7, 3.2), dpi=120)
    _setup_ax(fig, ax)

    names    = [d['name'].replace('HDA ', '').replace('HACIENDA ', '')[:15] for d in data]
    hsp_vals = [d.get('hsp_real') or 0 for d in data]
    colors   = [C_GREEN if h >= 3.8 else C_GOLD if h >= 2.5 else C_RED for h in hsp_vals]

    x = np.arange(len(names))
    bars = ax.bar(x, hsp_vals, color=colors, width=0.5, zorder=3, edgecolor='white', linewidth=0.5)
    ax.axhline(y=HSP_REF, color=C_DIM, linestyle='--', linewidth=1.4,
               label=f'Referencia {HSP_REF} h/día', zorder=4)

    for bar, val in zip(bars, hsp_vals):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, val + 0.06,
                    f'{val:.1f}h', ha='center', va='bottom',
                    fontsize=8, color=C_DARK, fontweight='bold')

    ax.set_xticks(x)
    ax.set_xticklabels(names, rotation=16, ha='right', fontsize=8, color=C_DARK)
    ax.set_ylabel('HSP Real (h)', fontsize=8, color=C_MUTED)
    ax.yaxis.set_tick_params(labelcolor=C_MUTED, labelsize=8)
    ax.yaxis.grid(True, linestyle='--', alpha=0.4, color=C_BORDER)

    legend_patches = [
        mpatches.Patch(color=C_GREEN, label='≥ 3.8 h — Buen rendimiento'),
        mpatches.Patch(color=C_GOLD,  label='2.5–3.8 h — Bajo rendimiento'),
        mpatches.Patch(color=C_RED,   label='< 2.5 h — Rendimiento crítico'),
    ]
    ax.legend(handles=legend_patches, frameon=False, fontsize=7.5,
              labelcolor=C_MUTED, loc='upper right')
    plt.tight_layout()
    plt.savefig(filename, facecolor=C_BG, bbox_inches='tight')
    plt.close()
    return True


# ═══════════════════════════════════════════════════════════════════════════════
#  REPORTE EJECUTIVO — HTML GERENCIAL
# ═══════════════════════════════════════════════════════════════════════════════
def build_executive_html_report(
    data,
    alarms_data=None,
    logo_src: str = "cid:logo",
    portfolio_chart_src: str = "cid:portfolio_chart",
    hsp_chart_src: str = "cid:hsp_chart",
) -> str:
    """
    Genera el reporte ejecutivo de cierre para el gerente de SOLGER.
    Nivel: senior de gestión de activos fotovoltaicos.
    """
    now      = datetime.now()
    now_str  = now.strftime("%d de %B de %Y — %H:%M")
    today_str = now.strftime("%d/%m/%Y")

    summary  = (data or {}).get("summary", {})
    plants   = (data or {}).get("plants",  [])
    kpi_list = (data or {}).get("kpis",    [])
    alarms   = (alarms_data or {}).get("alarms", [])

    kpi_map = {
        (k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {})
        for k in kpi_list
    }

    # ── KPIs globales del portafolio ─────────────────────────────────────────
    total_cap  = summary.get("totalCapacity_kWp", 0)
    today_kwh  = summary.get("totalEnergyToday_kWh", 0)
    month_kwh  = summary.get("totalEnergyMonth_kWh", 0)
    total_kwh  = summary.get("totalEnergyTotal_kWh", 0)
    co2        = summary.get("co2Avoided_ton", 0)
    active_p   = summary.get("activePlants", 0)
    n_plants   = summary.get("totalPlants", len(plants))

    # ── Rendimiento por planta ───────────────────────────────────────────────
    plants_perf = []
    hsp_list    = []
    for p in plants:
        dim   = kpi_map.get(p.get("plantCode"), {})
        cap   = float(p.get("capacity") or 0)
        day_p = float(dim.get("day_power") or 0)
        health = dim.get("real_health_state", 0)
        cap_est = cap <= 0

        hsp_real = None
        pr       = None
        expected = cap * HSP_REF * EFF if cap > 0 else 0

        if cap > 0 and day_p > 0:
            hsp_real = day_p / (cap * EFF)
            hsp_list.append(hsp_real)
            pr = (day_p / expected * 100) if expected > 0 else None

        plants_perf.append({
            "name": p.get("plantName", ""),
            "capacity": cap, "cap_estimated": cap_est,
            "day_power": day_p,
            "month_power": float(dim.get("month_power") or 0),
            "health": health, "hsp_real": hsp_real, "pr": pr, "expected": expected,
            "gridConnectionDate": p.get("gridConnectionDate"),
        })

    avg_hsp = sum(hsp_list) / len(hsp_list) if hsp_list else None
    prs     = [p['pr'] for p in plants_perf if p['pr'] is not None]
    avg_pr  = sum(prs) / len(prs) if prs else None

    # ── Clasificación de alarmas ──────────────────────────────────────────────
    a_revisar, a_monitoreo, a_generica = [], [], []
    for a in alarms:
        cls = classify_alarm(a.get('alarmName', ''), a.get('alarmCause', ''))
        (a_revisar if cls == 'REVISAR' else a_monitoreo if cls == 'MONITOREO' else a_generica).append(a)

    # ── Helpers de color ──────────────────────────────────────────────────────
    def _hc(h):
        return C_GREEN if (h and h >= 3.8) else C_GOLD if (h and h >= 2.5) else C_RED if h else C_MUTED

    def _pc(p):
        return C_GREEN if (p and p >= PR_WARN) else C_GOLD if (p and p >= PR_CRIT) else C_RED if p else C_MUTED

    def _hfmt(h):
        return f"{h:.1f} h" if h else "—"

    def _pfmt(p):
        return f"{p:.0f}%" if p is not None else "N/D"

    # ── Fila KPI superior ─────────────────────────────────────────────────────
    hsp_kpi = f"{avg_hsp:.1f} h/día" if avg_hsp else "N/D"
    pr_kpi  = f"{avg_pr:.0f}%" if avg_pr else "N/D"
    kpi_cells = ""
    for lbl, val, unit, clr in [
        ("Capacidad Total",  f"{total_cap:.1f}",  "kWp instalados",   C_DARK),
        ("Generación Hoy",   f"{today_kwh:.1f}",  "kWh producidos",   C_GOLD),
        ("HSP Real Prom.",   hsp_kpi,             "horas sol pico",   _hc(avg_hsp)),
        ("PR Portafolio",    pr_kpi,              "rendimiento real",  _pc(avg_pr)),
        ("CO₂ Evitado",      f"{co2:.2f}",        "toneladas acum.",   C_TEAL),
    ]:
        kpi_cells += (
            f'<td style="width:20%;padding:16px 4px;text-align:center;'
            f'border-right:1px solid rgba(15,23,42,0.06);">'
            f'<div style="font-size:9px;color:{C_MUTED};text-transform:uppercase;'
            f'letter-spacing:0.08em;font-weight:700;margin-bottom:5px;">{lbl}</div>'
            f'<div style="font-size:17px;font-weight:800;color:{clr};'
            f'letter-spacing:-0.02em;">{val}</div>'
            f'<div style="font-size:9px;color:{C_DIM};margin-top:2px;">{unit}</div>'
            f'</td>'
        )

    # ── Tabla de rendimiento por planta ───────────────────────────────────────
    plant_rows = ""
    for pp in sorted(plants_perf, key=lambda x: -(x['day_power'] or 0)):
        h = pp['health']
        if   h == 3: hl, hc_lbl, hbg = "Operativa",  "#166534", "#DCFCE7"
        elif h == 2: hl, hc_lbl, hbg = "Alarma",     "#92400E", "#FEF9C3"
        elif h == 1: hl, hc_lbl, hbg = "Offline",    "#991B1B", "#FEE2E2"
        else:        hl, hc_lbl, hbg = "Sin datos",  C_MUTED,   "#F1F5F9"

        cap_lbl = f"{pp['capacity']:.1f} kWp" if pp['capacity'] > 0 else f"<span style='color:{C_DIM};'>N/C *</span>"
        hsp_v = pp['hsp_real']
        hsp_lbl = f"<span style='font-weight:700;color:{_hc(hsp_v)};'>{hsp_v:.1f} h</span>" if hsp_v else f"<span style='color:{C_DIM};'>—</span>"

        pr_v = pp['pr']
        if pr_v is not None:
            pw = min(100, max(0, pr_v))
            pc = _pc(pr_v)
            pr_cell = (
                f'<div style="display:flex;align-items:center;gap:5px;min-width:90px;">'
                f'<div style="flex:1;height:5px;border-radius:3px;background:#E2E8F0;overflow:hidden;">'
                f'<div style="width:{pw:.0f}%;height:100%;background:{pc};border-radius:3px;"></div></div>'
                f'<span style="font-size:11px;font-weight:800;color:{pc};min-width:30px;">{pr_v:.0f}%</span></div>'
            )
        else:
            pr_cell = f"<span style='font-size:10px;color:{C_DIM};font-style:italic;'>Sin cap.</span>"

        # Próximo mantenimiento
        tasks = calc_maintenance_due(pp['gridConnectionDate'])
        urgent = next((t for t in tasks if t['priority'] == 'alta'), None)
        soon   = next((t for t in tasks if t['priority'] == 'media'), None)
        maint_tag = ""
        if urgent:
            maint_tag = f"<span style='font-size:10px;font-weight:700;color:{C_RED};'>⏰ {urgent['label']} ({urgent['next_due']})</span>"
        elif soon:
            maint_tag = f"<span style='font-size:10px;font-weight:700;color:#92400E;'>📅 {soon['label']} ({soon['next_due']})</span>"
        else:
            maint_tag = f"<span style='font-size:10px;color:{C_GREEN};font-weight:600;'>✅ Al día</span>"

        plant_rows += (
            f'<tr style="border-bottom:1px solid rgba(15,23,42,0.05);">'
            f'<td style="padding:9px 14px;font-weight:600;font-size:12.5px;color:{C_DARK};">{pp["name"]}</td>'
            f'<td style="padding:9px 14px;text-align:center;font-size:12px;color:{C_MUTED};">{cap_lbl}</td>'
            f'<td style="padding:9px 14px;text-align:center;font-size:13px;font-weight:800;color:{C_DARK};letter-spacing:-0.02em;">'
            f'{pp["day_power"]:.1f} <span style="font-size:10px;font-weight:500;color:{C_DIM};">kWh</span></td>'
            f'<td style="padding:9px 14px;text-align:center;">{hsp_lbl}</td>'
            f'<td style="padding:9px 14px;">{pr_cell}</td>'
            f'<td style="padding:9px 14px;text-align:center;">'
            f'<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;color:{hc_lbl};background:{hbg};">{hl}</span></td>'
            f'<td style="padding:9px 14px;">{maint_tag}</td>'
            f'</tr>'
        )

    cap_note = (
        f'<div style="padding:5px 14px 8px;font-size:10px;color:{C_DIM};">'
        f'* Capacidad no configurada en FusionSolar — HSP y PR no calculables para esta planta.</div>'
        if any(p['cap_estimated'] for p in plants_perf) else ''
    )

    # ── Cards de alarmas ──────────────────────────────────────────────────────
    def _alarm_card(a, dot_clr):
        nm   = a.get('alarmName', 'Sin nombre')
        caus = a.get('alarmCause', '')
        sug  = a.get('repairSuggestion', '')
        sta  = a.get('stationCode', '')
        dev  = a.get('devName', '')
        rt   = a.get('raiseTime')
        time_html = ''
        if rt:
            h_act = int((datetime.now().timestamp() * 1000 - rt) / 3_600_000)
            dt_f  = datetime.fromtimestamp(rt / 1000).strftime('%d/%m %H:%M')
            tc    = C_RED if h_act > 24 else C_DIM
            time_html = f"<div style='font-size:10px;color:{C_DIM};margin-top:3px;'>🕐 {dt_f} — <span style='color:{tc};font-weight:700;'>{h_act}h activa</span></div>"
        sug_html = (
            f"<div style='font-size:11px;padding:4px 8px;border-radius:4px;background:rgba(36,165,174,0.07);"
            f"border-left:3px solid {C_TEAL};color:{C_TEAL};margin-top:5px;font-weight:600;'>🔧 {sug}</div>"
        ) if sug else ''
        caus_html = (
            '<div style="font-size:10.5px;color:' + C_DIM + ';margin-top:3px;font-style:italic;">📌 ' + caus + '</div>'
            if caus else ''
        )
        return (
            f'<div style="padding:10px 0;border-bottom:1px solid rgba(15,23,42,0.05);">'
            f'<div style="display:flex;gap:8px;align-items:flex-start;">'
            f'<div style="width:7px;height:7px;border-radius:50%;background:{dot_clr};margin-top:4px;flex-shrink:0;"></div>'
            f'<div><div style="font-size:12.5px;font-weight:700;color:{C_DARK};">{nm}</div>'
            f'<div style="font-size:11px;color:{C_MUTED};margin-top:1px;">{dev or sta}</div>'
            f'{caus_html}{sug_html}{time_html}</div></div></div>'
        )

    rev_html = ("".join(_alarm_card(a, C_RED) for a in a_revisar)
                if a_revisar else
                f"<p style='text-align:center;font-size:12px;color:{C_MUTED};padding:18px 0;'>"
                f"Sin alarmas operativas activas que requieran intervención técnica.</p>")

    mon_shown = a_monitoreo[:4]
    mon_html  = "".join(_alarm_card(a, C_GOLD) for a in mon_shown)
    if len(a_monitoreo) > 4:
        mon_html += (
            f"<div style='font-size:10.5px;color:{C_DIM};padding:8px 0 0;font-style:italic;'>"
            f"... y <strong>{len(a_monitoreo) - 4}</strong> pérdidas de comunicación adicionales. "
            f"Verificar conectividad de data loggers en portal FusionSolar.</div>"
        )
    if not a_monitoreo:
        mon_html = f"<p style='text-align:center;font-size:12px;color:{C_MUTED};padding:18px 0;'>Sin pérdidas de comunicación activas.</p>"

    # ── Mantenimiento preventivo ──────────────────────────────────────────────
    maint_rows = ""
    for p in plants:
        tasks = calc_maintenance_due(p.get("gridConnectionDate"))
        pending = [t for t in tasks if t['priority'] in ('alta', 'media')]
        if not pending:
            continue
        tags = "".join(
            f"<span style='display:inline-block;padding:2px 8px;border-radius:12px;font-size:10.5px;"
            f"font-weight:700;color:{'#991B1B' if t['priority'] == 'alta' else '#92400E'};"
            f"background:{'#FEE2E2' if t['priority'] == 'alta' else '#FEF9C3'};margin:2px;'>"
            f"{'⏰' if t['is_overdue'] else '📅'} {t['label']} — {t['next_due']}</span>"
            for t in pending
        )
        maint_rows += (
            f'<tr style="border-bottom:1px solid rgba(15,23,42,0.05);">'
            f'<td style="padding:9px 14px;font-size:12.5px;font-weight:600;color:{C_DARK};">{p.get("plantName","")}</td>'
            f'<td style="padding:9px 14px;">{tags}</td>'
            f'</tr>'
        )

    if maint_rows:
        maint_section = (
            f'<div style="background:#FFFBF0;border:1px solid rgba(245,185,20,0.22);border-radius:8px;'
            f'padding:10px 14px;margin-bottom:14px;font-size:11px;color:#92400E;">'
            f'⚠️ Fechas estimadas desde la fecha de conexión a la red. '
            f'Registre las intervenciones realizadas en el portal de monitoreo para calibrar el calendario automáticamente.</div>'
            f'<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
            f'<thead><tr style="background:#F8FAFC;border-bottom:2px solid rgba(15,23,42,0.07);">'
            f'<th style="padding:7px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;'
            f'letter-spacing:0.05em;color:{C_MUTED};">Planta</th>'
            f'<th style="padding:7px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;'
            f'letter-spacing:0.05em;color:{C_MUTED};">Tareas Pendientes / Próximas (estimado)</th>'
            f'</tr></thead><tbody>{maint_rows}</tbody></table>'
        )
    else:
        maint_section = (
            f'<div style="text-align:center;padding:20px;font-size:12px;color:{C_MUTED};">'
            f'✅ Todas las plantas tienen su mantenimiento preventivo al día.</div>'
        )

    # ── Generación del mes vs hoy (contexto temporal) ─────────────────────────
    month_ctx = ""
    if month_kwh > 0 and today_kwh > 0:
        days_elapsed = now.day
        proj = (today_kwh + month_kwh) / days_elapsed * 30 if days_elapsed > 1 else month_kwh
        month_ctx = (
            f'<div style="background:#F0F9FF;border:1px solid rgba(36,165,174,0.2);border-radius:8px;'
            f'padding:10px 16px;margin:0 24px 16px;display:flex;gap:24px;align-items:center;'
            f'flex-wrap:wrap;font-size:11.5px;">'
            f'<span style="color:{C_TEAL};font-weight:700;">📊 Contexto mensual:</span>'
            f'<span style="color:{C_MUTED};">Acumulado del mes: <strong style="color:{C_DARK};">{month_kwh:.0f} kWh</strong></span>'
            f'<span style="color:{C_MUTED};">Proyección mensual: <strong style="color:{C_DARK};">{proj:.0f} kWh</strong></span>'
            f'<span style="color:{C_MUTED};">Generación histórica acum.: <strong style="color:{C_DARK};">{total_kwh/1000:.1f} MWh</strong></span>'
            f'</div>'
        )

    # ══════════════════════════════════════════════════════════════════════════
    #  HTML FINAL
    # ══════════════════════════════════════════════════════════════════════════
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SOLGER — Reporte Ejecutivo {today_str}</title>
</head>
<body style="margin:0;padding:20px 0;background:#F0F2F5;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:{C_DARK};">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0"
  style="max-width:680px;background:#FFFFFF;border-radius:16px;overflow:hidden;
         box-shadow:0 4px 24px rgba(15,23,42,0.08);border:1px solid rgba(15,23,42,0.06);">

  <!-- ═══ ENCABEZADO ══════════════════════════════════════════════════════════ -->
  <tr>
    <td style="background:linear-gradient(135deg,{C_DARK} 0%,#1E3A5F 60%,#0F2440 100%);padding:0;">
      <div style="height:4px;background:linear-gradient(90deg,{C_GOLD},{C_GREEN},{C_TEAL});"></div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:22px 28px 18px;">
            <img src="{logo_src}" alt="SOLGER" style="height:28px;width:auto;" />
            <div style="margin-top:10px;font-size:19px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;line-height:1.2;">
              Reporte Ejecutivo — Cierre Operativo Diario
            </div>
            <div style="font-size:11px;color:{C_DIM};margin-top:4px;">{now_str} · Valle del Cauca, Colombia</div>
          </td>
          <td style="padding:22px 28px 18px;text-align:right;vertical-align:middle;">
            <div style="display:inline-block;background:rgba(88,174,50,0.12);border:1px solid rgba(88,174,50,0.25);
                        border-radius:10px;padding:10px 16px;text-align:center;">
              <div style="font-size:9px;color:{C_DIM};text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">PLANTAS ACTIVAS</div>
              <div style="font-size:26px;font-weight:800;color:{C_GREEN};letter-spacing:-0.03em;line-height:1.1;">
                {active_p}<span style="font-size:14px;color:{C_DIM};">/{n_plants}</span>
              </div>
              <div style="font-size:9px;color:{C_DIM};">del portafolio</div>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ═══ KPIs ════════════════════════════════════════════════════════════════ -->
  <tr>
    <td style="background:#FAFBFC;border-bottom:1px solid rgba(15,23,42,0.06);">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>{kpi_cells}</tr></table>
    </td>
  </tr>

  <!-- ═══ CONTEXTO MENSUAL ════════════════════════════════════════════════════ -->
  <tr><td style="padding-top:16px;">{month_ctx}</td></tr>

  <!-- ═══ DIAGNÓSTICO POR PLANTA ══════════════════════════════════════════════ -->
  <tr>
    <td style="padding:0;">
      <div style="padding:4px 24px 10px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:{C_MUTED};">
          Diagnóstico de Rendimiento por Planta
        </div>
        <div style="font-size:10.5px;color:{C_DIM};margin-top:2px;">
          PR = Generación real / (Capacidad × {HSP_REF}h × {EFF:.0%}) · HSP real calculado desde producción del día.
          Referencia de rendimiento óptimo: ≥ 3.6 kWh/kWp/día.
        </div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr style="background:#F8FAFC;border-bottom:2px solid rgba(15,23,42,0.07);">
            {''.join(f'<th style="padding:8px 14px;text-align:{"center" if i > 0 else "left"};font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:{C_MUTED};">{h}</th>' for i, h in enumerate(['Planta', 'Cap. (kWp)', 'Gen. Hoy', 'HSP Real', 'PR', 'Estado', 'Próx. Mant.']))}
          </tr>
        </thead>
        <tbody>{plant_rows}</tbody>
      </table>
      {cap_note}
    </td>
  </tr>

  <!-- ═══ GRÁFICO: PORTAFOLIO ══════════════════════════════════════════════════ -->
  <tr>
    <td style="padding:20px 24px 10px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:{C_MUTED};margin-bottom:12px;">
        Generación Real vs. Esperada — Comparativo del Portafolio
      </div>
      <img src="{portfolio_chart_src}" alt="Comparativo portafolio"
           style="width:100%;max-width:628px;height:auto;border-radius:8px;border:1px solid rgba(15,23,42,0.06);" />
    </td>
  </tr>

  <!-- ═══ GRÁFICO: HSP ═════════════════════════════════════════════════════════ -->
  <tr>
    <td style="padding:10px 24px 20px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:{C_MUTED};margin-bottom:12px;">
        Horas de Sol Pico Real por Planta — Ref. {HSP_REF} h/día (Valle del Cauca)
      </div>
      <img src="{hsp_chart_src}" alt="HSP por planta"
           style="width:100%;max-width:628px;height:auto;border-radius:8px;border:1px solid rgba(15,23,42,0.06);" />
      <div style="font-size:10px;color:{C_DIM};margin-top:6px;font-style:italic;">
        HSP real = Generación diaria (kWh) / (Capacidad instalada (kWp) × {EFF:.0%} eficiencia).
        Valores bajos indican pérdidas por suciedad, sombreado parcial o degradación del inversor.
      </div>
    </td>
  </tr>

  <!-- ═══ SEPARADOR ════════════════════════════════════════════════════════════ -->
  <tr><td><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(15,23,42,0.08),transparent);margin:0 24px;"></div></td></tr>

  <!-- ═══ ALARMAS ══════════════════════════════════════════════════════════════ -->
  <tr>
    <td style="padding:20px 24px 10px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:{C_MUTED};margin-bottom:4px;">
        Novedades Operativas — Alarmas Activas
      </div>
      <div style="font-size:10.5px;color:{C_DIM};margin-bottom:14px;">
        Total: <strong>{len(alarms)}</strong> alarmas ·
        <span style="color:{C_RED};font-weight:700;">{len(a_revisar)} operativas a revisar</span> ·
        <span style="color:#92400E;font-weight:700;">{len(a_monitoreo)} pérdidas de comunicación</span>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr valign="top">
          <td style="width:50%;padding-right:8px;">
            <div style="background:#FFF8F8;border:1px solid rgba(239,68,68,0.14);border-radius:10px;padding:14px;border-top:3px solid {C_RED};">
              <div style="font-size:10.5px;font-weight:700;color:#991B1B;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">
                🔴 Alarmas Operativas a Revisar ({len(a_revisar)})
              </div>
              {rev_html}
            </div>
          </td>
          <td style="width:50%;padding-left:8px;">
            <div style="background:#FFFBF0;border:1px solid rgba(245,185,20,0.18);border-radius:10px;padding:14px;border-top:3px solid {C_GOLD};">
              <div style="font-size:10.5px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">
                🟡 Pérdida Comunicación Logger ({len(a_monitoreo)})
              </div>
              <div style="font-size:10px;color:{C_DIM};margin-bottom:8px;font-style:italic;">
                Pérdidas de conexión del data logger con FusionSolar Cloud.
                No implican detención de la planta. Verificar red y módulos de comunicación.
              </div>
              {mon_html}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ═══ SEPARADOR ════════════════════════════════════════════════════════════ -->
  <tr><td><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(15,23,42,0.08),transparent);margin:12px 24px;"></div></td></tr>

  <!-- ═══ MANTENIMIENTO ═════════════════════════════════════════════════════════ -->
  <tr>
    <td style="padding:10px 24px 20px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:{C_MUTED};margin-bottom:12px;">
        📅 Calendario de Mantenimiento Preventivo
      </div>
      <div style="font-size:10.5px;color:{C_DIM};margin-bottom:12px;">
        Limpieza de módulos: cada 6 meses · Inspección eléctrica: cada 12 meses ·
        Termografía infrarroja: cada 24 meses. Basado en fecha de conexión a la red.
      </div>
      {maint_section}
    </td>
  </tr>

  <!-- ═══ PIE DE PÁGINA ═════════════════════════════════════════════════════════ -->
  <tr>
    <td style="background:{C_DARK};padding:18px 28px;border-radius:0 0 16px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:12px;font-weight:700;color:#CBD5E1;">SOLGER Gestión Solar</div>
            <div style="font-size:10.5px;color:#475569;margin-top:3px;">
              Operación &amp; Mantenimiento de Activos Fotovoltaicos · Valle del Cauca, Colombia
            </div>
            <div style="font-size:10px;color:#334155;margin-top:3px;">
              Datos automatizados· {now_str}
            </div>
          </td>
          <td style="text-align:right;vertical-align:top;">
            <div style="font-size:9px;color:#334155;line-height:1.6;">
              HSP ref.: {HSP_REF} h/día (Valle del Cauca)<br>
              Factor pérdidas: η = {EFF:.0%}<br>
              Factor CO₂ UPME: 0.000385 t/kWh<br>
              Gen. histórica: {total_kwh/1000:.1f} MWh acumulados
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>"""


# ─── Reporte individual de planta (preservado) ────────────────────────────────
def build_html_report(data):
    """Alias para compatibilidad — usa el reporte ejecutivo."""
    return build_executive_html_report(data)


def build_plant_html_report(
    plant,
    kpi_dim,
    logo_src: str = "cid:logo",
    power_chart_src: str = "cid:power_chart",
    monthly_chart_src: str = "cid:monthly_chart",
) -> str:
    """Reporte HTML individual por planta (para correo técnico)."""
    now_str    = datetime.now().strftime("%d/%m/%Y %H:%M")
    plant_name = plant.get("plantName", "Planta Solar")
    capacity   = plant.get("capacity", 0.0) or 0.0
    address    = plant.get("plantAddress", "No especificada")
    grid_date  = plant.get("gridConnectionDate", "—")
    lat        = plant.get("latitude", "—"); lng = plant.get("longitude", "—")

    day_power   = float(kpi_dim.get("day_power", 0)   or 0)
    month_power = float(kpi_dim.get("month_power", 0) or 0)
    total_power = float(kpi_dim.get("total_power", 0) or 0)

    export_today = min(float(kpi_dim.get("day_on_grid_energy", 0) or 0), day_power)
    self_today   = max(0.0, day_power - export_today)
    load_today   = float(kpi_dim.get("day_use_energy", 0) or 0)
    if load_today <= 0:
        load_today = self_today
    buy_today  = max(0.0, load_today - self_today)
    self_suf   = (self_today / load_today * 100) if load_today > 0 else 0
    self_rate  = (self_today / day_power * 100)  if day_power > 0  else 0
    co2        = round(total_power * 0.000220, 2)
    health     = kpi_dim.get("real_health_state", 3)

    sl, sc, sb = "Operativa", "#3D8A1F", "#E6F5DC"
    if health == 2: sl, sc, sb = "Alarma",  "#D4A10A", "#FEF8E0"
    if health == 1: sl, sc, sb = "Offline", "#DC2626", "#FEE2E2"

    return f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Reporte — {plant_name}</title>
<style>
body{{font-family:'Segoe UI',sans-serif;background:{C_BG};color:{C_DARK};margin:0;padding:20px;}}
.c{{max-width:650px;margin:0 auto;background:#FFF;border-radius:14px;
    border:1px solid rgba(15,23,42,0.08);box-shadow:0 4px 16px rgba(15,23,42,0.04);overflow:hidden;}}
.kgrid{{display:table;width:100%;border-collapse:separate;border-spacing:10px;
        background:rgba(241,245,249,0.4);padding:4px 8px;}}
.kc{{display:table-cell;width:25%;background:#FFF;border:1px solid rgba(15,23,42,0.08);
     border-radius:10px;padding:10px;text-align:center;}}
.kl{{font-size:9px;color:{C_MUTED};text-transform:uppercase;font-weight:700;letter-spacing:0.05em;}}
.kv{{font-size:15px;font-weight:800;color:{C_DARK};margin-top:4px;}}
.ft{{padding:14px;text-align:center;font-size:10.5px;color:{C_DIM};
     border-top:1px solid rgba(15,23,42,0.06);background:rgba(15,23,42,0.01);}}
</style></head><body>
<div class="c">
  <div style="height:3px;background:linear-gradient(90deg,{C_GOLD},{C_GREEN},{C_TEAL});"></div>
  <div style="padding:16px 20px;border-bottom:1px solid rgba(15,23,42,0.06);display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="font-size:18px;font-weight:800;color:{C_DARK};">{plant_name}</div>
      <div style="font-size:11px;color:{C_MUTED};margin-top:3px;">Reporte Individual — {now_str}</div>
      <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;
                   color:{sc};background:{sb};border:1px solid {sc}30;margin-top:6px;">{sl}</span>
    </div>
    <img src="{logo_src}" alt="SOLGER" style="height:26px;width:auto;" />
  </div>
  <div class="kgrid">
    <div class="kc" style="border-top:2px solid {C_GOLD};"><div class="kl">Gen. Hoy</div><div class="kv">{day_power:.1f} kWh</div></div>
    <div class="kc" style="border-top:2px solid {C_TEAL};"><div class="kl">Gen. Mes</div><div class="kv">{month_power:.1f} kWh</div></div>
    <div class="kc" style="border-top:2px solid {C_TEAL};"><div class="kl">Gen. Total</div><div class="kv">{total_power:.1f} kWh</div></div>
    <div class="kc" style="border-top:2px solid {C_GREEN};"><div class="kl">CO₂ Evitado</div><div class="kv">{co2:.1f} t</div></div>
  </div>
  <div style="padding:12px 20px 0;">
    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:{C_MUTED};margin-bottom:10px;">Balance Energético Hoy</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:32%;padding-right:6px;vertical-align:top;">
          <div style="background:rgba(245,185,20,0.05);border:1px solid rgba(245,185,20,0.18);border-radius:8px;padding:8px;text-align:center;">
            <div style="font-size:9px;font-weight:700;color:#D4A10A;text-transform:uppercase;">Generación Solar</div>
            <div style="font-size:14px;font-weight:800;color:{C_DARK};margin-top:3px;">{day_power:.1f} kWh</div>
          </div>
          <div style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.12);border-radius:8px;padding:8px;text-align:center;margin-top:6px;">
            <div style="font-size:9px;font-weight:700;color:#DC2626;text-transform:uppercase;">Importado Red</div>
            <div style="font-size:14px;font-weight:800;color:{C_DARK};margin-top:3px;">{buy_today:.1f} kWh</div>
          </div>
        </td>
        <td style="width:36%;vertical-align:middle;text-align:center;padding:0 4px;">
          <div style="margin-bottom:8px;">
            <div style="font-size:9px;font-weight:700;color:#3D8A1F;text-transform:uppercase;">Autoconsumo</div>
            <div style="font-size:12px;font-weight:800;color:#3D8A1F;">{self_today:.1f} kWh ({self_rate:.0f}%)</div>
          </div>
          <div>
            <div style="font-size:9px;font-weight:700;color:#1A8A92;text-transform:uppercase;">Inyectado Red</div>
            <div style="font-size:12px;font-weight:800;color:#1A8A92;">{export_today:.1f} kWh</div>
          </div>
        </td>
        <td style="width:32%;padding-left:6px;vertical-align:top;">
          <div style="background:rgba(88,174,50,0.05);border:1px solid rgba(88,174,50,0.18);border-radius:8px;padding:8px;text-align:center;">
            <div style="font-size:9px;font-weight:700;color:#3D8A1F;text-transform:uppercase;">Consumo Local</div>
            <div style="font-size:14px;font-weight:800;color:{C_DARK};margin-top:3px;">{load_today:.1f} kWh</div>
            <div style="font-size:9px;color:#3D8A1F;margin-top:2px;">{self_suf:.0f}% solar</div>
          </div>
          <div style="background:rgba(36,165,174,0.05);border:1px solid rgba(36,165,174,0.18);border-radius:8px;padding:8px;text-align:center;margin-top:6px;">
            <div style="font-size:9px;font-weight:700;color:#1A8A92;text-transform:uppercase;">Excedentes</div>
            <div style="font-size:14px;font-weight:800;color:{C_DARK};margin-top:3px;">{export_today:.1f} kWh</div>
          </div>
        </td>
      </tr>
    </table>
  </div>
  <div style="padding:14px 20px 0;">
    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:{C_MUTED};margin-bottom:8px;">Perfil de Potencia Activa — Hoy</div>
    <img src="{power_chart_src}" style="width:100%;border-radius:6px;border:1px solid rgba(15,23,42,0.06);" alt="Potencia horaria" />
  </div>
  <div style="padding:14px 20px 0;">
    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:{C_MUTED};margin-bottom:8px;">Balance de Energía — Mes Actual</div>
    <img src="{monthly_chart_src}" style="width:100%;border-radius:6px;border:1px solid rgba(15,23,42,0.06);" alt="Balance mensual" />
  </div>
  <div style="padding:14px 20px 18px;">
    <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:{C_MUTED};margin-bottom:8px;">Información del Activo</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
      {''.join(f'<div style="background:rgba(15,23,42,0.02);padding:8px 12px;border-radius:7px;border:1px solid rgba(15,23,42,0.04);"><div style="font-size:9px;color:{C_MUTED};font-weight:700;text-transform:uppercase;margin-bottom:2px;">{lbl}</div><div style="font-weight:600;">{val}</div></div>' for lbl, val in [("Capacidad Instalada", f"{capacity:.2f} kWp"), ("Fecha de Conexión", str(grid_date)[:10]), ("Coordenadas GPS", f"{lat}, {lng}"), ("Dirección", address or "—")])}
    </div>
  </div>
  <div class="ft">SOLGER Gestión Solar © 2026 — Datos automatizados</div>
</div></body></html>"""


# ─── Telegram ─────────────────────────────────────────────────────────────────
def send_telegram_notification(text: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
    except Exception:
        pass


# ─── Email: reporte individual de planta ─────────────────────────────────────
def send_email_plant_report(html_content, plant_name, power_path, month_path):
    if not SMTP_USER or not SMTP_PASS or not EMAIL_TO:
        print(f"[Email - {plant_name}] SMTP no configurado en .env")
        return
    msg = MIMEMultipart("related")
    msg["Subject"] = f"SOLGER — Reporte Operativo: {plant_name}"
    msg["From"] = SMTP_USER; msg["To"] = EMAIL_TO
    alt = MIMEMultipart("alternative")
    msg.attach(alt); alt.attach(MIMEText(html_content, "html"))
    logo_path = get_logo_path()
    for path, cid in [(logo_path, "logo"), (power_path, "power_chart"), (month_path, "monthly_chart")]:
        if path and os.path.exists(path):
            with open(path, "rb") as f:
                img = MIMEImage(f.read())
                img.add_header("Content-ID", f"<{cid}>")
                img.add_header("Content-Disposition", "inline", filename=os.path.basename(path))
                msg.attach(img)
    try:
        srv = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        srv.starttls(); srv.login(SMTP_USER, SMTP_PASS)
        srv.sendmail(SMTP_USER, EMAIL_TO, msg.as_string()); srv.quit()
        print(f"  [OK] [Email] {plant_name} enviado correctamente.")
    except Exception as e:
        print(f"  [ERROR] [Email] {plant_name}: {e}")


# ─── Email: reporte ejecutivo del portafolio ─────────────────────────────────
def send_executive_email(html_content, portfolio_chart_path=None, hsp_chart_path=None):
    """Envía el reporte ejecutivo al gerente con gráficos embedded (CID)."""
    if not SMTP_USER or not SMTP_PASS or not EMAIL_TO:
        print("[Email Ejecutivo] SMTP no configurado en .env — revisar SMTP_PASS")
        return
    now_str = datetime.now().strftime('%d/%m/%Y')
    msg = MIMEMultipart("related")
    msg["Subject"] = f"SOLGER — Reporte Ejecutivo de Cierre | {now_str}"
    msg["From"] = SMTP_USER; msg["To"] = EMAIL_TO
    alt = MIMEMultipart("alternative")
    msg.attach(alt); alt.attach(MIMEText(html_content, "html"))
    logo_path = get_logo_path()
    for path, cid in [
        (logo_path,             "logo"),
        (portfolio_chart_path,  "portfolio_chart"),
        (hsp_chart_path,        "hsp_chart"),
    ]:
        if path and os.path.exists(path):
            with open(path, "rb") as f:
                img = MIMEImage(f.read())
                img.add_header("Content-ID", f"<{cid}>")
                img.add_header("Content-Disposition", "inline", filename=os.path.basename(path))
                msg.attach(img)
    try:
        srv = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        srv.starttls(); srv.login(SMTP_USER, SMTP_PASS)
        srv.sendmail(SMTP_USER, EMAIL_TO, msg.as_string()); srv.quit()
        print("  [OK] [Email Ejecutivo] Reporte enviado al gerente correctamente.")
    except Exception as e:
        print(f"  [ERROR] [Email Ejecutivo] Error: {e}")


# Alias para compatibilidad
def send_email_report(html_content):
    send_executive_email(html_content)


# ══════════════════════════════════════════════════════════════════════════════
#  PUNTO DE ENTRADA
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("=" * 62)
    print("  SOLGER — Generador de Reporte Ejecutivo de Cierre")
    print("=" * 62)

    # Forzar UTF-8 en stdout para compatibilidad con Windows
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')

    # ── 1. Obtener datos ──────────────────────────────────────────────────────
    print("\n[1/4] Consultando portafolio (backend proxy)...")
    data = fetch_data_from_proxy()
    if not data:
        print("  [WARN] Backend no disponible. Ejecuta: uvicorn main:app --port 8000")
    else:
        n = len(data.get("plants", []))
        print(f"  [OK] {n} plantas encontradas en el portafolio.")

    print("[2/4] Consultando alarmas activas...")
    alarms_data = fetch_alerts_from_proxy()
    if alarms_data:
        total_a = alarms_data.get("total", 0)
        a_rev   = sum(1 for a in alarms_data.get("alarms", []) if classify_alarm(a.get("alarmName",""), a.get("alarmCause","")) == "REVISAR")
        print(f"  [OK] {total_a} alarmas ({a_rev} operativas a revisar).")
    else:
        print("  [WARN] Sin respuesta de alarmas.")

    os.makedirs("data/processed", exist_ok=True)
    plants_dir = "data/processed/plants"
    os.makedirs(plants_dir, exist_ok=True)

    # ── 2. Preparar datos para gráficos ──────────────────────────────────────
    portfolio_chart_path = "data/processed/portfolio_chart.png"
    hsp_chart_path       = "data/processed/hsp_chart.png"
    logo_path            = get_logo_path()
    kpi_map              = {}

    if data:
        kpi_map = {
            (k.get("plantCode") or k.get("stationCode")): k.get("dataItemMap", {})
            for k in data.get("kpis", [])
        }
        plants_chart_data = []
        for p in data.get("plants", []):
            dim    = kpi_map.get(p.get("plantCode"), {})
            cap    = float(p.get("capacity") or 0)
            day_p  = float(dim.get("day_power") or 0)
            health = dim.get("real_health_state", 0)
            exp    = cap * HSP_REF * EFF if cap > 0 else 0
            pr     = (day_p / exp * 100) if (exp > 0) else None
            hsp_r  = (day_p / (cap * EFF)) if (cap > 0 and day_p > 0) else None
            plants_chart_data.append({
                "name": p.get("plantName", ""),
                "day_power": day_p, "capacity": cap, "health": health,
                "pr": pr, "hsp_real": hsp_r, "expected": exp,
            })

        print("[3/4] Generando graficos del portafolio...")
        sorted_data = sorted(plants_chart_data, key=lambda x: -x['day_power'])
        ok1 = generate_portfolio_chart(sorted_data, portfolio_chart_path)
        ok2 = generate_hsp_chart(plants_chart_data, hsp_chart_path)
        print(f"  [OK] Grafico portafolio: {'generado' if ok1 else 'sin datos'}")
        print(f"  [OK] Grafico HSP:        {'generado' if ok2 else 'sin datos (sin cap. configurada)'}")
    else:
        print("[3/4] Sin datos — omitiendo gráficos.")

    # ── 3. Reporte ejecutivo ──────────────────────────────────────────────────
    print("[4/4] Construyendo reporte ejecutivo HTML...")
    logo_b64 = get_base64_image(logo_path)
    port_b64 = get_base64_image(portfolio_chart_path)
    hsp_b64  = get_base64_image(hsp_chart_path)

    # Versión para guardar en disco (con base64 para visualización directa en navegador)
    html_exec_file = build_executive_html_report(
        data,
        alarms_data,
        logo_src=logo_b64 or "cid:logo",
        portfolio_chart_src=port_b64 or "cid:portfolio_chart",
        hsp_chart_src=hsp_b64 or "cid:hsp_chart",
    )
    ts        = datetime.now().strftime('%Y%m%d_%H%M%S')
    exec_path = f"data/processed/reporte_ejecutivo_{ts}.html"
    with open(exec_path, "w", encoding="utf-8") as f:
        f.write(html_exec_file)
    print(f"  [OK] Guardado en: {exec_path}")

    # Versión para email con CID
    html_exec_email = build_executive_html_report(
        data,
        alarms_data,
        logo_src="cid:logo",
        portfolio_chart_src="cid:portfolio_chart",
        hsp_chart_src="cid:hsp_chart",
    )

    # ── 4. Reportes individuales por planta ───────────────────────────────────
    if data and data.get("plants"):
        print(f"\nGenerando reportes individuales por planta ({len(data['plants'])})...")
        for p in data["plants"]:
            pcode = p.get("plantCode")
            dim   = kpi_map.get(pcode, {})
            safe  = get_safe_filename(p.get("plantName", pcode or "planta"))
            print(f"  -> {p.get('plantName', pcode)}")
            day_s, month_s = fetch_series_from_proxy(pcode)
            pwr_p = f"{plants_dir}/{safe}_power.png"
            mon_p = f"{plants_dir}/{safe}_monthly.png"
            generate_power_chart(day_s, pwr_p, month_data=month_s)
            generate_monthly_chart(month_s, mon_p)

            pwr_b64 = get_base64_image(pwr_p)
            mon_b64 = get_base64_image(mon_p)

            # Archivo local con imágenes base64
            p_html_file = build_plant_html_report(
                p,
                dim,
                logo_src=logo_b64 or "cid:logo",
                power_chart_src=pwr_b64 or "cid:power_chart",
                monthly_chart_src=mon_b64 or "cid:monthly_chart",
            )
            with open(f"{plants_dir}/{safe}.html", "w", encoding="utf-8") as f:
                f.write(p_html_file)

            # Para email con CID
            p_html_email = build_plant_html_report(
                p,
                dim,
                logo_src="cid:logo",
                power_chart_src="cid:power_chart",
                monthly_chart_src="cid:monthly_chart",
            )
            send_email_plant_report(p_html_email, p.get("plantName"), pwr_p, mon_p)
        print(f"  [OK] Reportes individuales en: {plants_dir}/")

    # ── 5. Enviar reporte ejecutivo al gerente ────────────────────────────────
    print("\nEnviando reporte ejecutivo al gerente...")
    send_executive_email(html_exec_email, portfolio_chart_path, hsp_chart_path)

    # ── 6. Telegram ───────────────────────────────────────────────────────────
    smry  = (data or {}).get("summary", {})
    n_tot = (alarms_data or {}).get("total", 0)
    n_rev = sum(1 for a in (alarms_data or {}).get("alarms", [])
                if classify_alarm(a.get("alarmName",""), a.get("alarmCause","")) == "REVISAR")
    avg_h  = sum(
        float(kpi_map.get(p.get("plantCode"), {}).get("day_power") or 0)
        / (float(p.get("capacity") or 1) * EFF)
        for p in (data or {}).get("plants", [])
        if float(p.get("capacity") or 0) > 0 and float(kpi_map.get(p.get("plantCode"), {}).get("day_power") or 0) > 0
    )
    n_hsp = sum(1 for p in (data or {}).get("plants", [])
                if float(p.get("capacity") or 0) > 0 and float(kpi_map.get(p.get("plantCode"), {}).get("day_power") or 0) > 0)
    hsp_t = f"{avg_h / n_hsp:.1f} h/día" if n_hsp > 0 else "N/D"

    telegram_text = (
        f"<b>☀️ SOLGER — Cierre Operativo Diario</b>\n\n"
        f"⚡ <b>Generación Hoy:</b> {smry.get('totalEnergyToday_kWh', 0):.1f} kWh\n"
        f"🔆 <b>HSP Real Prom.:</b> {hsp_t}\n"
        f"🏭 <b>Plantas Activas:</b> {smry.get('activePlants', 0)}/{smry.get('totalPlants', 0)}\n"
        f"🌱 <b>CO₂ Evitado:</b> {smry.get('co2Avoided_ton', 0):.2f} t acumuladas\n"
        f"🔴 <b>Alarmas:</b> {n_rev} operativas a revisar / {n_tot} total\n\n"
        f"<i>Reporte ejecutivo enviado al gerente por correo.</i>"
    )
    send_telegram_notification(telegram_text)

    print("\n" + "=" * 62)
    print("  [OK] Proceso completado. Revisa tu correo.")
    print("=" * 62)
