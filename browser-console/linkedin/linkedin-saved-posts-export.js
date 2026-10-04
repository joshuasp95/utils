// linkedin-saved-posts-export.js — Exporta a JSON y TXT tus publicaciones guardadas de LinkedIn.
//
// Qué hace:     Recorre la página "Publicaciones guardadas", expande el texto de cada tarjeta,
//               pulsa "Mostrar más resultados" / hace scroll hasta que no cargan más, y descarga
//               dos ficheros con título, autor, texto, fecha relativa y URL de cada publicación.
// Requisitos:   Navegador de escritorio con sesión iniciada en LinkedIn. Interfaz en español
//               (los textos de los botones se buscan literalmente; ver CONFIG).
// Uso:          1. Abre https://www.linkedin.com/my-items/saved-posts/
//               2. DevTools (Cmd+Option+I / F12) → pestaña Console.
//               3. Pega el script completo y pulsa Enter. Mantén la pestaña visible.
// Variables:    CONFIG (abajo): textos de la interfaz y prefijo de los ficheros descargados.
// Efectos:      SOLO LECTURA en LinkedIn (solo hace clic en "Ver más"/"Mostrar más resultados").
//               ESCRIBE: dos descargas en la carpeta de descargas del navegador.
// Salida:       <prefijo>-YYYY-MM-DD.json y <prefijo>-YYYY-MM-DD.txt
(async () => {
  // ─── CONFIGURACIÓN ──────────────────────────────────────────────────────────
  const CONFIG = {
    rutaEsperada: '/my-items/saved-posts',            // ruta de la página donde debe ejecutarse
    textoVerMas: 'Ver más',                           // ← CAMBIAR si tu LinkedIn está en otro idioma ("See more")
    textoMostrarMas: /Mostrar más resultados/i,       // ← CAMBIAR si tu LinkedIn está en otro idioma (/Show more results/i)
    prefijoArchivo: 'linkedin-guardados'              // ← CAMBIAR para renombrar los ficheros descargados
  };

  if (!location.pathname.startsWith(CONFIG.rutaEsperada)) {
    throw new Error('Abre primero Publicaciones guardadas de LinkedIn.');
  }

  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
  const limpio = value => (value || '').trim();
  const resultados = new Map();   // clave = URN de la publicación → evita duplicados entre lotes
  let completo = false;
  let aviso = null;

  // Cada tarjeta guardada lleva el URN del post en data-chameleon-result-urn.
  const tarjetas = () => [...document.querySelectorAll('main [data-chameleon-result-urn]')];

  function recoger() {
    for (const tarjeta of tarjetas()) {
      // Expande el texto truncado antes de leerlo.
      tarjeta.querySelector(`button[aria-label*="${CONFIG.textoVerMas}"]`)?.click();
      const urn = tarjeta.getAttribute('data-chameleon-result-urn');
      if (!urn) continue;

      const autorLink = tarjeta.querySelector('.entity-result__content-actor a[href]');
      const texto = limpio(tarjeta.querySelector('.entity-result__content-summary')?.innerText)
        .replace(/\s*…\s*ver más\s*$/i, '');
      // Título: el del contenido embebido o, si no hay, la primera línea del texto (máx. 160 car.).
      const titulo = limpio(tarjeta.querySelector('.entity-result__embedded-object-title')?.innerText)
        || limpio(texto.split('\n').find(Boolean)).slice(0, 160)
        || '(Sin título visible)';

      resultados.set(urn, {
        titulo,
        autor: limpio(autorLink?.innerText) || '(Autor no visible)',
        descripcion: texto,
        fecha_relativa: limpio(tarjeta.querySelector('.entity-result__content-actor p')?.innerText)
          .replace(/\s*•\s*$/, ''),
        url_post: `https://www.linkedin.com/feed/update/${urn}/`,
        url_autor: autorLink?.href || null,
        urn
      });
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
    let sinAvance = 0;
    while (true) {
      recoger();
      console.log(`Guardados recogidos: ${resultados.size}`);

      const boton = [...document.querySelectorAll('main button')]
        .find(b => CONFIG.textoMostrarMas.test(b.innerText));

      if (boton && !boton.disabled) {
        const antes = tarjetas().length;
        boton.scrollIntoView({ block: 'center' });
        boton.click();
        // Espera hasta 15 s (30 × 500 ms) a que aparezcan tarjetas nuevas.
        for (let i = 0; i < 30 && tarjetas().length <= antes; i++) await esperar(500);
        sinAvance = tarjetas().length > antes ? 0 : sinAvance + 1;
        if (sinAvance >= 3) {
          aviso = 'LinkedIn dejó de cargar más resultados.';
          break;
        }
        continue;
      }

      // Sin botón: prueba con scroll infinito al final de la página.
      const antes = tarjetas().length;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await esperar(1200);
      if (tarjetas().length > antes) continue;
      if ([...document.querySelectorAll('main button')].some(
        b => CONFIG.textoMostrarMas.test(b.innerText) && !b.disabled
      )) continue;
      completo = true;
      break;
    }
  } catch (error) {
    aviso = String(error);
    console.error(error);
  }

  recoger();
  const publicaciones = [...resultados.values()];
  const fecha = new Date().toISOString().slice(0, 10);
  const datos = { exportado_en: new Date().toISOString(), completo, aviso,
    total: publicaciones.length, publicaciones };
  const txt = publicaciones.map((p, i) => [
    `${i + 1}. ${p.titulo}`, `Autor: ${p.autor}`, `Fecha visible: ${p.fecha_relativa}`,
    `URL del post: ${p.url_post}`, `Perfil: ${p.url_autor || ''}`, '',
    p.descripcion, '\n' + '='.repeat(70)
  ].join('\n')).join('\n\n');

  descargar(`${CONFIG.prefijoArchivo}-${fecha}.json`, JSON.stringify(datos, null, 2),
    'application/json;charset=utf-8');
  await esperar(500);   // algunos navegadores bloquean dos descargas simultáneas
  descargar(`${CONFIG.prefijoArchivo}-${fecha}.txt`, txt, 'text/plain;charset=utf-8');
  console.log(`Exportadas ${publicaciones.length} publicaciones guardadas. Completo: ${completo}`);
})();
