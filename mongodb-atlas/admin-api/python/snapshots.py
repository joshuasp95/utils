#!/usr/bin/env python3
# snapshots.py — snapshots (copias de seguridad) y restauraciones de clusters Atlas.
#
# Qué hace:     Lista snapshots, crea uno on-demand o lanza un restore job sobre un cluster destino.
# Requisitos:   Python 3.10+, `pip install -r requirements.txt`, ../.env configurado.
#               Cluster con Cloud Backup activado (tiers dedicados, M10+).
# Uso:          python snapshots.py list <CLUSTER_NAME>
#               | create <CLUSTER_NAME> ["descripción"] [retentionDays]
#               | restore <CLUSTER_NAME> <SNAPSHOT_ID> <TARGET_CLUSTER_NAME>
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver ../.env.example).
# Efectos:      list    → SOLO LECTURA.
#               create  → ESCRIBE: crea un snapshot on-demand.
#               restore → ESCRIBE (DESTRUCTIVO para el destino): sobrescribe los datos del
#                         cluster destino. NO pide confirmación.
# Salida:       Tabla o JSON por stdout.

"""Gestión de snapshots y backups de clusters en MongoDB Atlas.

Uso:
  python snapshots.py list    <clusterName>
  python snapshots.py create  <clusterName> [description] [retentionDays]
  python snapshots.py restore <clusterName> <snapshotId> <targetCluster>

retentionDays por defecto: 7
"""

import json
import sys

from atlas_client import AtlasClient

client = AtlasClient()


def _backup_base(cluster: str) -> str:
    return f"{client.project_path}/clusters/{cluster}/backup"


def cmd_list(cluster: str) -> None:
    data = client.get(f"{_backup_base(cluster)}/snapshots")
    rows = data.get("results", [])
    if not rows:
        print(f"No hay snapshots para el cluster '{cluster}'.")
        return
    print(f"{'ID':<30} {'TIPO':<12} {'ESTADO':<15} {'CREADO':<25} {'BYTES'}")
    print("-" * 100)
    for s in rows:
        print(
            f"{s['id']:<30} {s.get('type','?'):<12} {s.get('status','?'):<15} "
            f"{s.get('createdAt','?'):<25} {s.get('storageSizeBytes','-')}"
        )


# ESCRIBE
def cmd_create(cluster: str, description: str = "On-demand via script", retention: int = 7) -> None:
    body = {"description": description, "retentionInDays": int(retention)}
    result = client.post(f"{_backup_base(cluster)}/snapshots", body)
    print(json.dumps({
        "id": result["id"],
        "type": result.get("type"),
        "status": result.get("status"),
        "description": result.get("description"),
        "retentionInDays": result.get("retentionInDays"),
    }, indent=2))


# ESCRIBE (DESTRUCTIVO para el cluster destino; deliveryType "automated" sobrescribe sus datos)
def cmd_restore(cluster: str, snapshot_id: str, target_cluster: str) -> None:
    body = {
        "snapshotId": snapshot_id,
        "deliveryType": "automated",
        "targetClusterName": target_cluster,
        "targetGroupId": client.project_id,
    }
    result = client.post(f"{_backup_base(cluster)}/restoreJobs", body)
    print(json.dumps({
        "id": result["id"],
        "deliveryType": result.get("deliveryType"),
        "status": result.get("status"),
        "targetClusterName": result.get("targetClusterName"),
    }, indent=2))


COMMANDS = {
    "list":    lambda a: cmd_list(a[0]),
    "create":  lambda a: cmd_create(a[0], a[1] if len(a) > 1 else "On-demand via script", int(a[2]) if len(a) > 2 else 7),
    "restore": lambda a: cmd_restore(a[0], a[1], a[2]),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
