print('introduce value: ')
str_to_decrypt = input()
str_to_decrypt = str_to_decrypt.lower()
letters = []
result = []

for i in range(26):
    letters.append((chr(ord('a') + i)))

for char in str_to_decrypt:
    mask = letters.index(char)
    real = letters[mask-2]
    result.append(real)
print(''.join(result))
