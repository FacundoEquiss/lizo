// Prueba de punta a punta de las listas de «Hecho» del Kanban (se ven las 20 más recientes, «Ver N anteriores», el archivo
// automático y su opción), con Playwright, contra un Telar LOCAL con datos descartables:
//
//   # 1) la base con 100 tarjetas en Hecho (recientes: ninguna se archiva sola con los 30 días de fábrica). El servidor apagado:
//   TABLERO_DATOS=/tmp/telar-hecho TABLERO_PUERTO=4600 TABLERO_SEMILLA_DISCORD=no npx tsx servidor/src/principal.ts --produccion   # una vez, y apagarlo
//   npx tsx scripts/sembrar-hecho.ts --datos /tmp/telar-hecho --modo recientes --cantidad 100
//   TABLERO_DATOS=/tmp/telar-hecho TABLERO_PUERTO=4600 TABLERO_SEMILLA_DISCORD=no npx tsx servidor/src/principal.ts --produccion
//   # 2) (opcional) otra base con tarjetas viejas, para ver el aviso de Telar, la actividad y Archivadas:
//   npx tsx scripts/sembrar-hecho.ts --datos /tmp/telar-hecho-viejas --modo viejas --cantidad 100   (y un servidor en 4602 con esa base)
//   NODE_PATH=$(npm root -g) node scripts/probar-kanban-hecho.cjs --web http://127.0.0.1:4600 [--web-viejas http://127.0.0.1:4602] [--capturas docs/capturas/kanban-hecho]
//
// Comprueba (y falla con un mensaje claro si algo no anda): con 100 tarjetas en Hecho se ven 20 (las más nuevas, de la más nueva a la más
// vieja), el contador del encabezado dice 100, «Ver N anteriores» suma de a 20 en el lugar y desaparece al llegar al final, el pie
// «Agregar tarjeta» queda a la vista, con un filtro se filtra sobre todas (no solo las visibles), arrastrar una tarjeta a Hecho la
// deja arriba (y sacarla la devuelve), «Agregar tarjeta» en Hecho la deja arriba, el atajo «.» la deja arriba, la opción «Archivo
// de Hecho» (de fábrica 30 días) se cambia y se guarda, lo mismo en el celular (con toques reales) y la consola queda limpia.
// Con --web-viejas: Telar archivó solo lo viejo, avisa una vez en la campana, queda en la actividad como «Telar» y en Archivadas,
// y se restaura con un toque. Escribe tarjetas en el Telar local: nunca contra producción.
const path = require('node:path')
const fs = require('node:fs')
const { chromium, devices } = require('playwright')

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : args[i + 1]
}
const WEB = opcion('web', 'http://127.0.0.1:4600')
const WEB_VIEJAS = opcion('web-viejas', '')
const CAPTURAS = opcion('capturas', '')
const SOLO = opcion('solo', '')
for (const u of [WEB, WEB_VIEJAS].filter(Boolean)) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) {
    console.error('Solo contra un Telar local.')
    process.exit(1)
  }
}
if (CAPTURAS) fs.mkdirSync(path.resolve(CAPTURAS), { recursive: true })

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let fallos = 0
const ok = (cond, texto) => {
  console.log(`${cond ? '  ok ' : '  MAL'}  ${texto}`)
  if (!cond) fallos++
}
const foto = async (page, nombre) => {
  if (CAPTURAS) await page.screenshot({ path: path.resolve(CAPTURAS, `${nombre}.png`) })
}
const get = (base, ruta) => fetch(base + ruta).then((r) => r.json())
const post = (base, ruta, cuerpo) =>
  fetch(base + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }).then((r) => r.json())

async function tableroDe(base) {
  const proyectos = await get(base, '/api/proyectos')
  const tb = proyectos.find((p) => p.prefijo === 'RC').tableros[0]
  return { id: tb.id, ...(await get(base, `/api/tableros/${tb.id}`)) }
}
const llegada = (t) => t.fechas.completada ?? t.actualizadaEn
/** Las claves de Hecho, de la tarjeta que llegó último a la que llegó primero. */
const clavesDeHecho = (tb) => {
  const hecho = tb.listas.find((l) => l.categoria === 'hecho').id
  return tb.tarjetas
    .filter((t) => t.listaId === hecho && !t.archivada)
    .sort((a, b) => (llegada(a) < llegada(b) ? 1 : llegada(a) > llegada(b) ? -1 : 0))
    .map((t) => t.clave)
}

async function nuevaPagina(browser, base, { tema = 'claro', movil = false } = {}) {
  const dispositivo = movil ? { ...devices['iPhone 15'] } : { viewport: { width: 1440, height: 900 } }
  const ctx = await browser.newContext({ ...dispositivo, deviceScaleFactor: movil ? 3 : 2, colorScheme: tema === 'oscuro' ? 'dark' : 'light', locale: 'es-AR' })
  await ctx.addInitScript((t) => {
    localStorage.setItem('tablero.tema', t)
    localStorage.setItem('telar.instalar.visto', String(Date.now()))
  }, tema)
  const page = await ctx.newPage()
  const errores = []
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()))
  page.on('pageerror', (e) => errores.push(String(e.message)))
  await page.goto(`${base}/RC/pendientes`)
  await page.waitForSelector('.lista .tarjeta')
  await espera(900)
  return { ctx, page, errores }
}

const lista = (page, nombre) => page.locator('.lista[data-lista]', { has: page.locator('.lista__nombre', { hasText: new RegExp(`^${nombre}$`) }) })
const clavesVistas = (page, nombre) => lista(page, nombre).locator('.ordenable .tarjeta__clave').allInnerTexts().then((x) => x.map((s) => s.trim()))
const cuenta = (page, nombre) => lista(page, nombre).locator('.lista__cuenta').first().innerText().then((t) => t.trim())
const enPantalla = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && r.height > 0
  })
const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

/** Arrastra con el mouse del centro de `origen` al de `destino` (con el movimiento en pasos, como una mano). */
async function arrastrar(page, origen, destino, { abajo = 60 } = {}) {
  await origen.scrollIntoViewIfNeeded()
  const a = await origen.boundingBox()
  const d = await destino.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + 20)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 30, { steps: 4 })
  await page.mouse.move(d.x + d.width / 2, d.y + abajo, { steps: 16 })
  await espera(350)
  await page.mouse.up()
  await espera(1000)
}

/** Deja en «Por hacer» y «En curso» unas tarjetas para arrastrar (y las junta en `tarjetas`). */
async function prepararOrigenes(base, tb) {
  const l = (n) => tb.listas.find((x) => x.nombre === n).id
  const sufijo = Date.now().toString(36).slice(-4)
  const hechas = []
  for (const [lid, nombre] of [[l('En curso'), 'En curso'], [l('En curso'), 'En curso'], [l('Por hacer'), 'Por hacer']]) {
    hechas.push(await post(base, '/api/tarjetas', { tableroId: tb.id, listaId: lid, titulo: `De ${nombre} para mover ${sufijo}` }))
  }
  return hechas
}

// ───────────────────────── escritorio ─────────────────────────

async function escritorio(browser, tema) {
  console.log(`\nEscritorio 1440 × 900, tema ${tema}`)
  const tb0 = await tableroDe(WEB)
  const inicial = await prepararOrigenes(WEB, tb0)
  const { ctx, page, errores } = await nuevaPagina(browser, WEB, { tema })
  const tb = await tableroDe(WEB)
  const hecho = lista(page, 'Hecho')
  await page.locator('.kanban__lienzo').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await espera(400)

  // 1 · Se ven las 20 más recientes, en orden, y el contador dice el total real.
  const total = clavesDeHecho(tb).length
  ok(total >= 100, `la base tiene ${total} tarjetas en Hecho`)
  const vistas = await clavesVistas(page, 'Hecho')
  ok(vistas.length === 20, `en Hecho se ven 20 tarjetas (se ven ${vistas.length})`)
  ok(igual(vistas, clavesDeHecho(tb).slice(0, 20)), 'son las 20 más recientes, de la que llegó último a la que llegó antes')
  ok((await cuenta(page, 'Hecho')) === String(total), `el contador del encabezado dice el total real (${total})`)
  const boton = hecho.locator('.lista__anteriores')
  ok((await boton.innerText()).replace(/\s+/g, ' ').trim() === `Ver ${total - 20} anteriores`, `al pie dice «Ver ${total - 20} anteriores»`)
  ok(await enPantalla(hecho.locator('.lista__pie')), 'el pie «Agregar tarjeta» sigue a la vista')
  await foto(page, `escritorio-${tema}-hecho-20`)

  // 2 · «Ver N anteriores» suma de a 20 en el lugar.
  await boton.scrollIntoViewIfNeeded()
  await foto(page, `escritorio-${tema}-hecho-ver-anteriores`)
  const urlAntes = page.url()
  await boton.click()
  await espera(300)
  ok((await clavesVistas(page, 'Hecho')).length === 40, 'un toque en «Ver N anteriores» muestra 20 más (40)')
  ok(igual(await clavesVistas(page, 'Hecho'), clavesDeHecho(tb).slice(0, 40)), 'y siguen en orden')
  ok(page.url() === urlAntes, 'sin cambiar de pantalla')
  ok((await cuenta(page, 'Hecho')) === String(total), 'el contador sigue diciendo el total')
  ok((await hecho.locator('.lista__anteriores').innerText()).includes(`Ver ${total - 40} anteriores`), `ahora dice «Ver ${total - 40} anteriores»`)
  ok(await enPantalla(hecho.locator('.lista__pie')), 'el pie fijo sigue a la vista')
  for (let i = 0; i < 6 && (await hecho.locator('.lista__anteriores').count()); i++) {
    await hecho.locator('.lista__anteriores').click()
    await espera(200)
  }
  ok((await clavesVistas(page, 'Hecho')).length === total, `al seguir, se ven las ${total} y el botón desaparece`)
  ok((await hecho.locator('.lista__anteriores').count()) === 0, 'sin tarjetas por mostrar, no hay botón')
  await hecho.locator('.lista__tarjetas').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await foto(page, `escritorio-${tema}-hecho-todas`)
  await hecho.locator('.lista__tarjetas').evaluate((el) => (el.scrollTop = 0))

  // 3 · Con un filtro se filtra sobre todas, no solo sobre las visibles.
  await page.reload()
  await page.waitForSelector('.lista .tarjeta')
  await page.locator('.kanban__lienzo').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await espera(500)
  const ultima = clavesDeHecho(tb).at(-1)
  const tUltima = tb.tarjetas.find((t) => t.clave === ultima)
  const numero = /\((\d+)\)$/.exec(tUltima.titulo)?.[1]
  const filtro = page.locator('input[placeholder^="Filtrar"]')
  await filtro.fill(`(${numero})`)
  await espera(500)
  ok((await clavesVistas(page, 'Hecho')).includes(ultima), `buscar «(${numero})» encuentra la tarjeta más vieja de Hecho (${ultima}), que no estaba entre las 20 visibles`)
  ok((await cuenta(page, 'Hecho')).endsWith(`/${total}`), `el contador muestra coincidencias sobre el total (${await cuenta(page, 'Hecho')})`)
  await foto(page, `escritorio-${tema}-hecho-filtrada`)
  await filtro.fill('ar')
  await espera(500)
  const coinc = Number((await cuenta(page, 'Hecho')).split('/')[0])
  const verAr = (await clavesVistas(page, 'Hecho')).length
  ok(verAr === Math.min(20, coinc), `con un filtro que coincide con ${coinc}, se ven ${verAr} (máximo 20)`)
  if (coinc > 20) ok((await hecho.locator('.lista__anteriores').innerText()).includes(`Ver ${coinc - 20} anteriores`), `y «Ver ${coinc - 20} anteriores» cuenta las que coinciden`)
  await filtro.fill('')
  await espera(300)

  // 4 · Arrastrar a Hecho la deja arriba; sacarla de Hecho la devuelve.
  const ordenable = (nombre, n) => lista(page, nombre).locator('.ordenable').nth(n)
  const deEnCurso = (await ordenable('En curso', 0).locator('.tarjeta__clave').innerText()).trim()
  await arrastrar(page, ordenable('En curso', 0), hecho.locator('.lista__tarjetas'))
  const tras = await tableroDe(WEB)
  const t1 = tras.tarjetas.find((t) => t.clave === deEnCurso)
  ok(t1.listaId === tb.listas.find((l) => l.categoria === 'hecho').id, `arrastrar ${deEnCurso} a Hecho la deja en Hecho`)
  ok(Date.now() - new Date(t1.fechas.completada).getTime() < 60_000, 'con la fecha de ahora (completada)')
  ok((await clavesVistas(page, 'Hecho'))[0] === deEnCurso, 'y queda arriba de todo en la pantalla')
  ok((await cuenta(page, 'Hecho')) === String(total + 1), `el contador subió a ${total + 1}`)
  await page.reload()
  await page.waitForSelector('.lista .tarjeta')
  await page.locator('.kanban__lienzo').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await espera(500)
  ok((await clavesVistas(page, 'Hecho'))[0] === deEnCurso, 'al recargar sigue arriba de todo')
  ok((await clavesVistas(page, 'Hecho')).length === 20, 'y siguen viéndose 20')
  await foto(page, `escritorio-${tema}-hecho-recien-llegada`)

  // 5 · Sacar una de Hecho a «En curso».
  await arrastrar(page, ordenable('Hecho', 1), lista(page, 'En curso').locator('.lista__tarjetas'))
  const sacada = (await get(WEB, `/api/tableros/${tb.id}`)).tarjetas.filter((t) => t.listaId === tb.listas.find((l) => l.nombre === 'En curso').id && t.fechas.completada === null).length
  ok(sacada >= 1, 'sacar una tarjeta de Hecho a «En curso» la deja sin completar')
  ok((await cuenta(page, 'Hecho')) === String(total), `el contador de Hecho vuelve a ${total}`)

  // 6 · «Agregar tarjeta» en Hecho: la nueva queda arriba.
  const titulo = `Nueva en Hecho ${Date.now().toString(36).slice(-4)}`
  await hecho.locator('.lista__agregar').click()
  await page.locator('.lista[data-lista] .alta textarea').first().fill(titulo)
  await page.keyboard.press('Enter')
  await espera(1200)
  const primera = hecho.locator('.ordenable').first()
  ok((await primera.getAttribute('aria-label')).includes(titulo), '«Agregar tarjeta» en Hecho deja la nueva arriba de todo')
  ok((await cuenta(page, 'Hecho')) === String(total + 1), 'y suma al contador')
  await page.keyboard.press('Escape')
  await foto(page, `escritorio-${tema}-hecho-agregada`)

  // 7 · El atajo «.» (mover a la lista de al lado) la deja arriba.
  const aMover = lista(page, 'En curso').locator('.ordenable').first()
  const claveMover = (await aMover.locator('.tarjeta__clave').innerText()).trim()
  await aMover.hover()
  await page.keyboard.press('.')
  await espera(1000)
  ok((await clavesVistas(page, 'Hecho'))[0] === claveMover, `el atajo «.» mueve ${claveMover} a Hecho y queda arriba`)

  // 8 · La opción «Archivo de Hecho»: desde el menú de la lista y desde el menú del tablero.
  await hecho.locator('.lista__menu').click()
  await page.getByRole('menuitem', { name: /Archivo de Hecho/ }).click()
  await page.waitForSelector('.dialogo--archivo-hecho')
  await espera(400)
  ok((await page.locator('.dialogo--archivo-hecho [role=radio][aria-checked=true]').innerText()).trim() === '30', 'de fábrica la opción dice 30 días')
  ok((await page.locator('.archivo-hecho__frase').innerText()).includes('más de 30 días en Hecho se archivan solas'), 'la frase explica qué hace')
  await foto(page, `escritorio-${tema}-opcion-archivo`)
  await page.locator('.dialogo--archivo-hecho [role=radio]', { hasText: 'Nunca' }).click()
  await espera(500)
  ok((await page.locator('.archivo-hecho__frase').innerText()).includes('hasta que las archives vos'), '«Nunca» cambia la frase')
  let aj = (await tableroDe(WEB)).tablero.ajustes
  ok(aj.archivoHecho && aj.archivoHecho.dias === null, 'y se guarda en los ajustes del tablero (dias: null)')
  await page.locator('.dialogo--archivo-hecho [role=radio]', { hasText: /^60$/ }).click()
  await espera(500)
  aj = (await tableroDe(WEB)).tablero.ajustes
  ok(aj.archivoHecho.dias === 60, 'elegir 60 se guarda')
  await page.locator('.dialogo--archivo-hecho [role=radio]', { hasText: /^30$/ }).click()
  await espera(500)
  aj = (await tableroDe(WEB)).tablero.ajustes
  ok(aj.archivoHecho.dias === 30, 'volver a 30 se guarda')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.dialogo--archivo-hecho', { state: 'detached' })
  // Menú del tablero en la barra lateral.
  const fila = page.locator('.tablero-item', { hasText: 'Pendientes' }).first()
  await fila.hover()
  await fila.locator('.tablero-item__mas').click()
  await page.getByRole('menuitem', { name: /Archivo de Hecho/ }).click()
  await page.waitForSelector('.archivo-hecho')
  await espera(400)
  ok((await page.locator('.ventanita .archivo-hecho').count()) === 1, 'el menú del tablero también tiene «Archivo de Hecho…» y abre la ventanita')
  await foto(page, `escritorio-${tema}-opcion-archivo-menu-tablero`)
  await page.keyboard.press('Escape')

  ok(errores.length === 0, `sin errores en la consola${errores.length ? ': ' + errores.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
  return inicial
}

// ───────────────────────── celular ─────────────────────────

async function celular(browser, tema) {
  console.log(`\nCelular (iPhone 15 emulado), tema ${tema}`)
  const { ctx, page, errores } = await nuevaPagina(browser, WEB, { tema, movil: true })
  const cdp = await ctx.newCDPSession(page)
  const toque = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] })
  const tb = await tableroDe(WEB)
  const total = clavesDeHecho(tb).length

  await page.locator('.pastilla-lista', { hasText: 'Hecho' }).tap()
  await espera(1000)
  const hecho = lista(page, 'Hecho')
  const vistas = await clavesVistas(page, 'Hecho')
  ok(vistas.length === 20, `en el celular también se ven 20 de Hecho (${vistas.length})`)
  ok(igual(vistas, clavesDeHecho(tb).slice(0, 20)), 'las 20 más recientes, en orden')
  ok((await cuenta(page, 'Hecho')) === String(total), `el contador dice el total real (${total})`)
  ok(await enPantalla(hecho.locator('.lista__agregar')), 'el pie «Agregar tarjeta» está a la vista, pegado abajo')
  const pastilla = await page.locator('.pastilla-lista', { hasText: 'Hecho' }).innerText()
  ok(pastilla.replace(/\s+/g, ' ').includes(String(total)), 'la tira de listas dice el total de Hecho')
  await foto(page, `movil-${tema}-hecho-20`)

  const boton = hecho.locator('.lista__anteriores')
  await boton.scrollIntoViewIfNeeded()
  const caja = await boton.boundingBox()
  ok(caja.height >= 44 && caja.width >= 44, `«Ver N anteriores» se toca en 44 px o más (${Math.round(caja.width)}×${Math.round(caja.height)})`)
  await foto(page, `movil-${tema}-hecho-ver-anteriores`)
  await boton.tap()
  await espera(400)
  ok((await clavesVistas(page, 'Hecho')).length === 40, 'un toque muestra 20 más (40)')
  ok(await enPantalla(hecho.locator('.lista__agregar')), 'el pie sigue a la vista')
  await foto(page, `movil-${tema}-hecho-40`)

  // «Agregar tarjeta» desde la hoja del celular.
  const titulo = `Desde el celular en Hecho ${Date.now().toString(36).slice(-4)}`
  await hecho.locator('.lista__agregar').tap()
  await page.waitForSelector('.compositor-rapido textarea')
  await espera(700)
  ok((await page.locator('.compositor-rapido__lista-nombre').innerText()).includes('Hecho'), 'la hoja de agregar abre con «Hecho» elegida')
  await page.keyboard.type(titulo)
  await page.locator('.compositor-rapido__enviar').tap()
  await espera(1500)
  await page.keyboard.press('Escape')
  await page.locator('.hoja-inferior__velo').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  await espera(600)
  await hecho.locator('.lista__tarjetas').evaluate((el) => (el.scrollTop = 0))
  await espera(300)
  const primera = hecho.locator('.ordenable').first()
  ok((await primera.getAttribute('aria-label')).includes(titulo), 'lo agregado desde el celular queda arriba de Hecho')

  // Arrastre con el dedo (toques reales): de «En curso» a la pastilla de Hecho.
  await page.locator('.pastilla-lista', { hasText: 'En curso' }).tap()
  await espera(1000)
  const enCurso = lista(page, 'En curso')
  const tarjeta = enCurso.locator('.ordenable').first()
  const clave = (await tarjeta.locator('.tarjeta__clave').innerText()).trim()
  const b = await tarjeta.boundingBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await toque('touchStart', x, y)
  await espera(340)
  for (let i = 1; i <= 6; i++) {
    await toque('touchMove', x + (24 * i) / 6, y + (40 * i) / 6)
    await espera(25)
  }
  const p = await page.locator('.pastilla-lista', { hasText: 'Hecho' }).boundingBox()
  for (let i = 1; i <= 14; i++) {
    await toque('touchMove', x + 24 + ((p.x + p.width / 2 - x - 24) * i) / 14, y + 40 + ((p.y + p.height / 2 - y - 40) * i) / 14)
    await espera(25)
  }
  await espera(450)
  await foto(page, `movil-${tema}-arrastre-a-hecho`)
  await toque('touchEnd', 0, 0)
  await espera(2000)
  const tras = await tableroDe(WEB)
  const mov = tras.tarjetas.find((t) => t.clave === clave)
  ok(mov.listaId === tb.listas.find((l) => l.categoria === 'hecho').id && Date.now() - new Date(mov.fechas.completada).getTime() < 90_000, `arrastrar ${clave} con el dedo a Hecho la deja en Hecho con la fecha de ahora`)
  await page.locator('.pastilla-lista', { hasText: 'Hecho' }).tap()
  await espera(900)
  ok((await clavesVistas(page, 'Hecho'))[0] === clave, 'y queda arriba de todo')

  // La opción, desde el menú de la lista (⋯) y desde «Proyectos y tableros».
  await lista(page, 'Hecho').locator('.lista__menu').tap()
  await page.getByRole('menuitem', { name: /Archivo de Hecho/ }).tap()
  await page.waitForSelector('.archivo-hecho--hoja')
  await espera(700)
  ok((await page.locator('.hoja-inferior [role=radio][aria-checked=true]').innerText()).trim() === '30', 'la hoja de la opción dice 30 días')
  const radios = await page.locator('.hoja-inferior .segmentado__opcion').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  ok(radios.every((h) => h >= 44), `las opciones se tocan en 44 px o más (${radios.join(', ')})`)
  await foto(page, `movil-${tema}-opcion-archivo`)
  await page.locator('.hoja-inferior [role=radio]', { hasText: 'Nunca' }).tap()
  await espera(500)
  ok((await tableroDe(WEB)).tablero.ajustes.archivoHecho?.dias === null, 'elegir «Nunca» se guarda')
  await page.locator('.hoja-inferior [role=radio]', { hasText: /^30$/ }).tap()
  await espera(500)
  ok((await tableroDe(WEB)).tablero.ajustes.archivoHecho?.dias === 30, 'volver a 30 se guarda')
  await page.keyboard.press('Escape')
  await espera(500)

  // Controles táctiles de menos de 44 px en lo nuevo.
  const chicos = await page.evaluate(() =>
    [...document.querySelectorAll('.lista__anteriores, .archivo-hecho .segmentado__opcion')]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44))
      .length,
  )
  ok(chicos === 0, 'ningún control nuevo mide menos de 44 px')
  ok(errores.length === 0, `sin errores en la consola${errores.length ? ': ' + errores.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

// ───────────────────────── lo que hizo Telar solo ─────────────────────────

async function viejas(browser, tema, movil) {
  console.log(`\nLo archivado solo por Telar, ${movil ? 'celular' : 'escritorio'}, tema ${tema}`)
  const { ctx, page, errores } = await nuevaPagina(browser, WEB_VIEJAS, { tema, movil })
  const tb = await tableroDe(WEB_VIEJAS)
  const hechas = clavesDeHecho(tb)
  ok(hechas.length >= 40 && hechas.length <= 50, `al abrir, Telar ya archivó lo de hace más de 30 días: quedan ${hechas.length} en Hecho (las recientes y las que no se archivan)`)
  const archivadas = await get(WEB_VIEJAS, `/api/tableros/${tb.id}/archivadas`)
  ok(archivadas.length >= 55, `hay ${archivadas.length} en Archivadas`)
  ok(hechas.some((c) => /checklist sin terminar/.test(tb.tarjetas.find((t) => t.clave === c).titulo)) && hechas.some((c) => /bloquea a una/.test(tb.tarjetas.find((t) => t.clave === c).titulo)), 'la de la checklist sin terminar y la que bloquea a otra abierta se quedaron')
  const act = await get(WEB_VIEJAS, `/api/tableros/${tb.id}/actividad`)
  const a = act.find((x) => x.accion === 'tablero.archivo_hecho')
  ok(a && a.actor.nombre === 'Telar' && /^archivó \d+ tarjetas de Hecho de hace más de 30 días$/.test(a.resumen), `la actividad dice «Telar ${a?.resumen}»`)
  const notis = await get(WEB_VIEJAS, '/api/notificaciones')
  const avisos = notis.filter((n) => n.tipo === 'aviso')
  ok(avisos.length === 1 && /^Telar archivó \d+ tarjetas de Hecho de hace más de 30 días$/.test(avisos[0].titulo) && /Archivadas y se restauran con un toque/.test(avisos[0].cuerpo), 'un solo aviso en la campana, con el texto pedido')
  // Abrir de nuevo no repite el aviso ni la actividad.
  await page.reload()
  await page.waitForSelector('.lista .tarjeta')
  await espera(700)
  ok((await get(WEB_VIEJAS, '/api/notificaciones')).filter((n) => n.tipo === 'aviso').length === 1, 'al abrir otra vez el aviso no se repite')
  ok((await get(WEB_VIEJAS, `/api/tableros/${tb.id}/actividad`)).filter((x) => x.accion === 'tablero.archivo_hecho').length === 1, 'ni la actividad')

  if (movil) {
    await page.locator('.pastilla-lista', { hasText: 'Hecho' }).tap()
    await espera(800)
  } else await page.locator('.kanban__lienzo').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await foto(page, `${movil ? 'movil' : 'escritorio'}-${tema}-archivo-automatico-kanban`)

  // La campana.
  if (movil) {
    await page.locator('[aria-label*="Notificaciones"], [aria-label*="notificaciones"]').first().tap()
  } else {
    await page.locator('[aria-label*="Notificaciones"], [aria-label*="notificaciones"]').first().click()
  }
  await espera(900)
  const textoCampana = await page.locator('.fila-notif').first().innerText().catch(() => '')
  ok(/Telar archivó \d+ tarjetas de Hecho de hace más de 30 días/.test(textoCampana), `la campana muestra el aviso («${textoCampana.replace(/\s+/g, ' ').slice(0, 90)}»)`)
  await foto(page, `${movil ? 'movil' : 'escritorio'}-${tema}-archivo-automatico-campana`)
  await page.keyboard.press('Escape')
  await espera(400)

  // La actividad (escritorio: el panel; celular: menú ⋮).
  if (!movil) {
    await page.locator('button[aria-label="Actividad"], [data-tip="Actividad"]').first().click()
    await espera(800)
    const txt = await page.locator('.actividad__item', { hasText: 'archivó' }).filter({ hasText: 'de Hecho de hace más de' }).first().innerText()
    ok(/Telar/.test(txt) && /archivó \d+ tarjetas de Hecho/.test(txt), 'el panel de actividad lo firma «Telar»')
    await foto(page, `escritorio-${tema}-archivo-automatico-actividad`)
    await page.keyboard.press('Escape')
    await espera(300)
    // Archivadas y restaurar con un toque.
    await page.locator('button[aria-label="Tarjetas archivadas"]').click()
    await espera(900)
    await foto(page, `escritorio-${tema}-archivo-automatico-archivadas`)
    const primeraArch = page.locator('li.archivada').first()
    const hay = await primeraArch.count()
    ok(hay > 0, 'las tarjetas archivadas por Telar aparecen en Archivadas')
    if (hay) {
      const clave = (await primeraArch.locator('.mono').first().innerText()).trim()
      await primeraArch.getByRole('button', { name: /Restaurar/ }).first().click()
      await espera(1500)
      const tras = await tableroDe(WEB_VIEJAS)
      const t = tras.tarjetas.find((x) => x.clave === clave)
      ok(t && !t.archivada, `restaurar ${clave} con un toque la devuelve al tablero`)
      ok(t && Date.now() - new Date(t.fechas.completada).getTime() < 120_000, 'llega a Hecho «ahora» (no se vuelve a archivar sola)')
      await page.reload()
      await page.waitForSelector('.lista .tarjeta')
      await espera(800)
      ok(!(await get(WEB_VIEJAS, `/api/tableros/${tb.id}`)).tarjetas.find((x) => x.clave === clave)?.archivada, 'y después de abrir el tablero sigue en Hecho')
    }
  }
  ok(errores.length === 0, `sin errores en la consola${errores.length ? ': ' + errores.slice(0, 3).join(' | ') : ''}`)
  await ctx.close()
}

;(async () => {
  const browser = await chromium.launch()
  try {
    if (!SOLO || SOLO === 'pc-claro') await escritorio(browser, 'claro')
    if (!SOLO || SOLO === 'pc-oscuro') await escritorio(browser, 'oscuro')
    if (!SOLO || SOLO === 'movil-claro') await celular(browser, 'claro')
    if (!SOLO || SOLO === 'movil-oscuro') await celular(browser, 'oscuro')
    if (WEB_VIEJAS && (!SOLO || SOLO === 'viejas')) {
      await viejas(browser, 'claro', false)
      await viejas(browser, 'oscuro', true)
    }
  } finally {
    await browser.close()
  }
  console.log(fallos ? `\n${fallos} comprobaciones fallaron.` : '\nTodo bien.')
  process.exit(fallos ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
