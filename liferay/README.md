# liferay

Scripts Groovy para la **consola de scripts de Liferay** (Control Panel → Server Administration →
Script). Se ejecutan dentro del propio portal, con acceso directo a sus servicios Java
(`*LocalServiceUtil`), así que no necesitan credenciales externas.

## Contenido

| Fichero | Qué hace | Efectos |
|---|---|---|
| `groovy/list-companies-webid.groovy` | Lista las companies (instancias) con `companyId`, `webId` y `virtualHostname` | SOLO LECTURA |
| `groovy/check-users-company.groovy` | Company por defecto, todas las companies, totales de usuarios, primeros N usuarios y sus sites | SOLO LECTURA |
| `groovy/check-user-auth-by-document.groovy` | Busca un usuario por screenName `<TIPO_DOC>_<NUMERO>` y prueba a autenticarlo con una contraseña | SOLO LECTURA (un intento fallido puede sumar al bloqueo por intentos) |
| `groovy/print-mail-effective-config.groovy` | Imprime el valor efectivo de las propiedades de correo SMTP (y las propias que añadas) | SOLO LECTURA (imprime la contraseña SMTP en claro) |
| `groovy/set-temporary-password-and-force-reset.groovy` | Asigna una contraseña temporal aleatoria a un usuario y le obliga a cambiarla | **ESCRIBE**: cambia la contraseña del usuario |
| `groovy/call-headless-api-with-session.groovy` | Hace un GET a una API headless (`/o/...`, por defecto Objects) reutilizando tu sesión de admin, e imprime el `curl` equivalente | SOLO LECTURA (imprime tu `JSESSIONID` y token CSRF) |

## Requisitos

- Liferay 7.x / DXP (7.4+ para la API de Objects del último script).
- Usuario con rol **Administrator** (la consola de scripts solo está disponible para él).
- En DXP recientes la consola puede estar desactivada por seguridad; se habilita en
  System Settings → Script Management.

## Variables

Cada script lleva sus variables arriba, marcadas con `// ← AJUSTAR`.

| Script | Variable | Obligatoria | Qué es | De dónde sacarla |
|---|---|---|---|---|
| `check-user-auth-by-document` | `webId` | Sí | Identificador textual de la company | `list-companies-webid.groovy` |
| | `documentIdType` | Sí | Prefijo del screenName (`DNI`, `NIE`...) | Convención de tu proyecto para el screenName |
| | `docNumber` | Sí | Número de documento del usuario | El propio usuario / ticket |
| | `password` | Sí | Contraseña a probar | El usuario. No la dejes guardada |
| `check-users-company` | `maxUsers` | No (10) | Cuántos usuarios listar | — |
| `print-mail-effective-config` | `keys` | No | Lista de propiedades a mostrar | `portal-ext.properties` de tu proyecto |
| `set-temporary-password-and-force-reset` | `userId` | Sí | Id numérico del usuario (`L` final = tipo `long`) | Control Panel → Users, o `check-user-auth-by-document` |
| `call-headless-api-with-session` | `url` | Sí | Endpoint GET, accesible desde el servidor (`localhost:8080`) | API Explorer: `http://<HOST>/o/api` |

## Uso

1. Control Panel → Server Administration → pestaña **Script**.
2. Lenguaje: **Groovy**.
3. Pega el script, ajusta las variables `← AJUSTAR` y pulsa **Execute**.
4. El resultado aparece debajo, en **Output**.

Nota sobre `println` y `out.println`: en la consola, `out` es el escritor del panel Output; `println`
también suele salir ahí. Los scripts usan uno u otro como en el original.

Orden habitual para un problema de login: `list-companies-webid` → `check-user-auth-by-document` →
(si hace falta) `set-temporary-password-and-force-reset`.
