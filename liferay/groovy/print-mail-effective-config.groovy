// print-mail-effective-config.groovy — imprime la configuración de correo efectiva del portal
//
// Qué hace:     Lee con PropsUtil el valor efectivo (el que Liferay está usando, tras
//               combinar portal.properties, portal-ext.properties y variables de entorno)
//               de las propiedades de correo SMTP y de las propiedades propias que añadas.
// Requisitos:   Liferay 7.x/DXP. Administrador en Control Panel → Server Administration → Script.
// Uso:          Añadir/quitar claves en la lista "← AJUSTAR", pegar y ejecutar.
// Variables:    keys → lista de propiedades a mostrar.
// Efectos:      SOLO LECTURA
// Salida:       "clave = valor" por línea. Si una clave no existe se imprime "null".
//
// AVISO: mail.session.mail.smtp.password se imprime en claro. Quítala de la lista si vas
// a copiar la salida a un ticket o a un chat.
//
// Nota: si el correo se configuró desde Control Panel → Server Administration → Mail,
// esos valores se guardan en base de datos (PortalPreferences) y pueden no coincidir
// con lo que devuelve PropsUtil.

import com.liferay.portal.kernel.util.PropsUtil

def keys = [                                   // ← AJUSTAR
    "mail.session.jndi.name",
    "mail.session.mail.smtp.host",
    "mail.session.mail.smtp.port",
    "mail.session.mail.smtp.user",
    "mail.session.mail.smtp.auth",
    "mail.session.mail.smtp.starttls.enable",
    "mail.session.mail.smtp.password",
    // Propiedades propias de tu proyecto, por ejemplo:
    // "environment.name.<PROYECTO>",
    // "emails.<PROYECTO>.to.address",
]

keys.each { key ->
    println "${key} = ${PropsUtil.get(key)}"
}
