// Corre ADENTRO de la página que se fotografía (el importador lo sirve como /__telar/en-pagina.mjs desde su propio servidor
// estático y lo importa). Es JavaScript plano del navegador: no corre nada del proyecto, solo lee su DOM.
//   instantanea(selector)  → { html, estiloRaiz, lienzos, hojas }  (plan 5.4)
//   recetas(url)           → las piezas con sus variantes, armadas por el código real del proyecto (plan 5.2, "Recetas")
//   aWebp(dataUrl, lado, q) → la miniatura en WebP

const ORIGEN = location.origin

/** Espera fuentes, imágenes y a que no queden animaciones finitas corriendo (tope 2 s). */
export async function esperarQuieto(tope = 2000) {
  await document.fonts.ready
  const t0 = performance.now()
  while (performance.now() - t0 < tope) {
    const finitas = document.getAnimations().filter((a) => {
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null
      return a.playState === 'running' && t && t.iterations !== Infinity
    })
    if (!finitas.length) break
    await new Promise((r) => setTimeout(r, 80))
  }
  await Promise.race([
    Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r)))))),
    new Promise((r) => setTimeout(r, 3000)),
  ])
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

/** URL del servidor local → marca {{archivo:ruta/del/repo}} (el importador la cambia por la ruta con hash). */
export function marcar(u) {
  if (!u || u.startsWith('data:') || u.startsWith('{{')) return u
  try {
    const abs = new URL(u, location.href)
    if (abs.origin === ORIGEN) return `{{archivo:${decodeURIComponent(abs.pathname.slice(1))}}}`
  } catch {
    // queda como está
  }
  return u
}

const reUrl = /url\((['"]?)([^'")]+)\1\)/g

/** Clona un elemento y lo deja listo para guardar: sin scripts ni eventos, lienzos como imagen, URLs marcadas. */
export function limpiarClon(original, lienzos) {
  const clon = original.cloneNode(true)
  // lienzos → imagen (el contenido sale de los originales, en el mismo orden)
  const orig = original.tagName === 'CANVAS' ? [original] : [...original.querySelectorAll('canvas')]
  const copias = clon.tagName === 'CANVAS' ? [clon] : [...clon.querySelectorAll('canvas')]
  copias.forEach((c, i) => {
    const o = orig[i]
    let url = ''
    try {
      url = o.toDataURL('image/png')
    } catch {
      url = ''
    }
    const r = o.getBoundingClientRect()
    const img = document.createElement('img')
    for (const a of o.attributes) if (a.name !== 'width' && a.name !== 'height') img.setAttribute(a.name, a.value)
    img.style.width = o.style.width || `${Math.round(r.width) || o.width}px`
    img.style.height = o.style.height || `${Math.round(r.height) || o.height}px`
    const n = lienzos.length
    lienzos.push(url.length > 200 ? url : '')
    img.setAttribute('src', `{{lienzo:${n}}}`)
    img.setAttribute('data-telar-lienzo', String(n))
    if (c === clon) return
    c.replaceWith(img)
  })
  // los valores de los campos quedan como atributo
  const camposO = [...original.querySelectorAll('input, textarea, select')]
  const camposC = [...clon.querySelectorAll('input, textarea, select')]
  camposC.forEach((c, i) => {
    const o = camposO[i]
    if (!o) return
    if (c.tagName === 'TEXTAREA') c.textContent = o.value
    else if (c.tagName === 'SELECT') [...c.options].forEach((op, k) => op.toggleAttribute('selected', o.selectedIndex === k))
    else if (o.type === 'checkbox' || o.type === 'radio') c.toggleAttribute('checked', o.checked)
    else c.setAttribute('value', o.value)
  })
  for (const x of clon.querySelectorAll('script, link, noscript, template, iframe, object, embed')) x.remove()
  for (const x of [clon, ...clon.querySelectorAll('*')]) {
    for (const a of [...x.attributes]) if (/^on/i.test(a.name)) x.removeAttribute(a.name)
    if (x.hasAttribute('src')) x.setAttribute('src', marcar(x.getAttribute('src')))
    x.removeAttribute('srcset')
    const st = x.getAttribute('style')
    if (st && st.includes('url(')) x.setAttribute('style', st.replace(reUrl, (t, q, u) => (u.startsWith('data:') ? t : `url("${marcar(u)}")`)))
    if (x.hasAttribute('href') && x.tagName !== 'use' && x.tagName !== 'USE') x.setAttribute('href', marcar(x.getAttribute('href')))
  }
  return clon
}

function hojasDeLaPagina() {
  const r = []
  for (const s of document.styleSheets) {
    if (!s.href) continue
    try {
      const u = new URL(s.href)
      if (u.origin === ORIGEN) r.push(decodeURIComponent(u.pathname.slice(1)))
    } catch {
      // nada
    }
  }
  return [...new Set(r)]
}

export async function instantanea(selector) {
  await esperarQuieto()
  const el = selector ? document.querySelector(selector) : document.body
  if (!el) return { error: `no está ${selector}` }
  const lienzos = []
  const clon = limpiarClon(el, lienzos)
  const estiloRaiz = {
    html: { clase: document.documentElement.className || '', estilo: document.documentElement.getAttribute('style') || '' },
    body: { clase: document.body.className || '', estilo: document.body.getAttribute('style') || '' },
  }
  if (estiloRaiz.html.estilo.includes('url(')) estiloRaiz.html.estilo = estiloRaiz.html.estilo.replace(reUrl, (t, q, u) => `url("${marcar(u)}")`)
  if (estiloRaiz.body.estilo.includes('url(')) estiloRaiz.body.estilo = estiloRaiz.body.estilo.replace(reUrl, (t, q, u) => `url("${marcar(u)}")`)
  return { html: selector && el !== document.body ? clon.outerHTML : clon.innerHTML, estiloRaiz, lienzos, hojas: hojasDeLaPagina() }
}

const ESTADO_CLASE = { hover: 'es-hover', encima: 'es-hover', active: 'es-active', apretado: 'es-active', focus: 'es-focus' }
const NOMBRE_ESTADO = { normal: 'normal', hover: 'encima', active: 'apretado', apagado: 'apagado', focus: 'con foco' }

/** Corre las recetas del perfil con el código real del proyecto y arma, por pieza, su hoja de variantes (variantes × estados). */
export const CSS_HOJA_VARIANTES =
  '.tv{pointer-events:none}.tv .tv-celda>*{position:relative!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;transform:none}' +
  '.tv-cab,.tv-fila{font:500 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif!important;color:#786e62!important;white-space:nowrap;letter-spacing:0;text-transform:none}' +
  '.tv-cab{font-weight:650!important;color:#29241e!important}'

export async function recetas(url) {
  await esperarQuieto(1200)
  const estilo = document.createElement('style')
  estilo.textContent = CSS_HOJA_VARIANTES
  document.head.append(estilo)
  const mod = await import(url)
  const api = {
    importar: (ruta) => import(new URL(ruta, location.href).href),
    html: (el) => el.outerHTML,
  }
  const lista = await mod.default(api)
  const salida = []
  for (const r of lista) {
    try {
      const estados = r.estados && r.estados.length ? r.estados : ['normal']
      const nombres = Object.keys(r.variantes)
      // la grilla se arma y se mide en la página (con su CSS real), escondida
      const caja = document.createElement('div')
      caja.className = r.raizClase || 'rcui'
      caja.style.cssText = 'position:absolute!important;inset:auto!important;left:0;top:0;width:max-content!important;height:auto!important;overflow:visible!important;visibility:hidden;z-index:-1'
      for (const [k, v] of Object.entries(r.escala || {})) caja.style.setProperty(k, v)
      const tv = document.createElement('div')
      tv.className = 'tv'
      tv.setAttribute('data-nombre', `Variantes de ${r.nombre}`)
      tv.style.cssText = `display:grid;grid-template-columns:auto repeat(${estados.length}, auto);gap:28px 44px;padding:36px;align-items:center;justify-items:start`
      const etiqueta = (t, clase) => {
        const e = document.createElement('div')
        e.className = clase
        e.textContent = t
        return e
      }
      tv.append(etiqueta('', 'tv-cab'))
      for (const e of estados) tv.append(etiqueta(NOMBRE_ESTADO[e] || e, 'tv-cab'))
      const variantesHtml = {}
      const lienzos = []
      for (const n of nombres) {
        const el = r.variantes[n]
        tv.append(etiqueta(n, 'tv-fila'))
        for (const e of estados) {
          const celda = document.createElement('div')
          celda.className = 'tv-celda'
          celda.setAttribute('data-nombre', `${n} · ${NOMBRE_ESTADO[e] || e}`)
          const copia = el.cloneNode(true)
          if (ESTADO_CLASE[e]) copia.classList.add(ESTADO_CLASE[e])
          if (e === 'apagado') {
            copia.setAttribute('aria-disabled', 'true')
            copia.classList.add('es-apagado')
          }
          celda.append(copia)
          tv.append(celda)
        }
      }
      caja.append(tv)
      ;(document.querySelector('.rcui') || document.body).after(caja)
      await esperarQuieto(800)
      const rect = tv.getBoundingClientRect()
      for (const n of nombres) variantesHtml[n] = limpiarClon(r.variantes[n], lienzos).outerHTML
      const html = limpiarClon(tv, lienzos).outerHTML
      caja.remove()
      salida.push({
        clave: r.clave,
        nombre: r.nombre,
        grupo: r.grupo || 'Piezas',
        escala: r.escala || {},
        raizClase: r.raizClase || 'rcui',
        estados,
        variantes: variantesHtml,
        html,
        lienzos,
        ancho: Math.ceil(rect.width),
        alto: Math.ceil(rect.height),
        nota: r.nota,
      })
    } catch (e) {
      salida.push({ clave: r.clave, error: String(e && e.message ? e.message : e) })
    }
  }
  estilo.remove()
  return { piezas: salida, hojas: hojasDeLaPagina(), css: CSS_HOJA_VARIANTES }
}

/** Miniatura: PNG → WebP (lado mayor `lado`). */
export async function aWebp(dataUrl, lado = 640, calidad = 0.82) {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const f = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * f))
  c.height = Math.max(1, Math.round(img.naturalHeight * f))
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/webp', calidad)
}
