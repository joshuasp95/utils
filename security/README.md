# security

Utilidades relacionadas con seguridad. De momento, revisión de certificados.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `certificates/check-p7b-certs.sh` | Lista subject e issuer de cada certificado dentro de los `.p7b` de un directorio | SOLO LECTURA |

## Requisitos

- `openssl` (macOS trae LibreSSL, que también soporta `pkcs7`).
- Shell POSIX (`sh`).

## Variables

| Variable / argumento | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|
| `$1` | No (def. `.`) | Directorio con los `.p7b` | Donde descargaste los certificados de la CA |
| `INFORM` | No (def. `PEM`) | Formato del `.p7b`: `PEM` (texto) o `DER` (binario) | `head -1 fichero.p7b`: si ves `-----BEGIN PKCS7-----` es PEM; si salen caracteres raros, DER |

## Ejemplos

```bash
./certificates/check-p7b-certs.sh <DIRECTORIO_CERTS>
INFORM=DER ./certificates/check-p7b-certs.sh <DIRECTORIO_CERTS>
```

Qué hace cada parte del comando `openssl` usado:

- `openssl pkcs7`: subcomando para ficheros PKCS#7 (`.p7b`, `.p7c`).
- `-print_certs`: imprime los certificados que contiene (subject = a quién se emitió, issuer = quién lo firmó).
- `-noout`: no vuelve a imprimir el bloque PKCS#7 codificado.
- `-in <fichero>`: fichero de entrada; `-inform PEM|DER`: formato de entrada.

Para comprobar además fechas de caducidad de cada certificado:

```bash
openssl pkcs7 -print_certs -in <FICHERO>.p7b | openssl x509 -noout -subject -enddate
```

(`x509 -enddate` muestra `notAfter`; ojo, `x509` solo lee el primer certificado del flujo.)
