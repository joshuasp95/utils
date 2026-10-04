#!/usr/bin/env python3
"""
md-to-docx.py — Convierte un Markdown sencillo en un .docx mínimo sin dependencias externas.

Qué hace:     Genera a mano el XML de Word (WordprocessingML) y lo empaqueta en un ZIP .docx.
              Cada línea del Markdown es un párrafo: los títulos (#, ##, ###) solo cambian el tamaño
              de letra (24/18/16 pt), las líneas **en negrita** y las viñetas (-, *, 1.) se quedan
              como texto plano sin marcas. No soporta tablas, enlaces, imágenes ni negrita en línea.
Requisitos:   Python 3.8+ (solo librería estándar).
Uso:          python3 md-to-docx.py notas.md
              python3 md-to-docx.py notas.md -o salida/notas.docx
Variables:    input          (posicional) ruta al fichero .md.
              -o / --output  ruta del .docx (por defecto: mismo nombre con .docx junto al .md).
Efectos:      ESCRIBE: el .docx de salida (lo sobrescribe si existe). No modifica el .md.
Salida:       Ruta del .docx generado por stdout.
"""
import argparse
from pathlib import Path
import html
import re
import zipfile


def md_to_docx(md_path: Path, docx_path: Path) -> None:
    text = md_path.read_text(encoding="utf-8")
    lines = text.splitlines()

    # Map markdown headings to font sizes (half-points in Word)
    # h1: 24pt, h2: 18pt, h3: 16pt, body: 11pt
    sizes = {1: 48, 2: 36, 3: 32}
    body_size = 22

    paragraphs = []

    for line in lines:
        raw = line.rstrip()
        if not raw:
            paragraphs.append(("", body_size))
            continue

        # Headings
        m = re.match(r"^(#{1,6})\s+(.*)$", raw)
        if m:
            level = len(m.group(1))
            txt = m.group(2).strip()
            size = sizes.get(level, body_size)
            paragraphs.append((txt, size))
            continue

        # Bold label lines like **Titulo**
        if raw.startswith("**") and raw.endswith("**") and len(raw) > 4:
            txt = raw.strip("*").strip()
            paragraphs.append((txt, body_size))
            continue

        # Strip list markers (-, *, numbered)
        stripped = raw.lstrip()
        if stripped.startswith(("- ", "* ")):
            txt = stripped[2:].strip()
        else:
            if len(stripped) > 2 and stripped[0].isdigit() and stripped[1] == ".":
                txt = stripped[2:].strip()
            else:
                txt = raw

        paragraphs.append((txt, body_size))

    # Build document XML with per-paragraph font size
    p_xml = []
    for p, size in paragraphs:
        if p == "":
            p_xml.append("<w:p/>")
        else:
            esc = html.escape(p)
            p_xml.append(
                "<w:p>"
                "<w:r>"
                f"<w:rPr><w:sz w:val=\"{size}\"/></w:rPr>"
                f"<w:t xml:space=\"preserve\">{esc}</w:t>"
                "</w:r>"
                "</w:p>"
            )

    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
</w:styles>
"""

    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {''.join(p_xml)}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
"""

    content_types_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""

    rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="word/styles.xml"/>
</Relationships>
"""

    # Un .docx es un ZIP con estas 4 piezas mínimas: tipos de contenido, relaciones,
    # documento y estilos.
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/styles.xml", styles_xml)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convierte un Markdown sencillo en un .docx mínimo.")
    parser.add_argument("input", help="Ruta al fichero .md")
    parser.add_argument("-o", "--output", help="Ruta del .docx (por defecto: junto al .md con extensión .docx)")
    args = parser.parse_args()
    md_path = Path(args.input)
    docx_path = Path(args.output) if args.output else md_path.with_suffix(".docx")
    md_to_docx(md_path, docx_path)
    print(str(docx_path))


if __name__ == "__main__":
    main()
