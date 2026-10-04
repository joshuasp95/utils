// call-headless-api-with-session.groovy — llama a una API headless de Liferay reutilizando tu sesión de admin
//
// Qué hace:     Toma la sesión HTTP (JSESSIONID) y el token CSRF del administrador que
//               ejecuta la consola, imprime el comando curl equivalente y hace un GET a
//               la URL indicada (por defecto, la API de Objects: object-definitions).
//               Sirve para consultar APIs /o/... sin crear credenciales OAuth2.
// Requisitos:   Liferay 7.4/DXP (con Objects para la URL por defecto). Administrador en
//               Control Panel → Server Administration → Script.
// Uso:          Ajustar url ("← AJUSTAR"), pegar y ejecutar.
// Variables:    url → endpoint GET a consultar. Debe ser accesible DESDE el servidor
//               (por eso "localhost:8080"). Otros ejemplos:
//               http://localhost:8080/o/headless-admin-user/v1.0/my-user-account
// Efectos:      SOLO LECTURA (hace un GET). OJO: imprime JSESSIONID y token CSRF, que
//               permiten actuar como tú mientras la sesión siga viva: no los compartas.
// Salida:       URL, comando curl equivalente y el cuerpo de la respuesta (o la traza
//               de error) en el panel "Output".

import com.liferay.portal.kernel.service.*;
import com.liferay.portal.kernel.security.auth.AuthTokenUtil;
import com.liferay.portal.kernel.util.HashMapBuilder;
import com.liferay.portal.kernel.util.Http;
import com.liferay.portal.kernel.util.HttpUtil;

import javax.servlet.http.HttpServletRequest;

String url = "http://localhost:8080/o/object-admin/v1.0/object-definitions"   // ← AJUSTAR

HttpServletRequest request = _getHttpServletRequest();

String sessionId = request.getSession().getId();
// Token CSRF: Liferay lo exige (cabecera x-csrf-token) en peticiones autenticadas por cookie
String csrfToken = AuthTokenUtil.getToken(request);

out.println("URL: " + url);
out.println("");
out.println("CURL:");
out.println("curl -X 'GET' '" + url + "' -H 'accept: application/json' \\\n\t-H 'Cookie: JSESSIONID=" + sessionId + "' \\\n\t-H 'x-csrf-token: " + csrfToken + "'");
out.println("");
out.println("RESPONSE:");
try {
	out.println(_callRestApiGetMethod(url, sessionId, csrfToken));
}
catch(Throwable t) {
	t.printStackTrace(out);
}


/* Obtiene la petición HTTP actual (la de la consola de scripts) desde el ServiceContext del hilo */

private HttpServletRequest _getHttpServletRequest() {
	ServiceContext serviceContext = ServiceContextThreadLocal.getServiceContext();

	return serviceContext.getRequest();
}


/* Hace un GET con las utilidades HTTP de Liferay, enviando la cookie de sesión y el token CSRF */

private String _callRestApiGetMethod(String url, String sessionId, String csrfToken) {
	Map<String, String> headers = HashMapBuilder.put(
		"Accept", "application/json"
	).put(
		"Cookie", "JSESSIONID=" + sessionId
	).put(
		"x-csrf-token", csrfToken
	).build();

	Http.Options httpOptions = new Http.Options();

	httpOptions.setHeaders(headers);

	httpOptions.setLocation(url);

	httpOptions.setMethod(Http.Method.GET);

	return HttpUtil.URLtoString(httpOptions);
}
