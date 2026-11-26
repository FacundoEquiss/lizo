// Mide el rendimiento del lienzo (plan v0.2, sección 9.4) con Playwright, contra un Telar LOCAL.
//
//   node scripts/sembrar-lienzo.mjs --url http://127.0.0.1:4338 --parecido-rc
//   NODE_PATH=$(npm root -g) node scripts/medir-lienzo.cjs --web http://127.0.0.1:4338 --tablero parecido-rc
//
// Mide en los TRES niveles de detalle del lienzo, cada uno con la vista puesta de antemano (la vista guardada del
// tablero), así las corridas son comparables:
//   - vistaGeneral: todo el tablero en pantalla (nivel «muy-lejos», zoom < 0,12 en un tablero grande);
//   - lejos: zoom 0,2 en el centro del tablero (nivel «lejos», 0,12–0,3: se lee el texto; es donde más se navega);
//   - deCerca: zoom 0,6 en el mismo centro (nivel normal).
// En cada uno: paneo de 1,5 s (botón del medio), zoom de 1,5 s (Ctrl + rueda, sin salir del nivel) y arrastre de un
// objeto de 1,5 s. Informa cuadros por segundo (promedio), el peor cuadro y el p95 (ms), y los ms de trabajo del hilo
// principal por cuadro (menos ruidoso que los cps: sirve para comparar dos versiones). Con --corridas N repite N veces y
// da cada número (para ver el ruido). Los números dependen de la máquina: sirven para comparar antes y después en la
// misma computadora. Con --solo lejos (o vistaGeneral, deCerca) mide un solo nivel; con --solo-accion paneo (o zoom,
// arrastre), una sola acción. Para probar una idea antes de programarla: --css "<reglas>" las inyecta en la página. Con
// --cpu 4 la CPU va 4 veces más lenta (una compu o un teléfono modestos: lo que cuesta en JavaScript se nota más).
// --json da todo en JSON.
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const WEB = opcion('web', 'http://127.0.0.1:4337')
const TABLERO = opcion('tablero', 'parecido-rc')
const PROYECTO = opcion('proyecto', 'RC')
const CORRIDAS = Number(opcion('corridas', 1))
const SOLO = opcion('solo', '')
const SOLO_ACCION = opcion('solo-accion', '')
const CSS = opcion('css', '')
const CPU = Number(opcion('cpu', 1))
if (!['127.0.0.1', 'localhost'].includes(new URL(WEB).hostname)) {
  console.error('Solo contra un Telar local.')
  process.exit(1)
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

/** Milisegundos de trabajo del hilo principal (JavaScript, estilos, layout, pintado…) desde que se abrió la página. */
async function hiloPrincipal(page) {
  if (!page.__cdp) {
    page.__cdp = await page.context().newCDPSession(page)
    await page.__cdp.send('Performance.enable')
  }
  const { metrics } = await page.__cdp.send('Performance.getMetrics')
  return metrics.find((m) => m.name === 'TaskDuration').value * 1000
}

async function contarCuadros(page, accion) {
  const hilo0 = await hiloPrincipal(page)
  await page.evaluate(() => {
    const w = window
    w.__cuadros = []
    w.__midiendo = true
    const paso = (t) => {
      w.__cuadros.push(t)
      if (w.__midiendo) requestAnimationFrame(paso)
    }
    requestAnimationFrame(paso)
  })
  await accion()
  const cuadros = await page.evaluate(() => {
    window.__midiendo = false
    return window.__cuadros
  })
  const hilo = (await hiloPrincipal(page)) - hilo0
  const deltas = cuadros.slice(1).map((t, i) => t - cuadros[i])
  const total = cuadros[cuadros.length - 1] - cuadros[0]
  const orden = [...deltas].sort((a, b) => a - b)
  return {
    fps: Math.round(((cuadros.length - 1) / total) * 1000 * 10) / 10,
    peor: Math.round(Math.max(0, ...deltas)),
    p95: Math.round(orden[Math.floor(orden.length * 0.95)] ?? 0),
    // Trabajo del hilo principal por cuadro dibujado, en ms: menos ruidoso que los cps para comparar dos versiones (con
    // el hilo saturado, los cps dependen de cuánto tarda cada cuadro).
    hilo: Math.round((hilo / Math.max(1, cuadros.length - 1)) * 10) / 10,
  }
}

async function centro(page) {
  const caja = await page.locator('.react-flow').boundingBox()
  return { cx: caja.x + caja.width / 2, cy: caja.y + caja.height / 2 }
}

async function paneo(page) {
  const { cx, cy } = await centro(page)
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  const pasos = 60
  for (let i = 0; i < pasos; i++) {
    const a = (i / pasos) * Math.PI * 2
    await page.mouse.move(cx + Math.cos(a) * 220, cy + Math.sin(a) * 140)
    await espera(1500 / pasos)
  }
  await page.mouse.up({ button: 'middle' })
}

async function zoom(page) {
  const { cx, cy } = await centro(page)
  await page.mouse.move(cx, cy)
  // Ida y vuelta (sale donde empezó): ±15 % en total, sin cruzar de nivel.
  await page.keyboard.down('Control')
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, i < 15 ? -8 : 8)
    await espera(50)
  }
  await page.keyboard.up('Control')
}

async function arrastre(page) {
  // El objeto (que no sea marco) más cerca del centro de la pantalla.
  const { cx, cy } = await centro(page)
  const b = await page.evaluate(
    ([x, y]) => {
      let mejor = null
      for (const el of document.querySelectorAll('.react-flow__node:not(.rf-marco)')) {
        const r = el.getBoundingClientRect()
        if (r.width < 6 || r.height < 6) continue
        const d = Math.hypot(r.x + r.width / 2 - x, r.y + r.height / 2 - y)
        if (!mejor || d < mejor.d) mejor = { d, x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }
      return mejor
    },
    [cx, cy],
  )
  if (!b) return null
  const r = await contarCuadros(page, async () => {
    await page.mouse.move(b.x, b.y)
    await page.mouse.down()
    for (let i = 0; i < 45; i++) {
      await page.mouse.move(b.x + Math.sin(i / 7) * 160, b.y + i * 3)
      await espera(1500 / 45)
    }
    await page.mouse.up()
  })
  await espera(300)
  await page.keyboard.press('Control+KeyZ')
  return r
}

async function vistaDe(nivel, elementos) {
  const W = 1440 - 248
  const H = 900 - 56
  const xs = elementos.map((e) => [e.x, e.x + e.ancho]).flat()
  const ys = elementos.map((e) => [e.y, e.y + e.alto]).flat()
  const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  if (nivel === 'vistaGeneral') {
    const z = Math.min(W / r.w, H / r.h) * 0.9
    return { zoom: z, x: (W - r.w * z) / 2 - r.x * z, y: (H - r.h * z) / 2 - r.y * z }
  }
  // El centro de un marco del medio (en un tablero sin marcos, el centro de todo).
  const marcos = elementos.filter((e) => e.tipo === 'marco').sort((a, b) => a.x - b.x || a.y - b.y)
  const m = marcos[Math.floor(marcos.length / 2)]
  const c = m ? { x: m.x + m.ancho / 2, y: m.y + m.alto / 2 } : { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  const z = nivel === 'lejos' ? 0.2 : 0.6
  return { zoom: z, x: W / 2 - c.x * z, y: H / 2 - c.y * z }
}

async function medirNivel(browser, nivel, tablero) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', (e) => errores.push(e.message))
  const vista = await vistaDe(nivel, tablero.elementos)
  await ctx.addInitScript(([clave, v]) => localStorage.setItem(clave, v), [`tablero.vista.${tablero.tablero.id}`, JSON.stringify(vista)])
  const t0 = Date.now()
  await page.goto(`${WEB}/${PROYECTO}/${TABLERO}/lienzo`)
  await page.waitForSelector('.react-flow__node', { timeout: 30000 })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const abrirMs = Date.now() - t0
  if (CSS) await page.addStyleTag({ content: CSS })
  if (CPU > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: CPU })
  await hiloPrincipal(page)
  await espera(1500)
  const info = await page.evaluate(() => ({
    nivel: document.querySelector('.lienzo')?.dataset.zoom ?? 'normal',
    nodos: document.querySelectorAll('.react-flow__node').length,
    aristas: document.querySelectorAll('.react-flow__edge').length,
    dom: document.getElementsByTagName('*').length,
  }))
  const r = { ...info, abrirMs }
  const hacer = (a) => !SOLO_ACCION || SOLO_ACCION === a
  if (hacer('paneo')) r.paneo = await contarCuadros(page, () => paneo(page))
  await espera(500)
  if (hacer('zoom')) r.zoom = await contarCuadros(page, () => zoom(page))
  await espera(500)
  if (hacer('arrastre')) r.arrastre = await arrastre(page)
  if (errores.length) r.errores = errores
  await ctx.close()
  return r
}

;(async () => {
  const proyectos = await (await fetch(`${WEB}/api/proyectos`)).json()
  const tb = proyectos.find((p) => p.prefijo === PROYECTO)?.tableros.find((t) => t.slug === TABLERO)
  if (!tb) throw new Error(`No está el tablero ${TABLERO} en ${PROYECTO}.`)
  const tablero = await (await fetch(`${WEB}/api/tableros/${tb.id}`)).json()
  const browser = await chromium.launch()
  const niveles = ['vistaGeneral', 'lejos', 'deCerca'].filter((n) => !SOLO || n === SOLO)
  const salida = { tablero: TABLERO, objetos: tablero.elementos.length, conectores: tablero.conectores.length }
  for (const n of niveles) {
    const corridas = []
    for (let i = 0; i < CORRIDAS; i++) corridas.push(await medirNivel(browser, n, tablero))
    salida[n] = corridas
  }
  if (args.includes('--json')) console.log(JSON.stringify(salida, null, 2))
  else {
    console.log(`${TABLERO}: ${salida.objetos} objetos, ${salida.conectores} conectores (${CORRIDAS} corridas)`)
    for (const n of niveles) {
      const cs = salida[n]
      const col = (f) => cs.map(f).join(' / ')
      console.log(`${n.padEnd(13)} [${cs[0].nivel}, ${cs[0].nodos} nodos, ${cs[0].dom} DOM] abrir ${col((c) => c.abrirMs)} ms`)
      for (const a of ['paneo', 'zoom', 'arrastre'].filter((x) => cs[0][x]))
        console.log(`   ${a.padEnd(9)} cps ${col((c) => c[a]?.fps)} | peor ${col((c) => c[a]?.peor)} | p95 ${col((c) => c[a]?.p95)} | hilo/cuadro ${col((c) => c[a]?.hilo)} ms`)
      const errs = cs.flatMap((c) => c.errores ?? [])
      if (errs.length) console.log('   errores:', errs.join(' | '))
    }
  }
  await browser.close()
})()
