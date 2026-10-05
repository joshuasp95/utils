// Ejecutar en una página /recent-activity/reactions/ de LinkedIn.
// Solo exporta texto y metadatos. No descarga imágenes ni vídeos.
(async () => {
  const version = '2026-10-05.2';
  if (!location.pathname.endsWith('/recent-activity/reactions/')) {
    throw new Error('Abre primero la pestaña Reacciones de tu actividad en LinkedIn.');
  }

  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
  const limpio = value => (value || '').trim();
  const resultados = new Map();
  const errores = [];
  let fin = 'interrumpido';

  const tarjetas = () => [...document.querySelectorAll(
    'div[id^="expanded"][id$="FeedType_PROFILE_REACTIONS"]'
  )];

  const lista = document.querySelector('[data-component-type="LazyColumn"][data-testid^="ProfileRecentActivityReactions"]');
  const scroller = lista?.closest('main') || document.querySelector('main');
  if (!lista || !scroller) throw new Error('No se encontró la lista de reacciones.');
  console.log(`Exportador de reacciones ${version}`);
  scroller.scrollTop = 0;
  await esperar(300);

  async function enlaceDelPost(tarjeta) {
    const boton = tarjeta.querySelector('button[aria-label^="Abrir el menú de controles para la publicación de"]');
    if (!boton) return null;

    // LinkedIn muestra «Ver publicación» en un aviso tras copiar el enlace.
    // La URL va en el parámetro url del enlace del aviso. No requiere permiso
    // para leer el portapapeles, aunque la acción de LinkedIn sí lo modifica.
    const enlacesAviso = () => [...document.querySelectorAll('a[href*="/safety/go/"]')]
      .filter(a => a.innerText.trim() === 'Ver publicación');
    const anteriores = new Set(enlacesAviso());
    boton.click();
    let opcion = null;
    for (let i = 0; i < 40; i++) {
      // El menú se monta en un portal fuera de la tarjeta.
      opcion = [...document.querySelectorAll('[role="menuitem"]')]
        .find(x => /Copiar enlace a la publicación/i.test(x.innerText)
          && x.getClientRects().length > 0);
      if (opcion) break;
      await esperar(100);
    }
    if (!opcion) throw new Error('No apareció «Copiar enlace a la publicación».');
    opcion.click();
    for (let i = 0; i < 60; i++) {
      const enlaceNuevo = enlacesAviso().find(a => !anteriores.has(a));
      const nuevo = enlaceNuevo && new URL(enlaceNuevo.href).searchParams.get('url');
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
        .find(b => b.innerText.trim() === '… más');
      botonMas?.click();
      await esperar(50);

      const botonMenu = tarjeta.querySelector('button[aria-label^="Abrir el menú de controles para la publicación de"]');
      const autor = limpio(botonMenu?.getAttribute('aria-label')
        ?.replace(/^Abrir el menú de controles para la publicación de\s*/, '')) || '(Autor no visible)';
      const linksAutor = [...tarjeta.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')];
      const linkAutor = linksAutor.find(a => limpio(a.innerText).includes(autor));
      const parrafo = tarjeta.querySelector('p[style*="--ckyjt"]');
      const descripcion = limpio(parrafo?.innerText).replace(/\s*… más\s*$/, '');
      const titulo = limpio(descripcion.split('\n').find(Boolean)).slice(0, 160)
        || '(Publicación sin texto visible)';
      const fechaParrafo = [...tarjeta.querySelectorAll('p')]
        .find(p => p.querySelector('svg[aria-label^="Visibilidad:"]'));
      const reaccionBoton = tarjeta.querySelector('button[aria-label^="Estado del botón de reacción:"]');
      const actividad = limpio(tarjeta.querySelector('p')?.innerText);

      let urlPost = null;
      try { urlPost = await enlaceDelPost(tarjeta); }
      catch (error) { errores.push({ autor, error: String(error) }); }

      resultados.set(clave, {
        titulo,
        autor,
        descripcion,
        actividad,
        fecha_relativa: limpio(fechaParrafo?.innerText).replace(/\s*•\s*$/, ''),
        reaccion: limpio(reaccionBoton?.getAttribute('aria-label')
          ?.replace('Estado del botón de reacción:', '')),
        url_post: urlPost,
        url_autor: linkAutor?.href || null,
        contiene_video: !!tarjeta.querySelector('video, [role="region"][aria-label="Video Player"]'),
        contiene_imagen: !!tarjeta.querySelector('img[alt="Ver imagen"]'),
        id_tarjeta: clave
      });
      if (resultados.size % 10 === 0) console.log(`Reacciones recogidas: ${resultados.size}`);
    }
  }

  function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(new Blob(['\uFEFF', contenido], { type: tipo }));
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
    while (esperasSinNuevas < 3) {
      await recoger();
      const idsAntes = new Set(tarjetas().map(t => t.id));

      // Lleva al final real del contenedor; LinkedIn añade lotes con retraso.
      // Retroceder y volver al borde reactiva el observador si quedó inmóvil.
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight * 2);
      await esperar(150);
      lista.lastElementChild?.scrollIntoView({ block: 'end' });
      scroller.scrollTop = scroller.scrollHeight;
      let nuevas = false;
      for (let i = 0; i < 150; i++) {
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
        console.log(`Sin lote nuevo tras 15 s (${esperasSinNuevas}/3). Cargadas: ${tarjetas().length}`);
      }
    }
    await recoger();
    fin = 'sin nuevos resultados tras 3 esperas de 15 segundos';
  } catch (error) {
    errores.push({ error: String(error) });
    console.error(error);
  }

  const reacciones = [...resultados.values()];
  const fecha = new Date().toISOString().slice(0, 10);
  const datos = { version, exportado_en: new Date().toISOString(), fin,
    total: reacciones.length, sin_url: reacciones.filter(r => !r.url_post).length,
    errores, reacciones };
  const txt = reacciones.map((r, i) => [
    `${i + 1}. ${r.titulo}`, `Autor: ${r.autor}`, `Fecha visible: ${r.fecha_relativa}`,
    `Actividad: ${r.actividad}`, `Reacción: ${r.reaccion}`,
    `URL del post: ${r.url_post || '(No disponible)'}`,
    `Perfil: ${r.url_autor || ''}`, `Vídeo: ${r.contiene_video ? 'sí' : 'no'}`,
    `Imagen: ${r.contiene_imagen ? 'sí' : 'no'}`, '', r.descripcion,
    '\n' + '='.repeat(70)
  ].join('\n')).join('\n\n');

  descargar(`linkedin-reacciones-${fecha}.json`, JSON.stringify(datos, null, 2),
    'application/json;charset=utf-8');
  await esperar(500);
  descargar(`linkedin-reacciones-${fecha}.txt`, txt, 'text/plain;charset=utf-8');
  console.log(`Exportadas ${reacciones.length} reacciones; ${datos.sin_url} sin URL. Fin: ${fin}`);
})();
