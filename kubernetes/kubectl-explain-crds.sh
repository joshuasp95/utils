#!/usr/bin/env bash
set -uo pipefail

# kubectl-explain-crds.sh — guarda en ficheros la documentación de campos (kubectl explain) de varios recursos.
#
# Qué hace:     Para cada recurso pasado como argumento ejecuta
#               `kubectl explain <recurso>.<FIELD> --recursive` y guarda el árbol completo de campos
#               en <OUT_DIR>/<recurso>.<FIELD>. Útil para tener a mano el esquema de CRDs
#               (Custom Resource Definitions: recursos que añade un operador) y compararlo entre versiones.
# Requisitos:   kubectl con acceso a un cluster donde estén instaladas esas CRDs
#               (`kubectl get crd` para ver cuáles hay).
# Uso:          ./kubectl-explain-crds.sh kafka schemaregistry connect controlcenter
#               OUT_DIR=specs-v2 FIELD=status ./kubectl-explain-crds.sh kafka
# Variables:    $@        nombres de recurso (singular, plural o shortname; `kubectl api-resources`).
#               OUT_DIR   directorio de salida (def. ./specs).
#               FIELD     campo raíz a documentar (def. spec).
# Efectos:      SOLO LECTURA en el cluster (explain solo consulta el esquema OpenAPI).
#               ESCRIBE: un fichero por recurso en OUT_DIR (se sobreescribe si existe).
# Salida:       <OUT_DIR>/<recurso>.<FIELD>

OUT_DIR="${OUT_DIR:-specs}"
FIELD="${FIELD:-spec}"

if [ $# -eq 0 ]; then
  echo "Uso: $0 <recurso> [recurso ...]   (ej: $0 kafka connect)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
for resource in "$@"; do
  # --recursive: muestra todos los campos anidados de una vez (sin descripciones largas).
  # Sin `set -e` a propósito: si un recurso falla (CRD no instalada), se avisa y se sigue con el resto.
  if kubectl explain "$resource.$FIELD" --recursive > "$OUT_DIR/$resource.$FIELD"; then
    echo "$OUT_DIR/$resource.$FIELD"
  else
    echo "fallo: $resource (¿existe la CRD? kubectl api-resources | grep -i $resource)" >&2
  fi
done
