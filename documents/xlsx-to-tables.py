#!/usr/bin/env python3
"""
xlsx-to-tables.py — Convierte la primera hoja de un .xlsx (o un .csv) en Markdown, CSV, TSV y DOCX.

Qué hace:     Lee la PRIMERA hoja de un Excel .xlsx sin librerías externas (abre el ZIP y parsea
              xl/sharedStrings.xml + xl/worksheets/sheet1.xml) o un .csv, y escribe la tabla en
              cuatro formatos: .md (tabla Markdown), .csv, .tsv y .docx (tabla con bordes, página Letter
              apaisado). La primera fila se trata como cabecera.
Requisitos:   Python 3.8+ (solo librería estándar).
Uso:          python3 xlsx-to-tables.py datos/matriz.xlsx
              python3 xlsx-to-tables.py datos/matriz.xlsx --out-dir salida --title "Matriz de skills"
              python3 xlsx-to-tables.py datos/matriz.csv --subtitle "Versión revisada"
Variables:    input          (posicional) ruta al .xlsx o .csv.
              --out-dir      carpeta de salida (por defecto: la del fichero de entrada).
              --title        título del .md y del .docx (por defecto: nombre del fichero sin extensión).
              --subtitle     línea bajo el título en el .docx (por defecto: "Generado desde <fichero>").
Efectos:      ESCRIBE: <out-dir>/<nombre>.md, .csv, .tsv y .docx (sobrescribe si existen).
              Con entrada .csv, el .csv de salida se omite si coincidiría con el de entrada.
Salida:       Ruta de cada fichero generado por stdout.
Limitaciones: Solo la primera hoja. Las celdas vacías que Excel no guarda (filas "dispersas") no se
              rellenan, así que una fila con huecos puede quedar con columnas desplazadas. Las fechas y
              números se devuelven con el valor bruto que guarda Excel (p. ej. fechas como número de serie).
"""
from __future__ import annotations

import argparse
import csv
import html
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET


# Espacio de nombres XML de SpreadsheetML (formato interno de .xlsx).
NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}


def read_xlsx_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as zf:
        # Excel guarda los textos repetidos una sola vez en sharedStrings.xml y las
        # celdas apuntan a ellos por índice (t="s").
        shared_strings = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("a:si", NS):
                texts = [t.text or "" for t in si.iterfind(".//a:t", NS)]
                shared_strings.append("".join(texts))

        sheet = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in sheet.findall(".//a:sheetData/a:row", NS):
            values = []
            for cell in row.findall("a:c", NS):
                values.append(read_cell(cell, shared_strings))
            if any(values):
                rows.append(values)
        return rows


def read_cell(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    value = cell.find("a:v", NS)
    if value is None:
        # Texto en línea (t="inlineStr"): va dentro de <is><t>…</t></is>.
        inline = cell.find("a:is", NS)
        if inline is None:
            return ""
        return "".join(t.text or "" for t in inline.iterfind(".//a:t", NS))
    raw = value.text or ""
    if cell_type == "s":
        return shared_strings[int(raw)]
    return raw


def read_csv_rows(path: Path) -> list[list[str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.reader(handle))


def write_csv(rows: list[list[str]], path: Path, dialect: str) -> None:
    # dialect "excel" = separador coma; "excel-tab" = separador tabulador (TSV).
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, dialect=dialect)
        writer.writerows(rows)


def write_md(rows: list[list[str]], path: Path, title: str, source_name: str) -> None:
    headers = rows[0]
    md_cell = lambda value: value.replace("|", "\\|").replace("\n", " ")
    lines = [
        f"# {title}",
        "",
        f"Fuente de verdad: `{source_name}`.",
        "",
        "| " + " | ".join(md_cell(h) for h in headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    lines += ["| " + " | ".join(md_cell(v) for v in values) + " |" for values in rows[1:]]
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def build_docx(rows: list[list[str]], path: Path, title: str, subtitle: str) -> None:
    # w:sz se expresa en medios puntos: 14 = 7 pt, 12 = 6 pt, 20 = 10 pt.
    def cell(text: str, bold: bool = False, size: int = 14) -> str:
        safe = html.escape(text)
        bold_xml = "<w:b/>" if bold else ""
        return (
            "<w:tc>"
            "<w:tcPr>"
            '<w:tcW w:w="900" w:type="dxa"/>'
            "</w:tcPr>"
            "<w:p>"
            "<w:r>"
            f"<w:rPr>{bold_xml}<w:sz w:val=\"{size}\"/></w:rPr>"
            f"<w:t xml:space=\"preserve\">{safe}</w:t>"
            "</w:r>"
            "</w:p>"
            "</w:tc>"
        )

    def row(cells: list[str], header: bool = False) -> str:
        return "<w:tr>" + "".join(cell(v, bold=header, size=14 if header else 12) for v in cells) + "</w:tr>"

    table_rows = [row(rows[0], header=True)] + [row(r) for r in rows[1:]]
    # pgSz 15840x12240 twips con orient=landscape = página Letter apaisada; pgMar 720 = 1,27 cm.
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:b/><w:sz w:val="20"/></w:rPr>
        <w:t>{html.escape(title)}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:sz w:val="14"/></w:rPr>
        <w:t>{html.escape(subtitle)}</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblLayout w:type="autofit"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:space="0"/>
          <w:left w:val="single" w:sz="4" w:space="0"/>
          <w:bottom w:val="single" w:sz="4" w:space="0"/>
          <w:right w:val="single" w:sz="4" w:space="0"/>
          <w:insideH w:val="single" w:sz="4" w:space="0"/>
          <w:insideV w:val="single" w:sz="4" w:space="0"/>
        </w:tblBorders>
      </w:tblPr>
      {''.join(table_rows)}
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
"""
    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="12"/>
    </w:rPr>
  </w:style>
</w:styles>
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
</Relationships>
"""
    # Un .docx es un ZIP con estas piezas mínimas.
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/styles.xml", styles_xml)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convierte la primera hoja de un .xlsx (o un .csv) en .md, .csv, .tsv y .docx.")
    parser.add_argument("input", help="Ruta al .xlsx o .csv")
    parser.add_argument("--out-dir", help="Carpeta de salida (por defecto: la del fichero de entrada)")
    parser.add_argument("--title", help="Título (por defecto: nombre del fichero sin extensión)")
    parser.add_argument("--subtitle", help='Subtítulo del .docx (por defecto: "Generado desde <fichero>")')
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.out_dir) if args.out_dir else input_path.parent
    title = args.title or input_path.stem
    subtitle = args.subtitle or f"Generado desde {input_path.name}"
    out_dir.mkdir(parents=True, exist_ok=True)

    is_csv = input_path.suffix.lower() == ".csv"
    rows = read_csv_rows(input_path) if is_csv else read_xlsx_rows(input_path)
    if not rows:
        raise SystemExit(f"Error: '{input_path}' no contiene filas")

    base = out_dir / input_path.stem
    outputs = [base.with_suffix(".md"), base.with_suffix(".tsv"), base.with_suffix(".docx")]
    write_md(rows, outputs[0], title, input_path.name)
    write_csv(rows, outputs[1], "excel-tab")
    build_docx(rows, outputs[2], title, subtitle)
    csv_out = base.with_suffix(".csv")
    if not (is_csv and csv_out.resolve() == input_path.resolve()):
        write_csv(rows, csv_out, "excel")
        outputs.append(csv_out)
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
