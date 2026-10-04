// set-temporary-password-and-force-reset.groovy — pone una contraseña temporal a un usuario y le obliga a cambiarla
//
// Qué hace:     Genera una contraseña aleatoria de 12 caracteres, se la asigna al usuario
//               indicado y marca passwordReset=true para que Liferay le pida cambiarla en
//               el siguiente login.
// Requisitos:   Liferay 7.x/DXP. Administrador en Control Panel → Server Administration → Script.
// Uso:          Ajustar userId ("← AJUSTAR"), pegar y ejecutar.
// Variables:    userId → id numérico del usuario (Control Panel → Users, o con
//               check-user-auth-by-document.groovy). El sufijo "L" indica tipo long en Groovy.
// Efectos:      ESCRIBE: cambia la contraseña del usuario y activa passwordReset.
//               La contraseña anterior deja de funcionar. No se puede deshacer.
// Salida:       La contraseña temporal generada (en claro) y confirmación del reset.
//
// AVISO: la contraseña temporal aparece en el Output; compártela por un canal seguro.

import com.liferay.portal.kernel.service.UserLocalServiceUtil
import com.liferay.portal.kernel.util.PwdGenerator

long userId = 12345L                          // ← AJUSTAR
String tempPwd = PwdGenerator.getPassword(12) // 12 = longitud de la contraseña

// updatePassword(userId, password1, password2, passwordReset, silentUpdate)
//   passwordReset=true  → obliga a cambiarla en el próximo login
//   silentUpdate=false  → aplica validaciones de la política de contraseñas
UserLocalServiceUtil.updatePassword(userId, tempPwd, tempPwd, true, false)
UserLocalServiceUtil.updatePasswordReset(userId, true)

println "Temp password generada: ${tempPwd}"
println "passwordReset=true aplicado para userId=${userId}"
