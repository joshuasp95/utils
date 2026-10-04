#!/usr/bin/env python3
# connection-test.py — diagnostica paso a paso la conexión a un MongoDB/Atlas desde tu equipo.
#
# Qué hace:     Con la URI de MONGODB_URI: 1) valida que no tenga espacios/saltos de línea,
#               2) resuelve DNS y abre TCP contra cada host:puerto, 3) hace handshake TLS,
#               4) conecta con PyMongo: ping, selección de servidor y (opcional) un find_one
#               sobre MONGODB_DB.MONGODB_COLLECTION. Cada fallo imprime causas habituales.
# Requisitos:   Python 3.9+, pymongo (`pip install pymongo`). Red/VPN/Private Link que llegue
#               a los hosts de la URI.
# Uso:          export MONGODB_URI='mongodb://<USER>:<PASSWORD>@<HOST1>:<PORT1>,<HOST2>:<PORT2>/?tls=true&replicaSet=<REPLICA_SET>&authSource=admin'
#               export MONGODB_DB=mydb MONGODB_COLLECTION=orders   # opcional
#               python3 connection-test.py
# Variables:    MONGODB_URI        (obligatoria) URI completa. Atlas UI → Connect → Drivers.
#                                  Las comprobaciones DNS/TCP/TLS se hacen sobre los hosts
#                                  explícitos; con mongodb+srv:// se prueba el hostname SRV.
#               MONGODB_DB         (opcional) BD para el find_one de prueba.
#               MONGODB_COLLECTION (opcional) colección para el find_one. Si falta alguna de
#                                  las dos, se omite el find_one.
#               MONGODB_APPNAME    (opcional) appname que verá el servidor. Por defecto connection-test.
# Efectos:      SOLO LECTURA (ping + find_one de un único _id). La URI se imprime con las
#               credenciales enmascaradas.
# Salida:       Diagnóstico por stdout. Códigos: 0 ok | 2 falta MONGODB_URI | 3 URI inválida |
#               10 timeout de selección | 11 operación rechazada (auth/permisos) |
#               12 configuración | 13 red/TLS | 14 otro error PyMongo.

import os
import re
import socket
import ssl
import sys
from urllib.parse import urlsplit, urlunsplit

from pymongo import MongoClient
from pymongo.errors import (
    ConfigurationError,
    ConnectionFailure,
    OperationFailure,
    PyMongoError,
    ServerSelectionTimeoutError,
)


DB_NAME = os.getenv("MONGODB_DB", "")
COLLECTION_NAME = os.getenv("MONGODB_COLLECTION", "")
APP_NAME = os.getenv("MONGODB_APPNAME", "connection-test")


def mask_uri(uri: str) -> str:
    parts = urlsplit(uri)
    if "@" not in parts.netloc:
        return uri

    _credentials, hosts = parts.netloc.rsplit("@", 1)
    return urlunsplit((parts.scheme, f"***:***@{hosts}", parts.path, parts.query, parts.fragment))


def extract_hosts(uri: str) -> list[tuple[str, int]]:
    parts = urlsplit(uri)
    netloc = parts.netloc.rsplit("@", 1)[-1]
    hosts_part = netloc.split("/", 1)[0]
    hosts = []

    for host_entry in hosts_part.split(","):
        host, _, port = host_entry.partition(":")
        if host:
            hosts.append((host, int(port or "27017")))

    return hosts


def validate_uri(uri: str) -> bool:
    has_error = False

    if re.search(r"\s", uri):
        print("\nERROR: la URI contiene espacios, tabuladores o saltos de linea.")
        print("MongoDB no puede resolver correctamente un hostname con espacios.")
        print("Vuelve a exportar MONGODB_URI en una sola linea, sin partirla al copiar/pegar.")
        has_error = True

    for host, _port in extract_hosts(uri):
        if re.search(r"\s", host):
            print(f"ERROR: hostname invalido con espacios/saltos de linea: {host!r}")
            has_error = True

    return not has_error


def check_dns_and_tcp(uri: str) -> None:
    print("\n[1] DNS/TCP check")
    for host, port in extract_hosts(uri):
        try:
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            ips = sorted({address[4][0] for address in addresses})
            print(f"  OK DNS {host}:{port} -> {', '.join(ips)}")
        except socket.gaierror as exc:
            print(f"  ERROR DNS {host}:{port}: {exc}")
            continue

        try:
            with socket.create_connection((host, port), timeout=5):
                print(f"  OK TCP {host}:{port}")
        except OSError as exc:
            print(f"  ERROR TCP {host}:{port}: {exc}")


def check_tls(uri: str) -> None:
    print("\n[2] TLS handshake check")
    context = ssl.create_default_context()

    for host, port in extract_hosts(uri):
        try:
            with socket.create_connection((host, port), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname=host) as tls_sock:
                    cert = tls_sock.getpeercert()
                    subject = dict(x[0] for x in cert.get("subject", []))
                    print(f"  OK TLS {host}:{port} -> {subject.get('commonName', '<sin CN>')}")
        except Exception as exc:
            print(f"  ERROR TLS {host}:{port}: {type(exc).__name__}: {exc}")


def main() -> int:
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        print("ERROR: falta la variable de entorno MONGODB_URI.")
        print()
        print("Ejemplo:")
        print("  export MONGODB_URI='mongodb://<USER>:<PASSWORD>@<HOST1>:<PORT1>,<HOST2>:<PORT2>,<HOST3>:<PORT3>/?tls=true&replicaSet=<REPLICA_SET>&authSource=admin'")
        print("  python3 connect-mongo-test.py")
        return 2

    print("MongoDB connection test")
    print(f"URI: {mask_uri(uri)}")
    print(f"DB: {DB_NAME or '<sin definir: se omite find_one>'}")
    print(f"Collection: {COLLECTION_NAME or '<sin definir: se omite find_one>'}")

    if not validate_uri(uri):
        return 3

    check_dns_and_tcp(uri)
    check_tls(uri)

    print("\n[3] PyMongo connection")
    try:
        client = MongoClient(
            uri,
            serverSelectionTimeoutMS=8000,
            connectTimeoutMS=3000,
            socketTimeoutMS=8000,
            appname=APP_NAME,
        )

        print("  Ejecutando ping...")
        ping = client.admin.command("ping")
        print(f"  OK ping: {ping}")

        print("  Seleccionando servidor...")
        # _select_server() es API interna de PyMongo: solo se usa para mostrar a qué nodo conecta
        server = client._select_server()
        print(f"  OK server seleccionado: {server.description.address}")

        if DB_NAME and COLLECTION_NAME:
            collection = client[DB_NAME][COLLECTION_NAME]
            print("  Ejecutando find_one...")
            # Proyección {"_id": 1}: solo trae el _id, no datos del documento
            doc = collection.find_one({}, {"_id": 1})
            print(f"  OK find_one _id: {doc}")
        else:
            print("  find_one omitido (define MONGODB_DB y MONGODB_COLLECTION para probarlo)")

        return 0

    except ServerSelectionTimeoutError as exc:
        print("\nERROR: PyMongo no pudo seleccionar ningun nodo del replica set antes del timeout.")
        print("Causas habituales:")
        print("  - No estas conectado a la red/VPN/PrivateLink desde donde resuelve esa URI.")
        print("  - Los puertos de la URI no son accesibles desde tu equipo (27017, o los de Private Link).")
        print("  - El replicaSet de la URI no coincide con el cluster.")
        print("  - Problema TLS/DNS/firewall.")
        print()
        print(exc)
        return 10

    except OperationFailure as exc:
        print("\nERROR: MongoDB respondio, pero rechazo la operacion.")
        print("Causas habituales:")
        print("  - Usuario/password incorrectos.")
        print("  - authSource incorrecto.")
        print("  - El usuario no tiene permisos sobre la DB/collection.")
        print()
        print(exc)
        return 11

    except ConfigurationError as exc:
        print("\nERROR: configuracion de URI o driver no valida.")
        print(exc)
        return 12

    except ConnectionFailure as exc:
        print("\nERROR: fallo de conexion de red o TLS.")
        print(exc)
        return 13

    except PyMongoError as exc:
        print("\nERROR PyMongo no esperado.")
        print(type(exc).__name__)
        print(exc)
        return 14


if __name__ == "__main__":
    sys.exit(main())
