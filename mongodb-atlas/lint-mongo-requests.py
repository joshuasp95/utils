#!/usr/bin/env python3
# lint-mongo-requests.py — análisis estático de peticiones de cambio MongoDB (scripts mongosh .js).
#
# Qué hace:     Recorre carpetas de "request" (peticiones de cambio con scripts .js para
#               mongosh), valida la sintaxis de cada .js con `node --check`, detecta patrones
#               de riesgo (sin selector de BD, colecciones con guion en notación de punto,
#               dropIndex sin try/catch, índices unique, TTL, operaciones destructivas),
#               sugiere el orden de ejecución (datos antes que índices) y dice qué requests
#               no tienen todavía su fichero de análisis (--analysis-file).
# Requisitos:   Python 3.9+. node en el PATH para validar sintaxis (si falta, se marca REVISAR).
# Uso:          ./lint-mongo-requests.py --root <RAIZ_REQUESTS> --pending --summary
#               ./lint-mongo-requests.py --root <RAIZ_REQUESTS> --date 2026-06-04
#               ./lint-mongo-requests.py --request <CARPETA_DE_UNA_REQUEST>
#               ./lint-mongo-requests.py --root ./requests --analysis-file REVIEW.md --pending
# Variables:    --root           carpeta raíz con la estructura <root>/<tipo>/<YYYY-MM-DD>/<request>/
#                                (si un día no tiene subcarpetas, la carpeta del día es la request).
#                                Obligatoria salvo con --request. También MONGO_REQUESTS_ROOT.
#               --request        analiza una sola carpeta (sin exigir la estructura anterior).
#               --date           solo las carpetas de ese día (YYYY-MM-DD).
#               --pending        solo requests con .js y sin fichero de análisis.
#               --analysis-file  nombre del fichero de análisis que se espera en cada request.
#                                Por defecto ANALYSIS.md (también MONGO_ANALYSIS_FILE).
#               --summary        resumen legible en vez de JSON.
# Efectos:      SOLO LECTURA: no mueve, extrae, crea ni borra nada; no conecta a MongoDB.
# Salida:       JSON compacto (o resumen) por stdout. Códigos: 0 sin hallazgos FALLA |
#               1 error de uso | 2 al menos un hallazgo FALLA.

"""lint-mongo-requests.py — analisis estatico de requests de cambio MongoDB.

Implementa la parte mecanica de revisar una peticion de cambio con scripts mongosh:
recorre las carpetas de request, valida la sintaxis de los `.js`, detecta patrones
de riesgo y dice que requests no tienen todavia su fichero de analisis.

Emite JSON compacto por stdout. El campo `verdictFloor` es ORIENTATIVO: marca el
peor hallazgo estatico encontrado, no el veredicto final. El juicio real (OK /
FALLA / REVISAR y la nota) lo escribe una persona o un asistente leyendo este
JSON, porque a menudo depende de contexto entre ficheros que el analisis estatico
no puede resolver. Ejemplo: un indice `unique` parece REVISAR, pero si la
misma request hace drop y recrea la coleccion, no puede haber duplicados y el
veredicto correcto es OK. Esos casos se senalan en `contextNotes`.

SOLO LECTURA: no mueve, extrae, crea ni borra nada. Las tareas de organizacion
(crear carpetas por fecha, mover requests, extraer ZIPs) siguen siendo manuales
a proposito.

Codigos de salida:
  0  analisis completado, ninguna request con hallazgos de nivel FALLA
  1  error de uso
  2  al menos una request tiene un hallazgo FALLA
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Raiz de requests: sin valor por defecto fijo (se pasa con --root o MONGO_REQUESTS_ROOT)
DEFAULT_ROOT = os.getenv("MONGO_REQUESTS_ROOT")
# Nombre del fichero de analisis que se espera en cada carpeta de request
ANALYSIS_FILE = os.getenv("MONGO_ANALYSIS_FILE", "ANALYSIS.md")

FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Nombres de fichero que sugieren datos/colecciones frente a indices.
# Sirve para avisar del orden de ejecucion recomendado (datos antes que indices).
RE_DATOS = re.compile(r"(collection|schema|data|insert|seed)", re.I)
RE_INDICES = re.compile(r"(index|indice|indexes)", re.I)


def comprobar_sintaxis(fichero: Path):
    """Valida sintaxis JS con `node --check`. Devuelve (ok, detalle)."""
    if not shutil.which("node"):
        return None, "node no disponible: sintaxis no comprobada"
    try:
        r = subprocess.run(
            ["node", "--check", str(fichero)],
            capture_output=True, text=True, timeout=20,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        return None, f"no se pudo ejecutar node --check: {e}"
    if r.returncode == 0:
        return True, ""
    primera = next((l.strip() for l in r.stderr.splitlines() if l.strip()), "error de sintaxis")
    return False, primera[:200]


def analizar_js(fichero: Path):
    """Aplica la lista de comprobacion a un script .js."""
    try:
        texto = fichero.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return {"file": fichero.name, "error": f"no legible: {e}", "findings": []}

    lineas = texto.splitlines()
    hallazgos = []

    def anadir(check, severidad, detalle, linea=None):
        h = {"check": check, "severity": severidad, "detail": detalle}
        if linea is not None:
            h["line"] = linea
        hallazgos.append(h)

    # 1) Sintaxis valida para mongosh (mongosh ejecuta JS: un error de sintaxis aborta)
    sintaxis_ok, detalle = comprobar_sintaxis(fichero)
    if sintaxis_ok is False:
        anadir("sintaxis", "FALLA", f"node --check falla: {detalle}")
    elif sintaxis_ok is None and detalle:
        anadir("sintaxis", "REVISAR", detalle)

    # 2) Selector de base de datos
    usa_use = bool(re.search(r"\buse\s*\(", texto))
    usa_sibling = "getSiblingDB" in texto
    toca_db = bool(re.search(r"\bdb\s*[.\[]", texto))
    selector = "use" if usa_use else ("getSiblingDB" if usa_sibling else "ninguno")
    if toca_db and selector == "ninguno":
        anadir("selector-db", "FALLA",
               "el script opera sobre db pero no hace use(\"...\") ni getSiblingDB(\"...\")")

    # 3) Colecciones con guion accedidas por notacion de punto (JS invalido)
    for i, l in enumerate(lineas, 1):
        if re.search(r"\bdb\.[A-Za-z0-9_$]+-", l):
            anadir("coleccion-con-guion", "FALLA",
                   "coleccion con guion en notacion de punto; usar db.getCollection(\"nombre-con-guion\")", i)

    # 4) dropIndex sin proteccion: falla si el indice no existe
    for i, l in enumerate(lineas, 1):
        if "dropIndex" in l:
            ventana = "\n".join(lineas[max(0, i - 6):i + 5])
            if "try" not in ventana:
                anadir("dropIndex-sin-try", "REVISAR",
                       "dropIndex fuera de try/catch: aborta si el indice no existe", i)

    # 5) Indices unique: pueden fallar por duplicados preexistentes
    for i, l in enumerate(lineas, 1):
        if re.search(r"unique\s*:\s*true", l):
            anadir("indice-unique", "REVISAR",
                   "indice unique: falla si ya hay duplicados en la coleccion", i)

    # 6) TTL: el campo indexado debe ser de tipo fecha
    for i, l in enumerate(lineas, 1):
        if "expireAfterSeconds" in l:
            anadir("ttl", "REVISAR",
                   "TTL: confirmar que el campo indexado es de tipo Date", i)

    operaciones = sorted({
        op for op in (
            "createCollection", "createIndex", "dropIndex", "insertMany",
            "insertOne", "updateMany", "deleteMany", "drop", "renameCollection",
        ) if re.search(rf"\b{op}\s*\(", texto)
    })

    # Que el script borre datos NO es un problema si la request lo pide.
    # Se registra como informativo, nunca como hallazgo.
    destructivas = [op for op in operaciones if op in
                    ("drop", "dropIndex", "deleteMany", "renameCollection")]
    if destructivas:
        anadir("operaciones-destructivas", "INFO",
               "el script incluye " + ", ".join(destructivas) +
               "; esto no baja el veredicto si la request lo pide")

    return {
        "file": fichero.name,
        "syntaxValid": sintaxis_ok,
        "dbSelector": selector,
        "operations": operaciones,
        "findings": hallazgos,
    }


def etiqueta_request(carpeta: Path, root: Path | None = None):
    """Etiqueta estable `<tipo>/<fecha>[/<request>]` (ruta relativa a la raiz), sea la
    request una subcarpeta del dia o la propia carpeta del dia."""
    if root is not None:
        try:
            return carpeta.relative_to(root).as_posix() or carpeta.name
        except ValueError:
            pass
    return carpeta.name


def analizar_request(carpeta: Path, root: Path | None = None):
    ficheros = sorted(p for p in carpeta.rglob("*") if p.is_file())
    js = [p for p in ficheros if p.suffix == ".js"]
    otros = [p.name for p in ficheros if p.suffix != ".js" and p.name != ANALYSIS_FILE]

    scripts = [analizar_js(p) for p in js]

    # Orden de ejecucion: datos antes que indices
    nombres = [s["file"] for s in scripts]
    datos = [n for n in nombres if RE_DATOS.search(n)]
    indices = [n for n in nombres if RE_INDICES.search(n)]
    orden = None
    if datos and indices:
        orden = {"primero": datos, "despues": indices,
                 "nota": "ejecutar colecciones/datos antes de indices"}

    # Contexto entre ficheros: si la request recrea las colecciones desde cero
    # (drop + createCollection), el riesgo de duplicados de un indice unique
    # queda neutralizado. El linter no puede decidirlo solo, pero si avisar.
    recrea = any(
        "drop" in s.get("operations", []) and "createCollection" in s.get("operations", [])
        for s in scripts
    )
    notas = []
    hay_unique = any(h["check"] == "indice-unique" for s in scripts for h in s["findings"])
    if recrea and hay_unique:
        notas.append(
            "la request recrea las colecciones (drop + createCollection), asi que los "
            "hallazgos 'indice-unique' probablemente no apliquen: no puede haber duplicados "
            "preexistentes en una coleccion nueva"
        )

    severidades = [h["severity"] for s in scripts for h in s["findings"]]
    if "FALLA" in severidades:
        sugerido = "FALLA"
    elif "REVISAR" in severidades:
        sugerido = "REVISAR"
    elif scripts:
        sugerido = "OK"
    else:
        sugerido = "SIN_SCRIPTS"

    return {
        "request": etiqueta_request(carpeta, root),
        "path": str(carpeta),
        "hasAnalysis": (carpeta / ANALYSIS_FILE).exists(),
        "jsCount": len(js),
        "otherFiles": otros,
        "executionOrder": orden,
        "verdictFloor": sugerido,
        "contextNotes": notas,
        "scripts": scripts,
    }


def descubrir(root: Path, fecha=None, solo_pendientes=False):
    """Localiza carpetas de request bajo <root>/<tipo>/<fecha>/<request>/."""
    encontradas = []
    if not root.is_dir():
        return encontradas
    for tipo in sorted(p for p in root.iterdir() if p.is_dir()):
        for dia in sorted(p for p in tipo.iterdir() if p.is_dir() and FECHA_RE.match(p.name)):
            if fecha and dia.name != fecha:
                continue
            hijos = [p for p in sorted(dia.iterdir()) if p.is_dir()]
            # Si el dia no tiene subcarpetas (p.ej. <root>/<tipo>/<fecha>/*.md), la carpeta
            # del dia es la propia request
            encontradas.extend(hijos if hijos else [dia])
    if solo_pendientes:
        # Pendiente = tiene scripts .js y le falta el analisis. Las requests sin
        # scripts (p.ej. altas de usuarios) no llevan fichero de analisis, asi que
        # no se cuentan como pendientes.
        encontradas = [
            c for c in encontradas
            if any(p.suffix == ".js" for p in c.rglob("*") if p.is_file())
            and not (c / ANALYSIS_FILE).exists()
        ]
    return encontradas


def main():
    global ANALYSIS_FILE
    ap = argparse.ArgumentParser(
        description="Analisis estatico de requests MongoDB (solo lectura).",
        epilog="Ejemplos:\n"
               "  %(prog)s --root <RAIZ_REQUESTS> --pending\n"
               "  %(prog)s --root <RAIZ_REQUESTS> --date 2026-06-04\n"
               "  %(prog)s --request <ruta-a-una-carpeta-de-request>\n"
               "  %(prog)s --root <RAIZ_REQUESTS> --pending --summary",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--root", type=Path,
                    default=Path(DEFAULT_ROOT) if DEFAULT_ROOT else None,
                    help="raiz <root>/<tipo>/<YYYY-MM-DD>/<request>/ (o MONGO_REQUESTS_ROOT)")
    ap.add_argument("--date", help="analizar solo una carpeta de fecha YYYY-MM-DD")
    ap.add_argument("--request", type=Path, help="analizar una sola carpeta de request")
    ap.add_argument("--pending", action="store_true",
                    help="solo requests con .js y sin fichero de analisis")
    ap.add_argument("--analysis-file", default=ANALYSIS_FILE,
                    help="nombre del fichero de analisis por request (por defecto %(default)s)")
    ap.add_argument("--summary", action="store_true",
                    help="resumen legible en vez de JSON completo")
    args = ap.parse_args()

    ANALYSIS_FILE = args.analysis_file

    if args.date and not FECHA_RE.match(args.date):
        ap.error("--date debe tener formato YYYY-MM-DD")

    if args.request:
        if not args.request.is_dir():
            ap.error(f"no es una carpeta: {args.request}")
        carpetas = [args.request.resolve()]
        root = None
    else:
        if args.root is None:
            ap.error("indica --root (o MONGO_REQUESTS_ROOT) o --request")
        root = args.root.resolve()
        carpetas = descubrir(root, args.date, args.pending)

    resultados = [analizar_request(c, root) for c in carpetas]

    if args.summary:
        if not resultados:
            print("Sin requests que analizar con esos filtros.")
            return 0
        anchura = max(len(r["request"]) for r in resultados)
        for r in resultados:
            marca = " " if r["hasAnalysis"] else "*"
            n = sum(1 for s in r["scripts"] for h in s["findings"] if h["severity"] != "INFO")
            print(f"{marca} {r['request']:<{anchura}}  {r['verdictFloor']:<10} "
                  f"{r['jsCount']} js, {n} hallazgo(s)")
        pend = sum(1 for r in resultados if not r["hasAnalysis"])
        print(f"\n{len(resultados)} request(s); {pend} sin {ANALYSIS_FILE} (marcadas con *)")
    else:
        json.dump({"root": str(args.root) if args.root else None, "count": len(resultados), "requests": resultados},
                  sys.stdout, ensure_ascii=False, separators=(",", ":"))
        print()

    hay_falla = any(h["severity"] == "FALLA"
                    for r in resultados for s in r["scripts"] for h in s["findings"])
    return 2 if hay_falla else 0


if __name__ == "__main__":
    sys.exit(main())
