#!/usr/bin/env python3
"""
pdf-inspect-annotations.py — Lista las anotaciones de cada página de un PDF (enlaces, comentarios, resaltados).

Qué hace:     Recorre las páginas con pypdf y, por cada anotación (/Annots), imprime su subtipo
              (/Link, /Text, /Highlight…), rectángulo, color, contenido, URI o destino interno y
              QuadPoints (zona resaltada). Útil para extraer enlaces o checklists de un PDF.
Requisitos:   Python 3.8+ y pypdf (`python3 -m pip install pypdf`).
Uso:          python3 pdf-inspect-annotations.py "<RUTA_AL_PDF>"
Variables:    pdf (posicional) ruta al PDF a inspeccionar.
Efectos:      SOLO LECTURA.
Salida:       Texto por stdout: "PAGE n" y una línea por anotación.
"""
import argparse
from pathlib import Path
from pypdf import PdfReader


parser = argparse.ArgumentParser(description="Lista las anotaciones de cada página de un PDF.")
parser.add_argument("pdf", help="Ruta al fichero PDF")
pdf = Path(parser.parse_args().pdf)
reader = PdfReader(pdf)

for page_no, page in enumerate(reader.pages, start=1):
    print(f"PAGE {page_no}")
    annotations = page.get("/Annots", [])
    if not annotations:
        print("  (no annotations)")
        continue
    for index, annotation_ref in enumerate(annotations, start=1):
        annotation = annotation_ref.get_object()   # resuelve la referencia indirecta del PDF
        # /A = acción asociada (p. ej. abrir una URI); /Dest = destino dentro del propio PDF.
        action = annotation.get("/A")
        uri = action.get("/URI") if action else None
        destination = annotation.get("/Dest")
        print(
            f"  {index}: subtype={annotation.get('/Subtype')} "
            f"rect={annotation.get('/Rect')} color={annotation.get('/C')} "
            f"contents={annotation.get('/Contents')!r} uri={uri!r} "
            f"dest={destination!r} quadpoints={annotation.get('/QuadPoints')}"
        )
