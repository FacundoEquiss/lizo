// Capturas de verificación del escritorio (plan v0.2, sección 15), con Playwright, contra un Telar LOCAL.
//
//   NODE_PATH=$(npm root -g) node scripts/capturas-escritorio.cjs --web http://127.0.0.1:4337 --grupo A
//   ... --solo A1,B3 · --salida docs/capturas/v0.2 · --sufijo "" (por ejemplo "-base") · --escala 2
//
// Cada escena abre un contexto nuevo (1440 × 900) con el tema pedido; las (c/o) salen en claro y en oscuro.
// Grupos A a D: las capturas de la sección 15; E: la tira de las animaciones (E1, en cámara lenta).
// Necesita los datos de `node scripts/sembrar-lienzo.mjs --demo`. No escribe en la base salvo donde la escena
// lo dice (crear, mover) y lo deshace al terminar.
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const WEB = opcion('web', 'http://127.0.0.1:4337')
const SALIDA = path.resolve(opcion('salida', 'docs/capturas/v0.2'))
const SUFIJO = opcion('sufijo', '')
const ESCALA = Number(opcion('escala', 2))
const SOLO = (opcion('solo', '') || '').split(',').filter(Boolean)
const GRUPOS = (opcion('grupo', '') || '').split(',').filter(Boolean)
const host = new URL(WEB).hostname
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error('Solo contra un Telar local.')
  process.exit(1)
}

const api = async (ruta, metodo = 'GET', cuerpo) => {
  const r = await fetch(WEB + ruta, {
    method: metodo,
    headers: cuerpo ? { 'content-type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${t}`)
  return t ? JSON.parse(t) : null
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function datos() {
  const proyectos = await api('/api/proyectos')
  const rc = proyectos.find((p) => p.prefijo === 'RC')
  const tb = rc.tableros.find((t) => t.slug === 'pendientes')
  const completo = await api(`/api/tableros/${tb.id}`)
  const marco = (titulo) => completo.elementos.find((e) => e.tipo === 'marco' && (e.datos.titulo === titulo))
  const conTexto = (texto) => completo.elementos.find((e) => String(e.datos.texto ?? '').startsWith(texto))
  return { proyectos, rc, tb, completo, marco, conTexto }
}

/** Contexto con el tema y (si hace falta) la vista del lienzo guardada. */
async function nuevaPagina(browser, tema, extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: ESCALA,
    colorScheme: tema === 'oscuro' ? 'dark' : 'light',
    reducedMotion: extra.reducedMotion ?? 'no-preference',
  })
  await ctx.addInitScript(
    ([t, almacen]) => {
      if (sessionStorage.getItem('capturas.listo')) return
      sessionStorage.setItem('capturas.listo', '1')
      localStorage.setItem('tablero.tema', t)
      for (const [k, v] of Object.entries(almacen)) localStorage.setItem(k, v)
    },
    [tema, extra.almacen ?? {}],
  )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('  [página]', e.message))
  return { ctx, page }
}

async function abrirKanban(page) {
  await page.goto(`${WEB}/RC/pendientes`)
  await page.waitForSelector('.lista .tarjeta', { timeout: 15000 })
  await espera(600)
}

/** Abre el lienzo con el centro (cx, cy) del lienzo a un zoom dado (sin animación). */
async function abrirLienzo(page, d, vista) {
  await page.goto(`${WEB}/RC/pendientes/lienzo`)
  await page.waitForSelector('.react-flow__node', { timeout: 15000 })
  if (vista) {
    // El primer encuadre guarda su vista al terminar: se espera a que termine para no pisar la pedida.
    await espera(900)
    const caja = await page.locator('.react-flow').boundingBox()
    const v = { x: caja.width / 2 - vista.cx * vista.zoom, y: caja.height / 2 - vista.cy * vista.zoom, zoom: vista.zoom }
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [`tablero.vista.${d.tb.id}`, v])
    await page.reload()
    // Puede ser un lugar vacío del lienzo (sin objetos a la vista): alcanza con que el lienzo esté.
    await page.waitForSelector('.react-flow__pane', { timeout: 15000 })
  }
  await espera(700)
}

async function centroDe(page, id) {
  const b = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }
}

/** Un lugar vacío del lienzo: debajo de todo lo que hay. */
function libreDebajo(d) {
  const els = d.completo.elementos
  const x = Math.min(...els.map((e) => e.x))
  const y = Math.max(...els.map((e) => e.y + e.alto))
  return { x, y: y + 400 }
}

/** Crea textos por la API (posiciones relativas a `zona`). Devuelve los ids, para borrarlos al terminar. */
async function crearTextos(d, zona, textos) {
  const creados = await api(`/api/tableros/${d.tb.id}/elementos`, 'POST', {
    elementos: textos.map((t) => ({
      tipo: 'texto',
      x: zona.x + t.x,
      y: zona.y + t.y,
      ancho: t.ancho ?? 300,
      alto: t.alto ?? 40,
      datos: { texto: t.datos.rico ? textoDe(t.datos.rico) : t.datos.texto, anchoAuto: true, ...t.datos },
    })),
  })
  return creados.map((e) => e.id)
}

/** Crea notas por la API (posiciones relativas a `zona`). Devuelve los objetos creados. */
async function crearNotas(d, zona, notas) {
  return api(`/api/tableros/${d.tb.id}/elementos`, 'POST', {
    elementos: notas.map((n) => ({ tipo: 'nota', x: zona.x + n.x, y: zona.y + n.y, ancho: n.ancho ?? 220, alto: n.alto ?? 220, datos: n.datos })),
  })
}

/** Crea formas por la API (posiciones relativas a `zona`), con el estilo de fábrica salvo lo que se pase. */
async function crearFormas(d, zona, formas) {
  const fabrica = { relleno: 'azul', tono: 'suave', borde: 'ninguno', bordeGrosor: 2, bordeEstilo: 'solido', opacidad: 1, fuente: 'sans', tamano: 16, alineacion: 'centro', alineacionV: 'medio', interlineado: 1.3, colorTexto: 'auto' }
  return api(`/api/tableros/${d.tb.id}/elementos`, 'POST', {
    elementos: formas.map((f) => ({ tipo: 'forma', x: zona.x + f.x, y: zona.y + f.y, ancho: f.ancho ?? 200, alto: f.alto ?? 130, datos: { ...fabrica, ...f.datos } })),
  })
}

// Las 13 formas con un texto de ejemplo (un flujo del restaurante), para B18.
const MUESTRARIO_FORMAS = [
  ['rectangulo', 'Paso', 'azul'],
  ['redondeado', 'Tomar el pedido', 'verde'],
  ['pildora', 'Inicio', 'naranja'],
  ['elipse', 'Mesa libre', 'celeste'],
  ['rombo', '¿Hay lugar?', 'amarillo'],
  ['triangulo', 'Ojo', 'rojo'],
  ['hexagono', 'Preparar', 'violeta'],
  ['paralelogramo', 'Pedido', 'lima'],
  ['cilindro', 'Recetas', 'gris'],
  ['documento', 'Menú del día', 'rosa'],
  ['estrella', '¡Nuevo!', 'amarillo'],
  ['globo', '¿Me trae la cuenta?', 'celeste'],
  ['flecha', 'Siguiente', 'azul'],
]

// Documentos de TipTap para el muestrario (B10).
const tx = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const p = (...content) => ({ type: 'paragraph', content })
const doc = (...content) => ({ type: 'doc', content })
const B = { type: 'bold' }
const I = { type: 'italic' }
const U = { type: 'underline' }
const T = { type: 'strike' }
const color = (c) => ({ type: 'color', attrs: { color: c } })
const resaltado = (c) => ({ type: 'resaltado', attrs: { color: c } })
const textoDe = (n) => (n.text ?? '') + (n.content ?? []).map(textoDe).join(n.type === 'doc' ? '\n' : '')
const MUESTRARIO_FUENTES = [
  {
    x: 0,
    y: 0,
    datos: {
      fuente: 'titulos',
      tamano: 52,
      rico: doc(p(tx('Títulos: Bricolage Grotesque'))),
    },
  },
  {
    x: 0,
    y: 96,
    datos: {
      fuente: 'sans',
      tamano: 21,
      rico: doc(
        p(tx('Sans: '), tx('negrita', B), tx(', '), tx('cursiva', I), tx(', '), tx('subrayado', U), tx(' y '), tx('tachado', T), tx('.')),
        p(tx('Color '), tx('rojo', color('rojo')), tx(', '), tx('azul', color('azul')), tx(' y '), tx('verde', color('verde')), tx('; '), tx('resaltado amarillo', resaltado('amarillo')), tx(' y '), tx('celeste', resaltado('celeste')), tx('.')),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(tx('Una viñeta'))] }, { type: 'listItem', content: [p(tx('Otra con '), tx('negrita', B))] }] },
        { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [p(tx('Primero'))] }, { type: 'listItem', content: [p(tx('Segundo'))] }] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p(tx('Tarea hecha'))] },
            { type: 'taskItem', attrs: { checked: false }, content: [p(tx('Tarea pendiente'))] },
          ],
        },
      ),
    },
  },
  {
    x: 560,
    y: 96,
    datos: {
      fuente: 'serif',
      tamano: 24,
      rico: doc(
        { type: 'heading', attrs: { level: 1 }, content: [tx('Serif: Newsreader')] },
        { type: 'heading', attrs: { level: 2 }, content: [tx('Un título 2')] },
        p(tx('Editorial, con '), tx('cursiva verdadera', I), tx(' y '), tx('negrita', B), tx('.')),
      ),
    },
  },
  {
    x: 560,
    y: 330,
    datos: { fuente: 'mono', tamano: 16, rico: doc(p(tx('Mono: Geist Mono · RC-12 · 1.250 · '), tx('if (mesa) sentar()', B))) },
  },
  {
    x: 560,
    y: 390,
    datos: { fuente: 'mano', tamano: 32, rico: doc(p(tx('Manuscrita: Caveat, '), tx('para anotar al margen', color('naranja')))) },
  },
]

// ───────── proyectos (C9–C13) ─────────

// Una "foto" de prueba para el proyecto: un local con toldo dibujado con CSS, a 256 × 256 (como la deja la app).
const HTML_FOTO = `<div id="foto" style="width:256px;height:256px;position:relative;overflow:hidden;background:linear-gradient(180deg,#ffe1b5 0%,#ffbf8a 52%,#f19a68 100%)">
  <div style="position:absolute;left:169px;top:29px;width:52px;height:52px;border-radius:50%;background:radial-gradient(circle,#fff8e0 0%,#ffd98a 72%)"></div>
  <div style="position:absolute;left:20px;top:48px;width:60px;height:17px;border-radius:10px;background:rgba(255,255,255,.55)"></div>
  <div style="position:absolute;left:48px;top:88px;width:160px;height:150px;background:#fff4e4;border-radius:8px 8px 0 0;box-shadow:0 7px 20px rgba(120,50,20,.28)"></div>
  <div style="position:absolute;left:38px;top:102px;width:180px;height:31px;border-radius:6px 6px 2px 2px;background:repeating-linear-gradient(90deg,#d6493a 0 15px,#fff7ec 15px 30px);box-shadow:0 4px 0 rgba(0,0,0,.07)"></div>
  <div style="position:absolute;left:64px;top:153px;width:75px;height:56px;border-radius:6px;background:linear-gradient(160deg,#fff0b8,#ffc65c);box-shadow:inset 0 0 0 4px #8b4a2b"></div>
  <div style="position:absolute;left:100px;top:153px;width:4px;height:56px;background:#8b4a2b"></div>
  <div style="position:absolute;left:152px;top:150px;width:42px;height:88px;border-radius:21px 21px 0 0;background:#8b4a2b"></div>
  <div style="position:absolute;left:185px;top:196px;width:5px;height:5px;border-radius:50%;background:#ffd36b"></div>
  <div style="position:absolute;left:0;top:238px;width:256px;height:18px;background:#7f9e55"></div>
  <div style="position:absolute;left:22px;top:201px;width:27px;height:37px;border-radius:14px 14px 3px 3px;background:#5f8a3e"></div>
  <div style="position:absolute;left:210px;top:205px;width:24px;height:33px;border-radius:12px 12px 3px 3px;background:#6c9748"></div>
</div>`

let fotoCache = null
async function fotoDePrueba(browser) {
  if (fotoCache) return fotoCache
  const ctx = await browser.newContext({ viewport: { width: 300, height: 300 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.setContent(`<body style="margin:0">${HTML_FOTO}</body>`)
  fotoCache = await page.locator('#foto').screenshot()
  await ctx.close()
  return fotoCache
}

/** RC con foto y solo Pendientes y Lanzamiento a la vista (los tableros de rendimiento, archivados). Lo deshace al terminar. */
async function conProyectos(browser, d, fn) {
  const rc = (await api('/api/proyectos')).find((p) => p.prefijo === 'RC')
  const ocultos = rc.tableros.filter((t) => t.slug.startsWith('rendimiento-'))
  for (const t of ocultos) await api(`/api/tableros/${t.id}`, 'PATCH', { archivado: true })
  const f = new FormData()
  f.append('archivo', new Blob([await fotoDePrueba(browser)], { type: 'image/png' }), 'foto.png')
  const r = await fetch(`${WEB}/api/proyectos/${rc.id}/imagen`, { method: 'POST', body: f })
  if (!r.ok) throw new Error(`foto: ${await r.text()}`)
  try {
    await fn(rc)
  } finally {
    await api(`/api/proyectos/${rc.id}`, 'PATCH', { imagen: null })
    for (const t of ocultos) await api(`/api/tableros/${t.id}`, 'PATCH', { archivado: false })
  }
}

async function abrirMenuProyecto(page) {
  await page.hover('.proyecto--activo .proyecto__fila')
  await page.locator('.proyecto--activo .proyecto__accion').first().click()
  await espera(350)
}

// ───────── escenas ─────────
// fn(page, d, foto) · foto(nombre) guarda `${id}-${nombre}-${tema}.png` (o sin tema si la escena es de un solo tema).

const ESCENAS = [
  {
    id: 'A1',
    grupo: 'A',
    temas: ['claro'],
    async fn(page, d, foto) {
      await abrirKanban(page)
      await foto('kanban')
    },
  },
  {
    id: 'A2',
    grupo: 'A',
    temas: ['oscuro'],
    async fn(page, d, foto) {
      await abrirKanban(page)
      await foto('kanban')
    },
  },
  {
    id: 'A3',
    grupo: 'A',
    temas: ['claro', 'oscuro'],
    async fn(page, d, foto) {
      await page.goto(`${WEB}/RC/pendientes?tarjeta=RC-2`)
      await page.waitForSelector('.hoja', { timeout: 15000 })
      await espera(900)
      await foto('tarjeta-porque')
    },
  },
  {
    id: 'A4',
    grupo: 'A',
    temas: ['claro', 'oscuro'],
    async fn(page, d, foto) {
      await abrirKanban(page)
      const tarjeta = page.locator('.tarjeta', { hasText: 'Mesa para dos' }).first()
      const b = await tarjeta.boundingBox()
      const destino = await page.locator('.lista', { hasText: 'Por hacer' }).first().boundingBox()
      await page.mouse.move(b.x + 40, b.y + 20)
      await page.mouse.down()
      await page.mouse.move(b.x + 60, b.y + 30, { steps: 4 })
      await page.mouse.move(destino.x + destino.width / 2, destino.y + 160, { steps: 18 })
      await espera(450)
      await foto('arrastre')
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await espera(300)
    },
  },
  {
    id: 'A5',
    grupo: 'A',
    temas: ['claro', 'oscuro'],
    async fn(page, d, foto) {
      await abrirKanban(page)
      await page.keyboard.press('Control+KeyK')
      await page.waitForSelector('.paleta')
      await espera(500)
      await foto('paleta')
      await page.keyboard.press('Escape')
      await espera(300)
      const lista = page.locator('.lista', { hasText: 'Por hacer' }).first()
      await lista.hover()
      await lista.locator('.lista__menu').first().click()
      await espera(450)
      await foto('menu')
    },
  },
  {
    id: 'C1',
    grupo: 'C',
    temas: ['claro'],
    async fn(page, d, foto) {
      // Muestrario: el ícono en 16, 32, 64 y 256 px sobre claro y oscuro, y una pestaña como la del navegador.
      const fila = (fondo, texto, archivo) => `
        <div class="fila" style="background:${fondo};color:${texto}">
          ${[16, 32, 64, 256].map((t) => `<figure><img src="${WEB}/marca/${archivo}" width="${t}" height="${t}"><figcaption>${t} px</figcaption></figure>`).join('')}
          <div class="pestana" style="background:${fondo === '#f4efe6' ? '#fff' : '#2b2c30'}">
            <img src="${WEB}/icono.svg" width="16" height="16"><span>Telar</span><span class="x">×</span>
          </div>
        </div>`
      await page.setContent(`<!doctype html><html><head><style>
        body{margin:0;font:600 13px system-ui;background:#888}
        .fila{display:flex;align-items:flex-end;gap:40px;padding:36px 48px;min-height:340px}
        figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:12px}
        figcaption{opacity:.6}
        .pestana{display:flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:10px 10px 0 0;margin-left:auto;align-self:flex-start;min-width:200px}
        .x{margin-left:auto;opacity:.5}
      </style></head><body>
        ${fila('#f4efe6', '#29241e', 'telar.svg')}
        ${fila('#1a1b1d', '#ededef', 'telar.svg')}
        ${fila('#1a1b1d', '#ededef', 'telar-claro.svg')}
      </body></html>`)
      await page.waitForLoadState('networkidle')
      await espera(300)
      await foto('iconos', { fullPage: true })
      for (const tema of ['claro', 'oscuro']) {
        await page.goto(`${WEB}/RC/pendientes`)
        await page.evaluate((t) => localStorage.setItem('tablero.tema', t), tema)
        await page.reload()
        await page.waitForSelector('.lateral .marca__logo')
        await espera(500)
        await foto(`lateral-${tema}`, { clip: { x: 0, y: 0, width: 248, height: 140 } })
      }
    },
  },
  {
    id: 'B1',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    async fn(page, d, foto) {
      await abrirLienzo(page, d)
      await page.keyboard.press('Shift+Digit1')
      await espera(900)
      await foto('lienzo')
    },
  },
  {
    id: 'B2',
    grupo: 'B',
    temas: ['oscuro'],
    async fn(page, d, foto) {
      const m = d.marco('Mecánicas')
      await abrirLienzo(page, d, { cx: m.x + m.ancho / 2, cy: m.y + m.alto / 2 - 20, zoom: 1 })
      await foto('mecanicas-100')
    },
  },
  {
    id: 'B3',
    grupo: 'B',
    temas: ['claro'],
    async fn(page, d, foto) {
      const n = d.conTexto('Propina')
      for (const zoom of [0.25, 1, 3]) {
        await abrirLienzo(page, d, { cx: n.x + n.ancho / 2, cy: n.y + n.alto / 2, zoom })
        const c = await centroDe(page, n.id)
        await page.mouse.click(c.x, c.y)
        await espera(400)
        await foto(`nota-${Math.round(zoom * 100)}`)
      }
    },
  },
  {
    id: 'B4',
    grupo: 'B',
    temas: ['claro'],
    async fn(page, d, foto) {
      await abrirLienzo(page, d)
      // "." va al primer marco (o al siguiente del que está en pantalla).
      await page.keyboard.press('Shift+Digit1')
      await espera(700)
      await page.keyboard.press('Period')
      await espera(1100)
      await foto('ir-al-marco')
    },
  },
  {
    id: 'B5',
    grupo: 'B',
    temas: ['claro'],
    async fn(page, d, foto) {
      await abrirLienzo(page, d)
      await page.mouse.move(700, 450)
      await espera(200)
      const antes = await page.locator('.herramientas').boundingBox()
      await foto('seleccionar')
      await page.keyboard.press('KeyN')
      await espera(500)
      const despues = await page.locator('.herramientas').boundingBox()
      await foto('nota')
      console.log('    barra con Seleccionar:', JSON.stringify(antes), '· con Nota:', JSON.stringify(despues))
    },
  },
  {
    id: 'B6',
    grupo: 'B',
    temas: ['claro'],
    async fn(page, d, foto) {
      const m = d.marco('Economía y balance')
      await abrirLienzo(page, d, { cx: m.x + m.ancho / 2, cy: m.y + m.alto / 2, zoom: 0.8 })
      await page.keyboard.press('KeyN')
      await espera(300)
      const caja = await page.locator('.react-flow').boundingBox()
      await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2, { steps: 5 })
      await espera(300)
      await foto('fantasma')
    },
  },
  {
    id: 'B7',
    grupo: 'B',
    temas: ['claro'],
    async fn(page, d, foto) {
      const m = d.marco('Economía y balance')
      await abrirLienzo(page, d, { cx: m.x + m.ancho / 2, cy: m.y + m.alto / 2, zoom: 0.8 })
      await page.keyboard.press('KeyS')
      await espera(300)
      const caja = await page.locator('.react-flow').boundingBox()
      const x = caja.x + caja.width / 2 - 160
      const y = caja.y + caja.height / 2 - 90
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 256, y + 144, { steps: 12 })
      await espera(200)
      await foto('forma-arrastre')
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await espera(200)
    },
  },
  {
    id: 'B8',
    grupo: 'B',
    temas: ['claro'],
    // B8 y B9: un texto recién creado (sin fondo, marco recto, cuatro manijas) y el mismo en edición con su barra.
    // Se mide cuánto se mueve el texto entre las dos (tiene que ser menos de 1 px).
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      await abrirLienzo(page, d, { cx: zona.x + 300, cy: zona.y + 40, zoom: 1 })
      await page.keyboard.press('KeyT')
      await espera(250)
      const caja = await page.locator('.react-flow').boundingBox()
      await page.mouse.click(caja.x + caja.width / 2 - 180, caja.y + caja.height / 2)
      await espera(500)
      await page.keyboard.type('Texto recién creado')
      await espera(200)
      await page.keyboard.press('Escape')
      await espera(600)
      const id = await page.evaluate(() => document.querySelector('.react-flow__node.selected')?.getAttribute('data-id'))
      const medir = () =>
        page.evaluate((id) => {
          const el = document.querySelector(`.react-flow__node[data-id="${id}"] .rico`)
          const r = document.createRange()
          r.selectNodeContents(el)
          const a = r.getClientRects()[0]
          return { x: a.x, y: a.y, w: a.width, h: a.height }
        }, id)
      const vista = await medir()
      await foto('texto-nuevo')
      const c = await centroDe(page, id)
      await page.mouse.dblclick(c.x, c.y)
      await espera(600)
      const edicion = await medir()
      await page.keyboard.press('End')
      await espera(150)
      const archivo = path.join(SALIDA, `B9-texto-editando${SUFIJO}.png`)
      await page.screenshot({ path: archivo })
      console.log('  ✓', path.relative(process.cwd(), archivo))
      console.log(`    diferencia entre B8 y B9: x ${(edicion.x - vista.x).toFixed(2)} px, y ${(edicion.y - vista.y).toFixed(2)} px, ancho ${(edicion.w - vista.w).toFixed(2)} px`)
      await page.keyboard.press('Escape')
      await espera(400)
      await api('/api/elementos/eliminar', 'POST', { ids: [id] })
    },
  },
  {
    id: 'B10',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // Las cinco fuentes y todos los formatos (negrita, cursiva, subrayado, tachado, color, resaltado, títulos, listas
    // y tareas).
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const ids = await crearTextos(d, zona, MUESTRARIO_FUENTES)
      try {
        await abrirLienzo(page, d, { cx: zona.x + 560, cy: zona.y + 300, zoom: 1 })
        await espera(800)
        await foto('texto-fuentes-formatos')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids })
      }
    },
  },
  {
    id: 'B11',
    grupo: 'B',
    temas: ['claro'],
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const parrafo = 'El cliente entra, mira la carta y elige una mesa. Si no hay lugar, espera en la puerta treinta segundos.'
      const ids = await crearTextos(
        d,
        zona,
        ['izquierda', 'centro', 'derecha', 'justificado'].map((a, i) => ({
          x: i * 280,
          y: 0,
          ancho: 240,
          datos: { texto: parrafo, fuente: 'sans', tamano: 18, alineacion: a, anchoAuto: false },
        })),
      )
      try {
        await abrirLienzo(page, d, { cx: zona.x + 540, cy: zona.y + 70, zoom: 0.95 })
        await espera(600)
        await foto('texto-alineaciones')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids })
      }
    },
  },
  {
    id: 'B12',
    grupo: 'B',
    temas: ['claro'],
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const rotulos = [
        ['Para decidir', 'amarillo', 21],
        ['En revisión', 'azul', 21],
        ['Listo', 'verde', 21],
        ['Idea suelta', 'rosa', 16],
        ['Cocina', 'naranja', 32],
      ]
      const ids = await crearTextos(
        d,
        zona,
        rotulos.map(([t, c, tam], i) => ({ x: (i % 3) * 230, y: Math.floor(i / 3) * 90, datos: { texto: t, fondo: c, tamano: tam, anchoAuto: true } })),
      )
      try {
        await abrirLienzo(page, d, { cx: zona.x + 330, cy: zona.y + 60, zoom: 1.4 })
        await espera(600)
        const id = ids[0]
        const c = await centroDe(page, id)
        await page.mouse.click(c.x, c.y)
        await espera(500)
        await foto('texto-con-fondo')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids })
      }
    },
  },
  {
    id: 'B13',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // Las diez notas de colores (con el nombre de su color).
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const colores = ['amarillo', 'naranja', 'rojo', 'rosa', 'violeta', 'azul', 'celeste', 'verde', 'lima', 'gris']
      const nombres = { amarillo: 'Amarillo', naranja: 'Naranja', rojo: 'Rojo', rosa: 'Rosa', violeta: 'Violeta', azul: 'Azul', celeste: 'Celeste', verde: 'Verde', lima: 'Lima', gris: 'Gris' }
      const creadas = await crearNotas(
        d,
        zona,
        colores.map((c, i) => ({ x: (i % 5) * 200, y: Math.floor(i / 5) * 200, ancho: 170, alto: 170, datos: { texto: nombres[c], color: c } })),
      )
      try {
        await abrirLienzo(page, d, { cx: zona.x + 485, cy: zona.y + 185, zoom: 1.05 })
        await espera(700)
        await foto('notas-colores')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: creadas.map((e) => e.id) })
      }
    },
  },
  {
    id: 'B14',
    grupo: 'B',
    temas: ['claro'],
    // Notas con 8, 60 y 300 caracteres: el texto entra completo en las tres, sin cortar palabras.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const textos = [
        'Ir a ver',
        'Los clientes esperan treinta segundos antes de irse del local.',
        'El mozo lleva la bandeja con los platos a la mesa, deja la cuenta, vuelve a la cocina y espera el próximo pedido. Si hay dos mesas esperando, atiende primero a la que llegó antes. Cuando el local está lleno, los clientes nuevos esperan en la puerta treinta segundos y después se van.',
      ]
      const creadas = await crearNotas(
        d,
        zona,
        textos.map((t, i) => ({ x: i * 260, y: 0, datos: { texto: t, color: ['amarillo', 'rosa', 'celeste'][i] } })),
      )
      try {
        await abrirLienzo(page, d, { cx: zona.x + 370, cy: zona.y + 110, zoom: 1.35 })
        await espera(900)
        await foto('notas-largos')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: creadas.map((e) => e.id) })
      }
    },
  },
  {
    id: 'B15',
    grupo: 'B',
    temas: ['claro'],
    // Una nota seleccionada con su barra y el menú de color abierto.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const [n] = await crearNotas(d, zona, [{ x: 0, y: 0, datos: { texto: 'Combo del día: hamburguesa, papas y gaseosa', color: 'amarillo' } }])
      try {
        await abrirLienzo(page, d, { cx: zona.x + 110, cy: zona.y + 60, zoom: 1.4 })
        await espera(500)
        const c = await centroDe(page, n.id)
        await page.mouse.click(c.x, c.y)
        await espera(400)
        await page.locator('.barra-ctx [aria-label="Color"]').click()
        await espera(400)
        await foto('nota-barra-color')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [n.id] })
      }
    },
  },
  {
    id: 'B16',
    grupo: 'B',
    temas: ['claro'],
    // Una nota arrastrándose: levantada y girada hacia donde va.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const notas = await crearNotas(d, zona, [
        { x: 0, y: 0, datos: { texto: 'Mesa para cuatro', color: 'verde' } },
        { x: 260, y: 0, datos: { texto: 'La que se mueve', color: 'naranja' } },
      ])
      try {
        await abrirLienzo(page, d, { cx: zona.x + 330, cy: zona.y + 110, zoom: 1.2 })
        await espera(500)
        const c = await centroDe(page, notas[1].id)
        await page.mouse.move(c.x, c.y)
        await page.mouse.down()
        await page.mouse.move(c.x + 60, c.y + 30, { steps: 8 })
        await page.mouse.move(c.x + 140, c.y + 50, { steps: 8 })
        await espera(250)
        await foto('nota-arrastrando')
        await page.mouse.up()
        await espera(400)
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: notas.map((e) => e.id) })
      }
    },
  },
  {
    id: 'B17',
    grupo: 'B',
    temas: ['claro'],
    // Convertir una nota en tarjeta: antes y después, con su conector en su lugar.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const notas = await crearNotas(d, zona, [
        { x: 0, y: 0, datos: { texto: 'El cliente pide la cuenta', color: 'celeste' } },
        { x: 380, y: 0, datos: { texto: 'Agregar propina al cobrar: según lo rápido que comió', color: 'amarillo' } },
      ])
      const con = await api(`/api/tableros/${d.tb.id}/conectores`, 'POST', { desdeId: notas[0].id, hastaId: notas[1].id, etiqueta: 'después' })
      let tarjeta = null
      let nuevoId = null
      try {
        await abrirLienzo(page, d, { cx: zona.x + 300, cy: zona.y + 110, zoom: 1.2 })
        await espera(500)
        const c = await centroDe(page, notas[1].id)
        await page.mouse.click(c.x, c.y)
        await espera(400)
        await page.locator('.barra-ctx [aria-label="Convertir"]').click()
        await espera(400)
        await foto('convertir-antes')
        await page.locator('.menu__item', { hasText: 'En tarjeta del Kanban' }).click()
        await espera(1200)
        await page.mouse.click(c.x, c.y + 260)
        await espera(500)
        await foto('convertir-despues')
        const t = await api(`/api/tableros/${d.tb.id}`)
        const el = t.elementos.find((e) => e.tipo === 'tarjeta' && Math.abs(e.x - notas[1].x) < 2 && Math.abs(e.y - notas[1].y) < 2)
        nuevoId = el?.id ?? null
        tarjeta = el ? t.tarjetas.find((x) => x.id === el.tarjetaId) : null
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [...notas.map((e) => e.id), ...(nuevoId ? [nuevoId] : [])] })
        await api('/api/conectores/eliminar', 'POST', { ids: [con.id] }).catch(() => {})
        if (tarjeta) await api(`/api/tarjetas/${tarjeta.clave}/archivar`, 'POST', { archivar: true })
      }
    },
  },
  {
    id: 'B28',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // B28 y B29: un conector soltado en el aire con el menú "Crear y conectar"; después de elegir "Nota", la nota
    // nueva conectada y en edición.
    async fn(page, d, foto, tema) {
      const zona = libreDebajo(d)
      const [origen] = await crearNotas(d, zona, [{ x: 0, y: 0, ancho: 200, alto: 200, datos: { texto: 'El cliente entra', color: 'celeste' } }])
      try {
        await abrirLienzo(page, d, { cx: zona.x + 330, cy: zona.y + 120, zoom: 1.1 })
        await espera(500)
        const n = page.locator(`.react-flow__node[data-id="${origen.id}"]`)
        const b = await n.boundingBox()
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
        await espera(350)
        const h = await n.locator('.punto-conexion[data-lado="derecha"]').boundingBox()
        await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
        await page.mouse.down()
        await page.mouse.move(h.x + 160, h.y + 30, { steps: 12 })
        await page.mouse.move(h.x + 280, h.y + 50, { steps: 12 })
        await page.mouse.up()
        await espera(500)
        await foto('crear-y-conectar')
        if (tema === 'claro') {
          await page.keyboard.press('KeyN')
          await espera(700)
          await page.keyboard.type('Busca mesa')
          await espera(300)
          const archivo = path.join(SALIDA, `B29-nota-conectada${SUFIJO}.png`)
          await page.screenshot({ path: archivo })
          console.log('  ✓', path.relative(process.cwd(), archivo))
          await page.keyboard.press('Escape')
          await espera(500)
        } else await page.keyboard.press('Escape')
      } finally {
        const t = await api(`/api/tableros/${d.tb.id}`)
        const ids = t.elementos.filter((e) => e.y >= zona.y - 200 && e.y < zona.y + 600).map((e) => e.id)
        await api('/api/elementos/eliminar', 'POST', { ids })
      }
    },
  },
  {
    id: 'B30',
    grupo: 'B',
    temas: ['claro'],
    // Un extremo de conector a medio reenganchar: el destino resaltado.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const [a, b, c] = await crearNotas(d, zona, [
        { x: 0, y: 0, ancho: 200, alto: 200, datos: { texto: 'Pide', color: 'amarillo' } },
        { x: 900, y: 0, ancho: 200, alto: 200, datos: { texto: 'Cocina', color: 'verde' } },
        { x: 520, y: 380, ancho: 200, alto: 200, datos: { texto: 'Mozo', color: 'rosa' } },
      ])
      const con = await api(`/api/tableros/${d.tb.id}/conectores`, 'POST', { desdeId: a.id, hastaId: b.id, etiqueta: 'pedido' })
      try {
        await abrirLienzo(page, d, { cx: zona.x + 550, cy: zona.y + 260, zoom: 0.95 })
        await espera(600)
        const et = await page.locator(`[data-etiqueta-conector="${con.id}"]`).boundingBox()
        await page.mouse.click(et.x + et.width + 40, et.y + et.height / 2)
        await espera(500)
        const fin = await page.locator('.conector__extremo').nth(1).boundingBox()
        const dest = await page.locator(`.react-flow__node[data-id="${c.id}"]`).boundingBox()
        await page.mouse.move(fin.x + fin.width / 2, fin.y + fin.height / 2)
        await page.mouse.down()
        await page.mouse.move(dest.x + dest.width * 0.6, dest.y + dest.height * 0.4, { steps: 16 })
        await espera(250)
        await foto('reenganchar')
        await page.keyboard.press('Escape')
        await page.mouse.move(dest.x - 400, dest.y + 400, { steps: 4 })
        await page.mouse.up()
        await espera(300)
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [a.id, b.id, c.id] })
      }
    },
  },
  {
    id: 'B31',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // Muestrario: los 3 trazos, las 7 puntas, las 3 líneas y los 5 grosores (con su nombre en la etiqueta).
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const filas = [
        ...[
          ['curvo', 'Curvo'],
          ['ortogonal', 'En ángulo'],
          ['recto', 'Recto'],
        ].map(([trazo, nombre]) => ({ col: 0, estilo: { trazo }, nombre })),
        ...[
          ['solido', 'Sólida'],
          ['rayado', 'Rayada'],
          ['punteado', 'Punteada'],
        ].map(([guion, nombre]) => ({ col: 0, estilo: { guion }, nombre })),
        ...[
          ['ninguna', 'Ninguna'],
          ['flecha', 'Flecha'],
          ['flecha_abierta', 'Flecha abierta'],
          ['triangulo', 'Triángulo'],
          ['punto', 'Punto'],
          ['rombo', 'Rombo'],
          ['barra', 'Barra'],
        ].map(([puntaFin, nombre]) => ({ col: 1, estilo: { puntaFin }, nombre })),
        ...[1, 2, 3, 4, 6].map((grosor) => ({ col: 2, estilo: { grosor }, nombre: `${grosor} px` })),
      ]
      const porCol = [0, 0, 0]
      const pares = filas.map((f) => {
        const fila = porCol[f.col]++
        return { ...f, x: f.col * 450, y: fila * 96 }
      })
      const notas = await crearNotas(
        d,
        zona,
        pares.flatMap((p) => [
          { x: p.x, y: p.y, ancho: 56, alto: 56, datos: { texto: 'A', color: 'gris' } },
          { x: p.x + 290, y: p.y + 24, ancho: 56, alto: 56, datos: { texto: 'B', color: 'gris' } },
        ]),
      )
      const colores = ['azul', 'verde', 'naranja']
      for (const [i, p] of pares.entries())
        await api(`/api/tableros/${d.tb.id}/conectores`, 'POST', {
          desdeId: notas[i * 2].id,
          hastaId: notas[i * 2 + 1].id,
          etiqueta: p.nombre,
          trazo: 'curvo',
          puntaFin: 'flecha',
          grosor: 2,
          color: p.col === 0 ? null : colores[p.col],
          ...p.estilo,
        })
      try {
        await abrirLienzo(page, d, { cx: zona.x + 620, cy: zona.y + 330, zoom: 0.88 })
        await espera(900)
        await foto('muestrario-conectores')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: notas.map((n) => n.id) })
      }
    },
  },
  {
    id: 'B32',
    grupo: 'B',
    temas: ['claro'],
    // Un conector verde seleccionado: se ve verde, con su halo, y la barra por encima de los objetos.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const [a, b] = await crearNotas(d, zona, [
        { x: 0, y: 60, ancho: 200, alto: 200, datos: { texto: 'Mesa libre', color: 'amarillo' } },
        { x: 560, y: 0, ancho: 200, alto: 200, datos: { texto: 'Se sienta', color: 'celeste' } },
      ])
      const con = await api(`/api/tableros/${d.tb.id}/conectores`, 'POST', { desdeId: a.id, hastaId: b.id, color: 'verde', grosor: 3, etiqueta: 'sí' })
      try {
        await abrirLienzo(page, d, { cx: zona.x + 380, cy: zona.y + 140, zoom: 1.2 })
        await espera(600)
        const et = await page.locator(`[data-etiqueta-conector="${con.id}"]`).boundingBox()
        await page.mouse.click(et.x + et.width / 2, et.y + et.height / 2)
        await espera(500)
        await page.mouse.move(et.x, et.y + 300)
        await espera(300)
        await foto('conector-verde')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [a.id, b.id] })
      }
    },
  },
  {
    id: 'B24',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // El panel "Tarjetas del Kanban" con la explicación.
    async fn(page, d, foto) {
      await abrirLienzo(page, d)
      await page.locator('button.boton-flotante', { hasText: 'Tarjetas del Kanban' }).click()
      await espera(600)
      await foto('panel-tarjetas')
    },
  },
  {
    id: 'B25',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // La misma tarjeta (RC-2, con porqué) en sus tres variantes; y (B26) una tarjeta ensanchada a 480 px.
    async fn(page, d, foto, tema) {
      const zona = libreDebajo(d)
      const t = d.completo.tarjetas.find((x) => x.clave === 'RC-2')
      const creados = await api(`/api/tableros/${d.tb.id}/elementos`, 'POST', {
        elementos: [
          { tipo: 'tarjeta', x: zona.x, y: zona.y, ancho: 260, alto: 44, tarjetaId: t.id, datos: { variante: 'compacta' } },
          { tipo: 'tarjeta', x: zona.x + 320, y: zona.y, ancho: 288, alto: 120, tarjetaId: t.id, datos: { variante: 'normal' } },
          { tipo: 'tarjeta', x: zona.x + 670, y: zona.y, ancho: 340, alto: 200, tarjetaId: t.id, datos: { variante: 'expandida' } },
          ...(tema === 'claro' ? [{ tipo: 'tarjeta', x: zona.x + 1100, y: zona.y, ancho: 480, alto: 120, tarjetaId: t.id, datos: { variante: 'normal' } }] : []),
        ],
      })
      try {
        await abrirLienzo(page, d, { cx: zona.x + 500, cy: zona.y + 110, zoom: 1.05 })
        await espera(700)
        await foto('tarjeta-variantes')
        if (tema === 'claro') {
          await abrirLienzo(page, d, { cx: zona.x + 1340, cy: zona.y + 90, zoom: 1.3 })
          await espera(600)
          const c = await centroDe(page, creados[3].id)
          await page.mouse.click(c.x, c.y)
          await espera(500)
          const archivo = path.join(SALIDA, `B26-tarjeta-480${SUFIJO}.png`)
          await page.screenshot({ path: archivo })
          console.log('  ✓', path.relative(process.cwd(), archivo))
        }
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: creados.map((e) => e.id) })
      }
    },
  },
  {
    id: 'B27',
    grupo: 'B',
    temas: ['claro'],
    // La barra de la tarjeta con el menú "Lista" abierto.
    async fn(page, d, foto) {
      const e = d.completo.elementos.find((x) => x.tipo === 'tarjeta')
      await abrirLienzo(page, d, { cx: e.x + 150, cy: e.y + 60, zoom: 1.4 })
      await espera(500)
      const c = await centroDe(page, e.id)
      await page.mouse.click(c.x, c.y)
      await espera(500)
      await page.locator('.barra-ctx [aria-label="Mover a otra lista"]').click()
      await espera(500)
      await foto('tarjeta-menu-lista')
    },
  },
  {
    id: 'C9',
    grupo: 'C',
    temas: ['claro', 'oscuro'],
    // La barra lateral: Restaurant City con foto y sus dos tableros; Hotel City con el sello.
    async fn(page, d, foto, tema, browser) {
      await conProyectos(browser, d, async () => {
        await abrirKanban(page)
        await page.mouse.move(900, 600)
        await espera(400)
        await foto('barra-lateral')
      })
    },
  },
  {
    id: 'C10',
    grupo: 'C',
    temas: ['claro'],
    // El menú del proyecto (⋯) y el menú de un tablero.
    async fn(page, d, foto, tema, browser) {
      await conProyectos(browser, d, async () => {
        await abrirKanban(page)
        await abrirMenuProyecto(page)
        await foto('menu-proyecto')
        await page.keyboard.press('Escape')
        await espera(300)
        const fila = page.locator('.tablero-item', { hasText: 'Lanzamiento' })
        await fila.hover()
        await fila.locator('.tablero-item__mas').click()
        await espera(350)
        await foto('menu-tablero')
      })
    },
  },
  {
    id: 'C11',
    grupo: 'C',
    temas: ['claro', 'oscuro'],
    // "Editar proyecto" con la foto.
    async fn(page, d, foto, tema, browser) {
      await conProyectos(browser, d, async () => {
        await abrirKanban(page)
        await abrirMenuProyecto(page)
        await page.locator('.menu__item', { hasText: 'Editar proyecto' }).click()
        await page.waitForSelector('.dialogo--proyecto')
        await espera(700)
        await foto('editar-proyecto')
      })
    },
  },
  {
    id: 'C12',
    grupo: 'C',
    temas: ['claro'],
    // Renombrar un tablero en el lugar (no guarda: Esc al final).
    async fn(page, d, foto, tema, browser) {
      await conProyectos(browser, d, async () => {
        await abrirKanban(page)
        await page.locator('.tablero-item', { hasText: 'Lanzamiento' }).locator('.tablero-item__fila').dblclick()
        await espera(200)
        await page.keyboard.press('End')
        await page.keyboard.type(' de marzo')
        await page.mouse.move(900, 600)
        await espera(300)
        await foto('renombrar-tablero')
        await page.keyboard.press('Escape')
      })
    },
  },
  {
    id: 'C13',
    grupo: 'C',
    temas: ['claro'],
    // "Archivados" abierta, con "Restaurar" al pasar el mouse. Archiva "Lanzamiento" mientras tanto, para que haya algo
    // aunque los datos sean solo los de --demo.
    async fn(page, d, foto, tema, browser) {
      await conProyectos(browser, d, async (rc) => {
        const lanzamiento = rc.tableros.find((t) => t.slug === 'lanzamiento')
        if (lanzamiento) await api(`/api/tableros/${lanzamiento.id}`, 'PATCH', { archivado: true })
        try {
          await abrirKanban(page)
          await page.locator('.archivados__titulo').click()
          await espera(450)
          await page.locator('.archivados__fila').first().hover()
          await espera(250)
          await foto('archivados')
        } finally {
          if (lanzamiento) await api(`/api/tableros/${lanzamiento.id}`, 'PATCH', { archivado: false })
        }
      })
    },
  },
  // C2 a C6: las cinco secciones de Configuración. La del lienzo se abre desde el lienzo (con un tablero abierto).
  ...[
    ['C2', 'apariencia', 'Apariencia'],
    ['C3', 'lienzo', 'Lienzo'],
    ['C4', 'estilos', 'Estilos de fábrica'],
    ['C5', 'atajos', 'Atajos'],
    ['C6', 'acerca', 'Acerca de'],
  ].map(([id, seccion, nombre]) => ({
    id,
    grupo: 'C',
    temas: ['claro', 'oscuro'],
    async fn(page, d, foto) {
      if (seccion === 'lienzo') await abrirLienzo(page, d)
      else await abrirKanban(page)
      await page.keyboard.press('Control+Comma')
      await page.waitForSelector('.dialogo.config')
      await page.locator('.config__seccion', { hasText: nombre }).click()
      await page.waitForSelector('.config__contenido .config-grupo, .config__contenido .config-atajos', { timeout: 15000 })
      await page.mouse.move(10, 890)
      await espera(800)
      await foto(`configuracion-${seccion}`)
    },
  })),
  {
    id: 'C7',
    grupo: 'C',
    temas: ['claro'],
    // Fondo de líneas y grilla de 48 (se guarda en el tablero; al terminar vuelve a puntos y 24).
    async fn(page, d, foto) {
      const m = d.marco('Mecánicas')
      await api(`/api/tableros/${d.tb.id}`, 'PATCH', { ajustes: { lienzo: { fondo: 'lineas', grilla: 48 } } })
      try {
        await abrirLienzo(page, d, { cx: m.x + m.ancho / 2, cy: m.y + m.alto / 2 - 40, zoom: 0.8 })
        await page.mouse.move(10, 890)
        await espera(500)
        await foto('fondo-lineas-48')
      } finally {
        await api(`/api/tableros/${d.tb.id}`, 'PATCH', { ajustes: { lienzo: { fondo: 'puntos', grilla: 24 } } })
      }
    },
  },
  {
    id: 'C8',
    grupo: 'C',
    temas: ['claro'],
    extra: { almacen: { 'telar.preferencias': JSON.stringify({ v: 1, densidad: 'compacta' }) } },
    async fn(page, d, foto) {
      await abrirKanban(page)
      await foto('kanban-compacto')
    },
  },
  {
    id: 'B18',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // Las 13 formas con texto.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const creadas = await crearFormas(
        d,
        zona,
        MUESTRARIO_FORMAS.map(([forma, texto, color], i) => ({
          x: (i % 5) * 250,
          y: Math.floor(i / 5) * 200,
          alto: forma === 'estrella' ? 150 : 130,
          datos: { forma, texto, relleno: color, tono: forma === 'estrella' ? 'fuerte' : 'suave' },
        })),
      )
      try {
        await abrirLienzo(page, d, { cx: zona.x + 600, cy: zona.y + 265, zoom: 0.88 })
        await espera(600)
        await foto('formas')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: creadas.map((e) => e.id) })
      }
    },
  },
  {
    id: 'B19',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // La misma forma con relleno suave, fuerte, sin relleno con borde rayado y al 40 % de opacidad.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const creadas = await crearFormas(d, zona, [
        { x: 0, y: 0, ancho: 220, datos: { forma: 'redondeado', texto: 'Relleno suave' } },
        { x: 280, y: 0, ancho: 220, datos: { forma: 'redondeado', texto: 'Relleno fuerte', tono: 'fuerte' } },
        { x: 560, y: 0, ancho: 220, datos: { forma: 'redondeado', texto: 'Sin relleno, borde rayado', relleno: 'ninguno', borde: 'azul', bordeEstilo: 'rayado' } },
        { x: 840, y: 0, ancho: 220, datos: { forma: 'redondeado', texto: 'Opacidad 40 %', tono: 'fuerte', opacidad: 0.4 } },
      ])
      try {
        await abrirLienzo(page, d, { cx: zona.x + 530, cy: zona.y + 65, zoom: 1.05 })
        await espera(600)
        await foto('rellenos')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: creadas.map((e) => e.id) })
      }
    },
  },
  {
    id: 'B20',
    grupo: 'B',
    temas: ['claro'],
    // La barra de la forma con el menú del borde abierto.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const [f] = await crearFormas(d, zona, [
        { x: 0, y: 0, ancho: 240, alto: 150, datos: { forma: 'rombo', texto: '¿Hay lugar?', relleno: 'amarillo', borde: 'naranja', bordeGrosor: 2, bordeEstilo: 'rayado' } },
      ])
      try {
        await abrirLienzo(page, d, { cx: zona.x + 120, cy: zona.y + 75, zoom: 1.3 })
        const c = await centroDe(page, f.id)
        await page.mouse.click(c.x, c.y)
        await espera(500)
        await page.locator('.barra-ctx [aria-label="Borde"]').click()
        await espera(500)
        await page.mouse.move(c.x, c.y + 400)
        await foto('barra-borde')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [f.id] })
      }
    },
  },
  {
    id: 'B21',
    grupo: 'B',
    temas: ['oscuro'],
    // Los cinco marcos de Restaurant City en oscuro: se distinguen y ninguno tiñe la pantalla.
    async fn(page, d, foto) {
      const ms = d.completo.elementos.filter((e) => e.tipo === 'marco')
      const x1 = Math.min(...ms.map((m) => m.x))
      const x2 = Math.max(...ms.map((m) => m.x + m.ancho))
      const y1 = Math.min(...ms.map((m) => m.y))
      const y2 = Math.max(...ms.map((m) => m.y + m.alto))
      await abrirLienzo(page, d, { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 + 10, zoom: 0.3 })
      await page.mouse.move(10, 890)
      await foto('marcos')
    },
  },
  {
    id: 'B22',
    grupo: 'B',
    temas: ['claro'],
    // El panel de marcos, con el que está en pantalla marcado.
    async fn(page, d, foto) {
      const m = d.marco('Flujos')
      await abrirLienzo(page, d, { cx: m.x + m.ancho / 2 - 100, cy: m.y + m.alto / 2, zoom: 0.62 })
      await page.locator('button.boton-flotante', { hasText: 'Marcos' }).click()
      await espera(500)
      await page.locator('.fila-marco', { hasText: 'Flujos' }).hover()
      await espera(250)
      await foto('panel-marcos')
    },
  },
  {
    id: 'B23',
    grupo: 'B',
    temas: ['claro'],
    // "Ajustar al contenido": antes y después (y se deshace).
    async fn(page, d, foto) {
      const m = d.marco('Mecánicas')
      await abrirLienzo(page, d, { cx: m.x + m.ancho / 2, cy: m.y + m.alto / 2 - 30, zoom: 0.78 })
      const b = await page.locator(`.react-flow__node[data-id="${m.id}"]`).boundingBox()
      await page.mouse.click(b.x + b.width / 2, b.y + 3)
      await espera(500)
      await page.locator('.barra-ctx [aria-label="Ajustar al contenido"]').hover()
      await espera(700)
      await foto('antes')
      await page.locator('.barra-ctx [aria-label="Ajustar al contenido"]').click()
      await espera(900)
      await page.mouse.move(b.x + b.width / 2, b.y + b.height + 60)
      await espera(300)
      await foto('despues')
      await page.keyboard.press('Control+z')
      await espera(900)
    },
  },
  {
    id: 'B33',
    grupo: 'B',
    temas: ['claro'],
    // La barra contextual de cada tipo: texto, nota, forma, marco, tarjeta y conector (seis recortes).
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const nota = { color: 'amarillo', fuente: 'sans', tamano: 'auto', alineacion: 'centro', alineacionV: 'medio', interlineado: 1.25, colorTexto: 'auto' }
      const creados = await api(`/api/tableros/${d.tb.id}/elementos`, 'POST', {
        elementos: [
          { tipo: 'texto', x: zona.x, y: zona.y, ancho: 260, alto: 40, datos: { texto: 'Un texto', anchoAuto: true, fuente: 'sans', tamano: 21 } },
          { tipo: 'nota', x: zona.x + 420, y: zona.y, ancho: 200, alto: 200, datos: { ...nota, texto: 'Una nota' } },
          { tipo: 'forma', x: zona.x + 800, y: zona.y + 30, ancho: 200, alto: 130, datos: { forma: 'redondeado', texto: 'Una forma', relleno: 'azul' } },
          { tipo: 'marco', x: zona.x, y: zona.y + 420, ancho: 560, alto: 320, datos: { titulo: 'Un marco', color: 'violeta', relleno: 'tinte' } },
        ],
      })
      const tarjeta = d.completo.elementos.find((e) => e.tipo === 'tarjeta')
      const [a, bNota] = [creados[0], creados[1]]
      const con = await api(`/api/tableros/${d.tb.id}/conectores`, 'POST', { desdeId: bNota.id, hastaId: creados[2].id, etiqueta: 'sí' })
      const recortar = async (nombre) => {
        const b = await page.locator('.barra-ctx').boundingBox()
        const archivo = path.join(SALIDA, `B33-barra-${nombre}${SUFIJO}.png`)
        await page.screenshot({ path: archivo, clip: { x: b.x - 14, y: b.y - 12, width: b.width + 28, height: b.height + 26 } })
        console.log('  ✓', path.relative(process.cwd(), archivo))
      }
      try {
        const casos = [
          ['texto', creados[0]],
          ['nota', creados[1]],
          ['forma', creados[2]],
          ['marco', creados[3]],
          ['tarjeta', tarjeta],
        ]
        for (const [nombre, e] of casos) {
          await abrirLienzo(page, d, { cx: e.x + e.ancho / 2, cy: e.y + e.alto / 2 + 60, zoom: 1 })
          const c = await centroDe(page, e.id)
          if (nombre === 'marco') await page.mouse.click(c.x, c.b.y + 3)
          else await page.mouse.click(c.x, c.y)
          await espera(500)
          await page.mouse.move(c.x, c.y + 300)
          await espera(200)
          await recortar(nombre)
        }
        await abrirLienzo(page, d, { cx: zona.x + 700, cy: zona.y + 100, zoom: 1 })
        const et = await page.locator(`[data-etiqueta-conector="${con.id}"]`).boundingBox()
        await page.mouse.click(et.x + et.width / 2, et.y + et.height / 2)
        await espera(500)
        await page.mouse.move(et.x, et.y + 300)
        await recortar('conector')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: creados.map((e) => e.id) })
      }
    },
  },
  {
    id: 'B34',
    grupo: 'B',
    temas: ['claro'],
    // La barra va debajo de un objeto pegado al borde de arriba.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const [n] = await crearNotas(d, zona, [{ x: 0, y: 0, datos: { texto: 'Pegada arriba', color: 'verde' } }])
      try {
        await abrirLienzo(page, d, { cx: zona.x + 110, cy: zona.y + 330, zoom: 1 })
        const c = await centroDe(page, n.id)
        await page.mouse.click(c.x, c.y)
        await espera(600)
        await page.mouse.move(c.x, c.y + 400)
        await foto('barra-debajo')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [n.id] })
      }
    },
  },
  {
    id: 'B35',
    grupo: 'B',
    temas: ['claro'],
    // Multiselección mixta (notas, una forma y un conector) con el menú Alinear abierto.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const [n1, n2] = await crearNotas(d, zona, [
        { x: 0, y: 0, datos: { texto: 'Cliente', color: 'amarillo' } },
        { x: 300, y: 50, datos: { texto: 'Mozo', color: 'celeste' } },
      ])
      const [f] = await crearFormas(d, zona, [{ x: 620, y: 30, datos: { forma: 'rombo', texto: '¿Hay mesa?', relleno: 'verde' } }])
      await api(`/api/tableros/${d.tb.id}/conectores`, 'POST', { desdeId: n1.id, hastaId: n2.id })
      try {
        await abrirLienzo(page, d, { cx: zona.x + 420, cy: zona.y + 200, zoom: 0.9 })
        const a = await centroDe(page, n1.id)
        const b = await centroDe(page, f.id)
        await page.mouse.move(a.b.x - 30, a.b.y - 30)
        await page.mouse.down()
        await page.mouse.move(b.b.x + b.b.width + 30, b.b.y + b.b.height + 80, { steps: 10 })
        await page.mouse.up()
        await espera(500)
        await page.locator('.barra-ctx [aria-label="Alinear"]').click()
        await espera(500)
        await foto('multiseleccion-alinear')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [n1.id, n2.id, f.id] })
      }
    },
  },
  {
    id: 'B36',
    grupo: 'B',
    temas: ['claro'],
    // El menú contextual: sobre un objeto y sobre el vacío.
    async fn(page, d, foto) {
      const zona = libreDebajo(d)
      const [n] = await crearNotas(d, zona, [{ x: 0, y: 0, datos: { texto: 'Con el botón derecho', color: 'rosa' } }])
      try {
        await abrirLienzo(page, d, { cx: zona.x + 300, cy: zona.y + 240, zoom: 1 })
        const c = await centroDe(page, n.id)
        await page.mouse.click(c.x, c.y, { button: 'right' })
        await espera(500)
        await foto('menu-objeto')
        await page.keyboard.press('Escape')
        await espera(300)
        await page.mouse.click(c.x + 420, c.y - 40, { button: 'right' })
        await espera(500)
        await foto('menu-vacio')
        await page.keyboard.press('Escape')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [n.id] })
      }
    },
  },
  {
    id: 'B37',
    grupo: 'B',
    temas: ['claro'],
    // Una nota que arma la IA por MCP (Markdown con negrita, lista y tarea), con la firma de quién la hizo.
    async fn(page, d, foto) {
      const info = await api('/api/info')
      const zona = libreDebajo(d)
      const r = await fetch(`${WEB}/api/herramientas/agregar_al_lienzo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${info.clave}` },
        body: JSON.stringify({
          actor: { tipo: 'ia', id: 'ia:claude', nombre: 'Claude', cliente: 'Claude Code' },
          args: {
            proyecto: 'RC',
            tablero: 'Pendientes',
            tipo: 'nota',
            color: 'celeste',
            x: zona.x,
            y: zona.y,
            ancho: 280,
            alto: 280,
            texto: 'Para la **hora pico**:\n\n- Dos mozos en el salón\n- *Platos rápidos* primero\n- [ ] Medir la espera',
          },
        }),
      }).then((x) => x.json())
      if (!r.ok) throw new Error(r.error)
      const id = r.resultado.objeto.id
      try {
        await abrirLienzo(page, d, { cx: zona.x + 140, cy: zona.y + 140, zoom: 1.4 })
        await page.mouse.move(10, 890)
        await espera(400)
        await foto('nota-por-mcp')
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: [id] })
      }
    },
  },
  {
    id: 'D1',
    grupo: 'D',
    temas: ['claro', 'oscuro'],
    // El anillo de foco (con teclado): un botón de la barra de herramientas, una nota (su marco de selección es el foco)
    // y un botón de un diálogo.
    async fn(page, d, foto) {
      const m = d.marco('Mecánicas')
      await abrirLienzo(page, d, { cx: m.x + m.ancho / 2, cy: m.y + m.alto / 2 - 60, zoom: 0.9 })
      await page.keyboard.press('Shift')
      await page.locator('.herramientas button[aria-label^="Nota"]').first().focus()
      await espera(250)
      const barra = await page.locator('.herramientas').boundingBox()
      await foto('foco-herramientas', { clip: { x: barra.x - 24, y: barra.y - 24, width: barra.width + 48, height: barra.height + 48 } })
      await page.focus('.lienzo .react-flow')
      for (let i = 0; i < 2; i++) {
        await page.keyboard.press('Tab')
        await espera(350)
      }
      const nodo = await page.evaluate(() => {
        const r = document.activeElement?.closest('.react-flow__node')?.getBoundingClientRect()
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
      })
      if (nodo) await foto('foco-nota', { clip: { x: nodo.x - 60, y: nodo.y - 90, width: nodo.w + 120, height: nodo.h + 150 } })
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+Comma')
      await page.waitForSelector('.dialogo.config')
      await espera(500)
      await page.keyboard.press('Tab')
      await espera(250)
      const dialogo = await page.locator('.dialogo.config').boundingBox()
      await foto('foco-dialogo', { clip: { x: dialogo.x, y: dialogo.y, width: dialogo.width, height: 260 } })
    },
  },
  {
    id: 'D2',
    grupo: 'D',
    temas: ['claro'],
    // Mil objetos al 10 %: el nivel de detalle (sin sombras, sin texto en notas y formas).
    async fn(page, d, foto) {
      const rc = (await api('/api/proyectos')).find((p) => p.prefijo === 'RC')
      const tb = rc.tableros.find((t) => t.slug === 'rendimiento-1000')
      if (!tb) throw new Error('falta el tablero rendimiento-1000 (scripts/sembrar-lienzo.mjs)')
      await page.goto(`${WEB}/RC/rendimiento-1000/lienzo`)
      await page.waitForSelector('.react-flow__node', { timeout: 20000 })
      await espera(900)
      const caja = await page.locator('.react-flow').boundingBox()
      // El centro de lo que se ve (abre con "ver todo"), y desde ahí al 10 %.
      const { cx, cy } = await page.evaluate(([w, h]) => {
        const m = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform)
        return { cx: (w / 2 - m.e) / m.a, cy: (h / 2 - m.f) / m.a }
      }, [caja.width, caja.height])
      await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [`tablero.vista.${tb.id}`, { x: caja.width / 2 - cx * 0.1, y: caja.height / 2 - cy * 0.1, zoom: 0.1 }])
      await page.reload()
      await page.waitForSelector('.react-flow__node', { timeout: 20000 })
      await espera(1500)
      await page.mouse.move(10, 890)
      await foto('mil-al-10')
    },
  },
  {
    id: 'D3',
    grupo: 'D',
    temas: ['claro'],
    // Los estados vacíos (9.2), un recorte de cada uno.
    async fn(page, d, foto) {
      const recorte = async (sel, nombre, margen = 8) => {
        const b = await page.locator(sel).first().boundingBox()
        await foto(nombre, { clip: { x: b.x - margen, y: b.y - margen, width: b.width + margen * 2, height: b.height + margen * 2 } })
      }
      await page.goto(`${WEB}/RC/lanzamiento/lienzo`)
      await page.waitForSelector('.lienzo-vacio', { timeout: 15000 })
      await espera(600)
      await page.mouse.move(10, 890)
      await recorte('.lienzo-vacio', 'lienzo')
      await page.locator('button', { hasText: 'Tarjetas del Kanban' }).first().click()
      await espera(500)
      await recorte('.panel-tarjetas', 'panel-tarjetas')
      await page.keyboard.press('Escape')
      await espera(700)
      await page.locator('button', { hasText: 'Marcos' }).first().click()
      await espera(500)
      await recorte('.panel-marcos', 'panel-marcos')
      await page.keyboard.press('Escape')
      await espera(200)
      await page.focus('.lienzo .react-flow')
      await page.keyboard.press('Control+KeyF')
      await page.waitForSelector('.buscador input')
      await page.keyboard.type('zzzz')
      await espera(400)
      await recorte('.buscador', 'buscador')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+Comma')
      await page.waitForSelector('.dialogo.config')
      await page.locator('.config__seccion', { hasText: 'Atajos' }).click()
      await page.locator('.config-atajos__buscar input').fill('zzzz')
      await espera(400)
      await recorte('.config__contenido', 'atajos', 0)
    },
  },
  {
    id: 'D4',
    grupo: 'D',
    temas: ['claro'],
    // El zoom del navegador al 200 % en una pantalla de 1440 × 900: la página mide 720 × 450.
    async fn(page, d, foto, tema, browser) {
      const ctx = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: ESCALA * 2 })
      await ctx.addInitScript(() => localStorage.setItem('tablero.tema', 'claro'))
      const p = await ctx.newPage()
      try {
        await p.goto(`${WEB}/RC/pendientes`)
        await p.waitForSelector('.lista .tarjeta', { timeout: 15000 })
        await espera(700)
        await p.screenshot({ path: path.join(SALIDA, `D4-kanban-200${SUFIJO}.png`) })
        console.log('  ✓', `D4-kanban-200${SUFIJO}.png`)
        await p.keyboard.press('Control+Comma')
        await p.waitForSelector('.dialogo.config')
        await espera(600)
        await p.screenshot({ path: path.join(SALIDA, `D4-configuracion-200${SUFIJO}.png`) })
        console.log('  ✓', `D4-configuracion-200${SUFIJO}.png`)
        await p.keyboard.press('Escape')
        await p.goto(`${WEB}/RC/pendientes/lienzo`)
        await p.waitForSelector('.react-flow__node', { timeout: 15000 })
        await espera(1200)
        await p.mouse.move(5, 445)
        await p.screenshot({ path: path.join(SALIDA, `D4-lienzo-200${SUFIJO}.png`) })
        console.log('  ✓', `D4-lienzo-200${SUFIJO}.png`)
      } finally {
        await ctx.close()
      }
    },
  },
  {
    id: 'B38',
    grupo: 'B',
    temas: ['claro', 'oscuro'],
    // El lienzo vacío (el tablero Lanzamiento no tiene objetos).
    async fn(page, d, foto) {
      await page.goto(`${WEB}/RC/lanzamiento/lienzo`)
      await page.waitForSelector('.lienzo-vacio', { timeout: 15000 })
      await espera(800)
      await page.mouse.move(10, 890)
      await foto('lienzo-vacio')
    },
  },
  {
    id: 'E1',
    grupo: 'E',
    temas: ['claro'],
    // La tira de las animaciones (sección 15, punto 3): el aviso de la herramienta entrando, una nota arrastrándose, un
    // conector dibujándose y el menú "Crear y conectar" apareciendo. Se graba en cámara lenta (el reloj de la página y
    // las animaciones CSS y WAAPI a 1/10) y se eligen 6 cuadros de cada una; debajo de cada cuadro, el tiempo real.
    async fn(page, d, foto) {
      const LENTO = 10
      await page.context().addInitScript(() => {
        const real = performance.now.bind(performance)
        let k = 1
        let baseReal = real()
        let baseFalso = baseReal
        const falso = (r) => baseFalso + (r - baseReal) / k
        performance.now = () => falso(real())
        const raf = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (cb) => raf((t) => cb(falso(t)))
        window.__camaraLenta = (nuevo) => {
          const r = real()
          baseFalso = falso(r)
          baseReal = r
          k = nuevo
        }
      })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Animation.enable')
      const camara = async (k) => {
        await page.evaluate((k) => window.__camaraLenta(k), k)
        await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / k })
      }
      /** Cuadros sin parar durante `ms` reales desde `desde`; el tiempo de cada uno, en el reloj de la cámara lenta. */
      const grabar = async (clip, ms, desde) => {
        const cuadros = []
        while (Date.now() - desde < ms) {
          const t = (Date.now() - desde) / LENTO
          cuadros.push({ t, img: await page.screenshot({ clip }) })
        }
        return cuadros
      }
      /** El cuadro más cercano a cada tiempo pedido (ms reales). */
      const elegir = (cuadros, tiempos) =>
        tiempos.map((t) => cuadros.reduce((a, c) => (Math.abs(c.t - t) < Math.abs(a.t - t) ? c : a)))
      const rodear = (b, izq, der, arr, aba) => ({ x: Math.max(0, b.x - izq), y: Math.max(0, b.y - arr), width: b.width + izq + der, height: b.height + arr + aba })
      const ms = (c) => `${Math.round(c.t)} ms`

      const zona = libreDebajo(d)
      const notas = await crearNotas(d, zona, [
        { x: 0, y: 0, datos: { texto: 'Mesa para cuatro', color: 'verde' } },
        { x: 260, y: 0, datos: { texto: 'La que se mueve', color: 'naranja' } },
        { x: 0, y: 600, ancho: 200, alto: 200, datos: { texto: 'El cliente entra', color: 'celeste' } },
      ])
      const filas = []
      try {
        // 1 · El aviso de la herramienta entra (tecla N). Un ensayo primero, para saber dónde queda.
        await abrirLienzo(page, d, { cx: zona.x + 330, cy: zona.y + 200, zoom: 1.2 })
        await camara(1)
        await page.mouse.move(1300, 840)
        await page.keyboard.press('KeyN')
        await espera(700)
        const aviso = await page.locator('.aviso-herramienta').boundingBox()
        await page.keyboard.press('Escape')
        await espera(800)
        const clip1 = rodear(aviso, 18, 18, 14, 14)
        await camara(LENTO)
        const t1 = Date.now()
        await page.keyboard.press('KeyN')
        const c1 = await grabar(clip1, 2600, t1)
        await camara(1)
        await page.keyboard.press('Escape')
        filas.push({ titulo: 'Aviso de la herramienta entrando (tecla N)', cuadros: elegir(c1, [0, 20, 45, 80, 130, 240]).map((c) => ({ ...c, pie: ms(c) })) })

        // 2 · Una nota arrastrándose: se levanta, se agranda apenas y gira hacia donde va.
        await espera(500)
        const n2 = await centroDe(page, notas[1].id)
        const clip2 = rodear(n2.b, 30, 210, 30, 100)
        await page.mouse.move(n2.x, n2.y)
        await espera(500)
        await camara(LENTO)
        const t2 = Date.now()
        const c2 = [{ t: 0, img: await page.screenshot({ clip: clip2 }) }]
        await page.mouse.down()
        for (let i = 1; i <= 5; i++) {
          await page.mouse.move(n2.x + 34 * i, n2.y + 14 * i, { steps: 4 })
          await espera(i === 1 ? 120 : 260)
          c2.push({ t: (Date.now() - t2) / LENTO, img: await page.screenshot({ clip: clip2 }) })
        }
        await page.mouse.up()
        await camara(1)
        filas.push({ titulo: 'Nota arrastrándose: se levanta y gira hacia donde va', cuadros: c2.map((c) => ({ ...c, pie: ms(c) })) })

        // 3 · Un conector dibujándose desde el punto de la derecha, y 4 · soltado en el aire: el menú "Crear y conectar".
        await espera(600)
        await abrirLienzo(page, d, { cx: zona.x + 330, cy: zona.y + 760, zoom: 1.2 })
        await camara(1)
        const n3 = page.locator(`.react-flow__node[data-id="${notas[2].id}"]`)
        const b3 = await n3.boundingBox()
        const PASOS = [
          [30, 3],
          [80, 10],
          [130, 18],
          [180, 26],
          [230, 34],
        ]
        const tirar = async (alMover) => {
          await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2)
          await espera(450)
          const h = await n3.locator('.punto-conexion[data-lado="derecha"]').boundingBox()
          const p0 = { x: h.x + h.width / 2, y: h.y + h.height / 2 }
          await page.mouse.move(p0.x, p0.y)
          await espera(200)
          await alMover?.('el punto')
          await page.mouse.down()
          for (const [dx, dy] of PASOS) {
            await page.mouse.move(p0.x + dx, p0.y + dy, { steps: 6 })
            await espera(60)
            await alMover?.(`+${dx} px`)
          }
        }
        // Ensayo: dónde cae el menú, para que el recorte tome la nota, la línea y el menú.
        await tirar()
        await page.mouse.up()
        await espera(700)
        const menu = await page.locator('.menu-conectar').boundingBox()
        await page.keyboard.press('Escape')
        await espera(700)
        const y0 = Math.min(b3.y, menu.y)
        const clip3 = rodear({ x: b3.x, y: y0, width: menu.x + menu.width - b3.x, height: Math.max(b3.y + b3.height, menu.y + menu.height) - y0 }, 24, 28, 24, 24)
        // La línea sola, en un recorte más bajo (sin el lugar del menú).
        const clipLinea = rodear({ x: b3.x, y: b3.y, width: b3.width + 16 + PASOS.at(-1)[0], height: b3.height }, 24, 40, 24, 24)
        const c3 = []
        await tirar(async (pie) => c3.push({ pie, img: await page.screenshot({ clip: clipLinea }) }))
        filas.push({ titulo: 'Conector dibujándose desde el punto de la derecha', cuadros: c3 })
        await camara(LENTO)
        const t4 = Date.now()
        await page.mouse.up()
        const c4 = await grabar(clip3, 2400, t4)
        await camara(1)
        await page.keyboard.press('Escape')
        filas.push({ titulo: 'Soltado en el aire: el menú "Crear y conectar" (desde su origen, 140 ms)', cuadros: elegir(c4, [0, 15, 35, 60, 100, 200]).map((c) => ({ ...c, pie: ms(c) })) })

        // La tira: seis cuadros por fila a 290 px; el aviso y el menú, en dos renglones de tres a 588, para que se lean.
        const anchos = [588, 290, 290, 588]
        const html = filas
          .map(
            (f, i) =>
              `<section><h2><span>${i + 1}</span>${f.titulo}</h2><div class="cuadros" style="--ancho: ${anchos[i]}px">${f.cuadros
                .map((c) => `<figure><img src="data:image/png;base64,${c.img.toString('base64')}"><figcaption>${c.pie}</figcaption></figure>`)
                .join('')}</div></section>`,
          )
          .join('')
        const caja = await page.evaluate(async (html) => {
          const el = document.createElement('div')
          el.id = 'tira'
          el.innerHTML = `<style>
            #tira { position: fixed; left: 0; top: 0; z-index: 2147483647; width: max-content; padding: 28px 32px 8px;
              background: #f4efe6; color: #24211d; font-family: 'Figtree Variable', system-ui, sans-serif; }
            #tira section { margin-bottom: 26px; }
            #tira h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-size: 17px; font-weight: 650; }
            #tira h2 span { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
              background: #24211d; color: #f4efe6; font-size: 13px; }
            #tira .cuadros { display: flex; flex-wrap: wrap; gap: 14px 12px; align-items: flex-start; width: 1800px; }
            #tira figure { margin: 0; }
            #tira img { display: block; width: var(--ancho); border-radius: 8px; box-shadow: 0 0 0 1px rgba(36, 33, 29, 0.12); }
            #tira figcaption { margin-top: 6px; text-align: center; font: 500 12px/1.2 'Geist Mono Variable', monospace; color: #857d72; }
          </style>${html}`
          document.body.append(el)
          await Promise.all([...el.querySelectorAll('img')].map((i) => i.decode()))
          const r = el.getBoundingClientRect()
          return { width: Math.ceil(r.width), height: Math.ceil(r.height) }
        }, html)
        await page.setViewportSize(caja)
        await espera(300)
        await foto('tira-animaciones', { clip: { x: 0, y: 0, ...caja } })
      } finally {
        await api('/api/elementos/eliminar', 'POST', { ids: notas.map((e) => e.id) })
      }
    },
  },
]

;(async () => {
  fs.mkdirSync(SALIDA, { recursive: true })
  const d = await datos()
  const browser = await chromium.launch()
  const elegidas = ESCENAS.filter((e) => (SOLO.length ? SOLO.includes(e.id) : GRUPOS.length ? GRUPOS.includes(e.grupo) : true))
  for (const escena of elegidas) {
    for (const tema of escena.temas) {
      const { ctx, page } = await nuevaPagina(browser, tema, escena.extra)
      const unTema = escena.temas.length === 1
      const foto = async (nombre, opciones = {}) => {
        const archivo = path.join(SALIDA, `${escena.id}-${nombre}${unTema ? '' : `-${tema}`}${SUFIJO}.png`)
        await page.screenshot({ path: archivo, ...opciones })
        console.log('  ✓', path.relative(process.cwd(), archivo))
      }
      try {
        await escena.fn(page, d, foto, tema, browser)
      } catch (e) {
        console.error(`  ✗ ${escena.id} (${tema}):`, e.message)
      } finally {
        await ctx.close()
      }
    }
  }
  await browser.close()
})()
