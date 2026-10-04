// linkedin-reactions-export.js — Exporta a JSON y TXT las publicaciones a las que has reaccionado en LinkedIn.
//
// Qué hace:     Recorre con scroll la pestaña "Reacciones" de tu actividad, expande cada texto y,
//               para cada tarjeta, abre el menú "..." → "Copiar enlace a la publicación". LinkedIn
//               muestra entonces un aviso con el enlace "Ver publicación"; el script lee la URL del
//               post de ese aviso (no lee el portapapeles). Carga lotes hasta que pasan 3 esperas
//               seguidas de 15 s sin tarjetas nuevas y descarga un JSON y un TXT.
//               No descarga imágenes ni vídeos.
// Requisitos:   Navegador de escritorio con sesión iniciada en LinkedIn. Interfaz en español
//               (los textos/aria-label se buscan literalmente; ver CONFIG).
// Uso:          1. Abre https://www.linkedin.com/in/<TU_PERFIL>/recent-activity/reactions/
//               2. DevTools (Cmd+Option+I / F12) → pestaña Console.
//               3. Pega el script completo y pulsa Enter. Mantén la pestaña visible y no la uses.
// Variables:    CONFIG (abajo): textos de la interfaz y prefijo de los ficheros descargados.
// Efectos:      SOLO LECTURA en LinkedIn (abre menús y pulsa "Copiar enlace"; no reacciona ni comenta).
//               OJO: la acción "Copiar enlace" de LinkedIn SOBRESCRIBE tu portapapeles en cada tarjeta.
//               ESCRIBE: dos descargas en la carpeta de descargas del navegador.
// Salida:       <prefijo>-YYYY-MM-DD.json y <prefijo>-YYYY-MM-DD.txt
//               El campo "fin" del JSON indica por qué terminó ("interrumpido" si hubo un error).
(async () => {
  // ─── CONFIGURACIÓN ──────────────────────────────────────────────────────────
  const CONFIG = {
    sufijoRuta: '/recent-activity/reactions/',
    // ← CAMBIAR los textos siguientes si tu LinkedIn no está en español.
    prefijoMenu: 'Abrir el menú de controles para la publicación de',  // aria-label del botón "..."
    textoCopiarEnlace: /Copiar enlace a la publicación/i,               // opción del menú
    textoVerPublicacion: 'Ver publicación',                             // enlace del aviso tras copiar
    textoMas: '… más',                                                  // botón que expande el texto
    prefijoReaccion: 'Estado del botón de reacción:',                   // aria-label del botón de reacción
    prefijoVisibilidad: 'Visibilidad:',                                 // aria-label del icono junto a la fecha
    esperaLoteMs: 15000,      // ← CAMBIAR: cuánto esperar a que llegue un lote nuevo tras hacer scroll
    esperasMaximas: 3,        // ← CAMBIAR: esperas seguidas sin tarjetas nuevas antes de terminar
    prefijoArchivo: 'linkedin-reacciones'                               // ← CAMBIAR nombre de los ficheros
  };

  if (!location.pathname.endsWith(CONFIG.sufijoRuta)) {
    throw new Error('Abre primero la pestaña Reacciones de tu actividad en LinkedIn.');
  }

  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
  const limpio = value => (value || '').trim();
  const resultados = new Map();   // clave = id del <div> de la tarjeta → evita duplicados
  const errores = [];
  let fin = 'interrumpido';       // motivo de finalización; se sobrescribe si termina bien

  // Cada tarjeta de reacción es un div con id "expanded…FeedType_PROFILE_REACTIONS".
  const tarjetas = () => [...document.querySelectorAll(
    'div[id^="expanded"][id$="FeedType_PROFILE_REACTIONS"]'
  )];

  // Lista virtualizada (LazyColumn) y el contenedor <main> que hace scroll.
  const lista = document.querySelector('[data-component-type="LazyColumn"][data-testid^="ProfileRecentActivityReactions"]');
  const scroller = lista?.closest('main') || document.querySelector('main');
  if (!lista || !scroller) throw new Error('No se encontró la lista de reacciones.');

  async function enlaceDelPost(tarjeta) {
    const boton = tarjeta.querySelector(`button[aria-label^="${CONFIG.prefijoMenu}"]`);
    if (!boton) return null;

    // LinkedIn muestra «Ver publicación» en un aviso tras copiar el enlace.
    // La URL va en el parámetro url del enlace del aviso (redirector /safety/go/?url=...).
    // No requiere permiso para leer el portapapeles, aunque la acción de LinkedIn sí lo modifica.
    const enlacesAviso = () => [...document.querySelectorAll('a[href*="/safety/go/"]')]
      .filter(a => a.innerText.trim() === CONFIG.textoVerPublicacion)
      .map(a => new URL(a.href).searchParams.get('url'))
      .filter(Boolean);
    // Avisos que ya estaban en pantalla: así solo se acepta el enlace NUEVO de esta tarjeta.
    const anteriores = new Set(enlacesAviso());
    boton.click();
    let opcion = null;
    // Espera hasta 4 s a que el menú pinte la opción "Copiar enlace".
    for (let i = 0; i < 40; i++) {
      opcion = [...tarjeta.querySelectorAll('[role="menuitem"]')]
        .find(x => CONFIG.textoCopiarEnlace.test(x.innerText));
      if (opcion) break;
      await esperar(100);
    }
    if (!opcion) throw new Error('No apareció «Copiar enlace a la publicación».');
    opcion.click();
    // Espera hasta 6 s a que aparezca el aviso con un enlace distinto de los anteriores.
    for (let i = 0; i < 60; i++) {
      const nuevo = enlacesAviso().find(url => !anteriores.has(url));
      if (nuevo && /^https?:\/\//.test(nuevo)) return nuevo;
      await esperar(100);
    }
    throw new Error('LinkedIn no mostró un enlace nuevo tras «Copiar enlace».');
  }

  async function recoger() {
    for (const tarjeta of tarjetas()) {
      const clave = tarjeta.id;
      if (resultados.has(clave)) continue;

      const botonMas = [...tarjeta.querySelectorAll('button')]
        .find(b => b.innerText.trim() === CONFIG.textoMas);
      botonMas?.click();
      await esperar(50);

      // El autor se deduce del aria-label del botón de menú ("... publicación de <Autor>").
      const botonMenu = tarjeta.querySelector(`button[aria-label^="${CONFIG.prefijoMenu}"]`);
      const autor = limpio(botonMenu?.getAttribute('aria-label')
        ?.replace(new RegExp(`^${CONFIG.prefijoMenu}\\s*`), '')) || '(Autor no visible)';
      const linksAutor = [...tarjeta.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')];
      const linkAutor = linksAutor.find(a => limpio(a.innerText).includes(autor));
      // Párrafo del cuerpo del post: LinkedIn lo marca con una variable CSS (--ckyjt). Frágil: revisar si cambia.
      const parrafo = tarjeta.querySelector('p[style*="--ckyjt"]');
      const descripcion = limpio(parrafo?.innerText).replace(/\s*… más\s*$/, '');
      const titulo = limpio(descripcion.split('\n').find(Boolean)).slice(0, 160)
        || '(Publicación sin texto visible)';
      const fechaParrafo = [...tarjeta.querySelectorAll('p')]
        .find(p => p.querySelector(`svg[aria-label^="${CONFIG.prefijoVisibilidad}"]`));
      const reaccionBoton = tarjeta.querySelector(`button[aria-label^="${CONFIG.prefijoReaccion}"]`);

      let urlPost = null;
      try { urlPost = await enlaceDelPost(tarjeta); }
      catch (error) { errores.push({ autor, error: String(error) }); }

      resultados.set(clave, {
        titulo,
        autor,
        descripcion,
        fecha_relativa: limpio(fechaParrafo?.innerText).replace(/\s*•\s*$/, ''),
        reaccion: limpio(reaccionBoton?.getAttribute('aria-label')
          ?.replace(CONFIG.prefijoReaccion, '')),
        url_post: urlPost,
        url_autor: linkAutor?.href || null,
        contiene_video: !!tarjeta.querySelector('video, [role="region"][aria-label="Video Player"]'),
        contiene_imagen: !!tarjeta.querySelector('img[alt="Ver imagen"]'),
        id_tarjeta: clave
      });
      if (resultados.size % 10 === 0) console.log(`Reacciones recogidas: ${resultados.size}`);
    }
  }

  // Descarga un fichero generado en memoria. '﻿' (BOM) ayuda a Excel/Windows a detectar UTF-8.
  function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(new Blob(['﻿', contenido], { type: tipo }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  try {
    let esperasSinNuevas = 0;
    while (esperasSinNuevas < CONFIG.esperasMaximas) {
      await recoger();
      const idsAntes = new Set(tarjetas().map(t => t.id));

      // Lleva al final real del contenedor; LinkedIn añade lotes con retraso.
      // El último elemento también activa el observador de scroll infinito de LinkedIn.
      lista.lastElementChild?.scrollIntoView({ block: 'end' });
      scroller.scrollTop = scroller.scrollHeight;
      // Comprueba cada 100 ms si ha aparecido alguna tarjeta con id nuevo.
      let nuevas = false;
      for (let i = 0; i < CONFIG.esperaLoteMs / 100; i++) {
        await esperar(100);
        if (tarjetas().some(t => !idsAntes.has(t.id))) {
          nuevas = true;
          break;
        }
      }
      if (nuevas) {
        esperasSinNuevas = 0;
      } else {
        esperasSinNuevas++;
        console.log(`Sin lote nuevo tras ${CONFIG.esperaLoteMs / 1000} s (${esperasSinNuevas}/${CONFIG.esperasMaximas}). Cargadas: ${tarjetas().length}`);
      }
    }
    await recoger();
    fin = `sin nuevos resultados tras ${CONFIG.esperasMaximas} esperas de ${CONFIG.esperaLoteMs / 1000} segundos`;
  } catch (error) {
    errores.push({ error: String(error) });
    console.error(error);
  }

  const reacciones = [...resultados.values()];
  const fecha = new Date().toISOString().slice(0, 10);
  const datos = { exportado_en: new Date().toISOString(), fin,
    total: reacciones.length, sin_url: reacciones.filter(r => !r.url_post).length,
    errores, reacciones };
  const txt = reacciones.map((r, i) => [
    `${i + 1}. ${r.titulo}`, `Autor: ${r.autor}`, `Fecha visible: ${r.fecha_relativa}`,
    `Reacción: ${r.reaccion}`, `URL del post: ${r.url_post || '(No disponible)'}`,
    `Perfil: ${r.url_autor || ''}`, `Vídeo: ${r.contiene_video ? 'sí' : 'no'}`,
    `Imagen: ${r.contiene_imagen ? 'sí' : 'no'}`, '', r.descripcion,
    '\n' + '='.repeat(70)
  ].join('\n')).join('\n\n');

  descargar(`${CONFIG.prefijoArchivo}-${fecha}.json`, JSON.stringify(datos, null, 2),
    'application/json;charset=utf-8');
  await esperar(500);   // algunos navegadores bloquean dos descargas simultáneas
  descargar(`${CONFIG.prefijoArchivo}-${fecha}.txt`, txt, 'text/plain;charset=utf-8');
  console.log(`Exportadas ${reacciones.length} reacciones; ${datos.sin_url} sin URL. Fin: ${fin}`);
})();
