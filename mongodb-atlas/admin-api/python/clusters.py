#!/usr/bin/env python3
# clusters.py — operaciones sobre clusters de un proyecto Atlas vía Admin API v2.
#
# Qué hace:     Lista, describe, pausa, reanuda o elimina clusters del proyecto ATLAS_PROJECT_ID.
# Requisitos:   Python 3.10+, `pip install -r requirements.txt`, ../.env configurado.
# Uso:          python clusters.py list | get <CLUSTER_NAME> | pause <CLUSTER_NAME>
#               | resume <CLUSTER_NAME> | delete <CLUSTER_NAME>
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver ../.env.example).
# Efectos:      list, get → SOLO LECTURA.
#               pause     → ESCRIBE: PATCH paused=true (detiene el cluster).
#               resume    → ESCRIBE: PATCH paused=false (arranca el cluster).
#               delete    → ESCRIBE (DESTRUCTIVO): borra el cluster. Pide confirmación.
# Salida:       Tabla o JSON por stdout.

"""Operaciones sobre clusters de MongoDB Atlas.

Uso:
  python clusters.py list
  python clusters.py get      <clusterName>
  python clusters.py pause    <clusterName>
  python clusters.py resume   <clusterName>
  python clusters.py delete   <clusterName>
"""

import json
import sys

from atlas_client import AtlasClient

client = AtlasClient()
BASE = client.project_path + "/clusters"


def cmd_list() -> None:
    data = client.get(BASE)
    rows = data.get("results", [])
    if not rows:
        print("No hay clusters en el proyecto.")
        return
    print(f"{'NOMBRE':<30} {'ESTADO':<20} {'VERSIÓN':<10} {'TIPO'}")
    print("-" * 80)
    for c in rows:
        print(f"{c['name']:<30} {c['stateName']:<20} {c.get('mongoDBVersion','?'):<10} {c.get('clusterType','?')}")


def cmd_get(name: str) -> None:
    c = client.get(f"{BASE}/{name}")
    print(json.dumps({
        "name": c["name"],
        "stateName": c["stateName"],
        "clusterType": c.get("clusterType"),
        "mongoDBVersion": c.get("mongoDBVersion"),
        "paused": c.get("paused"),
        "diskSizeGB": c.get("diskSizeGB"),
    }, indent=2))


# ESCRIBE: pausa el cluster
def cmd_pause(name: str) -> None:
    result = client.patch(f"{BASE}/{name}", {"paused": True})
    print(f"Cluster '{name}' pausado. Estado: {result['stateName']}")


# ESCRIBE: reanuda el cluster
def cmd_resume(name: str) -> None:
    result = client.patch(f"{BASE}/{name}", {"paused": False})
    print(f"Cluster '{name}' reanudado. Estado: {result['stateName']}")


# ESCRIBE (DESTRUCTIVO)
def cmd_delete(name: str) -> None:
    confirm = input(f"¿Eliminar el cluster '{name}'? [y/N] ").strip().lower()
    if confirm != "y":
        print("Cancelado.")
        return
    client.delete(f"{BASE}/{name}")
    print(f"Cluster '{name}' eliminado.")


COMMANDS = {
    "list": lambda args: cmd_list(),
    "get": lambda args: cmd_get(args[0]),
    "pause": lambda args: cmd_pause(args[0]),
    "resume": lambda args: cmd_resume(args[0]),
    "delete": lambda args: cmd_delete(args[0]),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
