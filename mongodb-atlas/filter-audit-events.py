#!/usr/bin/env python3
# filter-audit-events.py — filtra logs de auditoría de MongoDB/Atlas por colección y operación.
#
# Qué hace:     Lee ficheros de texto, .gz o carpetas (recursivo) con audit logs JSON-lines o
#               logs de servidor mongod con un objeto JSON por línea, y se queda con los eventos
#               de escritura/DDL (insert, update, delete, drop, createIndexes...) sobre las
#               colecciones indicadas. Útil para responder "¿quién tocó la colección X y cuándo?".
# Requisitos:   Python 3.9+ (solo librería estándar).
#               Los audit logs se descargan antes, p.ej.:
#               atlas logs download <HOSTNAME> mongodb-audit-log.gz --projectId <PROJECT_ID>
# Uso:          ./filter-audit-events.py <FICHERO_O_CARPETA>... [--collections C1 C2] [--commands ...]
#                                        [--format csv|jsonl|summary]
#               ./filter-audit-events.py ./audit-logs/ --collections orders customers --format summary
#               ./filter-audit-events.py audit.log.gz --commands drop dropCollection --format jsonl
# Variables:    inputs         ficheros o carpetas a leer (obligatorio, uno o más).
#               --collections  nombres de colección (sin la BD) a conservar. Si se omite, NO se
#                              filtra por colección (entran todas).
#               --commands     comandos/atypes a conservar. Por defecto: escrituras y DDL
#                              (ver DEFAULT_COMMANDS).
#               --format       csv (por defecto) | jsonl (un JSON por línea) | summary (conteos).
# Efectos:      SOLO LECTURA (lee ficheros locales; no conecta a ninguna base de datos).
# Salida:       Por stdout. Código 0 si hubo coincidencias, 1 si no hubo ninguna.

"""Filter MongoDB Atlas audit logs for selected collections and operations.

Reads plain text, .gz files, or directories. It accepts JSON-lines audit logs
and MongoDB server logs that contain a JSON object per line.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


# Comandos de escritura y DDL (cambios de estructura) que interesan por defecto.
# En el audit log aparecen como param.command (eventos authCheck) o como atype.
DEFAULT_COMMANDS = {
    "insert",
    "update",
    "delete",
    "findAndModify",
    "create",
    "createCollection",
    "drop",
    "dropCollection",
    "createIndexes",
    "createIndex",
    "dropIndexes",
    "dropIndex",
    "renameCollection",
}


def iter_paths(inputs: list[str]) -> Iterable[Path]:
    for raw in inputs:
        path = Path(raw)
        if path.is_dir():
            for child in sorted(path.rglob("*")):
                if child.is_file():
                    yield child
        elif path.is_file():
            yield path
        else:
            print(f"warning: path not found: {path}", file=sys.stderr)


def open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("rt", encoding="utf-8", errors="replace")


def extract_json(line: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass

    start = line.find("{")
    if start == -1:
        return None
    try:
        obj = json.loads(line[start:])
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def nested(obj: dict[str, Any], *keys: str) -> Any:
    current: Any = obj
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def event_time(event: dict[str, Any]) -> str:
    ts = event.get("ts")
    if isinstance(ts, dict):
        return str(ts.get("$date") or ts.get("date") or "")
    return str(ts or event.get("t") or event.get("timestamp") or "")


def user_list(event: dict[str, Any]) -> str:
    users = event.get("users")
    if not isinstance(users, list):
        return ""
    values = []
    for user in users:
        if isinstance(user, dict):
            name = user.get("user")
            db = user.get("db")
            values.append(f"{name}@{db}" if name and db else str(user))
    return ";".join(values)


def remote(event: dict[str, Any]) -> str:
    value = event.get("remote")
    if isinstance(value, dict):
        ip = value.get("ip")
        port = value.get("port")
        if ip and port:
            return f"{ip}:{port}"
        if ip:
            return str(ip)
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if isinstance(value, str):
        return value
    attr = nested(event, "attr")
    if isinstance(attr, dict):
        return str(attr.get("remote") or attr.get("client") or "")
    return ""


def command_name(event: dict[str, Any]) -> str:
    param_command = nested(event, "param", "command")
    if param_command:
        return str(param_command)
    attr_command = nested(event, "attr", "command")
    if isinstance(attr_command, dict):
        for key in DEFAULT_COMMANDS:
            if key in attr_command:
                return key
    return str(event.get("atype") or nested(event, "attr", "type") or "")


def namespace(event: dict[str, Any]) -> str:
    param_ns = nested(event, "param", "ns")
    if param_ns:
        return str(param_ns)
    attr_ns = nested(event, "attr", "ns")
    if attr_ns:
        return str(attr_ns)
    return str(event.get("ns") or "")


def collection_from_event(event: dict[str, Any], ns: str, command: str) -> str:
    if "." in ns:
        return ns.rsplit(".", 1)[1]
    args = nested(event, "param", "args")
    if isinstance(args, dict):
        for key in (command, "create", "drop", "createIndexes", "dropIndexes"):
            value = args.get(key)
            if isinstance(value, str):
                return value
        rename_to = args.get("to")
        if command == "renameCollection" and isinstance(rename_to, str):
            return rename_to.rsplit(".", 1)[-1]
    return ""


def row_for(path: Path, event: dict[str, Any]) -> dict[str, str]:
    command = command_name(event)
    ns = namespace(event)
    row = {
        "file": str(path),
        "timestamp": event_time(event),
        "atype": str(event.get("atype") or ""),
        "command": command,
        "ns": ns,
        "database": ns.split(".", 1)[0] if "." in ns else "",
        "collection": collection_from_event(event, ns, command),
        "users": user_list(event),
        "remote": remote(event),
        "result": str(event.get("result") if event.get("result") is not None else ""),
        "param": json.dumps(event.get("param", {}), ensure_ascii=False, sort_keys=True),
    }
    return row


def matches(row: dict[str, str], collections: set[str] | None, commands: set[str]) -> bool:
    # collections=None → sin filtro por colección
    if collections is not None and row["collection"] not in collections:
        return False
    if row["atype"] == "authCheck":
        return row["command"] in commands
    return row["atype"] in commands or row["command"] in commands


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", help="Log files or directories")
    parser.add_argument(
        "--collections", nargs="+", default=None,
        help="Colecciones a conservar (ej: orders customers). Por defecto: todas",
    )
    parser.add_argument("--commands", nargs="+", default=sorted(DEFAULT_COMMANDS))
    parser.add_argument("--format", choices=["csv", "jsonl", "summary"], default="csv")
    args = parser.parse_args()

    collections = set(args.collections) if args.collections else None
    commands = set(args.commands)
    rows: list[dict[str, str]] = []
    parsed = 0

    for path in iter_paths(args.inputs):
        try:
            with open_text(path) as handle:
                for line in handle:
                    event = extract_json(line)
                    if not event:
                        continue
                    parsed += 1
                    row = row_for(path, event)
                    if matches(row, collections, commands):
                        rows.append(row)
        except OSError as exc:
            print(f"warning: cannot read {path}: {exc}", file=sys.stderr)

    if args.format == "jsonl":
        for row in rows:
            print(json.dumps(row, ensure_ascii=False, sort_keys=True))
    elif args.format == "summary":
        print(f"parsed_json_events={parsed}")
        print(f"matched_events={len(rows)}")
        for label in ("collection", "command", "users", "remote", "result"):
            print(f"\n{label}:")
            for value, count in Counter(row[label] or "<empty>" for row in rows).most_common():
                print(f"  {count}\t{value}")
    else:
        writer = csv.DictWriter(sys.stdout, fieldnames=list(row_for(Path(""), {}).keys()))
        writer.writeheader()
        writer.writerows(rows)

    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
