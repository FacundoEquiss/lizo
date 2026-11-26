// Capturas de verificación del celular (plan v0.2 del celular, sección 16).
//
//   node scripts/capturas-movil.mjs                     levanta la app con una base de prueba propia, la siembra y saca todo
//   node scripts/capturas-movil.mjs --url=http://127.0.0.1:4417   usa una app que ya está corriendo (se siembra si hace falta)
//   --solo=04,16          solo esas capturas            --dispositivos=iphone15,pixel8,iphone15h
//   --temas=claro         solo un tema                  --escritorio=antes|despues   regresión de escritorio (1440×900)
//   --pwa                 capturas del manifest (web/public/pwa/captura-*.png); después, npm run pwa:iconos
//   --rendimiento         JavaScript inicial, primera y segunda carga, arrastre con 150 tarjetas y hojas (CPU ×4);
//                         con --modo=produccion (hace falta npm run build antes) mide también la segunda carga con
//                         service worker
//
// Usa devices['iPhone 15'], devices['iPhone 15 landscape'] y devices['Pixel 8'] de Playwright, sin tocar deviceScaleFactor,
// y toques reales por CDP (Input.dispatchTouchEvent) para los gestos. Nunca usa datos reales: la base es de prueba.
// El teclado en pantalla (que el emulador no dibuja) se simula achicando el alto visible por CDP; la captura agrega abajo
// una franja gris del alto del teclado, para que se vea qué quedó tapado.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { clienteApi, importarPlaywright, levantar, RAIZ, sembrar } from './prueba-local.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.length ? v.join('=') : true]
  }),
)
const SALIDA = path.resolve(RAIZ, args.salida || 'docs/capturas/movil')
mkdirSync(SALIDA, { recursive: true })
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const lista = (v, porDefecto) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : porDefecto)
const SOLO = lista(args.solo, null)
const toca = (nn) => !SOLO || SOLO.includes(nn)

const { chromium, devices } = await importarPlaywright()

let app = null
let base = args.url
const produccion = args.modo === 'produccion'
if (!base) {
  // --modo=produccion sirve la versión compilada (hay que correr npm run build antes); si no, npm run dev.
  app = await levantar({ modo: produccion ? 'produccion' : 'dev', datos: '/tmp/telar-movil-capturas', puerto: produccion ? 4419 : 4418, puertoWeb: 4417 })
  base = app.url
}
const semilla = await sembrar(base)
const RUTA = `/${semilla.prefijo}/${semilla.slug}`
const DECISION = semilla.decision ?? 'RC-4'
const api = clienteApi(base)

const navegador = await chromium.launch()
let informePrevio = {}
try {
  informePrevio = JSON.parse(readFileSync(path.join(SALIDA, 'informe.json'), 'utf8'))
} catch {}
const informe = { ...informePrevio, fecha: new Date().toISOString(), base: produccion ? 'versión compilada' : 'npm run dev' }
informe.dispositivos ??= {}

async function contexto(dispositivo, tema, extra = {}) {
  const ctx = await navegador.newContext({ ...dispositivo, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', ...extra })
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('tablero.tema', t)
      if (!localStorage.getItem('telar.prueba')) {
        localStorage.setItem('telar.prueba', '1')
        localStorage.setItem('telar.instalar.visto', String(Date.now()))
      }
    } catch {}
  }, tema === 'oscuro' ? 'oscuro' : 'claro')
  return ctx
}

/** Espera a que un elemento animado deje de moverse (el resorte de la copia que se arrastra, por ejemplo). */
async function quieto(page, selector) {
  let antes = ''
  let iguales = 0
  for (let i = 0; i < 60 && iguales < 4; i++) {
    await esperar(100)
    const ahora = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return ''
      const r = el.getBoundingClientRect()
      return `${getComputedStyle(el).transform} ${r.x.toFixed(2)} ${r.y.toFixed(2)}`
    }, selector)
    iguales = ahora === antes ? iguales + 1 : 0
    antes = ahora
  }
}

/** Espera a que el tablero esté pintado (y sin animaciones en curso). */
async function listo(page, selector = '.lista') {
  await page.waitForSelector(selector, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await esperar(450)
}

// ───────── Regresión de escritorio ─────────

async function escritorio(cual) {
  const dir = path.join(SALIDA, '..', '..', '..', '.tmp', 'regresion-escritorio', cual)
  mkdirSync(dir, { recursive: true })
  const resultados = {}
  for (const tema of ['claro', 'oscuro']) {
    const ctx = await contexto({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, tema)
    const page = await ctx.newPage()
    await page.goto(base + RUTA)
    await listo(page)
    const enmascarar = [page.locator('.en-vivo')]
    await page.screenshot({ path: path.join(dir, `${tema}-kanban.png`), mask: enmascarar })
    // Arrastre con mouse: se agarra la tercera tarjeta de la primera lista y se lleva a la segunda.
    const tarjeta = page.locator('.lista').first().locator('.ordenable').nth(2)
    const caja = await tarjeta.boundingBox()
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(caja.x + caja.width / 2 + i * 25, caja.y + caja.height / 2 + i * 4)
    await quieto(page, '.sombra-arrastre__giro')
    await page.screenshot({ path: path.join(dir, `${tema}-arrastre.png`), mask: enmascarar })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await esperar(400)
    await page.goto(`${base}${RUTA}?tarjeta=${DECISION}`)
    await listo(page, '.hoja .porque')
    // Lo que dice "hace X minutos" cambia entre una corrida y otra: se esconde sin mover nada.
    await page.addStyleTag({ content: '.hoja__origen, .porque__cuando, .comentario__cuando, .evento__cuando { visibility: hidden !important }' })
    await page.mouse.move(5, 895)
    await esperar(800)
    await page.screenshot({ path: path.join(dir, `${tema}-tarjeta.png`), mask: enmascarar })
    await ctx.close()
  }
  if (cual === 'despues') {
    // Comparación píxel a píxel con las de antes, dentro del navegador (sin dependencias).
    const page = await (await navegador.newContext()).newPage()
    for (const nombre of ['claro-kanban', 'claro-arrastre', 'claro-tarjeta', 'oscuro-kanban', 'oscuro-arrastre', 'oscuro-tarjeta']) {
      const a = path.join(dir, '..', 'antes', `${nombre}.png`)
      const b = path.join(dir, `${nombre}.png`)
      let antes
      try {
        antes = readFileSync(a).toString('base64')
      } catch {
        resultados[nombre] = 'sin captura de antes'
        continue
      }
      const despues = readFileSync(b).toString('base64')
      resultados[nombre] = await page.evaluate(
        async ([x, y]) => {
          const cargar = (s) =>
            new Promise((ok) => {
              const i = new Image()
              i.onload = () => ok(i)
              i.src = 'data:image/png;base64,' + s
            })
          const [ia, ib] = await Promise.all([cargar(x), cargar(y)])
          if (ia.width !== ib.width || ia.height !== ib.height) return { distintos: 'tamaño' }
          const lienzo = (i) => {
            const c = document.createElement('canvas')
            c.width = i.width
            c.height = i.height
            const g = c.getContext('2d')
            g.drawImage(i, 0, 0)
            return g.getImageData(0, 0, i.width, i.height).data
          }
          const da = lienzo(ia)
          const db = lienzo(ib)
          let distintos = 0
          const caja = { x1: Infinity, y1: Infinity, x2: -1, y2: -1 }
          for (let p = 0; p < da.length; p += 4)
            if (Math.abs(da[p] - db[p]) > 2 || Math.abs(da[p + 1] - db[p + 1]) > 2 || Math.abs(da[p + 2] - db[p + 2]) > 2) {
              distintos++
              const x = (p / 4) % ia.width
              const y = Math.floor(p / 4 / ia.width)
              caja.x1 = Math.min(caja.x1, x)
              caja.y1 = Math.min(caja.y1, y)
              caja.x2 = Math.max(caja.x2, x)
              caja.y2 = Math.max(caja.y2, y)
            }
          return distintos ? { distintos, total: da.length / 4, zona: caja } : { distintos: 0, total: da.length / 4 }
        },
        [antes, despues],
      )
    }
  }
  return resultados
}

// ───────── Celular ─────────

const DISPOSITIVOS = {
  iphone15: { dispositivo: 'iPhone 15', teclado: 336 },
  pixel8: { dispositivo: 'Pixel 8', teclado: 300 },
  iphone15h: { dispositivo: 'iPhone 15 landscape', teclado: 190 },
}
const EN_HORIZONTAL = ['01', '04', '06', '16', '21']

/** Toques reales por CDP. */
function crearDedo(cdp) {
  const enviar = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] })
  return {
    async deslizar(x0, y0, dx, dy, pasos = 12, ms = 16) {
      await enviar('touchStart', x0, y0)
      for (let i = 1; i <= pasos; i++) {
        await enviar('touchMove', x0 + (dx * i) / pasos, y0 + (dy * i) / pasos)
        await esperar(ms)
      }
      await enviar('touchEnd', 0, 0)
    },
    async apretar(x, y, ms = 340) {
      await enviar('touchStart', x, y)
      await esperar(ms)
    },
    async llevar(x0, y0, x1, y1, pasos = 15, ms = 25) {
      for (let i = 1; i <= pasos; i++) {
        await enviar('touchMove', x0 + ((x1 - x0) * i) / pasos, y0 + ((y1 - y0) * i) / pasos)
        await esperar(ms)
      }
    },
    soltar: () => enviar('touchEnd', 0, 0),
  }
}

/** Lo que el informe mide en cada pantalla: ancho, zonas táctiles, letra de los campos y lo que se sale. */
async function medir(page) {
  return page.evaluate(() => {
    const W = innerWidth
    const H = innerHeight
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W
    }
    const nombre = (el) =>
      (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || el.className || el.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 48)
    // Zona táctil: hasta dónde un toque todavía llega al control, desde su centro hacia cada lado (cuenta lo que agranda
    // un ::before o ::after, o la celda entera si es la que se toca).
    // Algo fijo o pegado encima (la cabecera de una hoja, un aviso, la barra de comentar) tapa por un momento: depende
    // de dónde quedó el scroll, no del tamaño del control. Ese lado se cuenta como alcanzado.
    const fijo = (n) => {
      for (let p = n; p && p !== document.body; p = p.parentElement) if (/fixed|sticky/.test(getComputedStyle(p).position)) return p
      return null
    }
    // El borde de lo que se desplaza (una lista, un panel) también es scroll: más allá, se cuenta como alcanzado.
    const marco = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
        if (/auto|scroll/.test(getComputedStyle(p).overflowY + getComputedStyle(p).overflowX)) return p.getBoundingClientRect()
      return null
    }
    const alcanza = (el, dx, dy) => {
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2 + dx
      const y = r.top + r.height / 2 + dy
      if (x < 0 || y < 0 || x >= W || y >= H) return true
      const m = marco(el)
      if (m && (x < m.left || x >= m.right || y < m.top || y >= m.bottom)) return true
      const otro = document.elementFromPoint(x, y)
      if (!otro) return false
      if (el.contains(otro) || otro.contains(el)) return true
      const tapa = fijo(otro)
      return !!tapa && !tapa.contains(el) && (dx !== 0 || dy !== 0)
    }
    const zona = (el, eje) => {
      let n = 1
      for (const signo of [-1, 1])
        for (let d = 1; d <= 30; d++) {
          if (!alcanza(el, eje === 'x' ? signo * d : 0, eje === 'y' ? signo * d : 0)) break
          n++
        }
      return n
    }
    // Lo que el plan define más bajo a propósito (se informa aparte, con el motivo).
    const EXCEPCIONES = [
      ['.franja-conexion__dentro', 'franja de 32 px a todo el ancho (9.6)'],
      ['.app-movil--apaisado .barra-movil :is(button, [role="button"])', 'barra superior de 40 px en horizontal (4.1)'],
      ['.react-flow__attribution a', 'crédito de React Flow en el lienzo (lo resuelve el lienzo completo, paquete H)'],
    ]
    const chicos = []
    const excepciones = []
    for (const el of document.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [role="switch"], [role="radio"], [role="tab"], [role="option"], [role="menuitem"]')) {
      if (!visible(el) || el.closest('[aria-hidden="true"], [inert]') || el.matches('.ordenable')) continue
      // A medias fuera de la pantalla: depende del scroll (se mide cuando está entero a la vista).
      const caja = el.getBoundingClientRect()
      if (caja.top < 0 || caja.left < 0 || caja.bottom > H || caja.right > W) continue
      // Lo que está tapado (debajo de una hoja, de un velo o de un aviso) no se puede tocar ahora: no cuenta.
      if (!alcanza(el, 0, 0)) continue
      if (el.parentElement?.closest('button, [role="button"], [role="option"], [role="menuitem"], a[href]')) continue
      const r = el.getBoundingClientRect()
      const zx = r.width >= 43.5 ? r.width : zona(el, 'x')
      const zy = r.height >= 43.5 ? r.height : zona(el, 'y')
      if (zx < 43.5 || zy < 43.5) {
        const dato = { que: nombre(el), ancho: Math.round(r.width), alto: Math.round(r.height), zona: `${Math.round(zx)}×${Math.round(zy)}` }
        const motivo = EXCEPCIONES.find(([sel]) => el.matches(sel))?.[1]
        if (motivo) excepciones.push({ ...dato, motivo })
        else chicos.push(dato)
      }
    }
    const letraChica = [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select, [contenteditable="true"]')]
      .filter(visible)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => ({ que: nombre(el), letra: getComputedStyle(el).fontSize }))
    // Lo que se sale a los costados sin estar dentro de algo que lo recorta o se desplaza (el paginado, la tira).
    const afuera = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || (r.right <= W + 1 && r.left >= -1) || r.bottom < 0 || r.top > H) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      let recortado = false
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') {
          recortado = true
          break
        }
      }
      if (!recortado) afuera.push({ que: nombre(el), izquierda: Math.round(r.left), derecha: Math.round(r.right) })
    }
    return { anchoPagina: document.documentElement.scrollWidth, anchoVentana: W, chicos, excepciones, letraChica, afuera: afuera.slice(0, 20) }
  })
}

/** Contraste de los textos chicos de la barra inferior y de la tira contra su fondo (10.2: mínimo 4,5:1). */
async function contraste(page) {
  return page.evaluate(() => {
    const leer = (c) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number)
      if (c.startsWith('color(srgb')) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1]
      return [n[0], n[1], n[2], n[3] ?? 1]
    }
    const luz = ([r, g, b]) => {
      const f = (v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    // El fondo efectivo: se mezclan las capas semitransparentes hasta llegar a una opaca.
    const fondo = (el) => {
      const capas = []
      for (let p = el; p; p = p.parentElement) {
        const c = leer(getComputedStyle(p).backgroundColor)
        if (c[3] > 0) capas.push(c)
        if (c[3] >= 1) break
      }
      let res = capas.length && capas.at(-1)[3] >= 1 ? capas.pop().slice(0, 3) : [255, 255, 255]
      for (const c of capas.reverse()) res = res.map((v, i) => v * (1 - c[3]) + c[i] * c[3])
      return res
    }
    const r = {}
    for (const sel of ['.barra-inferior__texto', '.pastilla-lista__nombre', '.pastilla-lista__cuenta']) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el)
        const c = leer(cs.color)
        const f = fondo(el)
        const texto = f.map((v, i) => v * (1 - c[3] * Number(cs.opacity)) + c[i] * c[3] * Number(cs.opacity))
        const [a, b] = [luz(texto), luz(f)].sort((x, y) => y - x)
        const razon = (a + 0.05) / (b + 0.05)
        const clave = `${sel} (${parseFloat(cs.fontSize)} px)`
        r[clave] = Math.min(r[clave] ?? Infinity, +razon.toFixed(2))
      }
    }
    return r
  })
}

async function celular(clave, tema) {
  const { dispositivo, teclado } = DISPOSITIVOS[clave]
  const ctx = await contexto(devices[dispositivo], tema)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const dedo = crearDedo(cdp)
  const errores = []
  page.on('pageerror', (e) => errores.push(`${e.message} (${(e.stack ?? '').split('\n').slice(1, 3).join(' ').trim()})`))
  if (process.env.DEPURAR) {
    await page.addInitScript(() =>
      addEventListener('keydown', (e) => { if (!(e.target instanceof Element)) console.log('TECLA-RARA', e.key, String(e.target), new Error().stack) }, true),
    )
    page.on('console', (m) => { if (m.text().startsWith('TECLA-RARA')) console.log(m.text().slice(0, 900)) })
  }
  const medidas = {}
  const hechas = []
  const archivo = (nn, nombre) => path.join(SALIDA, `${clave}-${tema}-${nn}-${nombre}.png`)
  const foto = async (nn, nombre, medirla = tema === 'claro') => {
    await page.screenshot({ path: archivo(nn, nombre) })
    hechas.push(`${nn}-${nombre}`)
    if (medirla) medidas[nn] = await medir(page)
  }
  // El teclado: se achica el alto visible (como hace Android; en iOS la app lo lleva a --teclado) y se dibuja abajo.
  const fotoConTeclado = async (nn, nombre, antes) => {
    const vp = page.viewportSize()
    const dpr = await page.evaluate(() => devicePixelRatio)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height - teclado, deviceScaleFactor: dpr, mobile: true })
    await esperar(450)
    try {
      if (antes) await antes()
      await esperar(250)
      const imagen = await page.screenshot()
      const sharp = (await import('sharp')).default
      await sharp(imagen)
        .extend({ bottom: Math.round(teclado * dpr), background: tema === 'oscuro' ? '#2c2c2e' : '#d1d3d9' })
        .png()
        .toFile(archivo(nn, nombre))
      hechas.push(`${nn}-${nombre}`)
      if (tema === 'claro') medidas[nn] = await medir(page)
    } finally {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: dpr, mobile: true })
      await esperar(300)
    }
  }
  const ir = async (ruta = RUTA, selector = '.lista') => {
    await page.goto(base + ruta)
    await listo(page, selector)
  }
  const tocar = async (selector) => {
    await page.locator(selector).first().tap()
    await esperar(650)
  }
  const atras = async () => {
    await page.goBack().catch(() => {})
    await esperar(650)
  }
  const solo = (nn) => toca(nn) && (clave !== 'iphone15h' || EN_HORIZONTAL.includes(nn))

  try {
    // 01–03 · Entrar (se intercepta /api/sesion: "hay que entrar").
    if (solo('01') || solo('02') || solo('03')) {
      await page.route('**/api/sesion', (r) => r.fulfill({ json: { publico: true, entrado: false, eventos: 'sondeo' } }))
      if (solo('01')) {
        await ir(RUTA, '.entrar')
        await foto('01', 'entrar')
      }
      if (solo('02')) {
        await page.evaluate(() => localStorage.setItem('telar.entrar', JSON.stringify({ email: 'ana@ejemplo.com', enviado: Date.now() - 12_000, hasta: Date.now() + 9 * 60_000 })))
        await ir(RUTA, '.entrar__codigo')
        await foto('02', 'entrar-codigo')
        await page.evaluate(() => localStorage.removeItem('telar.entrar'))
      }
      if (solo('03')) {
        await ir(RUTA, '.entrar')
        await fotoConTeclado('03', 'entrar-teclado', async () => {
          await page.locator('#entrar-mail').tap()
          await page.keyboard.type('ana@ejemplo.com')
        })
      }
      await page.unroute('**/api/sesion')
    }

    // 04–08 · Kanban, paginado y arrastre con el dedo.
    await ir()
    if (solo('04')) {
      await foto('04', 'kanban')
      medidas.contraste = await contraste(page)
    }
    if (solo('05')) {
      const caja = await page.locator('.lista').first().boundingBox()
      await dedo.deslizar(caja.x + caja.width * 0.8, caja.y + 90, -caja.width * 0.7, 0)
      await esperar(900)
      await foto('05', 'kanban-segunda-lista')
      await ir()
    }
    if (solo('06') || solo('07') || solo('08')) {
      const tarjeta = page.locator('.lista').first().locator('.ordenable').nth(1)
      const titulo = await tarjeta.getAttribute('aria-label')
      const origen = await page.evaluate(() => document.querySelector('.lista')?.getAttribute('data-lista'))
      const caja = await tarjeta.boundingBox()
      const x = caja.x + caja.width / 2
      const y = caja.y + caja.height / 2
      await dedo.apretar(x, y)
      await dedo.llevar(x, y, x + 24, y + 40, 6)
      await quieto(page, '.sombra-arrastre__giro')
      if (solo('06')) await foto('06', 'kanban-arrastre')
      if (clave !== 'iphone15h') {
        const pastilla = await page.locator('.pastilla-lista').nth(2).boundingBox()
        await dedo.llevar(x + 24, y + 40, pastilla.x + pastilla.width / 2, pastilla.y + pastilla.height / 2, 14)
        await esperar(450)
        await quieto(page, '.sombra-arrastre__giro')
        if (solo('07')) await foto('07', 'kanban-arrastre-tira')
        await dedo.soltar()
        await esperar(1400)
        if (solo('08')) await foto('08', 'kanban-soltada')
        // Se devuelve la tarjeta a su lugar (las demás capturas esperan el tablero como estaba).
        const movida = await page.evaluate((t) => [...document.querySelectorAll('.ordenable')].find((e) => e.getAttribute('aria-label') === t) ? t.split(':')[0] : null, titulo)
        if (movida && origen) await api.post(`/api/tarjetas/${encodeURIComponent(movida)}/mover`, { listaId: origen, posicion: 1 })
      } else await dedo.soltar()
      await ir()
    }

    // 09 · Compositor rápido con el teclado.
    if (solo('09')) {
      await tocar('.barra-inferior__agregar')
      await fotoConTeclado('09', 'compositor', async () => {
        await page.keyboard.type('error: se traba el horno !alta #Cocina')
        await esperar(300)
      })
      await page.locator('.compositor-rapido__campo').fill('')
      await atras()
    }

    // 10–11 · Filtros.
    if (solo('10') || solo('11')) {
      await tocar('.barra-movil__accion')
      await page.locator('.hoja-filtros__opciones button', { hasText: 'Error' }).first().tap()
      await page.locator('.hoja-filtros__opciones button', { hasText: 'Alta' }).first().tap().catch(() => {})
      await esperar(400)
      if (solo('10')) await foto('10', 'filtros')
      await tocar('.hoja-filtros__ver')
      await esperar(500)
      if (solo('11')) await foto('11', 'kanban-filtrado')
      await ir()
    }

    // 12 · Proyectos y tableros.
    if (solo('12')) {
      await tocar('.barra-movil__titulo')
      await foto('12', 'selector-tablero')
      await atras()
    }

    // 13–14 · Buscar.
    if (solo('13') || solo('14')) {
      await tocar('.barra-inferior__lugar >> text=Buscar')
      if (solo('13')) await foto('13', 'buscar')
      await page.keyboard.type('horno')
      await page.waitForSelector('.buscar-movil .fila-tactil', { timeout: 8000 }).catch(() => {})
      await esperar(700)
      if (solo('14')) await foto('14', 'buscar-resultados')
      await page.keyboard.press('Escape').catch(() => {})
      await esperar(800)
      await ir()
    }

    // 15 · Menú (el ⋮ de la cabecera).
    if (solo('15')) {
      await tocar('.barra-movil__menu')
      await foto('15', 'mas')
      await atras()
    }

    // 16–20 · La tarjeta (la decisión de la semilla: porqué completo, checklist, adjunto y comentarios).
    if (['16', '17', '18', '19', '20'].some(solo)) {
      await ir(`${RUTA}?tarjeta=${DECISION}`, '.hoja-movil .hoja__titulo')
      await esperar(700)
      await page.addStyleTag({ content: '.hoja__origen, .porque__cuando, .comentario__cuando, .evento__cuando { visibility: hidden !important }' })
      if (solo('16')) await foto('16', 'tarjeta')
      if (solo('17')) {
        await page.locator('.hoja-movil .porque').first().scrollIntoViewIfNeeded()
        await esperar(500)
        await foto('17', 'tarjeta-porque')
      }
      if (solo('18')) {
        await page.locator('.hoja-movil .porque').first().scrollIntoViewIfNeeded()
        await fotoConTeclado('18', 'tarjeta-porque-editando', async () => {
          await page.locator('.hoja-movil .porque__valor').first().tap()
          await esperar(500)
          await page.locator('.hoja-movil .porque textarea').first().scrollIntoViewIfNeeded().catch(() => {})
        })
        await page.locator('.barra-edicion .boton--fantasma').tap().catch(() => {})
        await esperar(400)
      }
      if (solo('19')) {
        await page.locator('.hoja-movil .hoja__titulo').scrollIntoViewIfNeeded()
        await page.locator('.hoja-movil .propiedad', { hasText: 'Prioridad' }).locator('.valor-boton').first().tap()
        await esperar(700)
        await foto('19', 'tarjeta-selector')
        await atras()
      }
      if (solo('20')) {
        await fotoConTeclado('20', 'tarjeta-comentar', async () => {
          await page.locator('.comentar-movil__campo').tap()
          await page.keyboard.type('A 15 me parece bien')
        })
        await page.locator('.comentar-movil__campo').fill('')
      }
    }

    // 21 y 23 · Lienzo (el completo es el paquete H: 22, 24 y 25 quedan para entonces).
    if (solo('21') || solo('23')) {
      await ir(`${RUTA}/lienzo`, '.react-flow__node')
      await esperar(900)
      if (solo('21')) await foto('21', 'lienzo')
      if (solo('23')) {
        await tocar('.barra-inferior__agregar')
        await foto('23', 'lienzo-crear')
        await atras()
      }
    }

    // 27 · Versión nueva (en npm run dev no hay service worker: se pone el estado a mano).
    if (solo('27') && !produccion) {
      await ir()
      await page.evaluate(() => window.__telarPwa?.setState({ actualizacion: 'esperando', actualizacionEscondida: false }))
      await esperar(700)
      await foto('27', 'actualizar')
      await page.evaluate(() => window.__telarPwa?.setState({ actualizacion: null }))
    }

    // 28 · Instalar: la invitación (Android, con el evento del navegador) o los pasos de iOS.
    if (solo('28')) {
      await ir()
      if (clave === 'pixel8') {
        await page.evaluate(() => {
          localStorage.removeItem('telar.instalar.visto')
          localStorage.setItem('telar.visitas', '2')
          const e = new Event('beforeinstallprompt')
          Object.assign(e, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) })
          dispatchEvent(e)
        })
        await page.waitForSelector('.invitacion-instalar', { timeout: 9000 }).catch(() => {})
        await esperar(600)
        await foto('28', 'instalar')
        await page.evaluate(() => localStorage.setItem('telar.instalar.visto', String(Date.now())))
      } else {
        await tocar('.barra-movil__menu')
        await tocar('.hoja-mas >> text=Instalar Telar')
        await esperar(500)
        await foto('28', 'instalar')
        await atras()
      }
    }

    // 29 · Actividad.
    if (solo('29')) {
      await ir()
      await tocar('.barra-movil__menu')
      await tocar('.hoja-mas >> text=Actividad')
      await esperar(500)
      await foto('29', 'actividad')
      await atras()
    }

    // 30 · Nuevo proyecto, como hoja, con el teclado.
    if (solo('30')) {
      await ir()
      await tocar('.barra-movil__titulo')
      await tocar('.selector-tablero__nuevo-proyecto')
      await esperar(400)
      await fotoConTeclado('30', 'nuevo-proyecto', async () => {
        await page.locator('.dialogo input').first().tap()
        await page.keyboard.type('Mi Restaurante')
      })
    }

    // 26 · Sin conexión, al final (corta la red y deja una tarjeta pendiente que nunca se sube).
    if (solo('26')) {
      await ir(`${RUTA}?tarjeta=${DECISION}`, '.hoja-movil .hoja__titulo')
      await esperar(2200) // lo guardado para leer sin conexión
      await page.locator('.hoja-movil__cerrar').tap()
      await esperar(2200)
      await ctx.setOffline(true)
      await page.evaluate(() => dispatchEvent(new Event('offline')))
      // Volver a abrir la tarjeta sin red la lee de lo guardado: la franja dice desde cuándo.
      await page.evaluate((c) => {
        history.pushState(null, '', `${location.pathname}?tarjeta=${c}`)
        dispatchEvent(new PopStateEvent('popstate'))
      }, DECISION)
      await esperar(1200)
      await page.locator('.hoja-movil__cerrar').tap()
      await esperar(900)
      await tocar('.barra-inferior__agregar')
      await page.keyboard.type('Llamar al proveedor de pan')
      await page.keyboard.press('Enter')
      await esperar(900)
      await page.keyboard.press('Escape')
      await esperar(900)
      await page.evaluate(() => {
        const l = document.querySelector('.lista__tarjetas')
        if (l) l.scrollTop = l.scrollHeight
      })
      await esperar(400)
      await foto('26', 'sin-conexion')
    }
  } catch (e) {
    errores.push(`se cortó: ${e.message.split('\n')[0]}`)
  } finally {
    await ctx.close()
  }
  return { hechas, medidas, errores }
}

function resumir(medidas) {
  const unicos = (xs) => [...new Map(xs.map((x) => [JSON.stringify(x), x])).values()]
  const todas = Object.values(medidas)
  return {
    anchoPagina: Math.max(0, ...todas.map((m) => m.anchoPagina)),
    anchoVentana: todas[0]?.anchoVentana ?? null,
    controlesChicos: unicos(todas.flatMap((m) => m.chicos)),
    excepcionesDelPlan: unicos(todas.flatMap((m) => m.excepciones ?? [])),
    camposConLetraChica: unicos(todas.flatMap((m) => m.letraChica)),
    elementosAfuera: unicos(todas.flatMap((m) => m.afuera)),
    porPantalla: Object.fromEntries(Object.entries(medidas).map(([nn, m]) => [nn, { chicos: m.chicos.length, letraChica: m.letraChica.length, afuera: m.afuera.length }])),
  }
}

// ───────── Capturas del manifest (--pwa) ─────────

async function capturasManifest() {
  const destino = path.join(RAIZ, 'web', 'public', 'pwa')
  mkdirSync(destino, { recursive: true })
  const angosta = { ...devices['Pixel 8'], viewport: { width: 360, height: 780 }, screen: { width: 360, height: 780 }, deviceScaleFactor: 3 }
  const hechas = []
  for (const [nombre, ruta, selector] of [
    ['kanban', RUTA, '.lista .ordenable'],
    ['tarjeta', `${RUTA}?tarjeta=${DECISION}`, '.hoja-movil .hoja__titulo'],
    ['lienzo', `${RUTA}/lienzo`, '.react-flow__node'],
  ]) {
    const ctx = await contexto(angosta, 'claro')
    const page = await ctx.newPage()
    await page.goto(base + ruta)
    await listo(page, selector)
    await esperar(900)
    await page.screenshot({ path: path.join(destino, `captura-${nombre}.png`) })
    hechas.push(`web/public/pwa/captura-${nombre}.png`)
    await ctx.close()
  }
  const ctx = await contexto({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, 'claro')
  const page = await ctx.newPage()
  await page.goto(base + RUTA)
  await listo(page)
  await esperar(600)
  await page.screenshot({ path: path.join(destino, 'captura-escritorio.png') })
  hechas.push('web/public/pwa/captura-escritorio.png')
  await ctx.close()
  return hechas
}

// ───────── Rendimiento (--rendimiento, 10.1) ─────────

// --cpu=1 sirve para comparar: cuánto de lo medido es del teléfono emulado y cuánto de la máquina que corre la prueba.
const CPU = Number(args.cpu) || 4
const CUATRO_G_LENTA = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }

/** Tiempos por cuadro mientras corre fn (con requestAnimationFrame, en la página). */
async function cuadros(page, fn) {
  await page.evaluate(() => {
    window.__cuadros = []
    let antes = performance.now()
    const vuelta = (t) => {
      window.__cuadros.push(t - antes)
      antes = t
      if (window.__cuadros) window.__rafCuadros = requestAnimationFrame(vuelta)
    }
    window.__rafCuadros = requestAnimationFrame(vuelta)
  })
  await fn()
  const xs = await page.evaluate(() => {
    cancelAnimationFrame(window.__rafCuadros)
    const r = window.__cuadros.slice(1)
    window.__cuadros = null
    return r
  })
  const orden = [...xs].sort((a, b) => a - b)
  const p = (q) => (orden.length ? orden[Math.min(orden.length - 1, Math.floor(q * orden.length))] : 0)
  return { cuadros: xs.length, p50: +p(0.5).toFixed(1), p90: +p(0.9).toFixed(1), max: +(orden.at(-1) ?? 0).toFixed(1), masDe50: xs.filter((x) => x > 50).length }
}

/**
 * El servidor local no comprime y Vercel sí (gzip o brotli): para medir con red lenta como en el teléfono, las cargas
 * pasan por un intermediario que comprime con gzip lo que comprimiría Vercel.
 */
async function intermediarioGzip(destino) {
  const http = await import('node:http')
  const { createGzip } = await import('node:zlib')
  const servidor = http.createServer((pedido, respuesta) => {
    const url = new URL(pedido.url, destino)
    const salida = http.request(url, { method: pedido.method, headers: { ...pedido.headers, host: url.host } }, (r) => {
      const cabeceras = { ...r.headers }
      const comprimible = /javascript|css|html|json|svg|manifest/.test(String(cabeceras['content-type'] ?? ''))
      if (comprimible && /gzip/.test(String(pedido.headers['accept-encoding'] ?? '')) && !cabeceras['content-encoding']) {
        delete cabeceras['content-length']
        cabeceras['content-encoding'] = 'gzip'
        respuesta.writeHead(r.statusCode ?? 200, cabeceras)
        r.pipe(createGzip()).pipe(respuesta)
      } else {
        respuesta.writeHead(r.statusCode ?? 200, cabeceras)
        r.pipe(respuesta)
      }
    })
    salida.on('error', () => respuesta.destroy())
    pedido.pipe(salida)
  })
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok))
  return { url: `http://127.0.0.1:${servidor.address().port}`, cerrar: () => new Promise((ok) => servidor.close(ok)) }
}

async function rendimiento() {
  const r = {
    condiciones: `Pixel 8 emulado, CPU ×${CPU}, red "4G lenta" (150 ms, 1,6 Mb/s), con gzip como en Vercel`,
    base: produccion ? 'versión compilada' : 'npm run dev (los tamaños no valen: sin compilar; usar --modo=produccion)',
  }
  const gz = await intermediarioGzip(base)

  // 1 y 2 · Primera carga: JavaScript que se baja antes de ver el tablero, tiempo hasta verlo y bloqueo total.
  const ctx = await contexto(devices['Pixel 8'], 'claro')
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', CUATRO_G_LENTA)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  const js = []
  let tableroVisto = false
  page.on('response', async (res) => {
    if (tableroVisto || !/\.m?js(\?|$)/.test(res.url()) || res.request().resourceType() !== 'script') return
    try {
      const cuerpo = await res.body()
      js.push({ archivo: new URL(res.url()).pathname, comprimido: gzipSync(cuerpo, { level: 9 }).length })
    } catch {}
  })
  await page.addInitScript(() => {
    window.__largas = []
    new PerformanceObserver((l) => window.__largas.push(...l.getEntries().map((e) => ({ inicio: e.startTime, duracion: e.duration })))).observe({ type: 'longtask', buffered: true })
    // El momento en que se ve el tablero y qué JavaScript se había pedido hasta ahí (lo que se baja después, en un
    // momento libre, no es "inicial").
    new MutationObserver((_, obs) => {
      if (!document.querySelector('.lista .ordenable')) return
      obs.disconnect()
      window.__visto = performance.now()
      window.__jsAntes = performance.getEntriesByType('resource').filter((e) => /\.m?js(\?|$)/.test(e.name)).map((e) => new URL(e.name).pathname)
    }).observe(document, { childList: true, subtree: true })
  })
  const inicio = Date.now()
  await page.goto(gz.url + RUTA, { waitUntil: 'commit' })
  await page.waitForSelector('.lista .ordenable', { timeout: 60000 })
  tableroVisto = true
  const primera = Date.now() - inicio
  await esperar(3000)
  const { largas, visto, jsAntes } = await page.evaluate(() => ({ largas: window.__largas, visto: window.__visto, jsAntes: window.__jsAntes ?? [] }))
  const inicial = js.filter((x) => jsAntes.includes(x.archivo))
  r.javascriptInicialKB = +(inicial.reduce((a, x) => a + x.comprimido, 0) / 1024).toFixed(1)
  r.javascriptInicialArchivos = inicial.map((x) => `${x.archivo} ${(x.comprimido / 1024).toFixed(1)} KB`)
  r.javascriptDespuesKB = +(js.filter((x) => !jsAntes.includes(x.archivo)).reduce((a, x) => a + x.comprimido, 0) / 1024).toFixed(1)
  r.primeraCargaMs = visto ? Math.round(visto) : primera
  r.bloqueoTotalMs = Math.round(largas.reduce((a, l) => a + Math.max(0, l.duracion - 50), 0))

  // 3 · Segunda carga con el service worker (solo en la versión compilada).
  if (produccion) {
    await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 30000 }).catch(() => {})
    await esperar(1500)
    const t0 = Date.now()
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector('.lista .ordenable', { timeout: 60000 })
    const visto2 = await page.evaluate(() => window.__visto)
    r.segundaCargaMs = visto2 ? Math.round(visto2) : Date.now() - t0
    r.segundaCargaControlada = await page.evaluate(() => !!navigator.serviceWorker.controller)
  }
  await ctx.close()
  await gz.cerrar()

  // 4 · Arrastre con 150 tarjetas en el tablero.
  const t = await api.get(`/api/tableros/${semilla.tableroId}`)
  const activas = t.tarjetas.filter((x) => !x.archivada).length
  const primeraLista = [...t.listas].sort((a, b) => (a.orden < b.orden ? -1 : 1))[0]
  for (let i = activas; i < 150; i++) await api.post('/api/tarjetas', { tableroId: t.tablero.id, listaId: primeraLista.id, titulo: `Tarjeta de carga ${i + 1}` })
  const ctx2 = await contexto(devices['Pixel 8'], 'claro')
  const page2 = await ctx2.newPage()
  await page2.goto(base + RUTA)
  await listo(page2)
  // Se mide con la app ya asentada: las piezas que se bajan en un momento libre (la tarjeta, las hojas) ya están.
  await page2.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/assets/Diferidas')), null, { timeout: 15000 }).catch(() => {})
  await esperar(1200)
  const cdp2 = await ctx2.newCDPSession(page2)
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  const dedo = crearDedo(cdp2)
  const caja = await page2.locator('.lista').first().locator('.ordenable').nth(1).boundingBox()
  const x = caja.x + caja.width / 2
  const y = caja.y + caja.height / 2
  r.tarjetasEnElTablero = (await api.get(`/api/tableros/${semilla.tableroId}`)).tarjetas.filter((x) => !x.archivada).length
  r.arrastre = await cuadros(page2, async () => {
    await dedo.apretar(x, y)
    await dedo.llevar(x, y, x + 10, y + 260, 40, 30)
    await dedo.llevar(x + 10, y + 260, x - 10, y + 60, 40, 30)
  })
  await page2.keyboard.press('Escape').catch(() => {})
  await dedo.soltar()
  await esperar(800)

  // 5 · Abrir y cerrar una hoja.
  r.abrirHoja = await cuadros(page2, async () => {
    await page2.locator('.barra-movil__menu').tap()
    await esperar(900)
  })
  r.cerrarHoja = await cuadros(page2, async () => {
    await page2.goBack()
    await esperar(900)
  })
  await ctx2.close()
  // Se sacan las tarjetas de carga: el tablero de prueba vuelve a como estaba.
  const despues = await api.get(`/api/tableros/${semilla.tableroId}`)
  for (const x of despues.tarjetas.filter((x) => x.titulo.startsWith('Tarjeta de carga ') && !x.archivada)) await api.post(`/api/tarjetas/${x.clave}/archivar`, { archivar: true })
  r.metas = {
    javascriptInicial: `${r.javascriptInicialKB} KB (meta ≤ 230)`,
    primeraCarga: `${r.primeraCargaMs} ms (meta < 2500)`,
    bloqueoTotal: `${r.bloqueoTotalMs} ms (meta < 300)`,
    segundaCarga: r.segundaCargaMs ? `${r.segundaCargaMs} ms (meta < 1000)` : 'sin service worker (correr con --modo=produccion)',
    arrastre: `p90 ${r.arrastre.p90} ms, máx ${r.arrastre.max} ms (meta p90 ≤ 16,7 y ninguno > 50)`,
    hojas: `máx ${Math.max(r.abrirHoja.max, r.cerrarHoja.max)} ms (meta ≤ 32)`,
  }
  return r
}

// ───────── Correr ─────────

try {
  if (args.escritorio) {
    informe.escritorio = await escritorio(args.escritorio === 'antes' ? 'antes' : 'despues')
    console.log(JSON.stringify(informe.escritorio, null, 2))
  } else if (args.pwa) {
    const hechas = await capturasManifest()
    console.log(hechas.join('\n'))
    console.log('Ahora: npm run pwa:iconos (suma las capturas al manifest).')
  } else if (args.rendimiento) {
    informe.rendimiento = await rendimiento()
    console.log(JSON.stringify(informe.rendimiento, null, 2))
  } else {
    const temas = lista(args.temas, ['claro', 'oscuro'])
    for (const clave of lista(args.dispositivos, ['iphone15', 'pixel8', 'iphone15h'])) {
      for (const tema of clave === 'iphone15h' ? temas.filter((t) => t === 'claro') : temas) {
        const r = await celular(clave, tema)
        console.log(`${clave} ${tema}: ${r.hechas.length} capturas${r.errores.length ? ' · ' + r.errores.join(' · ') : ''}`)
        // Una corrida parcial (--solo) actualiza sus pantallas y deja las demás como estaban.
        const previo = informe.dispositivos[clave] ?? {}
        const { contraste, ...pantallasNuevas } = r.medidas
        const capturas = [...new Set([...(previo.capturas ?? []), ...r.hechas.map((h) => `${tema}-${h}`)])].sort()
        if (tema === 'claro') {
          const pantallas = { ...(previo.pantallas ?? {}), ...pantallasNuevas }
          informe.dispositivos[clave] = { ...previo, capturas, ...resumir(pantallas), pantallas, errores: r.errores }
        } else informe.dispositivos[clave] = { ...previo, capturas, erroresOscuro: r.errores }
        if (contraste) informe.dispositivos[clave].contraste = { ...(previo.contraste ?? {}), [tema]: contraste }
      }
    }
    informe.pendientes = { '22, 24 y 25': 'lienzo completo (paquete H): depende del lienzo de escritorio' }
  }
  writeFileSync(path.join(SALIDA, 'informe.json'), JSON.stringify(informe, null, 2) + '\n')
} finally {
  await navegador.close()
  if (app) await app.parar()
}
