# misc

Scripts sueltos que no encajan en otra categoría.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `caesar-decrypt.py` | Descifra un texto cifrado con César de desplazamiento +2 (cada letra pasa a la que está 2 posiciones antes: `c→a`, `a→y`). Antes era `python/decrypt.py` | SOLO LECTURA |

## Requisitos

- Python 3.

## Variables

Ninguna: el texto se lee por teclado.

## Uso

```bash
python3 caesar-decrypt.py
# introduce value:
# jgnnq
# hello
```

Limitación: solo admite letras `a-z`; espacios, números, `ñ` o acentos provocan un `ValueError`.
