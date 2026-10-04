#!/usr/bin/env python3
# caesar-decrypt.py — descifra un texto cifrado con César de desplazamiento +2
#
# Qué hace:     Lee una cadena por teclado y sustituye cada letra por la que está 2
#               posiciones antes en el alfabeto inglés (c→a, d→b, a→y, b→z).
# Requisitos:   Python 3.
# Uso:          python3 caesar-decrypt.py   (y escribir el texto cuando lo pida)
# Variables:    Ninguna; la entrada se lee de stdin.
# Efectos:      SOLO LECTURA
# Salida:       El texto descifrado, en minúsculas, por pantalla.
#
# Limitación: solo admite letras a-z (sin espacios, números, ñ ni acentos); cualquier
# otro carácter provoca ValueError en letters.index().

print('introduce value: ')
str_to_decrypt = input()
str_to_decrypt = str_to_decrypt.lower()
letters = []
result = []

# Alfabeto ['a', 'b', ..., 'z'] construido a partir del código ASCII de 'a'
for i in range(26):
    letters.append((chr(ord('a') + i)))

for char in str_to_decrypt:
    mask = letters.index(char)
    # mask-2 puede ser negativo (-1, -2): en Python un índice negativo cuenta desde el
    # final, así que 'a' → letters[-2] = 'y'. Eso hace que el alfabeto "dé la vuelta".
    real = letters[mask-2]
    result.append(real)
print(''.join(result))
