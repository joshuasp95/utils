#!/bin/sh

# check-p7b-certs.sh — muestra los certificados contenidos en cada fichero .p7b de un directorio.
#
# Qué hace:     Recorre los *.p7b del directorio indicado y, para cada uno, imprime el subject y el
#               issuer de todos los certificados que contiene (cadena completa: hoja, intermedias, raíz).
#               Un .p7b (PKCS#7) es un "paquete" de certificados sin clave privada, típico al recibir
#               un certificado firmado por una CA.
# Requisitos:   openssl (cualquier versión con el subcomando pkcs7), sh POSIX.
# Uso:          ./check-p7b-certs.sh                      # directorio actual
#               ./check-p7b-certs.sh <DIRECTORIO>
#               INFORM=DER ./check-p7b-certs.sh <DIRECTORIO>   # si los .p7b son binarios
# Variables:    $1      directorio con los .p7b (def. el actual).
#               INFORM  formato de entrada: PEM (texto, empieza por -----BEGIN PKCS7-----) o DER
#                       (binario). Def. PEM.
# Efectos:      SOLO LECTURA (no modifica ni convierte ficheros).
# Salida:       Por pantalla: nombre de cada fichero seguido de subject= / issuer= de cada certificado.

DIR="${1:-.}"
INFORM="${INFORM:-PEM}"

for f in "$DIR"/*.p7b; do
    # Si no hay ningún .p7b, el patrón queda sin expandir: se ignora.
    [ -e "$f" ] || continue
    echo "------------------------------------------------------"
    echo "$f"
    # -print_certs: lista los certificados; -noout: sin volcar el PKCS#7 en sí.
    openssl pkcs7 -print_certs -noout -in "$f" -inform "$INFORM"
done
