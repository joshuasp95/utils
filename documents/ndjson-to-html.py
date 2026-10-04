#!/usr/bin/env python3
"""
ndjson-to-html.py — Convierte un NDJSON de registros de tiempo (imputaciones) en un informe HTML autocontenido.

Qué hace:     Lee un fichero NDJSON (un objeto JSON por línea) con entradas de tiempo y genera un
              HTML con: resumen de totales, balance mensual/semanal frente a una jornada de 8 h
              (lunes-viernes), vista calendario coloreada y detalle por día.
              OJO: no es un visor NDJSON genérico; espera los campos de imputación descritos abajo.
Requisitos:   Python 3.10+ (solo librería estándar).
Uso:          python3 ndjson-to-html.py datos/imputaciones-2026-02.ndjson
              python3 ndjson-to-html.py datos/imputaciones.ndjson -o informe.html
              python3 ndjson-to-html.py datos/imputaciones.ndjson --highlight-months 2026-04,2026-05
Variables:    input                (posicional) ruta al .ndjson.
              -o / --output        ruta del HTML (por defecto: mismo nombre con .html junto al .ndjson).
              --highlight-months   lista YYYY-MM separada por comas; añade una tarjeta con el balance
                                   combinado de esos meses (opcional).
              Campos por línea:    date (YYYY-MM-DD, obligatorio), hours (número, obligatorio),
                                   type ("Break", "Absence", "Sickness", "Vacation", "Public Holiday"
                                   o cualquier otro = trabajo), project, task, client, start, end, weekday.
Efectos:      ESCRIBE: el fichero HTML de salida (lo sobrescribe si existe). No modifica el NDJSON.
Salida:       HTML autocontenido (CSS en línea, sin JS ni recursos externos).
"""

import argparse
import calendar
import json
import sys
from collections import defaultdict
from datetime import date as date_cls, timedelta
from pathlib import Path


MONTHS_ES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


# ── helpers ──────────────────────────────────────────────────────────────────

def load_entries(path: Path) -> list[dict]:
    entries = []
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"[WARN] línea {lineno} ignorada: {e}", file=sys.stderr)
    return entries


def fmt_hours(h: float) -> str:
    """Formatea horas como '2h 30m' para lectura humana."""
    total_min = round(h * 60)
    if total_min == 0:
        return "0h"
    hh, mm = divmod(total_min, 60)
    if hh and mm:
        return f"{hh}h {mm:02d}m"
    if hh:
        return f"{hh}h"
    return f"{mm}m"


def fmt_delta(h: float) -> str:
    """Formatea diferencias de horas con signo."""
    total_min = round(h * 60)
    if total_min == 0:
        return "0h"
    sign = "+" if total_min > 0 else "-"
    return f"{sign}{fmt_hours(abs(total_min) / 60)}"


def month_label(date_str: str) -> str:
    """'2026-02-03'  →  'Febrero 2026'"""
    y, m, _ = date_str.split("-")
    return f"{MONTHS_ES[int(m)]} {y}"


def period_label(entries: list[dict]) -> str:
    """Devuelve una etiqueta de mes o rango para el conjunto de entradas."""
    if not entries:
        return "Imputaciones"
    months = sorted({e["date"][:7] for e in entries})
    if len(months) == 1:
        return month_label(entries[0]["date"])
    years = sorted({m[:4] for m in months})
    if len(years) == 1:
        return years[0]
    return f"{months[0]} – {months[-1]}"


def is_break(entry: dict) -> bool:
    return entry.get("type") == "Break"


def is_absence(entry: dict) -> bool:
    entry_type = entry.get("type", "")
    return entry_type in {"Absence", "Sickness", "Vacation", "Public Holiday"}


def is_public_holiday(entry: dict) -> bool:
    if entry.get("type") == "Public Holiday":
        return True
    task = entry.get("task", "").lower()
    return is_absence(entry) and ("public holiday" in task or "festivo" in task)


def is_counted_absence(entry: dict) -> bool:
    """Sickness/vacaciones/permisos cubren jornada; festivos reducen objetivo."""
    return is_absence(entry) and not is_public_holiday(entry)


def is_work_entry(entry: dict) -> bool:
    return not is_break(entry) and not is_absence(entry)


def day_status(work_hours: float, absence_hours: float = 0.0) -> tuple[str, str]:
    """Devuelve clase CSS y etiqueta de balance respecto a 8h cubiertas."""
    covered_hours = work_hours + absence_hours
    balance = round(covered_hours - 8.0, 10)
    if absence_hours > 0 and balance >= 0:
        return "day-absence", f"Aus. {fmt_hours(absence_hours)}"
    if balance > 0:
        return "day-over", f"+{fmt_hours(balance)}"
    if balance < 0:
        return "day-under", f"-{fmt_hours(abs(balance))}"
    return "day-ok", "OK"


def parse_date(date_str: str) -> date_cls:
    return date_cls.fromisoformat(date_str)


def workdays_between(start: date_cls, end: date_cls) -> int:
    """Cuenta lunes-viernes entre dos fechas inclusive."""
    total = 0
    current = start
    while current <= end:
        if current.weekday() < 5:
            total += 1
        current += timedelta(days=1)
    return total


# ── HTML builder ─────────────────────────────────────────────────────────────

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f5f7fa;
    color: #1a1a2e;
    padding: 2rem 1.5rem;
}
h1 {
    font-size: 1.8rem;
    margin-bottom: 1.25rem;
    color: #2c3e50;
    border-bottom: 3px solid #3498db;
    padding-bottom: .5rem;
    display: inline-block;
}
.day-block {
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,.08);
    margin-bottom: 1.5rem;
    overflow: hidden;
}
.day-header {
    background: #2c3e50;
    color: #fff;
    padding: .65rem 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.day-block.day-over .day-header { background: #7a4b00; }
.day-block.day-under .day-header { background: #8a1f17; }
.day-block.day-ok .day-header { background: #1f5f46; }
.day-block.day-absence .day-header { background: #1d4ed8; }
.day-header .date { font-size: 1.05rem; font-weight: 600; text-transform: capitalize; }
.day-header .day-total {
    font-size: .9rem;
    background: #3498db;
    border-radius: 20px;
    padding: .2rem .75rem;
}
.day-block.day-over .day-total { background: #f59e0b; color: #221400; }
.day-block.day-under .day-total { background: #ef4444; }
.day-block.day-ok .day-total { background: #22c55e; color: #052e16; }
.day-block.day-absence .day-total { background: #93c5fd; color: #172554; }
.balance-note {
    font-size: .8rem;
    opacity: .9;
    margin-left: .35rem;
}
table {
    width: 100%;
    border-collapse: collapse;
    font-size: .875rem;
}
th {
    background: #ecf0f1;
    text-align: left;
    padding: .5rem .8rem;
    font-weight: 600;
    color: #555;
    text-transform: uppercase;
    font-size: .75rem;
    letter-spacing: .04em;
}
td { padding: .5rem .8rem; border-bottom: 1px solid #f0f0f0; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f7fbff; }
.pill {
    display: inline-block;
    padding: .15rem .55rem;
    border-radius: 12px;
    font-size: .75rem;
    font-weight: 500;
    white-space: nowrap;
}
.pill-type  { background: #eaf4fb; color: #1a6fa3; }
.pill-project { background: #eafaf1; color: #1a7a4a; }
.hours-cell { font-weight: 600; white-space: nowrap; }
.summary {
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,.08);
    padding: 1rem 1.5rem;
    margin-bottom: 2rem;
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
    align-items: center;
}
.summary-item { display: flex; flex-direction: column; align-items: center; }
.summary-item .label { font-size: .75rem; color: #777; text-transform: uppercase; letter-spacing: .05em; }
.summary-item .value { font-size: 1.6rem; font-weight: 700; color: #2c3e50; }
.legend {
    display: flex;
    gap: .75rem;
    flex-wrap: wrap;
    margin-top: -.75rem;
    margin-bottom: 1.5rem;
    color: #455;
    font-size: .85rem;
}
.legend-item { display: flex; align-items: center; gap: .35rem; }
.legend-swatch { width: .85rem; height: .85rem; border-radius: 999px; display: inline-block; }
.legend-ok { background: #22c55e; }
.legend-over { background: #f59e0b; }
.legend-under { background: #ef4444; }
.legend-absence { background: #3b82f6; }
.calendar-overview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}
.month-card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,.08);
    overflow: hidden;
}
.month-title {
    background: #24364a;
    color: #fff;
    font-weight: 700;
    padding: .6rem .8rem;
    text-transform: capitalize;
}
.month-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 1px;
    background: #e8eef5;
    padding: 1px;
}
.weekday-cell,
.calendar-day {
    background: #fff;
    min-height: 3.2rem;
    padding: .35rem;
}
.weekday-cell {
    min-height: auto;
    text-align: center;
    color: #5a6b7d;
    font-size: .72rem;
    font-weight: 700;
    text-transform: uppercase;
}
.calendar-day {
    color: #2c3e50;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
}
.calendar-day.empty {
    background: #f3f6f9;
    color: #b5c0ca;
}
.calendar-day.weekend { background: #fafafa; color: #9aa6b2; }
.calendar-day.day-ok { background: #dcfce7; color: #14532d; }
.calendar-day.day-over { background: #fef3c7; color: #78350f; }
.calendar-day.day-under { background: #fee2e2; color: #7f1d1d; }
.calendar-day.day-absence { background: #dbeafe; color: #1e3a8a; }
.calendar-day:hover { outline: 2px solid #3498db; outline-offset: -2px; }
.day-number { font-weight: 700; line-height: 1; }
.day-hours { font-size: .78rem; font-weight: 700; }
.day-balance { font-size: .7rem; opacity: .85; }
.section-title {
    color: #2c3e50;
    font-size: 1.15rem;
    margin: 1rem 0 .9rem;
}
.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
}
.stats-card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,.08);
    overflow: hidden;
}
.stats-card h3 {
    background: #2c3e50;
    color: #fff;
    font-size: 1rem;
    padding: .65rem .9rem;
}
.stats-card table { box-shadow: none; border-radius: 0; }
.number-cell { text-align: right; white-space: nowrap; }
.balance-positive { color: #067647; font-weight: 700; }
.balance-negative { color: #b42318; font-weight: 700; }
.balance-zero { color: #455; font-weight: 700; }
.balance-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: .75rem;
    margin-bottom: 1.25rem;
}
.balance-summary-card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,.08);
    padding: .9rem 1rem;
    border-left: 5px solid #94a3b8;
}
.balance-summary-card.negative { border-left-color: #ef4444; }
.balance-summary-card.positive { border-left-color: #22c55e; }
.balance-summary-card.zero { border-left-color: #64748b; }
.balance-summary-title {
    color: #64748b;
    font-size: .75rem;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
}
.balance-summary-value {
    font-size: 1.45rem;
    font-weight: 800;
    margin-top: .15rem;
}
.balance-summary-note {
    color: #64748b;
    font-size: .8rem;
    margin-top: .25rem;
}
@media (max-width: 640px) {
    body { padding: 1rem .75rem; }
    .stats-grid { grid-template-columns: 1fr; }
    .stats-card { overflow-x: auto; }
    .calendar-overview { grid-template-columns: 1fr; }
}
"""


def months_for_calendar(entries: list[dict]) -> list[tuple[int, int]]:
    """Devuelve meses a pintar; para un anual muestra los 12 meses."""
    months = sorted({e["date"][:7] for e in entries})
    if not months:
        return []
    years = sorted({int(m[:4]) for m in months})
    if len(years) == 1 and len(months) > 1:
        return [(years[0], month) for month in range(1, 13)]
    return [(int(m[:4]), int(m[5:7])) for m in months]


def build_calendar_overview(by_day: dict[str, list[dict]]) -> str:
    """Construye una vista mensual/semanal compacta con enlaces al detalle."""
    if not by_day:
        return ""

    day_work_totals = {
        day: sum(e["hours"] for e in entries if is_work_entry(e))
        for day, entries in by_day.items()
    }
    day_absence_totals = {
        day: sum(e["hours"] for e in entries if is_absence(e))
        for day, entries in by_day.items()
    }
    cal = calendar.Calendar(firstweekday=0)
    weekday_headers = ["L", "M", "X", "J", "V", "S", "D"]
    month_cards = []

    flat_entries = [entry for entries in by_day.values() for entry in entries]
    for year, month in months_for_calendar(flat_entries):
        cells = [f'<div class="weekday-cell">{label}</div>' for label in weekday_headers]
        for current_day in cal.itermonthdates(year, month):
            if current_day.month != month:
                cells.append('<div class="calendar-day empty"></div>')
                continue

            date_key = current_day.isoformat()
            day_num = current_day.day
            is_weekend = current_day.weekday() >= 5
            if date_key in day_work_totals or date_key in day_absence_totals:
                work_hours = day_work_totals.get(date_key, 0.0)
                absence_hours = day_absence_totals.get(date_key, 0.0)
                day_class, balance_label = day_status(work_hours, absence_hours)
                hours_label = fmt_hours(work_hours)
                if absence_hours and not work_hours:
                    hours_label = fmt_hours(absence_hours)
                elif absence_hours:
                    hours_label = f"{fmt_hours(work_hours)} + {fmt_hours(absence_hours)}"
                cells.append(f"""
                <a class="calendar-day {day_class}" href="#day-{date_key}">
                    <span class="day-number">{day_num}</span>
                    <span class="day-hours">{hours_label}</span>
                    <span class="day-balance">{balance_label}</span>
                </a>""")
                continue

            weekend_class = " weekend" if is_weekend else ""
            cells.append(f"""
            <div class="calendar-day empty{weekend_class}">
                <span class="day-number">{day_num}</span>
            </div>""")

        month_cards.append(f"""
        <section class="month-card">
            <div class="month-title">{MONTHS_ES[month]} {year}</div>
            <div class="month-grid">{''.join(cells)}</div>
        </section>""")

    return f"""
    <h2 class="section-title">Vista calendario</h2>
    <div class="calendar-overview">{''.join(month_cards)}</div>"""


def period_stats(entries: list[dict], start: date_cls, end: date_cls) -> dict:
    base_hours = workdays_between(start, end) * 8.0
    project_hours = sum(e["hours"] for e in entries if is_work_entry(e))
    counted_absence_hours = sum(e["hours"] for e in entries if is_counted_absence(e))
    public_holiday_hours = sum(e["hours"] for e in entries if is_public_holiday(e))
    target_hours = max(0.0, base_hours - public_holiday_hours)
    covered_hours = project_hours + counted_absence_hours
    balance = round(covered_hours - target_hours, 10)
    return {
        "base": base_hours,
        "public_holiday": public_holiday_hours,
        "target": target_hours,
        "project": project_hours,
        "counted_absence": counted_absence_hours,
        "covered": covered_hours,
        "balance": balance,
    }


def balance_class(balance: float) -> str:
    return (
        "balance-positive" if balance > 0
        else "balance-negative" if balance < 0
        else "balance-zero"
    )


def summary_class(balance: float) -> str:
    return "positive" if balance > 0 else "negative" if balance < 0 else "zero"


def period_row(label: str, stats: dict) -> str:
    balance = stats["balance"]
    balance_class = (
        "balance-positive" if balance > 0
        else "balance-negative" if balance < 0
        else "balance-zero"
    )
    return f"""
        <tr>
            <td>{label}</td>
            <td class="number-cell">{fmt_hours(stats["base"])}</td>
            <td class="number-cell">{fmt_hours(stats["public_holiday"])}</td>
            <td class="number-cell">{fmt_hours(stats["target"])}</td>
            <td class="number-cell">{fmt_hours(stats["project"])}</td>
            <td class="number-cell">{fmt_hours(stats["counted_absence"])}</td>
            <td class="number-cell">{fmt_hours(stats["covered"])}</td>
            <td class="number-cell {balance_class}">{fmt_delta(balance)}</td>
        </tr>"""


def build_balance_summary(month_stats: dict[tuple[int, int], dict],
                          highlight_months: list[tuple[int, int]] | None = None) -> str:
    if not month_stats:
        return ""

    all_balance = round(sum(stats["balance"] for stats in month_stats.values()), 10)

    # Tarjeta opcional: balance combinado de los meses pedidos con --highlight-months.
    highlight_html = ""
    if highlight_months:
        wanted = set(highlight_months)
        highlight_balance = round(sum(
            stats["balance"]
            for key, stats in month_stats.items()
            if key in wanted
        ), 10)
        highlight_label = " + ".join(f"{MONTHS_ES[m]} {y}" for y, m in sorted(wanted))
        highlight_html = f"""
        <div class="balance-summary-card {summary_class(highlight_balance)}">
            <div class="balance-summary-title">{highlight_label}</div>
            <div class="balance-summary-value {balance_class(highlight_balance)}">{fmt_delta(highlight_balance)}</div>
            <div class="balance-summary-note">Saldo combinado de los meses seleccionados</div>
        </div>"""

    monthly_cards = []
    for (year, month), stats in sorted(month_stats.items()):
        balance = stats["balance"]
        monthly_cards.append(f"""
        <div class="balance-summary-card {summary_class(balance)}">
            <div class="balance-summary-title">{MONTHS_ES[month]} {year}</div>
            <div class="balance-summary-value {balance_class(balance)}">{fmt_delta(balance)}</div>
            <div class="balance-summary-note">
                Objetivo {fmt_hours(stats["target"])} · Cubierto {fmt_hours(stats["covered"])}
            </div>
        </div>""")

    return f"""
    <h2 class="section-title">Resumen de balances</h2>
    <div class="balance-summary">
        <div class="balance-summary-card {summary_class(all_balance)}">
            <div class="balance-summary-title">Balance total del HTML</div>
            <div class="balance-summary-value {balance_class(all_balance)}">{fmt_delta(all_balance)}</div>
            <div class="balance-summary-note">Suma de todos los meses cargados</div>
        </div>
        {highlight_html}
        {''.join(monthly_cards)}
    </div>"""


def build_stats_tables(entries: list[dict],
                       highlight_months: list[tuple[int, int]] | None = None) -> str:
    if not entries:
        return ""

    monthly_entries: dict[tuple[int, int], list[dict]] = defaultdict(list)
    weekly_entries: dict[date_cls, list[dict]] = defaultdict(list)
    for entry in entries:
        current_day = parse_date(entry["date"])
        monthly_entries[(current_day.year, current_day.month)].append(entry)
        week_start = current_day - timedelta(days=current_day.weekday())
        weekly_entries[week_start].append(entry)

    month_rows = []
    month_stats = {}
    for (year, month), month_entries in sorted(monthly_entries.items()):
        start = date_cls(year, month, 1)
        end = date_cls(year, month, calendar.monthrange(year, month)[1])
        label = f"{MONTHS_ES[month]} {year}"
        stats = period_stats(month_entries, start, end)
        month_stats[(year, month)] = stats
        month_rows.append(period_row(label, stats))

    week_rows = []
    for week_start, week_entries in sorted(weekly_entries.items()):
        week_end = week_start + timedelta(days=6)
        label = f"{week_start.isoformat()} - {week_end.isoformat()}"
        week_rows.append(period_row(label, period_stats(week_entries, week_start, week_end)))

    header = """
        <tr>
            <th>Periodo</th>
            <th>Base</th>
            <th>Festivos</th>
            <th>Objetivo real</th>
            <th>Proyecto</th>
            <th>Sickness/Vac./Permisos</th>
            <th>Cubierto</th>
            <th>Balance</th>
        </tr>"""

    return f"""
    {build_balance_summary(month_stats, highlight_months)}
    <h2 class="section-title">Estadísticas de jornada</h2>
    <div class="stats-grid">
        <section class="stats-card">
            <h3>Por mes</h3>
            <table>
                <thead>{header}</thead>
                <tbody>{''.join(month_rows)}</tbody>
            </table>
        </section>
        <section class="stats-card">
            <h3>Por semana</h3>
            <table>
                <thead>{header}</thead>
                <tbody>{''.join(week_rows)}</tbody>
            </table>
        </section>
    </div>"""


def build_html(entries: list[dict], source_file: str,
               highlight_months: list[tuple[int, int]] | None = None) -> str:
    # Agrupa por fecha, mantiene orden de aparición
    by_day: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_day[e["date"]].append(e)

    title = period_label(entries)
    total_hours = sum(e["hours"] for e in entries if is_work_entry(e))
    total_break_hours = sum(e["hours"] for e in entries if is_break(e))
    total_absence_hours = sum(e["hours"] for e in entries if is_absence(e))
    total_hours_with_breaks = total_hours + total_break_hours
    total_days = len(by_day)
    total_entries = len(entries)

    rows_html = []
    for date, day_entries in sorted(by_day.items()):
        day_hours = sum(e["hours"] for e in day_entries if is_work_entry(e))
        day_absence_hours = sum(e["hours"] for e in day_entries if is_absence(e))
        day_class, balance_label = day_status(day_hours, day_absence_hours)
        weekday = day_entries[0].get("weekday", "")
        _, m, d = date.split("-")
        day_label = f"{weekday.capitalize()}  {int(d)}/{int(m)}"
        day_total_label = fmt_hours(day_hours)
        if day_absence_hours:
            day_total_label = (
                f"{fmt_hours(day_hours)} trabajo · {fmt_hours(day_absence_hours)} ausencia"
                if day_hours else f"{fmt_hours(day_absence_hours)} ausencia"
            )

        trs = []
        for e in day_entries:
            task = e.get("task", "")
            project = e.get("project", "")
            etype = e.get("type", "")
            start = e.get("start", "")
            end = e.get("end", "")
            hours = e.get("hours", 0)
            client = e.get("client", "")

            trs.append(f"""
            <tr>
                <td>{start} – {end}</td>
                <td class="hours-cell">{fmt_hours(hours)}</td>
                <td><span class="pill pill-project">{project}</span></td>
                <td><span class="pill pill-type">{etype}</span></td>
                <td>{task}</td>
                <td style="color:#999;font-size:.8rem">{client}</td>
            </tr>""")

        rows_html.append(f"""
    <div class="day-block {day_class}" id="day-{date}">
        <div class="day-header">
            <span class="date">{day_label}</span>
            <span class="day-total">{day_total_label} <span class="balance-note">{balance_label}</span></span>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Horario</th>
                    <th>Duración</th>
                    <th>Proyecto</th>
                    <th>Tipo</th>
                    <th>Tarea</th>
                    <th>Cliente</th>
                </tr>
            </thead>
            <tbody>{''.join(trs)}
            </tbody>
        </table>
    </div>""")

    summary_html = f"""
    <div class="summary">
        <div class="summary-item">
            <span class="label">Total trabajo</span>
            <span class="value">{fmt_hours(total_hours)}</span>
        </div>
        <div class="summary-item">
            <span class="label">Con breaks</span>
            <span class="value">{fmt_hours(total_hours_with_breaks)}</span>
        </div>
        <div class="summary-item">
            <span class="label">Ausencias</span>
            <span class="value">{fmt_hours(total_absence_hours)}</span>
        </div>
        <div class="summary-item">
            <span class="label">Días con registros</span>
            <span class="value">{total_days}</span>
        </div>
        <div class="summary-item">
            <span class="label">Entradas</span>
            <span class="value">{total_entries}</span>
        </div>
    </div>"""

    legend_html = """
    <div class="legend">
        <span class="legend-item"><span class="legend-swatch legend-ok"></span>8h exactas</span>
        <span class="legend-item"><span class="legend-swatch legend-over"></span>Exceso sobre 8h</span>
        <span class="legend-item"><span class="legend-swatch legend-under"></span>Déficit sobre 8h</span>
        <span class="legend-item"><span class="legend-swatch legend-absence"></span>Ausencia / sickness / vacaciones</span>
    </div>"""
    calendar_html = build_calendar_overview(by_day)
    stats_html = build_stats_tables(entries, highlight_months)

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Imputaciones – {title}</title>
    <style>{CSS}</style>
</head>
<body>
    <h1>Imputaciones – {title}</h1>
    {summary_html}
    {legend_html}
    {stats_html}
    {calendar_html}
    <h2 class="section-title">Detalle por día</h2>
    {''.join(rows_html)}
    <p style="margin-top:1rem;font-size:.75rem;color:#bbb">Generado desde {source_file}</p>
</body>
</html>
"""


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Convierte un NDJSON de imputaciones a HTML legible.")
    parser.add_argument(
        "input", help="Ruta al archivo .ndjson (ej: datos/imputaciones-2026-02.ndjson)")
    parser.add_argument(
        "-o", "--output", help="Ruta del HTML de salida (por defecto: mismo nombre .html junto al .ndjson)")
    parser.add_argument(
        "--highlight-months",
        help="Meses YYYY-MM separados por comas para una tarjeta de balance combinado (ej: 2026-04,2026-05)")
    args = parser.parse_args()

    highlight_months = None
    if args.highlight_months:
        try:
            highlight_months = [
                (int(item[:4]), int(item[5:7]))
                for item in (part.strip() for part in args.highlight_months.split(","))
                if item
            ]
        except ValueError:
            print("Error: --highlight-months debe ser una lista YYYY-MM separada por comas", file=sys.stderr)
            sys.exit(1)

    input_path = Path(args.input)
    if not input_path.exists():
        print(
            f"Error: no se encuentra el archivo '{input_path}'", file=sys.stderr)
        sys.exit(1)

    output_path = Path(
        args.output) if args.output else input_path.with_suffix(".html")

    entries = load_entries(input_path)
    if not entries:
        print("Error: el archivo está vacío o no contiene JSON válido.",
              file=sys.stderr)
        sys.exit(1)

    html = build_html(entries, str(input_path), highlight_months)
    output_path.write_text(html, encoding="utf-8")
    work_hours = sum(e["hours"] for e in entries if is_work_entry(e))
    print(
        f"HTML generado → {output_path}  ({len(entries)} entradas, {fmt_hours(work_hours)} de trabajo)")


if __name__ == "__main__":
    main()
