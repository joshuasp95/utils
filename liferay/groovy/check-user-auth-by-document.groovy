// check-user-auth-by-document.groovy — comprueba si un usuario existe y si una contraseña le autentica
//
// Qué hace:     Busca un usuario cuyo screenName sigue el patrón "<TIPO_DOC>_<NUMERO_DOC>"
//               (convención usada cuando el login es por documento de identidad) e intenta
//               autenticarlo con la contraseña indicada. Imprime el estado del usuario y el
//               código de resultado de la autenticación.
// Requisitos:   Liferay 7.x/DXP. Administrador en Control Panel → Server Administration → Script.
// Uso:          Ajustar las variables marcadas con "← AJUSTAR", pegar y ejecutar.
// Variables:    webId          → webId de la company (sacarlo con list-companies-webid.groovy).
//               documentIdType → prefijo del screenName (p. ej. "DNI", "NIE").
//               docNumber      → número de documento del usuario.
//               password       → contraseña a probar.
// Efectos:      SOLO LECTURA en datos de usuario. OJO: un intento fallido de autenticación
//               puede contar como intento fallido para la política de bloqueo (lockout).
// Salida:       Datos del usuario, código y estado de autenticación y el resultsMap.
//
// AVISO: no dejes la contraseña real guardada en el script ni en el historial de la consola.

import com.liferay.portal.kernel.service.CompanyLocalServiceUtil
import com.liferay.portal.kernel.service.UserLocalServiceUtil
import com.liferay.portal.kernel.security.auth.Authenticator

def webId = "liferay.com"              // ← AJUSTAR
def documentIdType = "DNI"             // ← AJUSTAR
def docNumber = "<NUMERO_DOCUMENTO>"   // ← AJUSTAR
def password = "<CLAVE_A_PROBAR>"      // ← AJUSTAR

def company = CompanyLocalServiceUtil.getCompanyByWebId(webId)
def screenName = "${documentIdType}_${docNumber}"

println "CompanyId: ${company.companyId}"
println "ScreenName buscado: ${screenName}"

// fetch* devuelve null si no existe (get* lanzaría excepción)
def user = UserLocalServiceUtil.fetchUserByScreenName(company.companyId, screenName)

if (user == null) {
    println "RESULTADO: NO existe usuario Liferay con ese screenName."
    return
}

println "RESULTADO: Usuario encontrado."
println "userId=${user.userId}, email=${user.emailAddress}, status=${user.status}, lockout=${user.lockout}, active=${user.active}"

// authenticateByScreenName(companyId, screenName, password, headerMap, parameterMap, resultsMap)
// Pasa por la cadena de autenticadores configurada (incluido LDAP si está activo).
def resultsMap = [:]
int auth = UserLocalServiceUtil.authenticateByScreenName(
    company.companyId,
    screenName,
    password,
    [:],
    [:],
    resultsMap
)

// Traducción de las constantes de Authenticator a texto legible
println "Auth code: ${auth}"
println "Auth status: " + (
    auth == Authenticator.SUCCESS ? "SUCCESS" :
    auth == Authenticator.FAILURE ? "FAILURE" :
    auth == Authenticator.DNE ? "DNE" :
    auth == Authenticator.PASSWORD_EXPIRED ? "PASSWORD_EXPIRED" :
    auth == Authenticator.INVALID_PASSWORD ? "INVALID_PASSWORD" :
    auth == Authenticator.INVALID_SCREEN_NAME ? "INVALID_SCREEN_NAME" :
    "OTRO (${auth})"
)

println "resultsMap=${resultsMap}"
