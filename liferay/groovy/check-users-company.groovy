// check-users-company.groovy — resumen de companies y usuarios de la instancia por defecto
//
// Qué hace:     Muestra la company por defecto, todas las companies, el total de usuarios
//               (global y de la company por defecto), los primeros N usuarios y los sites
//               a los que pertenece cada uno.
// Requisitos:   Liferay 7.x/DXP. Administrador en Control Panel → Server Administration → Script.
// Uso:          Ajustar maxUsers si quieres ver más usuarios, pegar y ejecutar.
// Variables:    maxUsers → cuántos usuarios listar (los primeros por orden interno).
// Efectos:      SOLO LECTURA
// Salida:       Bloques de texto en el panel "Output".
//
// Nota: el original eran varios fragmentos pegados uno detrás de otro (con imports en
// medio). Aquí se han unido en un único script ejecutable sin cambiar lo que se imprime.

import com.liferay.portal.kernel.service.CompanyLocalServiceUtil
import com.liferay.portal.kernel.service.UserLocalServiceUtil
import com.liferay.portal.kernel.util.PortalUtil

int maxUsers = 10   // ← AJUSTAR

// Total de usuarios de todo el portal (todas las companies)
def number = UserLocalServiceUtil.getUsersCount()
out.println(number)

// Company por defecto: la que se usa si no hay virtual host que indique otra
long companyId = PortalUtil.getDefaultCompanyId()
def c = CompanyLocalServiceUtil.getCompany(companyId)
println "Default companyId=${companyId} webId=${c.webId} mx=${c.mx} name=${c.name}"

// Primeros usuarios de la company por defecto (start=0, end=maxUsers)
def users = UserLocalServiceUtil.getCompanyUsers(companyId, 0, maxUsers)
users.each { u ->
    println "${u.userId} | ${u.screenName} | ${u.emailAddress} | activo=${u.active} | status=${u.status}"
}

// Todas las companies (mx = dominio de correo de la instancia)
CompanyLocalServiceUtil.getCompanies().each { comp ->
    println "companyId=${comp.companyId} | webId=${comp.webId} | mx=${comp.mx} | name=${comp.name}"
}

def count = UserLocalServiceUtil.getUsersCount()
println "Total usuarios globales: ${count}"

def companyUsersCount = UserLocalServiceUtil.getCompanyUsersCount(companyId)
println "Usuarios en company ${companyId}: ${companyUsersCount}"

// Sites (groups) de cada uno de los usuarios listados arriba
users.each { u ->
    println "---- ${u.emailAddress}"
    u.getGroups().each { g ->
        println "   Site: ${g.name}"
    }
}
