#!/usr/bin/env python3
# db_users.py — gestión de usuarios de base de datos de un proyecto Atlas vía Admin API v2.
#
# Qué hace:     Lista, describe, crea, rota contraseña o elimina database users.
# Requisitos:   Python 3.10+, `pip install -r requirements.txt`, ../.env configurado.
# Uso:          python db_users.py list | get <USERNAME> [authDb]
#               | create <USERNAME> <PASSWORD> <ROLE> [authDb] | rotate <USERNAME> <NEW_PASSWORD> [authDb]
#               | delete <USERNAME> [authDb]
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (ver ../.env.example).
#               authDb: base de datos de autenticación (por defecto admin).
# Efectos:      list, get → SOLO LECTURA.
#               create    → ESCRIBE: crea un usuario de BD con el rol indicado.
#               rotate    → ESCRIBE: cambia la contraseña (las apps con la antigua dejan de conectar).
#               delete    → ESCRIBE (DESTRUCTIVO): elimina el usuario. Pide confirmación.
#               Ojo: la contraseña pasada como argumento queda en el historial del shell.
# Salida:       Tabla o JSON por stdout.

"""Operaciones sobre usuarios de base de datos en MongoDB Atlas.

Uso:
  python db_users.py list
  python db_users.py get    <username> [authDb]
  python db_users.py create <username> <password> <role> [authDb]
  python db_users.py rotate <username> <newPassword> [authDb]
  python db_users.py delete <username> [authDb]

authDb por defecto: admin
Roles comunes: readWriteAnyDatabase, read, readWrite, dbAdmin, atlasAdmin
"""

import json
import sys

from atlas_client import AtlasClient

client = AtlasClient()
BASE = client.project_path + "/databaseUsers"
DEFAULT_AUTH_DB = "admin"


def cmd_list() -> None:
    data = client.get(BASE)
    rows = data.get("results", [])
    if not rows:
        print("No hay usuarios.")
        return
    print(f"{'USUARIO':<30} {'AUTH_DB':<10} {'ROLES'}")
    print("-" * 80)
    for u in rows:
        roles = ", ".join(r["roleName"] for r in u.get("roles", []))
        print(f"{u['username']:<30} {u['databaseName']:<10} {roles}")


def cmd_get(username: str, auth_db: str = DEFAULT_AUTH_DB) -> None:
    u = client.get(f"{BASE}/{auth_db}/{username}")
    print(json.dumps({
        "username": u["username"],
        "databaseName": u["databaseName"],
        "roles": u.get("roles", []),
        "scopes": u.get("scopes", []),
    }, indent=2))


# ESCRIBE
def cmd_create(username: str, password: str, role: str, auth_db: str = DEFAULT_AUTH_DB) -> None:
    body = {
        "username": username,
        "password": password,
        "databaseName": auth_db,
        "roles": [{"roleName": role, "databaseName": auth_db}],
    }
    result = client.post(BASE, body)
    print(f"Usuario '{result['username']}' creado con rol '{role}'.")


# ESCRIBE
def cmd_rotate(username: str, new_password: str, auth_db: str = DEFAULT_AUTH_DB) -> None:
    client.patch(f"{BASE}/{auth_db}/{username}", {"password": new_password})
    print(f"Contraseña de '{username}' actualizada.")


# ESCRIBE (DESTRUCTIVO)
def cmd_delete(username: str, auth_db: str = DEFAULT_AUTH_DB) -> None:
    confirm = input(f"¿Eliminar usuario '{username}'? [y/N] ").strip().lower()
    if confirm != "y":
        print("Cancelado.")
        return
    client.delete(f"{BASE}/{auth_db}/{username}")
    print(f"Usuario '{username}' eliminado.")


COMMANDS = {
    "list":   lambda a: cmd_list(),
    "get":    lambda a: cmd_get(a[0], a[1] if len(a) > 1 else DEFAULT_AUTH_DB),
    "create": lambda a: cmd_create(a[0], a[1], a[2], a[3] if len(a) > 3 else DEFAULT_AUTH_DB),
    "rotate": lambda a: cmd_rotate(a[0], a[1], a[2] if len(a) > 2 else DEFAULT_AUTH_DB),
    "delete": lambda a: cmd_delete(a[0], a[1] if len(a) > 1 else DEFAULT_AUTH_DB),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
