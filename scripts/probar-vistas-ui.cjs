// Prueba de verdad (Playwright) de las vistas de un tablero, contra un Telar LOCAL con datos descartables:
//
//   TABLERO_DATOS=/tmp/telar-vistas TABLERO_PUERTO=4682 TABLERO_SEMILLA_DISCORD=no npx tsx servidor/src/principal.ts --produccion
//   NODE_PATH=$(npm root -g) node scripts/probar-vistas-ui.cjs --web http://127.0.0.1:4682 [--capturas docs/capturas/vistas-tablero]
//   ... --solo=pc-claro | pc-oscuro | movil-claro | movil-oscuro (de a una combinación; sin --solo, las cuatro)
//
// Qué mira, en PC (1440 × 900) y en celular emulado (iPhone 15, toques reales), en claro y en oscuro:
//   · el tablero de siempre (sin el ajuste de vistas guardado, como los de antes) sigue con sus tres pestañas,
//   · «Nuevo tablero» de cada tipo (Tablero, Diagrama, Diseño, Completo) desde la interfaz: las cuatro opciones, «Tablero» de fábrica,
//     y la línea de que Diseño es del proyecto,
//   · la barra superior (o la de abajo en el celular) solo muestra lo que el tablero tiene; con una sola vista no hay pestañas,
//   · la dirección de una vista que el tablero no tiene redirige a la que sí,
//   · un tablero solo lienzo no ofrece tarjetas del Kanban, y uno solo Kanban abre directo en el Kanban,
//   · ⋯ → Vistas…: sumar y sacar una vista; sacar una con contenido pregunta y no borra nada; la última no se puede sacar,
//   · el ícono de cada tablero en la barra lateral, controles táctiles de menos de 44 px y consola limpia.
// Nunca apunta a producción: se niega si la dirección no es 127.0.0.1 o localhost.
const path = require('node:path')
const fs = require('node:fs')
const { chromium, devices } = require('playwright')

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`))
  if (a) return a.slice(n.length + 3)
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const WEB = opcion('web', 'http://127.0.0.1:4682')
const CAPTURAS = opcion('capturas', '')
const SOLO = (opcion('solo', '') || '').split(',').filter(Boolean)
if (!['127.0.0.1', 'localhost'].includes(new URL(WEB).hostname)) {
  console.error('Solo contra un Telar local (127.0.0.1 o localhost).')
  process.exit(1)
}
if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true })

let fallas = 0
const ok = (cond, que, detalle) => {
  if (!cond) fallas++
  console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle !== undefined ? `\n      ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}` : ''}`)
  return cond
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const api = async (ruta, metodo = 'GET', cuerpo) => {
  const r = await fetch(WEB + ruta, { method: metodo, headers: cuerpo ? { 'content-type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
  const t = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${t}`)
  return t ? JSON.parse(t) : null
}

/** Los tableros de RC por nombre. */
const tableros = async () => (await api('/api/proyectos')).find((p) => p.prefijo === 'RC').tableros
const porNombre = async (nombre) => (await tableros()).find((t) => t.nombre === nombre)

async function contexto(browser, { movil, tema }) {
  const base = movil
    ? { ...devices['iPhone 15'], colorScheme: tema === 'oscuro' ? 'dark' : 'light' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: tema === 'oscuro' ? 'dark' : 'light' }
  const ctx = await browser.newContext(base)
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('tablero.tema', t)
      localStorage.setItem('telar.instalar.visto', String(Date.now()))
    } catch {}
  }, tema === 'oscuro' ? 'oscuro' : 'claro')
  return ctx
}

/** Una página con la consola vigilada (errores y avisos de React). */
let ultimaPagina = null
async function pagina(ctx, consola) {
  const page = await ctx.newPage()
  ultimaPagina = page
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) {
      const t = m.text()
      // Lo de la red del entorno (fuentes, favicon) no es de la app.
      if (/Failed to load resource|favicon|net::ERR/.test(t)) return
      consola.push(`${m.type()}: ${t.slice(0, 240)}`)
    }
  })
  page.on('pageerror', (e) => consola.push(`pageerror: ${String(e.message).slice(0, 240)}`))
  return page
}

const foto = async (page, nombre) => {
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) })
}

/** Cuántos controles táctiles de la pantalla miden menos de 44 px (de alto o de ancho). */
async function chicos(page, ambito = 'body', excepto = '') {
  return page.evaluate(([a, excepto]) => {
    const raiz = document.querySelector(a) ?? document.body
    const malos = []
    for (const el of raiz.querySelectorAll('button, a[href], [role="radio"], [role="switch"], input, [role="tab"]')) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden], [aria-hidden="true"]')) continue
      if (r.bottom < 0 || r.top > innerHeight) continue
      // El «+» de la barra de abajo mide 56 × 42 desde el plan del celular, dentro de una celda que llega a los 64 px de alto.
      if (excepto && el.matches(excepto)) continue
      if (r.height < 43.5 || r.width < 43.5) malos.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${Math.round(r.width)}×${Math.round(r.height)} «${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}»`)
    }
    return malos
  }, [ambito, excepto])
}

/** El menú ⋯ del proyecto RC → «Nuevo tablero» (los botones de la barra lateral aparecen al pasar el mouse). */
async function nuevoTableroDesdeElMenu(page) {
  await page.locator('.proyecto__cabecera').first().hover()
  await page.getByRole('button', { name: /Opciones de Restaurant City/ }).click()
  await page.getByRole('menuitem', { name: 'Nuevo tablero' }).click()
}

/** La opción de tipo por su nombre exacto («Diseño» también aparece en la frase de «Completo»). */
const opcionTipo = (page, nombre) => page.locator('.tipo-tablero__opcion').filter({ has: page.locator('.tipo-tablero__nombre', { hasText: new RegExp(`^${nombre}$`) }) })

const ruta = (page) => new URL(page.url()).pathname

async function abrir(page, destino, esperarA = '.barra, .barra-movil') {
  await page.goto(WEB + destino, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(esperarA, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await esperar(500)
}

// ───────────────────────── escritorio ─────────────────────────

async function pc(browser, tema) {
  const consola = []
  const ctx = await contexto(browser, { movil: false, tema })
  const page = await pagina(ctx, consola)
  const sufijo = `pc-${tema}`
  console.log(`\nEscritorio, ${tema}`)

  // 1. El tablero de siempre: sus tres pestañas.
  await abrir(page, '/RC/pendientes')
  ok((await page.locator('.pestanas .pestana').count()) === 3, 'el tablero de antes sigue con sus tres pestañas (Kanban, Lienzo, Diseño)')
  ok(await page.locator('.tablero-item__icono').first().isVisible(), 'cada tablero de la barra lateral lleva el ícono de su tipo')
  await foto(page, `${sufijo}-1-tablero-completo`)

  // 2. Nuevo tablero (desde el menú del proyecto): las cuatro opciones, «Tablero» de fábrica y la línea de Diseño.
  await nuevoTableroDesdeElMenu(page)
  await page.waitForSelector('.tipo-tablero__opcion')
  const opciones = await page.locator('.tipo-tablero__opcion .tipo-tablero__nombre').allTextContents()
  ok(JSON.stringify(opciones) === JSON.stringify(['Tablero', 'Diagrama', 'Diseño', 'Completo']), 'el diálogo ofrece Tablero, Diagrama, Diseño y Completo', opciones)
  const frases = await page.locator('.tipo-tablero__frase').allTextContents()
  ok(frases.length === 4 && frases.every((f) => f.length > 20), 'cada opción trae su frase', frases)
  ok((await page.locator('.tipo-tablero__opcion[aria-checked="true"] .tipo-tablero__nombre').textContent()) === 'Tablero', '«Tablero» viene elegido de fábrica')
  ok(/Diseño es del proyecto/.test(await page.locator('.tipo-tablero__nota').textContent()), 'una línea dice que Diseño es del proyecto')
  await esperar(450)
  await foto(page, `${sufijo}-2-nuevo-tablero-tipos`)
  // Con flechas se mueve la elección.
  await page.locator('.tipo-tablero__opcion[aria-checked="true"]').focus()
  await page.keyboard.press('ArrowRight')
  ok((await page.locator('.tipo-tablero__opcion[aria-checked="true"] .tipo-tablero__nombre').textContent()) === 'Diagrama', 'las flechas cambian el tipo')

  // 3. Un Diagrama: entra directo al lienzo, sin pestañas y sin Kanban.
  await page.getByPlaceholder('Por ejemplo: Lanzamiento').fill('Cómo funciona')
  await page.getByRole('button', { name: 'Crear tablero' }).click()
  await page.waitForSelector('.lienzo', { timeout: 15000 })
  ok(ruta(page) === '/RC/como-funciona/lienzo', 'el diagrama abre directo en su lienzo', ruta(page))
  ok((await page.locator('.pestanas').count()) === 0, 'un tablero con una sola vista no tiene pestañas')
  ok((await page.getByText('Tarjetas del Kanban').count()) === 0, 'el diagrama no ofrece traer tarjetas del Kanban')
  const dg = await porNombre('Cómo funciona')
  ok(JSON.stringify(dg.vistas) === '["lienzo"]', 'el servidor lo guardó solo con lienzo', dg.vistas)
  const completoDg = await api(`/api/tableros/${dg.id}`)
  ok(completoDg.listas.length === 0 && completoDg.tarjetas.length === 0, 'un diagrama no crea listas ni tarjetas')
  await esperar(400)
  await foto(page, `${sufijo}-3-diagrama-sin-pestanas`)
  ok(await page.locator('.tablero-item--activo .tablero-item__icono').isVisible(), 'la fila del diagrama lleva su ícono')
  ok((await page.locator('.tablero-item--activo .tablero-item__cuenta').count()) === 0, 'y no cuenta tarjetas (no tiene Kanban)')

  // 4. La dirección de una vista que no tiene redirige a la que sí.
  await abrir(page, '/RC/como-funciona', '.lienzo')
  ok(ruta(page) === '/RC/como-funciona/lienzo', '/RC/como-funciona (sin vista) cae en el lienzo', ruta(page))
  await abrir(page, '/RC/como-funciona/diseno', '.lienzo')
  ok(ruta(page) === '/RC/como-funciona/lienzo', '/RC/como-funciona/diseno redirige al lienzo, que es lo que tiene', ruta(page))

  // 5. Un tablero Diseño: entra directo a la hoja de diseño, sin crear lista ni lienzo.
  await abrir(page, '/RC/pendientes')
  await nuevoTableroDesdeElMenu(page)
  await opcionTipo(page, 'Diseño').click()
  await page.getByPlaceholder('Por ejemplo: Lanzamiento').fill('Manual de marca')
  await page.getByRole('button', { name: 'Crear tablero' }).click()
  await page.waitForURL(/\/RC\/manual-de-marca\/diseno/, { timeout: 15000 })
  await page.waitForSelector('.diseno, .diseno-raiz, [class*="diseno"]', { timeout: 20000 })
  await esperar(900)
  ok((await page.locator('.pestanas').count()) === 0, 'un tablero Diseño no tiene pestañas')
  const mb = await porNombre('Manual de marca')
  ok(JSON.stringify(mb.vistas) === '["diseno"]', 'el tablero Diseño solo tiene Diseño', mb.vistas)
  const cmb = await api(`/api/tableros/${mb.id}`)
  ok(cmb.listas.length === 0 && cmb.elementos.length === 0, 'un tablero Diseño no crea listas ni lienzo')
  await foto(page, `${sufijo}-4-tablero-diseno`)
  await abrir(page, '/RC/manual-de-marca', '.diseno, [class*="diseno"]')
  ok(/\/RC\/manual-de-marca\/diseno/.test(ruta(page)), '/RC/manual-de-marca (sin vista) entra a Diseño', ruta(page))

  // 6. Tablero (solo Kanban) y Completo.
  for (const [nombre, tipo, vistasEsperadas] of [['Pendientes 2', 'Tablero', '["kanban"]'], ['Todo junto', 'Completo', '["kanban","lienzo","diseno"]']]) {
    await abrir(page, '/RC/pendientes')
    await nuevoTableroDesdeElMenu(page)
      await opcionTipo(page, tipo).click()
    await page.getByPlaceholder('Por ejemplo: Lanzamiento').fill(nombre)
    await page.getByRole('button', { name: 'Crear tablero' }).click()
    await page.waitForSelector(tipo === 'Tablero' ? '.lista' : '.pestanas', { timeout: 15000 })
    await esperar(500)
    const t = await porNombre(nombre)
    ok(JSON.stringify(t.vistas) === vistasEsperadas, `«${tipo}»: el servidor lo guardó con ${vistasEsperadas}`, t.vistas)
    if (tipo === 'Tablero') {
      ok(ruta(page) === '/RC/pendientes-2', 'el Tablero abre directo en el Kanban', ruta(page))
      ok((await page.locator('.pestanas').count()) === 0, 'un tablero solo Kanban no tiene pestañas')
      ok((await page.locator('.lista').count()) === 3, 'con sus tres listas de fábrica')
      await foto(page, `${sufijo}-5-tablero-kanban`)
    } else {
      ok((await page.locator('.pestanas .pestana').count()) === 3, 'el Completo tiene sus tres pestañas')
      await foto(page, `${sufijo}-6-completo`)
    }
  }

  // 7. ⋯ → Vistas… sobre «Pendientes 2» (solo Kanban): sumar el lienzo, sacar con contenido, no sacar la última.
  const t2 = await porNombre('Pendientes 2')
  await abrir(page, '/RC/pendientes-2', '.lista')
  const fila = page.locator('.tablero-item', { hasText: 'Pendientes 2' })
  await fila.hover()
  await fila.getByRole('button', { name: /Opciones del tablero/ }).click()
  ok((await page.getByRole('menuitem', { name: 'Archivo de Hecho…' }).count()) === 1, 'el menú de un tablero con Kanban trae «Archivo de Hecho…»')
  await page.getByRole('menuitem', { name: 'Vistas…' }).click()
  await page.waitForSelector('.vistas-panel')
  const estado = async () => page.evaluate(() => [...document.querySelectorAll('.vistas-panel [role="switch"]')].map((b) => `${b.querySelector('.vistas-panel__nombre').textContent}:${b.getAttribute('aria-checked')}${b.disabled ? ':fijo' : ''}`))
  ok(JSON.stringify(await estado()) === JSON.stringify(['Kanban:true:fijo', 'Lienzo:false', 'Diseño:false']), 'el panel Vistas: Kanban prendido (y fijo, es la única), Lienzo y Diseño apagados', await estado())
  await esperar(450)
  await foto(page, `${sufijo}-7-panel-vistas`)
  await page.getByRole('switch', { name: /Lienzo/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.pestanas .pestana').length === 2, null, { timeout: 8000 })
  ok(JSON.stringify((await porNombre('Pendientes 2')).vistas) === '["kanban","lienzo"]', 'sumar el lienzo se guarda y aparecen las pestañas Kanban y Lienzo')
  await foto(page, `${sufijo}-8-vista-sumada`)
  // Con contenido en el lienzo, sacarlo pregunta antes (y no borra nada).
  await api(`/api/tableros/${t2.id}/elementos`, 'POST', { tipo: 'nota', x: 0, y: 0, datos: { texto: 'Una nota que no se pierde' } })
  await page.keyboard.press('Escape')
  await abrir(page, '/RC/pendientes-2', '.lista')
  await page.locator('.tablero-item', { hasText: 'Pendientes 2' }).hover()
  await page.locator('.tablero-item', { hasText: 'Pendientes 2' }).getByRole('button', { name: /Opciones del tablero/ }).click()
  await page.getByRole('menuitem', { name: 'Vistas…' }).click()
  await page.waitForSelector('.vistas-panel')
  await esperar(900)
  await page.getByRole('switch', { name: /Lienzo/ }).click()
  await page.waitForSelector('.vistas-panel__confirmar')
  ok(/1 objeto/.test(await page.locator('.vistas-panel__confirmar').textContent()) && /No se borra nada/.test(await page.locator('.vistas-panel__confirmar').textContent()), 'sacar una vista con contenido pregunta, dice cuánto hay y que no se borra nada')
  await esperar(300)
  await foto(page, `${sufijo}-9-confirmar-sacar`)
  await page.getByRole('button', { name: 'Cancelar' }).click()
  ok(JSON.stringify((await porNombre('Pendientes 2')).vistas) === '["kanban","lienzo"]', 'Cancelar deja las vistas como estaban')
  await page.getByRole('switch', { name: /Lienzo/ }).click()
  await page.getByRole('button', { name: 'Sacar el lienzo' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.pestanas').length === 0, null, { timeout: 8000 })
  ok(JSON.stringify((await porNombre('Pendientes 2')).vistas) === '["kanban"]', 'confirmar saca el lienzo y la barra vuelve a no tener pestañas')
  ok((await api(`/api/tableros/${t2.id}`)).elementos.length === 1, 'y la nota del lienzo sigue guardada (no se borró nada)')
  ok(await page.getByRole('switch', { name: /Kanban/ }).isDisabled(), 'la última vista no se puede sacar')
  await page.getByRole('switch', { name: /Lienzo/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.pestanas .pestana').length === 2, null, { timeout: 8000 })
  await page.goto(WEB + '/RC/pendientes-2/lienzo')
  await page.waitForSelector('.lienzo', { timeout: 15000 })
  await esperar(700)
  ok((await page.locator('.nodo-nota, [data-id]').count()) > 0, 'al sumar el lienzo otra vez, la nota vuelve')
  await foto(page, `${sufijo}-10-lienzo-recuperado`)
  // Sacar el Kanban estando en el Kanban: la pantalla pasa sola a la vista que queda.
  await page.getByRole('tab', { name: 'Kanban' }).click()
  await page.waitForSelector('.lista')
  const f2 = page.locator('.tablero-item', { hasText: 'Pendientes 2' })
  await f2.hover()
  await f2.getByRole('button', { name: /Opciones del tablero/ }).click()
  await page.getByRole('menuitem', { name: 'Vistas…' }).click()
  await page.waitForSelector('.vistas-panel')
  await esperar(900)
  await page.getByRole('switch', { name: /Kanban/ }).click()
  if (await page.locator('.vistas-panel__confirmar').count()) await page.getByRole('button', { name: 'Sacar el Kanban' }).click()
  await page.waitForFunction(() => location.pathname.endsWith('/lienzo'), null, { timeout: 8000 })
  ok(ruta(page) === '/RC/pendientes-2/lienzo', 'sacar la vista que se está mirando lleva a la que queda', ruta(page))
  await page.keyboard.press('Escape')

  // 8. Atajos y paleta: solo lo que el tablero tiene.
  await abrir(page, '/RC/como-funciona/lienzo', '.lienzo')
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.paleta')
  await page.locator('.paleta input').fill('ir al')
  await esperar(300)
  const comandos = await page.locator('.paleta__texto').allTextContents()
  ok(!comandos.includes('Ir al kanban') && !comandos.includes('Ir a Diseño'), 'la paleta de un diagrama no ofrece ir al Kanban ni a Diseño', comandos)
  await page.keyboard.press('Escape')

  ok(consola.length === 0, 'consola limpia', consola)
  await ctx.close()
}

// ───────────────────────── celular ─────────────────────────

async function movil(browser, tema) {
  const consola = []
  const ctx = await contexto(browser, { movil: true, tema })
  const page = await pagina(ctx, consola)
  const sufijo = `movil-${tema}`
  console.log(`\nCelular (iPhone 15), ${tema}`)
  const abrirMovil = (d, sel) => abrir(page, d, sel ?? '.app-movil')
  // Lo que arma la parte de escritorio, por si se corre solo el celular (con una base nueva).
  const rc = (await api('/api/proyectos')).find((p) => p.prefijo === 'RC')
  if (!(await porNombre('Pendientes 2'))) await api('/api/tableros', 'POST', { proyectoId: rc.id, nombre: 'Pendientes 2', tipo: 'tablero' })
  if (!(await porNombre('Manual de marca'))) await api('/api/tableros', 'POST', { proyectoId: rc.id, nombre: 'Manual de marca', tipo: 'diseno' })

  // El tablero de siempre: cinco lugares.
  await abrirMovil('/RC/pendientes', '.barra-inferior')
  ok((await page.locator('.barra-inferior__lugar').count()) === 5, 'el tablero completo: la barra de abajo tiene sus cinco lugares (Kanban, Lienzo, Agregar, Diseño, Buscar)')
  await foto(page, `${sufijo}-1-barra-completa`)

  // Nuevo tablero (Diagrama) desde la hoja de proyectos.
  await page.locator('.barra-movil__tablero, [aria-label*="tablero" i], .barra-movil button').first().click().catch(() => {})
  await page.waitForSelector('.selector-tablero__proyecto', { timeout: 8000 }).catch(() => {})
  if (!(await page.locator('.selector-tablero__proyecto').count())) {
    // El título de la barra abre el selector.
    await page.locator('.barra-movil__titulo, .barra-movil__tablero').first().click()
    await page.waitForSelector('.selector-tablero__proyecto', { timeout: 8000 })
  }
  await esperar(500)
  await foto(page, `${sufijo}-2-selector`)
  await page.getByRole('button', { name: 'Nuevo tablero', exact: false }).first().click()
  await page.waitForSelector('.nuevo-tablero-movil .tipo-tablero__opcion')
  await esperar(500)
  const opciones = await page.locator('.nuevo-tablero-movil .tipo-tablero__nombre').allTextContents()
  ok(JSON.stringify(opciones) === JSON.stringify(['Tablero', 'Diagrama', 'Diseño', 'Completo']), 'la hoja ofrece las cuatro opciones', opciones)
  ok((await page.locator('.tipo-tablero__opcion[aria-checked="true"] .tipo-tablero__nombre').textContent()) === 'Tablero', '«Tablero» viene elegido de fábrica')
  ok(/Diseño es del proyecto/.test(await page.locator('.nuevo-tablero-movil .tipo-tablero__nota').textContent()), 'y dice que Diseño es del proyecto')
  const chicosHoja = await chicos(page, '.nuevo-tablero-movil')
  ok(chicosHoja.length === 0, 'controles táctiles de la hoja de 44 px o más', chicosHoja)
  await esperar(300)
  await foto(page, `${sufijo}-3-hoja-nuevo-tablero`)
  await opcionTipo(page, 'Diagrama').tap()
  await page.locator('.nuevo-tablero-movil input').fill('Mapa del celular')
  await foto(page, `${sufijo}-4-hoja-diagrama-elegido`)
  await page.getByRole('button', { name: 'Crear tablero' }).tap()
  await page.waitForURL(/\/RC\/mapa-del-celular\/lienzo/, { timeout: 15000 })
  await page.waitForSelector('.lienzo', { timeout: 15000 })
  await esperar(800)
  ok(ruta(page) === '/RC/mapa-del-celular/lienzo', 'el diagrama abre directo en su lienzo', ruta(page))
  const lugares = await page.locator('.barra-inferior__lugar').allTextContents()
  ok(lugares.length === 3 && lugares[0].includes('Lienzo') && lugares[2].includes('Buscar'), 'la barra de abajo solo trae Lienzo, Agregar y Buscar', lugares)
  ok((await page.locator('.barra-inferior__lugar', { hasText: 'Kanban' }).count()) === 0 && (await page.locator('.barra-inferior__lugar', { hasText: 'Diseño' }).count()) === 0, 'sin Kanban ni Diseño en la barra')
  await foto(page, `${sufijo}-5-diagrama`)
  const chicosBarra = await chicos(page, '.barra-inferior', '.barra-inferior__agregar')
  ok(chicosBarra.length === 0, 'la barra de abajo: controles de 44 px o más', chicosBarra)
  // «+» en el lienzo de un diagrama: sin «Tarjeta».
  await page.locator('.barra-inferior__agregar').tap()
  await page.waitForSelector('.hoja-crear')
  await esperar(400)
  ok((await page.locator('.hoja-crear', { hasText: 'Tarjeta' }).count()) === 0, 'agregar al lienzo de un diagrama no ofrece «Tarjeta»')
  await foto(page, `${sufijo}-6-agregar-diagrama`)
  await page.keyboard.press('Escape')
  await page.goBack().catch(() => {})
  await esperar(300)

  // Dirección de una vista que no tiene.
  await abrirMovil('/RC/mapa-del-celular/diseno', '.lienzo')
  ok(ruta(page) === '/RC/mapa-del-celular/lienzo', 'la dirección de Diseño en un diagrama redirige al lienzo', ruta(page))

  // Un tablero solo Diseño: la barra trae solo Diseño y Buscar (no hay a dónde agregar).
  const mb = await tableros().then((ts) => ts.find((t) => t.vistas.length === 1 && t.vistas[0] === 'diseno'))
  if (mb) {
    await abrirMovil(`/RC/${mb.slug}`, '.barra-inferior')
    await esperar(1200)
    const l2 = await page.locator('.barra-inferior__lugar').allTextContents()
    ok(l2.length === 2 && l2[0].includes('Diseño') && l2[1].includes('Buscar'), 'un tablero solo Diseño: la barra de abajo trae Diseño y Buscar (sin «+»)', l2)
    await foto(page, `${sufijo}-7-solo-diseno`)
  }

  // Un tablero solo Kanban.
  const kb = await porNombre('Pendientes 2')
  await abrirMovil(`/RC/${kb.slug}/lienzo`, '.barra-inferior')
  await esperar(900)
  const kanbanSolo = await tableros().then((ts) => ts.find((t) => t.nombre === 'Pendientes 2'))
  if (kanbanSolo.vistas.length === 1) {
    ok(ruta(page) === `/RC/${kb.slug}`, 'un tablero solo Kanban: la dirección del lienzo vuelve al Kanban', ruta(page))
    const l3 = await page.locator('.barra-inferior__lugar').allTextContents()
    ok(l3.length === 3 && l3[0].includes('Kanban'), 'y la barra trae Kanban, Agregar y Buscar', l3)
  }

  // Opciones de un tablero (mantener apretado) → Vistas.
  await abrirMovil('/RC/pendientes', '.barra-inferior')
  await page.locator('.barra-movil__titulo, .barra-movil__tablero').first().tap()
  await page.waitForSelector('.selector-tablero__proyecto', { timeout: 8000 })
  await esperar(400)
  const filaT = page.locator('.selector-tablero__tablero', { hasText: 'Mapa del celular' })
  ok((await filaT.locator('.selector-tablero__icono').count()) === 1, 'en el selector, cada tablero lleva el ícono de su tipo')
  // Mantener apretado: en Android llega como «contextmenu» (en iOS lo cubre el reloj propio, que no se puede soltar con CDP sin que el
  // toque que levanta caiga sobre la hoja que recién se abrió).
  await filaT.dispatchEvent('contextmenu')
  await page.getByText('Sumar o sacar Kanban, Lienzo o Diseño').waitFor({ timeout: 6000 })
  await foto(page, `${sufijo}-8-opciones-tablero`)
  await page.getByText('Sumar o sacar Kanban, Lienzo o Diseño').tap()
  await page.waitForSelector('.vistas-panel')
  await esperar(900)
  const chicosV = await chicos(page, '.vistas-panel')
  ok(chicosV.length === 0, 'el panel Vistas: controles de 44 px o más', chicosV)
  await esperar(450)
  await foto(page, `${sufijo}-9-vistas`)
  await page.getByRole('switch', { name: /Kanban/ }).tap()
  await page.waitForFunction(async () => (await (await fetch('/api/proyectos')).json()).flatMap((p) => p.tableros).find((t) => t.nombre === 'Mapa del celular').vistas.length === 2, null, { timeout: 8000 })
  ok(true, 'en el celular se suma el Kanban desde «Vistas»')
  await foto(page, `${sufijo}-10-vistas-sumada`)

  ok(consola.length === 0, 'consola limpia', consola)
  await ctx.close()
}

;(async () => {
  const browser = await chromium.launch()
  const combos = [
    ['pc-claro', () => pc(browser, 'claro')],
    ['pc-oscuro', () => pc(browser, 'oscuro')],
    ['movil-claro', () => movil(browser, 'claro')],
    ['movil-oscuro', () => movil(browser, 'oscuro')],
  ].filter(([n]) => !SOLO.length || SOLO.includes(n))
  for (const [n, fn] of combos) {
    try {
      await fn()
    } catch (e) {
      fallas++
      // Para ver qué había en pantalla cuando se cortó.
      if (ultimaPagina && process.env.TELAR_FALLO) await ultimaPagina.screenshot({ path: process.env.TELAR_FALLO }).catch(() => {})
      console.log(`  ✗ ${n} se cortó: ${String(e.message ?? e).split('\n').slice(0, 4).join(' | ')}`)
    }
  }
  await browser.close()
  console.log(fallas ? `\n${fallas} ${fallas === 1 ? 'cosa falló' : 'cosas fallaron'}.` : '\nTodo bien.')
  process.exit(fallas ? 1 : 0)
})()
