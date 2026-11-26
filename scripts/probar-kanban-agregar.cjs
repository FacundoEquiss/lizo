// Prueba de punta a punta de «agregar tarjeta» en el Kanban (encabezado de la lista, pie fijo y compositor), con Playwright,
// contra un Telar LOCAL con datos descartables:
//
//   TABLERO_DATOS=/tmp/telar-kanban TABLERO_PUERTO=4338 TABLERO_PUERTO_WEB=4337 TABLERO_SEMILLA_DISCORD=no npm run dev
//   node scripts/sembrar-kanban.mjs --url http://127.0.0.1:4338
//   NODE_PATH=$(npm root -g) node scripts/probar-kanban-agregar.cjs --web http://127.0.0.1:4337 [--capturas docs/capturas/kanban-agregar]
//
// Comprueba (y falla con un mensaje claro si algo no anda): pie siempre a la vista con 64 tarjetas, botón «+» del encabezado,
// compositor dentro de la pantalla (PC y celular), Enter / Ctrl+Enter / Mayús+Enter / Esc, tipo, prioridad, etiquetas (con
// crear al vuelo), motivo, título largo, error con «Reintentar», arrastrar una tarjeta después de usar el compositor y que
// no haya errores en la consola. Escribe tarjetas en el tablero «Pendientes» del Telar local: nunca contra producción.
const path = require('node:path')
const fs = require('node:fs')
const { chromium, devices } = require('playwright')

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const WEB = opcion('web', 'http://127.0.0.1:4337')
const CAPTURAS = opcion('capturas', '')
const SOLO_VER = args.includes('--sin-capturas')
const host = new URL(WEB).hostname
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error('Solo contra un Telar local.')
  process.exit(1)
}
if (CAPTURAS) fs.mkdirSync(path.resolve(CAPTURAS), { recursive: true })

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let fallos = 0
const ok = (cond, texto) => {
  console.log(`${cond ? '  ok ' : '  MAL'}  ${texto}`)
  if (!cond) fallos++
}
const foto = async (page, nombre) => {
  if (!CAPTURAS || SOLO_VER) return
  await page.screenshot({ path: path.resolve(CAPTURAS, `${nombre}.png`) })
}

async function nuevaPagina(browser, { tema = 'claro', movil = false } = {}) {
  const base = movil ? { ...devices['iPhone 15'] } : { viewport: { width: 1440, height: 900 } }
  const ctx = await browser.newContext({ ...base, deviceScaleFactor: movil ? 3 : 2, colorScheme: tema === 'oscuro' ? 'dark' : 'light' })
  await ctx.addInitScript((t) => localStorage.setItem('tablero.tema', t), tema)
  const page = await ctx.newPage()
  const errores = []
  // El 500 de la prueba de «error del servidor» lo provoca la propia prueba: no cuenta.
  page.on('console', (m) => m.type() === 'error' && !/status of 500/.test(m.text()) && errores.push(m.text()))
  page.on('pageerror', (e) => errores.push(String(e.message)))
  await page.goto(`${WEB}/RC/pendientes`)
  await page.waitForSelector('.lista .tarjeta')
  await espera(700)
  return { ctx, page, errores }
}

const lista = (page, nombre) => page.locator('.lista', { has: page.locator('.lista__nombre', { hasText: new RegExp(`^${nombre}$`) }) })
const cantidad = async (page, nombre) => Number(await lista(page, nombre).locator('.lista__cuenta').first().innerText().then((t) => t.split('/')[0]))
/** ¿El elemento está entero dentro de la ventana? */
const enPantalla = (page, locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.height > 0
  })

// Un nombre distinto en cada corrida: la etiqueta que se crea al vuelo queda en el proyecto.
const TOKEN = Date.now().toString(36).slice(-5)
const ETIQUETA_NUEVA = `viaje ${TOKEN}`

async function escritorio(browser) {
  console.log('\nEscritorio 1440 × 900')
  const { ctx, page, errores } = await nuevaPagina(browser)
  const porHacer = lista(page, 'Por hacer')

  // 1 · El pie queda a la vista aunque la lista tenga 64 tarjetas.
  const pie = porHacer.locator('.lista__pie')
  ok(await enPantalla(page, pie), 'con 64 tarjetas, el pie «Agregar tarjeta» está entero a la vista sin desplazar')
  ok(await enPantalla(page, porHacer.locator('.lista__agregar')), 'el botón «Agregar tarjeta» se ve')
  const dentro = await porHacer.locator('.lista__tarjetas').evaluate((el) => ({ sc: el.scrollHeight, ch: el.clientHeight }))
  ok(dentro.sc > dentro.ch * 4, `la lista se desplaza por dentro (${dentro.sc} px de contenido en ${dentro.ch} px)`)
  const pieAbajo = await pie.evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight)
  ok(pieAbajo, 'el pie no se sale de la ventana')

  // 2 · Encabezado: tres piezas centradas en la misma línea y del mismo alto de zona.
  const cab = await porHacer.locator('.lista__cabecera').evaluate((cabecera) => {
    const caja = (sel) => {
      const r = cabecera.querySelector(sel).getBoundingClientRect()
      return { centro: r.top + r.height / 2, alto: r.height, ancho: r.width }
    }
    return { nombre: caja('.lista__nombre'), cuenta: caja('.lista__cuenta'), mas: caja('.lista__boton--mas'), menu: caja('.lista__menu') }
  })
  const centros = [cab.nombre.centro, cab.cuenta.centro, cab.mas.centro, cab.menu.centro]
  ok(Math.max(...centros) - Math.min(...centros) <= 1, `título, número, «+» y «⋯» comparten el centro vertical (${centros.map((c) => c.toFixed(1)).join(' · ')})`)
  ok(Math.abs(cab.mas.alto - cab.menu.alto) < 0.5 && Math.abs(cab.mas.ancho - cab.menu.ancho) < 0.5, `«+» y «⋯» miden lo mismo (${cab.mas.ancho}×${cab.mas.alto})`)
  const mas = porHacer.locator('.lista__boton--mas')
  ok((await mas.getAttribute('aria-label')) === 'Agregar tarjeta' && (await mas.getAttribute('data-tip')) === 'Agregar tarjeta', 'el «+» tiene aria-label y aviso «Agregar tarjeta»')
  const anchoAntes = await porHacer.evaluate((el) => el.getBoundingClientRect().width)
  await foto(page, 'escritorio-claro-encabezado')

  // 3 · El «+» abre el compositor entero dentro de la pantalla, con el título enfocado.
  await mas.click()
  await page.waitForSelector('.alta')
  await espera(450)
  ok(await enPantalla(page, porHacer.locator('.alta')), 'el compositor abierto entra entero en la pantalla (con la lista de 64)')
  ok(await page.evaluate(() => document.activeElement?.classList.contains('alta__titulo')), 'el foco queda en el título')
  ok(Math.abs((await porHacer.evaluate((el) => el.getBoundingClientRect().width)) - anchoAntes) < 0.5, 'la lista no cambia de ancho al abrir el compositor')
  const titulo = page.locator('.alta__titulo')

  // 4 · Enter agrega y deja abierto; la tarjeta aparece al final de la lista.
  const antes = await cantidad(page, 'Por hacer')
  await titulo.fill(`Primera tarjeta del compositor ${TOKEN}`)
  await page.keyboard.press('Enter')
  await page.waitForFunction((n) => [...document.querySelectorAll('.lista')].find((l) => l.textContent.includes('Por hacer'))?.querySelector('.lista__cuenta')?.textContent === String(n), antes + 1)
  ok((await cantidad(page, 'Por hacer')) === antes + 1, 'Enter agrega la tarjeta')
  ok((await page.locator('.alta').count()) === 1 && (await titulo.inputValue()) === '', 'el compositor sigue abierto y el título queda vacío')
  ok(await page.evaluate(() => document.activeElement?.classList.contains('alta__titulo')), 'el foco sigue en el título para cargar otra')

  // 5 · Tipo, prioridad, etiquetas (una existente y una nueva al vuelo) y motivo.
  await page.locator('.alta__pildora', { hasText: 'Tarea' }).click()
  await page.locator('.selector__item', { hasText: 'Error' }).first().click()
  await page.locator('.alta__pildora[aria-label^="Prioridad"]').click()
  await page.locator('.selector__item', { hasText: 'Urgente' }).first().click()
  await page.locator('.alta__pildora[aria-label^="Etiquetas"]').click()
  await page.locator('.selector__item', { hasText: 'cocina' }).first().click()
  await page.locator('.selector__buscar').fill(ETIQUETA_NUEVA)
  await page.locator('.selector__item--crear').click()
  await page.keyboard.press('Escape')
  await espera(250)
  ok((await page.locator('.alta__etiquetas li').count()) === 2, 'las dos etiquetas (cocina y la nueva) se ven elegidas')
  ok(await page.evaluate(() => document.activeElement?.classList.contains('alta__titulo')), 'al cerrar el selector el foco vuelve al título')
  await titulo.fill(`Se traba el horno con dos platos ${TOKEN}`)
  await page.locator('.alta__motivo').fill('Los clientes se van enojados si el plato tarda más de un minuto.')
  await foto(page, 'escritorio-claro-compositor-completo')
  await page.keyboard.press('Shift+Enter').catch(() => {})
  ok(await page.evaluate(() => document.activeElement?.classList.contains('alta__motivo')), 'Mayús+Enter en el título pasa al motivo')
  await page.keyboard.press('Control+Enter')
  await page.waitForSelector('.alta', { state: 'detached' })
  ok(true, 'Ctrl+Enter agrega y cierra')
  await espera(900)
  const nueva = page.locator('.ordenable', { hasText: `Se traba el horno con dos platos ${TOKEN}` })
  ok((await nueva.count()) === 1, 'la tarjeta nueva está en la lista')
  ok((await nueva.locator('.tarjeta__etiquetas').innerText()).toLowerCase().includes('cocina'), 'tiene la etiqueta existente')
  ok((await nueva.locator('.tarjeta__etiquetas').innerText()).toLowerCase().includes(ETIQUETA_NUEVA), 'tiene la etiqueta creada al vuelo')
  const clave = (await nueva.locator('.tarjeta__clave').innerText()).trim()
  const r = await fetch(`${WEB}/api/tarjetas/${clave}`).then((x) => x.json())
  ok(r.tipo === 'error' && r.prioridad === 'urgente', `se creó con tipo «error» y prioridad «urgente» (${r.tipo}, ${r.prioridad})`)
  ok(r.porqueCompleto?.motivo?.startsWith('Los clientes se van enojados'), 'el motivo quedó guardado como el porqué de la tarjeta')

  // 6 · Esc cierra y conserva lo escrito como borrador; la sintaxis rápida sigue andando.
  await porHacer.locator('.lista__agregar').click()
  await page.waitForSelector('.alta')
  await titulo.fill('idea: borrador que no se manda !alta')
  await espera(200)
  ok((await page.locator('.alta__pildora[aria-label^="Tipo"]').innerText()).includes('Idea'), 'la sintaxis «idea:» se refleja en la píldora de tipo')
  ok((await page.locator('.alta__pildora[aria-label^="Prioridad"]').innerText()).includes('Alta'), 'la sintaxis «!alta» se refleja en la píldora de prioridad')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.alta', { state: 'detached' })
  await porHacer.locator('.lista__agregar').click()
  await page.waitForSelector('.alta')
  ok((await titulo.inputValue()) === 'idea: borrador que no se manda !alta', 'Esc cierra y lo escrito queda de borrador')
  await titulo.fill('')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.alta', { state: 'detached' })

  // 7 · Título larguísimo: se ve completo (el campo crece) y la tarjeta se crea con todo el texto.
  const largo = `Decidir cómo se muestra el tiempo de espera de cada cliente arriba de la mesa cuando hay más de diez personas en el salón y la cocina está al límite ${TOKEN}`
  await porHacer.locator('.lista__agregar').click()
  await page.waitForSelector('.alta')
  await titulo.fill(largo)
  const visible = await titulo.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)
  ok(visible, 'el título largo se ve completo (sin cortarse ni scroll interno)')
  await foto(page, 'escritorio-claro-titulo-largo')
  await page.keyboard.press('Enter')
  await espera(700)
  ok((await page.locator('.ordenable', { hasText: largo.slice(-40) }).count()) === 1, 'se creó con el título entero')

  // 8 · Error del servidor: lo escrito no se pierde y se puede reintentar.
  await titulo.fill(`Esta falla al principio ${TOKEN}`)
  await page.route('**/api/tarjetas', (ruta) => (ruta.request().method() === 'POST' ? ruta.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"El servidor no pudo guardar."}' }) : ruta.continue()))
  await page.keyboard.press('Enter')
  await page.waitForSelector('.alta__fallida')
  ok((await page.locator('.alta__fallida').innerText()).includes(`Esta falla al principio ${TOKEN}`), 'si falla, el título queda a la vista con «No se pudo agregar»')
  await foto(page, 'escritorio-claro-error')
  await page.unroute('**/api/tarjetas')
  await page.locator('.alta__fallida button', { hasText: 'Reintentar' }).click()
  await page.waitForSelector('.alta__fallida', { state: 'detached' })
  await espera(700)
  ok((await page.locator('.ordenable', { hasText: `Esta falla al principio ${TOKEN}` }).count()) === 1, 'Reintentar la agrega')
  await page.keyboard.press('Escape')

  // 9 · Lista vacía y título de lista largo: el encabezado no se desarma.
  const bandeja = lista(page, 'Bandeja \\(Discord\\)')
  ok(await enPantalla(page, bandeja.locator('.lista__agregar')), 'lista vacía: «Agregar tarjeta» a la vista')
  const nombreLargo = 'Una lista con un nombre larguísimo que no entra'
  const id = await bandeja.getAttribute('data-lista')
  await fetch(`${WEB}/api/listas/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: nombreLargo }) })
  await espera(1200)
  const largoCab = await page.locator(`.lista[data-lista="${id}"] .lista__cabecera`).evaluate((c) => {
    const f = c.getBoundingClientRect()
    return [...c.querySelectorAll('.lista__cuenta, .lista__boton')].every((e) => e.getBoundingClientRect().right <= f.right && e.getBoundingClientRect().width > 0) && c.getBoundingClientRect().height < 60
  })
  ok(largoCab, 'con un título de lista larguísimo, número, «+» y «⋯» siguen dentro y a la vista (el título se corta con …)')
  await foto(page, 'escritorio-claro-titulo-de-lista-largo')
  await fetch(`${WEB}/api/listas/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Bandeja (Discord)' }) })

  // 10 · Atajo N con el mouse sobre una lista.
  await lista(page, 'En curso').hover()
  await page.keyboard.press('n')
  await page.locator('.lista[data-lista] .alta').first().waitFor()
  await espera(300)
  ok((await lista(page, 'En curso').locator('.alta').count()) === 1, 'el atajo N abre el compositor de la lista bajo el mouse')
  await page.keyboard.press('Escape')

  // 11 · Arrastrar una tarjeta DESPUÉS de usar el compositor sigue andando.
  await page.waitForSelector('.alta', { state: 'detached' })
  const origen = lista(page, 'En curso').locator('.ordenable').first()
  const claveOrigen = (await origen.locator('.tarjeta__clave').innerText()).trim()
  const destino = lista(page, 'Por decidir').locator('.lista__tarjetas')
  const a = await origen.boundingBox()
  const d = await destino.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + 20)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 30, { steps: 4 })
  await page.mouse.move(d.x + d.width / 2, d.y + 60, { steps: 14 })
  await espera(300)
  await page.mouse.up()
  await espera(900)
  const donde = await fetch(`${WEB}/api/tarjetas/${claveOrigen}`).then((x) => x.json())
  ok(donde.listaNombre === 'Por decidir', `arrastrar ${claveOrigen} de «En curso» a «Por decidir» después de usar el compositor anda (quedó en «${donde.listaNombre}»)`)

  ok(errores.length === 0, `sin errores en la consola${errores.length ? ': ' + errores.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

async function oscuro(browser) {
  console.log('\nEscritorio, tema oscuro')
  const { ctx, page, errores } = await nuevaPagina(browser, { tema: 'oscuro' })
  await foto(page, 'escritorio-oscuro-encabezado')
  await lista(page, 'Por hacer').locator('.lista__boton--mas').click()
  await page.waitForSelector('.alta')
  await espera(400)
  await page.locator('.alta__titulo').fill('Que se pueda cargar otra tarjeta sin cerrar')
  await page.locator('.alta__pildora[aria-label^="Prioridad"]').click()
  await page.locator('.selector__item', { hasText: 'Alta' }).first().click()
  await espera(300)
  await foto(page, 'escritorio-oscuro-compositor')
  ok(errores.length === 0, 'sin errores en la consola')
  await ctx.close()
}

async function celular(browser) {
  console.log('\nCelular (iPhone 15 emulado)')
  const { ctx, page, errores } = await nuevaPagina(browser, { movil: true })
  await page.locator('.pastilla-lista', { hasText: 'Por hacer' }).tap()
  await espera(900)
  const visible = page.locator('.lista[data-lista]', { has: page.locator('.lista__nombre', { hasText: /^Por hacer$/ }) })
  ok(await enPantalla(page, visible.locator('.lista__agregar')), 'con 64 tarjetas, «Agregar tarjeta» está siempre a la vista, pegado abajo')
  const medidas = await visible.locator('.lista__cabecera').evaluate((c) => {
    const m = (sel) => {
      const e = c.querySelector(sel)
      const antes = getComputedStyle(e, '::before')
      const r = e.getBoundingClientRect()
      const extra = Math.abs(parseFloat(antes.top) || 0)
      return { ancho: r.width + extra * 2, alto: r.height + extra * 2, centro: r.top + r.height / 2 }
    }
    return { mas: m('.lista__boton--mas'), menu: m('.lista__menu'), cuenta: m('.lista__cuenta'), nombre: m('.lista__nombre') }
  })
  ok(medidas.mas.ancho >= 44 && medidas.mas.alto >= 44 && medidas.menu.ancho >= 44 && medidas.menu.alto >= 44, `los botones del encabezado se tocan en 44 px o más (+: ${medidas.mas.ancho}×${medidas.mas.alto}, ⋯: ${medidas.menu.ancho}×${medidas.menu.alto})`)
  ok(Math.max(medidas.mas.centro, medidas.menu.centro, medidas.cuenta.centro, medidas.nombre.centro) - Math.min(medidas.mas.centro, medidas.menu.centro, medidas.cuenta.centro, medidas.nombre.centro) <= 1, 'el encabezado está alineado verticalmente')
  await foto(page, 'movil-claro-lista')

  // El «+» del encabezado abre la hoja con la lista elegida.
  await visible.locator('.lista__boton--mas').tap()
  await page.waitForSelector('.compositor-rapido textarea')
  await espera(800)
  ok((await page.locator('.compositor-rapido__lista-nombre').innerText()).includes('Por hacer'), 'el «+» del encabezado abre la hoja con «Por hacer» elegida')
  ok(await enPantalla(page, page.locator('.compositor-rapido__cuerpo')), 'la hoja entra entera en la pantalla')
  await page.keyboard.type(`Probar el alta desde el celular ${TOKEN} !alta #cocina`)
  await page.locator('.compositor-rapido__motivo').tap()
  await page.keyboard.type('Porque anotar rápido es el uso número uno.')
  await page.locator('.alta__pildora[aria-label^="Tipo"]').tap()
  await page.locator('.selector__item', { hasText: 'Idea' }).first().tap()
  await espera(600)
  await foto(page, 'movil-claro-compositor')
  const antes = await cantidad(page, 'Por hacer')
  await page.locator('.compositor-rapido__enviar').tap()
  await page.waitForFunction((n) => [...document.querySelectorAll('.lista')].find((l) => l.textContent.includes('Por hacer'))?.querySelector('.lista__cuenta')?.textContent === String(n), antes + 1, { timeout: 8000 })
  ok(true, 'la tarjeta se agrega desde la hoja')
  // Lo escrito en la hoja salió con tipo, prioridad, etiqueta y motivo.
  const tablero = await fetch(`${WEB}/api/proyectos`).then((x) => x.json())
  const tb = tablero.find((p) => p.prefijo === 'RC').tableros[0]
  const completo = await fetch(`${WEB}/api/tableros/${tb.id}`).then((x) => x.json())
  const creada = completo.tarjetas.find((x) => x.titulo === `Probar el alta desde el celular ${TOKEN}`)
  ok(Boolean(creada) && creada.tipo === 'idea' && creada.prioridad === 'alta' && creada.porque?.motivo?.startsWith('Porque anotar'), `salió con tipo «idea» (elegido gana al texto), prioridad «alta» y motivo (${creada?.tipo}, ${creada?.prioridad})`)
  ok(errores.length === 0, `sin errores en la consola${errores.length ? ': ' + errores.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

;(async () => {
  const browser = await chromium.launch()
  try {
    await escritorio(browser)
    await oscuro(browser)
    await celular(browser)
  } finally {
    await browser.close()
  }
  console.log(fallos ? `\n${fallos} comprobaciones fallaron.` : '\nTodo bien.')
  process.exit(fallos ? 1 : 0)
})()
