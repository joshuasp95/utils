# atlas_client.py — cliente base para la MongoDB Atlas Admin API v2 con OAuth2 (Service Account).
#
# Qué hace:     Módulo importado por clusters.py, db_users.py, ip_access_list.py y
#               snapshots.py. Carga ../.env, obtiene y renueva el token OAuth2
#               (client_credentials) y expone get/post/patch/delete sobre la API.
# Requisitos:   Python 3.10+ (usa `str | None`), requests, python-dotenv (requirements.txt).
# Uso:          from atlas_client import AtlasClient; client = AtlasClient()
# Variables:    ATLAS_CLIENT_ID, ATLAS_CLIENT_SECRET, ATLAS_PROJECT_ID (obligatorias);
#               ATLAS_TOKEN_URL, ATLAS_API_BASE, ATLAS_API_VERSION (opcionales). Ver ../.env.example.
# Efectos:      Ninguno por sí mismo; depende del método HTTP que use quien lo importa.
# Salida:       Objetos JSON (dict/list) devueltos por la API; errores HTTP por stderr + excepción.

"""Cliente base para la MongoDB Atlas Admin API con autenticación OAuth2 (Service Account)."""

import os
import sys
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

# Carga .env desde admin-api/ (carpeta padre de python/)
load_dotenv(Path(__file__).parent.parent / ".env")

TOKEN_URL = os.getenv("ATLAS_TOKEN_URL", "https://services.cloud.mongodb.com/api/oauth/token")
API_BASE = os.getenv("ATLAS_API_BASE", "https://cloud.mongodb.com/api/atlas/v2")
API_VERSION = os.getenv("ATLAS_API_VERSION", "2023-02-01")


class AtlasClient:
    def __init__(self) -> None:
        # os.environ[...] lanza KeyError si falta la variable obligatoria
        self.client_id = os.environ["ATLAS_CLIENT_ID"]
        self.client_secret = os.environ["ATLAS_CLIENT_SECRET"]
        self.project_id = os.environ["ATLAS_PROJECT_ID"]
        self._token: str | None = None
        self._token_expiry: float = 0

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def _ensure_token(self) -> str:
        # Reutiliza el token si le quedan más de 30 s de vida; si no, pide uno nuevo.
        # auth=(id, secret) hace que requests envíe la cabecera HTTP Basic.
        if self._token and time.time() < self._token_expiry - 30:
            return self._token

        resp = requests.post(
            TOKEN_URL,
            auth=(self.client_id, self.client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expiry = time.time() + data["expires_in"]
        return self._token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._ensure_token()}",
            "Accept": f"application/vnd.atlas.{API_VERSION}+json",
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    def _url(self, path: str) -> str:
        return f"{API_BASE}{path}"

    def get(self, path: str, params: dict | None = None) -> Any:
        r = requests.get(self._url(path), headers=self._headers(), params=params, timeout=30)
        return self._handle(r)

    def post(self, path: str, body: Any = None) -> Any:
        r = requests.post(self._url(path), headers=self._headers(), json=body, timeout=30)
        return self._handle(r)

    def patch(self, path: str, body: Any) -> Any:
        r = requests.patch(self._url(path), headers=self._headers(), json=body, timeout=30)
        return self._handle(r)

    def delete(self, path: str) -> Any:
        r = requests.delete(self._url(path), headers=self._headers(), timeout=30)
        return self._handle(r)

    @staticmethod
    def _handle(response: requests.Response) -> Any:
        if not response.ok:
            try:
                err = response.json()
                msg = err.get("detail") or err.get("reason") or err.get("error") or response.text
            except Exception:
                msg = response.text
            print(f"Error {response.status_code}: {msg}", file=sys.stderr)
            response.raise_for_status()
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    # ------------------------------------------------------------------
    # Convenience: ruta base del proyecto
    # ------------------------------------------------------------------

    @property
    def project_path(self) -> str:
        return f"/groups/{self.project_id}"
