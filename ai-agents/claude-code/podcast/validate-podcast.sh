#!/usr/bin/env bash
# validate-podcast.sh — comprueba que un guion de podcast cumple las reglas de formato
# para Edge Read Aloud. Solo lee: nunca modifica el fichero.
#
# Comprueba:
#   - BOM UTF-8 presente (Edge detecta asi la codificacion y pronuncia bien los acentos)
#   - ausencia de Markdown, vinetas, tablas y etiquetas
#   - ausencia de emojis, flechas, rayas largas y comillas tipograficas
#   - digitos sueltos (los numeros deben ir escritos con palabras)
#   - longitud orientativa y parrafos separados por linea en blanco
#
# Codigos de salida:
#   0  cumple
#   1  error de uso
#   2  incumple alguna regla obligatoria
#   3  cumple lo obligatorio, con avisos
#
# Requisitos:   bash, grep -E, od, python3 (para leer UTF-8 con BOM y detectar emojis).
# Uso:          ./validate-podcast.sh guion.txt
# Variables:    $1 → ruta al guion en texto plano.
# Efectos:      SOLO LECTURA (crea un temporal con mktemp que se borra al salir).
# Salida:       Lineas "ok / AVISO / ERROR" y un RESULTADO final por stdout.

set -uo pipefail

SCRIPT_NAME="$(basename "$0")"
ERRORS=0
WARNINGS=0

usage() {
  cat <<EOF
$SCRIPT_NAME — valida un guion de podcast para Edge Read Aloud (solo lectura)

Uso:
  $SCRIPT_NAME <ruta-al-guion.txt>

Salida: lista de incumplimientos (ERROR) y avisos (AVISO).
Codigos: 0 correcto | 1 uso incorrecto | 2 incumple | 3 correcto con avisos
EOF
}

err()  { printf 'ERROR  %s\n' "$1"; ERRORS=$((ERRORS+1)); }
warn() { printf 'AVISO  %s\n' "$1"; WARNINGS=$((WARNINGS+1)); }
ok()   { printf 'ok     %s\n' "$1"; }

[ $# -eq 1 ] || { usage >&2; exit 1; }
case "$1" in -h|--help) usage; exit 0 ;; esac
F="$1"
[ -f "$F" ] || { printf '%s: no existe el fichero: %s\n' "$SCRIPT_NAME" "$F" >&2; exit 1; }

printf 'Validando: %s\n\n' "$F"

# --- BOM -------------------------------------------------------------------
if head -c 3 "$F" | od -An -tx1 | tr -d ' \n' | grep -q '^efbbbf'; then
  ok "BOM UTF-8 presente"
else
  err "falta el BOM UTF-8 (Edge puede leer mal los acentos)"
fi

# Cuerpo sin BOM, para el resto de comprobaciones
BODY="$(mktemp)"; trap 'rm -f "$BODY"' EXIT
python3 -c "
import sys
src, dst = sys.argv[1], sys.argv[2]
open(dst, 'w', encoding='utf-8').write(open(src, encoding='utf-8-sig').read())
" "$F" "$BODY" 2>/dev/null || { err "el fichero no es UTF-8 valido"; exit 2; }

# --- Markdown y estructura visual -----------------------------------------
check_absent() { # patron  mensaje  nivel
  local pat="$1" msg="$2" lvl="$3" n
  n="$(grep -cE "$pat" "$BODY" 2>/dev/null || true)"
  n="${n:-0}"
  if [ "$n" -gt 0 ]; then
    [ "$lvl" = "err" ] && err "$msg ($n lineas)" || warn "$msg ($n lineas)"
    grep -nE "$pat" "$BODY" 2>/dev/null | head -3 | sed 's/^/         /' | cut -c1-100
  fi
}

check_absent '^#{1,6} '            'titulos Markdown'                        err
check_absent '^[[:space:]]*[-*+][[:space:]]+' 'vinetas de lista'             err
check_absent '^[[:space:]]*[0-9]+[.)][[:space:]]+' 'listas numeradas'        err
check_absent '\|.*\|'              'tablas'                                  err
check_absent '\*\*|__'             'negrita Markdown'                        err
check_absent '`'                   'comillas de codigo'                      err
check_absent '<[a-zA-Z/][^>]*>'    'etiquetas HTML/XML'                      err

# --- Caracteres problematicos para lectura en voz alta ---------------------
# Se comprueba con Python porque los rangos unicode de grep -E no son fiables
# (un rango mal interpretado daba falsos positivos con las vocales acentuadas).
CHARCHECK="$(python3 - "$BODY" <<'PY'
import sys, unicodedata
from collections import Counter

texto = open(sys.argv[1], encoding='utf-8').read()

def es_emoji(c):
    o = ord(c)
    return (0x1F000 <= o <= 0x1FAFF) or (0x2600 <= o <= 0x27BF) or (0xFE0F == o)

categorias = {
    'comillas tipograficas': set('‘’“”'),
    'rayas largas':          set('–—'),
    'flechas':               set('←↑→↓↔⇐⇒⇔'),
    'simbolos de vineta':    set('•·●▪◦'),
    'puntos suspensivos':    set('…'),
}

hallazgos = []
for nombre, conjunto in categorias.items():
    encontrados = Counter(c for c in texto if c in conjunto)
    if encontrados:
        detalle = ' '.join(f'{c!r}x{n}' for c, n in encontrados.items())
        hallazgos.append(f'{nombre}: {detalle}')

emojis = Counter(c for c in texto if es_emoji(c))
if emojis:
    detalle = ' '.join(f'{unicodedata.name(c, "?")}x{n}' for c, n in emojis.items())
    hallazgos.append(f'emojis o iconos: {detalle}')

print('\n'.join(hallazgos))
PY
)"
if [ -n "$CHARCHECK" ]; then
  while IFS= read -r linea; do
    [ -n "$linea" ] && err "$linea"
  done <<< "$CHARCHECK"
else
  ok "sin caracteres problematicos para lectura en voz alta"
fi

# --- Numeros en digitos ----------------------------------------------------
DIGITS="$(grep -oE '[0-9]+' "$BODY" 2>/dev/null | wc -l | tr -d ' ')"
if [ "${DIGITS:-0}" -gt 0 ]; then
  err "hay $DIGITS numeros en digitos; deben escribirse con palabras"
  grep -nE '[0-9]+' "$BODY" 2>/dev/null | head -3 | sed 's/^/         /' | cut -c1-100
else
  ok "sin digitos sueltos"
fi

# --- Acentos (deben existir: el espanol natural los lleva) ----------------
if grep -qE '[áéíóúñüÁÉÍÓÚÑÜ¿¡]' "$BODY" 2>/dev/null; then
  ok "espanol natural con acentos"
else
  warn "no se detectan acentos ni enyes; comprueba que el texto esta en espanol natural"
fi

# --- Longitud y parrafos ---------------------------------------------------
WORDS="$(wc -w < "$BODY" | tr -d ' ')"
MINUTES=$(( WORDS / 150 ))
if [ "$WORDS" -lt 400 ]; then
  warn "solo $WORDS palabras (~$MINUTES min): muy corto para un podcast"
elif [ "$WORDS" -gt 6000 ]; then
  warn "$WORDS palabras (~$MINUTES min): valora dividirlo en varios guiones"
else
  ok "$WORDS palabras (~$MINUTES min de escucha)"
fi

PARAS="$(grep -c '^[[:space:]]*$' "$BODY" 2>/dev/null || echo 0)"
if [ "${PARAS:-0}" -lt 3 ]; then
  warn "pocos saltos de parrafo ($PARAS): el lector de voz no pausara bien"
else
  ok "$PARAS separaciones de parrafo"
fi

# --- Resultado -------------------------------------------------------------
printf '\n'
if [ "$ERRORS" -gt 0 ]; then
  printf 'RESULTADO: %d incumplimiento(s), %d aviso(s)\n' "$ERRORS" "$WARNINGS"
  exit 2
elif [ "$WARNINGS" -gt 0 ]; then
  printf 'RESULTADO: cumple, con %d aviso(s)\n' "$WARNINGS"
  exit 3
fi
printf 'RESULTADO: cumple todas las reglas\n'
exit 0
