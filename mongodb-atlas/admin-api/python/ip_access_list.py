#!/usr/bin/env python3
# ip_access_list.py — gestión de la IP Access List (lista blanca de IPs) de un proyecto Atlas.
#
# Qué hace:     Lista, añade o elimina entradas IP/CIDR desde las que se permite conectar.
# Requisitos:   Python 3.10+, `pip install -r requirements.txt`, ../.env configurado.
# Uso:          python ip_access_list.py list | add <CIDR> ["comentario"] | delete <CIDR>
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver ../.env.example).
# Efectos:      list   → SOLO LECTURA.
#               add    → ESCRIBE: abre acceso de red al proyecto desde ese CIDR.
#               delete → ESCRIBE: quita la entrada. Pide confirmación.
# Salida:       Tabla o líneas de confirmación por stdout.

"""Gestión del IP Access List de un proyecto Atlas.

Uso:
  python ip_access_list.py list
  python ip_access_list.py add    <cidr> [comment]
  python ip_access_list.py delete <cidr>

Ejemplo cidr: 10.10.0.0/24  o  203.0.113.5/32
"""

import sys
from urllib.parse import quote

from atlas_client import AtlasClient

client = AtlasClient()
BASE = client.project_path + "/accessList"


def cmd_list() -> None:
    data = client.get(BASE)
    rows = data.get("results", [])
    if not rows:
        print("Access list vacío.")
        return
    print(f"{'IP / CIDR':<25} {'COMENTARIO'}")
    print("-" * 60)
    for e in rows:
        entry = e.get("cidrBlock") or e.get("ipAddress") or "-"
        print(f"{entry:<25} {e.get('comment', '-')}")


# ESCRIBE
def cmd_add(cidr: str, comment: str = "Añadido via script") -> None:
    body = [{"cidrBlock": cidr, "comment": comment}]
    result = client.post(BASE, body)
    added = result.get("results", [])
    for e in added:
        entry = e.get("cidrBlock") or e.get("ipAddress")
        print(f"Añadido: {entry}")


# ESCRIBE
def cmd_delete(cidr: str) -> None:
    confirm = input(f"¿Eliminar '{cidr}' del access list? [y/N] ").strip().lower()
    if confirm != "y":
        print("Cancelado.")
        return
    # La API espera el CIDR URL-encoded: quote(..., safe="") convierte "/" en "%2F"
    encoded = quote(cidr, safe="")
    client.delete(f"{BASE}/{encoded}")
    print(f"Entrada '{cidr}' eliminada.")


COMMANDS = {
    "list":   lambda a: cmd_list(),
    "add":    lambda a: cmd_add(a[0], a[1] if len(a) > 1 else "Añadido via script"),
    "delete": lambda a: cmd_delete(a[0]),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
