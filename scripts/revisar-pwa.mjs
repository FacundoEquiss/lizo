// Revisión de la PWA (plan del celular, 9.10 y 16.3): instalable, service worker, sin conexión, actualización, bandeja y
// "Salir". Con Playwright y CDP, sobre la versión compilada:
//
//   npm run build && node scripts/revisar-pwa.mjs
//
// Levanta la app compilada con una base de prueba propia (puerto 4420) y, para "Salir", otra en modo público (4421) con
// una cookie de prueba firmada acá (nunca la cuenta del dueño ni la base de producción). Para la actualización compila una
// segunda versión (TELAR_SW_MARCA) y al final vuelve a compilar la normal. Escribe docs/capturas/movil/pwa.json y deja
// las capturas en docs/capturas/pwa/.
import { execSync, spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clienteApi, importarPlaywright, levantar, RAIZ, sembrar } from './prueba-local.mjs'

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const CAPTURAS = path.join(RAIZ, 'docs', 'capturas', 'pwa')
mkdirSync(CAPTURAS, { recursive: true })
const { chromium, devices } = await importarPlaywright()

const resultado = { fecha: new Date().toISOString(), items: {} }
const anotar = (n, nombre, ok, detalle = {}) => {
  resultado.items[n] = { nombre, ok, ...detalle }
  console.log(`${ok ? '✓' : '✗'} ${n}. ${nombre}${detalle.nota ? ` — ${detalle.nota}` : ''}`)
}
const compilar = (marca) =>
  execSync('npx vite build', { cwd: RAIZ, env: { ...process.env, ...(marca ? { TELAR_SW_MARCA: marca } : {}) }, stdio: 'ignore' })
const tamPng = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : null)
const contenidoIdb = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const r = indexedDB.open('telar', 1)
        r.onsuccess = () => {
          const tx = r.result.transaction(['instantanea', 'pendientes'])
          const a = tx.objectStore('instantanea').getAllKeys()
          const b = tx.objectStore('pendientes').getAllKeys()
          tx.oncomplete = () => ok({ instantanea: a.result.length, pendientes: b.result.length })
        }
        r.onerror = () => ok(null)
      }),
  )

const app = await levantar({ modo: 'produccion', datos: '/tmp/telar-movil-pwa', puerto: 4420 })
const base = app.url
const semilla = await sembrar(base)
const RUTA = `/${semilla.prefijo}/${semilla.slug}`
const api = clienteApi(base)
const dir = mkdtempSync(path.join(os.tmpdir(), 'telar-pwa-'))
const ctx = await chromium.launchPersistentContext(dir, { ...devices['Pixel 8'], locale: 'es-AR' })
await ctx.addInitScript(() => localStorage.setItem('telar.instalar.visto', String(Date.now())))
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errores = []
page.on('pageerror', (e) => errores.push(e.message))
// Todo lo que pasa por la red: nada de /api, /mcp ni /archivos puede venir del service worker.
const privadosDelSw = []
let pedidosPrivados = 0
page.on('response', (r) => {
  const u = new URL(r.url())
  if (/^\/(api|mcp|archivos)(\/|$)/.test(u.pathname)) {
    pedidosPrivados++
    if (r.fromServiceWorker()) privadosDelSw.push(u.pathname)
  }
})
// Recargas de verdad (documentos nuevos): los cambios de dirección con history.pushState o replaceState no cuentan.
let navegaciones = 0
page.on('load', () => navegaciones++)
const cdp = await ctx.newCDPSession(page)

try {
  // ── 1. Manifest ──
  {
    const r = await fetch(base + '/manifest.webmanifest')
    const tipo = r.headers.get('content-type') ?? ''
    let m = null
    try {
      m = await r.json()
    } catch {}
    const problemas = []
    if (!m) problemas.push('no es JSON')
    else {
      for (const k of ['name', 'short_name', 'start_url']) if (!m[k]) problemas.push(`falta ${k}`)
      if (m.display !== 'standalone') problemas.push('display no es standalone')
      const iconos = m.icons ?? []
      if (!iconos.some((i) => i.sizes === '192x192' && (i.purpose ?? 'any').includes('any'))) problemas.push('falta el ícono de 192')
      if (!iconos.some((i) => i.sizes === '512x512' && (i.purpose ?? 'any').includes('any'))) problemas.push('falta el ícono de 512')
      if (!iconos.some((i) => (i.purpose ?? '').includes('maskable'))) problemas.push('falta un ícono maskable')
      const capturas = m.screenshots ?? []
      if (!capturas.some((c) => c.form_factor === 'narrow')) problemas.push('falta una captura narrow')
      if (!capturas.some((c) => c.form_factor === 'wide')) problemas.push('falta una captura wide')
      const archivos = [...iconos, ...capturas, ...(m.shortcuts ?? []).flatMap((s) => s.icons ?? [])]
      for (const a of archivos) {
        const ra = await fetch(base + a.src)
        if (!ra.ok) {
          problemas.push(`${a.src}: ${ra.status}`)
          continue
        }
        const medida = tamPng(Buffer.from(await ra.arrayBuffer()))
        if (a.sizes && medida !== a.sizes) problemas.push(`${a.src} mide ${medida}, dice ${a.sizes}`)
      }
      if (!/application\/manifest\+json/.test(tipo)) problemas.push(`tipo ${tipo}`)
    }
    anotar(1, 'Manifest completo y sus archivos miden lo que dicen', problemas.length === 0, { problemas, tipo })
  }

  // ── 2 y 3. Instalable; el service worker controla la segunda carga ──
  await page.goto(base + RUTA)
  await page.waitForSelector('.lista .ordenable', { timeout: 30000 })
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 30000 })
  await esperar(1000)
  await page.reload()
  await page.waitForSelector('.lista .ordenable')
  const instalable = await cdp.send('Page.getInstallabilityErrors')
  anotar(2, 'Page.getInstallabilityErrors vacío', instalable.installabilityErrors.length === 0, { errores: instalable.installabilityErrors })
  const sw = await page.evaluate(async () => ({
    controla: !!navigator.serviceWorker.controller,
    estado: (await navigator.serviceWorker.getRegistration())?.active?.state ?? null,
    caches: await caches.keys(),
  }))
  anotar(3, 'El service worker está activo y controla la segunda carga', sw.controla && sw.estado === 'activated', sw)

  // ── 4. Sin red: se ve el último tablero y una tarjeta abierta antes; sin recargas en ciclo ──
  {
    const decision = semilla.decision ?? 'RC-4'
    await page.goto(`${base}${RUTA}?tarjeta=${decision}`)
    await page.waitForSelector('.hoja-movil .hoja__titulo')
    await esperar(2500)
    await page.goto(base + RUTA)
    await page.waitForSelector('.lista .ordenable')
    await esperar(2500)
    await ctx.setOffline(true)
    await page.reload()
    const antes = navegaciones
    await page.waitForSelector('.lista .ordenable', { timeout: 15000 }).catch(() => {})
    await esperar(10_000)
    const franja = (await page.locator('.franja-conexion').textContent().catch(() => '')) ?? ''
    const tarjetas = await page.locator('.lista .ordenable').count()
    await page.screenshot({ path: path.join(CAPTURAS, 'pixel8-sin-conexion.png') })
    await page.evaluate((c) => {
      history.pushState(null, '', `${location.pathname}?tarjeta=${c}`)
      dispatchEvent(new PopStateEvent('popstate'))
    }, decision)
    await page.waitForSelector('.hoja-movil .hoja__titulo', { timeout: 8000 }).catch(() => {})
    await esperar(800)
    const detalle = await page.evaluate(() => ({
      abierta: !!document.querySelector('.hoja-movil .hoja__titulo'),
      minima: !!document.querySelector('.hoja-movil__contenido--minima'),
      comentarios: document.querySelectorAll('.hoja-movil .comentario').length,
    }))
    await page.screenshot({ path: path.join(CAPTURAS, 'pixel8-tarjeta-sin-conexion.png') })
    const recargas = navegaciones - antes
    anotar(
      4,
      'Sin red: el último tablero, la franja y una tarjeta abierta antes; sin recargas en ciclo',
      franja.includes('Sin conexión') && tarjetas > 0 && detalle.abierta && !detalle.minima && recargas === 0,
      { franja, tarjetas, detalle, recargasEn10s: recargas },
    )
    await page.locator('.hoja-movil__cerrar').tap().catch(() => {})
    await esperar(600)
    await ctx.setOffline(false)
    await page.evaluate(() => dispatchEvent(new Event('online')))
    await esperar(1500)
  }

  // ── 7. Una tarjeta nueva sin red queda pendiente y, con red, se sube una sola vez ──
  {
    const titulo = `Revisión de la PWA ${Date.now().toString(36)}`
    await page.goto(base + RUTA)
    await page.waitForSelector('.lista .ordenable')
    await esperar(1500)
    await ctx.setOffline(true)
    await page.evaluate(() => dispatchEvent(new Event('offline')))
    await page.locator('.barra-inferior__agregar').tap()
    await page.waitForSelector('.compositor-rapido textarea')
    await page.keyboard.type(titulo)
    await page.keyboard.press('Enter')
    await esperar(900)
    await page.keyboard.press('Escape')
    await esperar(900)
    const pendiente = await page.evaluate((t) => [...document.querySelectorAll('.lista .ordenable')].map((x) => x.getAttribute('aria-label')).find((l) => l.endsWith(t)) ?? null, titulo)
    await page.evaluate(() => {
      const l = document.querySelector('.lista__tarjetas')
      if (l) l.scrollTop = l.scrollHeight
    })
    await esperar(300)
    await page.screenshot({ path: path.join(CAPTURAS, 'pixel8-pendiente.png') })
    await ctx.setOffline(false)
    await page.evaluate(() => dispatchEvent(new Event('online')))
    await page
      .waitForFunction((t) => [...document.querySelectorAll('.lista .ordenable')].some((x) => /^[A-Z]+-\d+: /.test(x.getAttribute('aria-label')) && x.getAttribute('aria-label').endsWith(t)), titulo, { timeout: 20000 })
      .catch(() => {})
    await esperar(1200)
    await page.screenshot({ path: path.join(CAPTURAS, 'pixel8-subida.png') })
    const enServidor = (await api.get(`/api/buscar?q=${encodeURIComponent(titulo)}`)).filter((r) => r.tarjeta.titulo === titulo).length
    anotar(7, 'Sin red queda pendiente; al volver la red se sube una sola vez', !!pendiente?.startsWith('Se sube cuando haya conexión') && enServidor === 1, { pendiente, enServidor })
  }

  // ── 5. Nada privado sale del service worker ni queda en sus cachés ──
  {
    const enCaches = await page.evaluate(async () => {
      const malas = []
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (/\/(api|mcp|archivos)(\/|$)/.test(new URL(r.url).pathname)) malas.push(r.url)
      return malas
    })
    anotar(5, 'Ningún pedido a /api, /mcp ni /archivos respondido por el service worker ni guardado en sus cachés', privadosDelSw.length === 0 && enCaches.length === 0, {
      pedidosPrivadosVistos: pedidosPrivados,
      delServiceWorker: privadosDelSw,
      enCaches,
    })
  }

  // ── 6. Versión nueva: la pastilla, una sola recarga y la caché vieja borrada ──
  try {
    const vieja = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('telar-base-')))
    await page.goto(base + RUTA)
    await page.waitForSelector('.lista .ordenable')
    await esperar(4500) // la app ya se está usando: no se actualiza sola
    await page.locator('.barra-movil__nombre').tap()
    await esperar(500)
    await page.goBack()
    await esperar(600)
    compilar(`revision-${Date.now()}`)
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update())
    await page.waitForSelector('.aviso-actualizar', { timeout: 30000 })
    await esperar(600)
    await page.screenshot({ path: path.join(CAPTURAS, 'pixel8-actualizar.png') })
    const antes = navegaciones
    await page.locator('.aviso-actualizar__boton').tap()
    await page.waitForSelector('.lista .ordenable', { timeout: 30000 })
    await esperar(5000)
    const despues = await page.evaluate(async () => ({ caches: (await caches.keys()).filter((k) => k.startsWith('telar-base-')), controla: !!navigator.serviceWorker.controller, pastilla: !!document.querySelector('.aviso-actualizar') }))
    await page.screenshot({ path: path.join(CAPTURAS, 'pixel8-actualizada.png') })
    const recargas = navegaciones - antes
    anotar(
      6,
      'Versión nueva: aparece la pastilla, "Actualizar" recarga una vez y la caché vieja ya no está',
      recargas === 1 && despues.controla && !despues.pastilla && despues.caches.length === 1 && !vieja.includes(despues.caches[0]),
      { cacheVieja: vieja, ...despues, recargas },
    )
  } finally {
    compilar()
  }

  // ── Primera vez sin conexión (sin nada guardado): la pantalla que reintenta sola ──
  {
    await page.evaluate(
      () =>
        new Promise((ok) => {
          const r = indexedDB.open('telar', 1)
          r.onsuccess = () => {
            const tx = r.result.transaction(['instantanea', 'pendientes'], 'readwrite')
            tx.objectStore('instantanea').clear()
            tx.objectStore('pendientes').clear()
            tx.oncomplete = ok
          }
        }),
    )
    await ctx.setOffline(true)
    const antes = navegaciones
    await page.reload()
    await page.waitForSelector('.sin-conexion', { timeout: 15000 }).catch(() => {})
    await esperar(10_000)
    const pantalla = await page.locator('.sin-conexion__titulo').textContent().catch(() => null)
    await page.screenshot({ path: path.join(CAPTURAS, 'pixel8-primera-vez-sin-conexion.png') })
    const recargas = navegaciones - antes - 1
    await ctx.setOffline(false)
    await page.evaluate(() => dispatchEvent(new Event('online')))
    const volvio = await page.waitForSelector('.lista .ordenable', { timeout: 20000 }).then(() => true).catch(() => false)
    anotar('4b', 'Primera vez sin red: "Telar necesita conexión la primera vez", sin recargas, y se abre sola al volver', pantalla === 'Telar necesita conexión la primera vez' && recargas === 0 && volvio, {
      pantalla,
      recargasEn10s: recargas,
      seAbrioSola: volvio,
    })
  }
} finally {
  await ctx.close()
  rmSync(dir, { recursive: true, force: true })
  await app.parar()
}

// ── 8. Salir borra lo guardado, la bandeja y el borrador (servidor en modo público, con una cookie de prueba) ──
{
  const PUERTO = 4421
  const BASE = `http://127.0.0.1:${PUERTO}`
  const DATOS = '/tmp/telar-movil-pwa-publico'
  const SECRETO = randomBytes(24).toString('hex')
  const USUARIO = 'usuario-de-prueba'
  const servidor = async (publico) => {
    const env = { ...process.env, TABLERO_DATOS: DATOS, TABLERO_PUERTO: String(PUERTO), TABLERO_SEMILLA_DISCORD: 'no', TABLERO_USUARIO: 'Ana' }
    delete env.TABLERO_DB_URL
    delete env.TABLERO_PUBLICO
    if (publico) Object.assign(env, { TABLERO_PUBLICO: '1', TABLERO_SECRETO: SECRETO, TABLERO_USUARIOS: USUARIO })
    const hijo = spawn('npm', ['start'], { cwd: RAIZ, env, detached: true, stdio: 'ignore' })
    for (let i = 0; i < 150; i++) {
      try {
        if ((await (await fetch(BASE + '/api/salud')).json()).listo) break
      } catch {}
      await esperar(300)
    }
    return async () => {
      try {
        process.kill(-hijo.pid, 'SIGTERM')
      } catch {}
      await esperar(1500)
    }
  }
  rmSync(DATOS, { recursive: true, force: true })
  mkdirSync(DATOS, { recursive: true })
  let parar = await servidor(false)
  await sembrar(BASE)
  await parar()
  parar = await servidor(true)
  const dir2 = mkdtempSync(path.join(os.tmpdir(), 'telar-pwa-salir-'))
  const ctx2 = await chromium.launchPersistentContext(dir2, { ...devices['iPhone 15'], locale: 'es-AR' })
  try {
    await ctx2.addInitScript(() => localStorage.setItem('telar.instalar.visto', String(Date.now())))
    const vence = Math.floor(Date.now() / 1000) + 3600
    const baseCookie = `v1.${USUARIO}.${vence}`
    await ctx2.addCookies([{ name: 'tablero_sesion', value: `${baseCookie}.${createHmac('sha256', SECRETO).update(baseCookie).digest('base64url')}`, url: BASE }])
    const p = ctx2.pages()[0] ?? (await ctx2.newPage())
    await p.goto(BASE + RUTA)
    await p.waitForSelector('.lista .ordenable', { timeout: 30000 })
    await esperar(2500)
    // Una tarjeta que no se puede subir (el envío se corta) y un borrador en el compositor.
    await p.route('**/api/tarjetas', (r) => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()))
    await p.locator('.barra-inferior__agregar').tap()
    await p.waitForSelector('.compositor-rapido textarea')
    await p.keyboard.type('Queda en la bandeja')
    await p.keyboard.press('Enter')
    await esperar(1200)
    await p.keyboard.type('Borrador sin mandar')
    await esperar(400)
    await p.keyboard.press('Escape')
    await esperar(900)
    const antes = { ...(await contenidoIdb(p)), borrador: await p.evaluate(() => sessionStorage.getItem('telar.borrador-rapido')) }
    await p.locator('.barra-movil__menu').tap()
    await esperar(700)
    await p.locator('.hoja-mas >> text=Salir').tap()
    await esperar(400)
    await p.screenshot({ path: path.join(CAPTURAS, 'iphone15-salir.png') })
    await p.locator('.hoja-mas__confirmar .boton--primario').tap()
    await p.waitForSelector('.entrar', { timeout: 20000 })
    await esperar(1200)
    const despues = { ...(await contenidoIdb(p)), borrador: await p.evaluate(() => sessionStorage.getItem('telar.borrador-rapido')) }
    anotar(
      8,
      'Salir borra la instantánea, la bandeja y el borrador',
      antes.instantanea > 0 && antes.pendientes > 0 && !!antes.borrador && despues.instantanea === 0 && despues.pendientes === 0 && !despues.borrador,
      { antes, despues },
    )
  } finally {
    await ctx2.close()
    rmSync(dir2, { recursive: true, force: true })
    await parar()
  }
}

// ── 9. Íconos, pantallas de arranque y manifest al día con la marca y los colores ──
try {
  execSync('npm run pwa:verificar', { cwd: RAIZ, stdio: 'pipe' })
  anotar(9, 'npm run pwa:verificar pasa', true)
} catch (e) {
  anotar(9, 'npm run pwa:verificar pasa', false, { nota: String(e.stdout ?? e.message).slice(0, 400) })
}

resultado.erroresDeLaPagina = errores
resultado.todoBien = Object.values(resultado.items).every((i) => i.ok)
writeFileSync(path.join(RAIZ, 'docs', 'capturas', 'movil', 'pwa.json'), JSON.stringify(resultado, null, 2) + '\n')
console.log(resultado.todoBien ? 'Revisión de la PWA: todo bien.' : 'Revisión de la PWA: hay puntos que no pasan (ver docs/capturas/movil/pwa.json).')
process.exit(resultado.todoBien ? 0 : 1)
