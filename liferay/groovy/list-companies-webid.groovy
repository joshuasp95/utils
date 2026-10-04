// list-companies-webid.groovy — lista todas las companies (instancias) de Liferay con su webId
//
// Qué hace:     Recorre todas las companies del portal e imprime companyId, webId y
//               virtualHostname. Útil para saber qué webId usar en otros scripts
//               (p. ej. check-user-auth-by-document.groovy).
// Requisitos:   Liferay 7.x/DXP. Usuario administrador con acceso a
//               Control Panel → Server Administration → Script (lenguaje: Groovy).
// Uso:          Pegar el script en la consola de scripts y pulsar "Execute".
// Variables:    Ninguna.
// Efectos:      SOLO LECTURA
// Salida:       Una línea por company en el panel "Output" de la consola.

import com.liferay.portal.kernel.service.CompanyLocalServiceUtil

CompanyLocalServiceUtil.getCompanies().each { c ->
    // webId = identificador textual de la instancia (p. ej. "liferay.com")
    // virtualHostname = host con el que se accede a esa instancia
    println "companyId=${c.companyId} | webId=${c.webId} | virtualHostname=${c.virtualHostname}"
}
