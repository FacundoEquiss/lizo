// Recorrido de la interfaz de la IA integrada, fase 1 (docs/plan-ia-integrada.md, 15.6), con Playwright, SOLO contra un Telar local:
//   escribir @cl → la lista (PC) o la barra de chips (celular) → elegir → enviar → la mención se ve como pastilla → una IA
//   responde por MCP → la campana marca +1 → abrir la bandeja (o la hoja) → tocar → abre la tarjeta y queda leída →
//   «Responder» y la cita → solo con teclado → los estados de la campana → Configuración → Notificaciones y el alias.
// En PC (1440 × 900) y en celular emulado (iPhone 15 y Pixel 8, con el teclado de Android emulado al escribir), en claro y en
// oscuro. Falla con un mensaje claro si algo no anda (y sale con código 1); la consola tiene que quedar limpia.
//
// Dos maneras de correrlo:
//   A) Contra el servidor de mentira (hasta que el servidor real tenga las rutas de la F1; ver scripts/ia-servidor-falso.ts):
//        TABLERO_DATOS=/tmp/telar-ia TABLERO_PUERTO=4338 TABLERO_PUERTO_WEB=4337 TABLERO_SEMILLA_DISCORD=no npm run dev:servidor
//        node scripts/sembrar-kanban.mjs --url http://127.0.0.1:4338
//        npx tsx scripts/ia-servidor-falso.ts --real http://127.0.0.1:4338 --puerto 4348
//        TABLERO_PUERTO=4348 TABLERO_PUERTO_WEB=4337 npm run dev:web
//        NODE_PATH=$(npm root -g) node scripts/probar-ia-ui.cjs --web http://127.0.0.1:4337 --falso http://127.0.0.1:4348
//      Además de lo común, prueba los estados que solo el de mentira puede provocar (cargando, error, vacío, servidor sin las
//      rutas, «Ver más» con 70 notificaciones, error al marcar como leída).
//   B) Contra un Telar real con la F1 del servidor (menciones y notificaciones de verdad):
//        npm run dev     (en otra terminal; TABLERO_DATOS descartable)  y  node scripts/sembrar-kanban.mjs
//        TELAR_IA_REAL=1 NODE_PATH=$(npm root -g) node scripts/probar-ia-ui.cjs --web http://127.0.0.1:4317
//      Acá la notificación sale de verdad del servidor cuando «Claude» (por MCP) contesta una mención.
// Opciones: --capturas docs/capturas/ia-f1 (guarda las capturas) · --solo=pc-claro,iphone15-oscuro (qué combinaciones) ·
//   --antes http://127.0.0.1:4327 (solo las capturas de «antes» de la tarjeta, con una web vieja) · --prefijo despues|antes.
// Escribe comentarios en las tarjetas RC-2 y RC-3 del Telar local y cambia sus preferencias de notificaciones (las restaura).
// Nunca apunta a producción: se niega si una dirección no es 127.0.0.1 o localhost. No imprime la clave del MCP.
const path = require('node:path')
const fs = require('node:fs')
const { chromium, devices } = require('playwright')

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.find((a) => a.startsWith(`--${n}=`))
  if (i) return i.slice(n.length + 3)
  const j = args.indexOf(`--${n}`)
  return j === -1 ? d : args[j + 1]
}
const WEB = opcion('web', 'http://127.0.0.1:4337')
const FALSO = opcion('falso', '')
const CAPTURAS = opcion('capturas', '')
const ANTES = opcion('antes', '')
const SOLO = opcion('solo', '')
const REAL = process.env.TELAR_IA_REAL === '1'
const PREFIJO = opcion('prefijo', ANTES ? 'antes' : 'despues')
for (const u of [WEB, FALSO, ANTES].filter(Boolean)) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) {
    console.error('Solo contra un Telar local (127.0.0.1 o localhost).')
    process.exit(1)
  }
}
if (!REAL && !FALSO && !ANTES) {
  console.error('Falta --falso <dirección del servidor de mentira> (o TELAR_IA_REAL=1 contra un Telar con la F1 del servidor).')
  process.exit(1)
}
const SALIDA = CAPTURAS ? path.resolve(CAPTURAS) : ''
if (SALIDA) fs.mkdirSync(SALIDA, { recursive: true })

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let fallos = 0
const ok = (cond, texto, detalle) => {
  console.log(`  ${cond ? 'ok ' : 'MAL'}  ${texto}${!cond && detalle !== undefined ? `\n        ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}` : ''}`)
  if (!cond) fallos++
  return cond
}
// Un texto distinto en cada corrida: los comentarios quedan en el Telar local.
const TOKEN = Date.now().toString(36).slice(-5)

// ───────────────────────── Dispositivos ─────────────────────────
const DISPOSITIVOS = {
  pc: { nombre: 'PC 1440 × 900', contexto: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, movil: false },
  iphone15: { nombre: 'iPhone 15', contexto: { ...devices['iPhone 15'], deviceScaleFactor: 2 }, movil: true, teclado: 336 },
  pixel8: { nombre: 'Pixel 8', contexto: { ...devices['Pixel 8'], deviceScaleFactor: 2 }, movil: true, teclado: 300 },
}
const COMBINACIONES = [
  ['pc', 'claro'],
  ['pc', 'oscuro'],
  ['iphone15', 'claro'],
  ['iphone15', 'oscuro'],
  ['pixel8', 'claro'],
  ['pixel8', 'oscuro'],
].filter(([d, t]) => !SOLO || SOLO.split(',').includes(`${d}-${t}`) || SOLO.split(',').includes(d))

// ───────────────────────── Contra el servidor de mentira ─────────────────────────
const falso = async (ruta, cuerpo) => {
  if (!FALSO) return null
  const r = await fetch(`${FALSO}/__falso/${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}) })
  return r.json()
}

// ───────────────────────── Una IA por MCP ─────────────────────────
let mcp = null
async function conectarMcp() {
  if (mcp) return mcp
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const info = await fetch(`${WEB}/api/info`).then((r) => r.json())
  const url = new URL(info.urlMcp)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('El MCP de ese Telar no es local: no sigo.')
  const cliente = new Client({ name: 'probar-ia-ui', version: '1.0.0' })
  await cliente.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${info.clave}`, 'x-tablero-autor': 'Claude' } } }))
  mcp = cliente
  return cliente
}
/** «Claude» (una IA de afuera) comenta una tarjeta por MCP, como lo hace Claude Code. */
async function claudeComenta(tarjeta, texto) {
  const c = await conectarMcp()
  const r = await c.callTool({ name: 'comentar', arguments: { tarjeta, texto } })
  if (r.isError) throw new Error(`comentar: ${r.content?.map((x) => x.text ?? '').join('')}`)
}

/** Deja en RC-3 dos comentarios fijos (uno mío, uno de Claude) para las capturas de antes y después. */
async function prepararDatos() {
  const tarjeta = await fetch(`${WEB}/api/tarjetas/RC-3`).then((r) => r.json())
  const ya = (t) => tarjeta.comentarios?.some((c) => c.cuerpo.startsWith(t))
  if (!ya('Esto lo hablamos con la cocina')) {
    await fetch(`${WEB}/api/tarjetas/RC-3/comentarios`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cuerpo: 'Esto lo hablamos con la cocina: conviene probarlo con 30 clientes antes de cambiar nada.' }) })
  }
  if (!ya('**Revisado:**')) await claudeComenta('RC-3', '**Revisado:** con 30 clientes la cola de la cocina no se traba. Dejo el detalle en el porqué.')
}

// ───────────────────────── Páginas ─────────────────────────
async function nueva(browser, clave, tema, base = WEB) {
  const d = DISPOSITIVOS[clave]
  const ctx = await browser.newContext({ ...d.contexto, colorScheme: tema === 'oscuro' ? 'dark' : 'light' })
  await ctx.addInitScript((t) => localStorage.setItem('tablero.tema', t), tema)
  const page = await ctx.newPage()
  const errores = []
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()))
  page.on('pageerror', (e) => errores.push(String(e.message)))
  return { ctx, page, errores, d, base }
}
const ir = async (p, ruta, selector) => {
  await p.page.goto(`${p.base}${ruta}`)
  await p.page.waitForSelector(selector ?? '.lista .tarjeta', { timeout: 20000 })
  await espera(600)
}
const foto = async (p, nombre, tema, opciones = {}) => {
  if (!SALIDA) return
  // Los avisos de «Claude comentó en…» tapan lo que se quiere ver: se cierran antes de sacar la captura.
  await p.page.evaluate(() => document.querySelectorAll('.aviso__cerrar').forEach((b) => b.click()))
  await espera(200)
  await p.page.screenshot({ path: path.join(SALIDA, `${PREFIJO}-${nombre}-${p.clave}-${tema}.png`), ...opciones })
}
const contador = async (page) => {
  const t = await page.locator('.campana__numero').first().innerText({ timeout: 800 }).catch(() => '')
  return t === '9+' ? 10 : Number(t) || 0
}
/** Cierra la tarjeta de escritorio con su botón (Esc no cierra mientras se escribe en un campo). */
async function cerrarTarjeta(page) {
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.locator('.comentar__caja textarea').waitFor({ state: 'detached' })
  await espera(300)
}
const enfocadoEs = (page, selector) => page.evaluate((s) => !!document.activeElement?.matches(s), selector)
/** Achica el alto visible como el teclado de Android (y en iOS la app lo lleva a --teclado); devuelve cómo deshacerlo. */
async function conTeclado(p, fn) {
  const cdp = await p.ctx.newCDPSession(p.page)
  const vp = p.page.viewportSize()
  const dpr = await p.page.evaluate(() => devicePixelRatio)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height - p.d.teclado, deviceScaleFactor: dpr, mobile: true })
  await espera(450)
  try {
    return await fn()
  } finally {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: dpr, mobile: true })
    await espera(300)
  }
}
/** Captura con el teclado dibujado abajo (el emulador no lo dibuja), como capturas-movil.mjs. */
async function fotoConTeclado(p, nombre, tema) {
  if (!SALIDA) return
  const sharp = (await import('sharp')).default
  const dpr = await p.page.evaluate(() => devicePixelRatio)
  await p.page.evaluate(() => document.querySelectorAll('.aviso__cerrar').forEach((b) => b.click()))
  await espera(200)
  const imagen = await p.page.screenshot()
  await sharp(imagen)
    .extend({ bottom: Math.round(p.d.teclado * dpr), background: tema === 'oscuro' ? '#2c2c2e' : '#d1d3d9' })
    .png()
    .toFile(path.join(SALIDA, `${PREFIJO}-${nombre}-${p.clave}-${tema}.png`))
}

/** Los controles táctiles nuevos que midan menos de 44 px (meta: ninguno). */
async function chicos(page, selectores) {
  return page.evaluate((sels) => {
    const malos = []
    for (const sel of sels)
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.width < 43.5 || r.height < 43.5) malos.push(`${sel} ${Math.round(r.width)}×${Math.round(r.height)}`)
      }
    return malos
  }, selectores)
}

// ───────────────────────── Recorrido de PC ─────────────────────────
async function recorridoPC(p, tema) {
  const { page } = p
  console.log(`\n${p.d.nombre} · ${tema}`)
  await falso('reiniciar')
  await ir(p, '/RC/pendientes?tarjeta=RC-2', '.comentar__caja textarea')
  const campo = page.locator('.comentar__caja textarea')
  const lista = page.locator('[role=listbox][aria-label="Mencionar a"]')

  // 1 · Escribir @cl: la lista, con teclado y con ARIA.
  await campo.click()
  await page.keyboard.type(`Gracias ${TOKEN}, @cl`)
  await lista.waitFor({ timeout: 4000 })
  const opciones = await page.locator('[role=option]').allInnerTexts()
  ok(opciones.length >= 1 && opciones.some((o) => /Claude/.test(o) && /@claude/.test(o)), 'al escribir @cl aparece la lista con Claude y su @alias', opciones)
  ok(opciones.some((o) => /le llega cuando se conecta|responde sola/.test(o)), 'cada opción dice qué va a pasar', opciones)
  ok((await campo.getAttribute('role')) === 'combobox' && (await campo.getAttribute('aria-expanded')) === 'true', 'el campo es una caja combinada abierta (role=combobox, aria-expanded)')
  const idLista = await lista.getAttribute('id')
  ok((await campo.getAttribute('aria-controls')) === idLista, 'aria-controls apunta a la lista')
  const activa = await campo.getAttribute('aria-activedescendant')
  ok(!!activa && (await page.locator(`#${activa}[role=option][aria-selected=true]`).count()) === 1, 'aria-activedescendant apunta a la opción marcada')
  ok((await page.locator('.menciones__opcion').count()) <= 8, 'hasta 8 opciones a la vista')
  await foto(p, 'menciones-lista', tema)
  if (opciones.length > 1) {
    await page.keyboard.press('ArrowDown')
    ok((await campo.getAttribute('aria-activedescendant')) !== activa, 'la flecha de abajo mueve la opción activa')
    await page.keyboard.press('ArrowUp')
    ok((await campo.getAttribute('aria-activedescendant')) === activa, 'la flecha de arriba vuelve a la primera')
  }
  // Esc cierra la lista y nada más: la tarjeta sigue abierta y el texto queda.
  const antesEsc = await campo.inputValue()
  await page.keyboard.press('Escape')
  await espera(250)
  ok((await lista.count()) === 0, 'Esc cierra la lista')
  ok((await page.locator('.hoja, [role=dialog]').first().isVisible()) && (await campo.inputValue()) === antesEsc && (await enfocadoEs(page, '.comentar__caja textarea')), 'Esc no cierra la tarjeta ni toca el texto, y el foco sigue en el campo')
  // Otra mención, ahora elegida con Enter.
  await page.keyboard.type(' @cl')
  await lista.waitFor({ timeout: 4000 })
  await page.keyboard.press('Enter')
  await espera(250)
  ok((await lista.count()) === 0 && (await campo.inputValue()).endsWith('@claude '), 'Enter inserta @claude con un espacio y cierra la lista', await campo.inputValue())
  // Un alias que no existe queda como texto; un mail y el código no cuentan.
  await page.keyboard.type(`ya le respondí. Y @nadie${TOKEN} no existe, a@b.com tampoco, ni \`@claude\` en código.`)
  ok((await lista.count()) === 0, 'una mención sin coincidencias no deja la lista pegada (y se puede seguir escribiendo)')
  // «No hay nadie con ese nombre» se ve mientras se escribe, sin bloquear.
  await page.keyboard.type(' @zzzz')
  await page.locator('.menciones__vacio').waitFor({ timeout: 3000 }).catch(() => {})
  ok((await page.locator('.menciones__vacio').innerText().catch(() => '')) === 'No hay nadie con ese nombre', 'sin coincidencias dice «No hay nadie con ese nombre»')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Control+Enter')
  // 2 · Se envía y la mención se ve como pastilla.
  const nuevo = page.locator('.comentario', { hasText: `Gracias ${TOKEN}` }).first()
  await nuevo.waitFor({ timeout: 8000 })
  const pastillas = await nuevo.locator('.md-mencion').allInnerTexts()
  ok(pastillas.length === 1 && pastillas[0] === '@claude', 'el comentario muestra una sola pastilla: @claude', pastillas)
  ok((await nuevo.locator('.md-mencion--ia').count()) === 1, 'la pastilla de una IA es violeta (md-mencion--ia)')
  ok(/@nadie/.test(await nuevo.locator('.comentario__texto').innerText()) && (await nuevo.locator('.md-mencion', { hasText: 'nadie' }).count()) === 0, 'el alias que no existe queda como texto plano')
  ok((await nuevo.locator('.md-mencion', { hasText: 'a@b' }).count()) === 0, 'un mail no se dibuja como mención')
  await foto(p, 'hilo-mencion', tema)

  // 2b · Lo mismo en la descripción: Esc cierra la lista y recién el segundo Esc cancela la edición.
  if (await page.locator('.descripcion--vacia').count()) await page.locator('.descripcion--vacia').click()
  else await page.locator('.descripcion').first().dblclick()
  const editor = page.locator('.editor-md textarea')
  await editor.waitFor()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(`Descripción ${TOKEN} con @cl`)
  await lista.waitFor({ timeout: 4000 })
  await page.keyboard.press('Tab')
  await page.keyboard.type('mirá esto')
  await page.keyboard.type(' @cl')
  await lista.waitFor({ timeout: 4000 })
  await page.keyboard.press('Escape')
  ok((await lista.count()) === 0 && (await page.locator('.editor-md').count()) === 1, 'en la descripción, el primer Esc cierra la lista y no la edición')
  await page.keyboard.press('Control+Enter')
  await page.locator('.descripcion .md-mencion--ia').first().waitFor({ timeout: 6000 })
  ok((await page.locator('.descripcion .md-mencion--ia').count()) >= 1, 'la descripción guardada dibuja @claude como pastilla')

  // 3 · Una IA responde por MCP y la campana marca +1.
  await cerrarTarjeta(page)
  const antes = await contador(page)
  await claudeComenta('RC-2', `**Respuesta ${TOKEN}:** ya lo vi, con 30 clientes anda bien.`)
  if (!REAL) await falso('notificar', { tipo: 'respuesta', titulo: 'Claude respondió en RC-2', cuerpo: `Respuesta ${TOKEN}: ya lo vi, con 30 clientes anda bien.`, enlace: '/RC/pendientes?tarjeta=RC-2' })
  const t0 = Date.now()
  while ((await contador(page)) !== antes + 1 && Date.now() - t0 < 15000) await espera(250)
  ok((await contador(page)) === antes + 1, `la campana pasa de ${antes} a ${antes + 1} sin recargar, cuando la IA responde`)
  ok(/sin leer/.test((await page.locator('.campana').getAttribute('aria-label')) ?? ''), 'el nombre de la campana dice cuántas hay sin leer', await page.locator('.campana').getAttribute('aria-label'))

  // 4 · La bandeja: abrir, tocar, abre la tarjeta y queda leída.
  await page.locator('.campana').click()
  await page.locator('.bandeja').waitFor()
  const primera = page.locator('.fila-notif').first()
  ok(/RC-2/.test(await primera.innerText()) && (await primera.getAttribute('class')).includes('fila-notif--sin-leer'), 'la primera fila es la nueva y figura sin leer', await primera.innerText())
  ok((await page.locator('.bandeja__grupo h3').allTextContents()).includes('Hoy'), 'las notificaciones de hoy van bajo «Hoy»')
  await espera(500) // que termine la animación de entrada
  ok((await page.locator('.bandeja').boundingBox()).width >= 359 && (await page.locator('.bandeja').boundingBox()).height <= 481, 'la bandeja mide 360 px de ancho y hasta 480 de alto', await page.locator('.bandeja').boundingBox())
  await foto(p, 'bandeja', tema)
  await primera.click()
  await page.waitForSelector('.comentar__caja textarea')
  ok(/tarjeta=RC-2/.test(page.url()) && (await page.locator('.bandeja').count()) === 0, 'tocar la fila cierra la bandeja y abre la tarjeta (RC-2)', page.url())
  await espera(500)
  ok((await contador(page)) === antes, 'la notificación queda leída (el número vuelve a ' + antes + ')')

  // 5 · «Responder» y la cita.
  const deClaude = page.locator('.comentario--ia', { hasText: `Respuesta ${TOKEN}` }).first()
  await deClaude.waitFor({ timeout: 8000 })
  await deClaude.locator('.comentario__responder').click()
  ok(/Respondiendo a Claude/.test(await page.locator('.comentar__respondiendo').innerText()), 'queda «Respondiendo a Claude» sobre el campo')
  ok(await enfocadoEs(page, '.comentar__caja textarea'), 'el foco pasa al campo')
  await page.keyboard.type(`Perfecto ${TOKEN}, lo dejamos así.`)
  await page.keyboard.press('Control+Enter')
  const respuesta = page.locator('.comentario', { hasText: `Perfecto ${TOKEN}` }).first()
  await respuesta.waitFor({ timeout: 8000 })
  ok((await page.locator('.comentar__respondiendo').count()) === 0, 'al enviar, «Respondiendo a…» se va')
  const cita = respuesta.locator('.comentario__cita')
  ok(/a Claude/.test(await cita.innerText().catch(() => '')) && /Respuesta/.test(await cita.innerText().catch(() => '')), 'la respuesta lleva la cita «↪ a Claude: “…”»', await cita.innerText().catch(() => ''))
  await foto(p, 'hilo-respuesta', tema)
  await cita.click()
  await espera(120)
  ok((await deClaude.getAttribute('class')).includes('comentario--resaltado'), 'un clic en la cita resalta el comentario original')

  // 6 · Solo con teclado: la campana.
  await cerrarTarjeta(page)
  await page.locator('.campana').focus()
  await page.keyboard.press('Enter')
  await page.locator('.bandeja').waitFor()
  ok(await page.evaluate(() => !!document.activeElement?.closest('.bandeja')), 'con el teclado, la bandeja recibe el foco al abrirse')
  await page.keyboard.press('Escape')
  await page.locator('.bandeja').waitFor({ state: 'detached' })
  ok(await enfocadoEs(page, '.campana'), 'Esc cierra la bandeja y el foco vuelve a la campana')

  // 7 · Los estados de la campana, con el servidor de mentira.
  if (!REAL && FALSO) await estadosDeLaCampana(p, tema)

  // 8 · Configuración → Notificaciones y el alias.
  await configuracion(p, tema)

  ok(p.errores.length === 0, 'la consola quedó limpia', p.errores)
}

/** Cargando, error, vacío, sin rutas en el servidor, «Ver más» y error al marcar: solo con el servidor de mentira. */
async function estadosDeLaCampana(p, tema) {
  const { page } = p
  const recargar = () => ir(p, '/RC/pendientes')
  const esperados = (e) => /status of (404|500)|Failed to load resource/.test(e)
  const antesDeErrores = p.errores.length

  await falso('modo', { novedades: 'ok', latenciaMs: 1800 })
  await page.goto(`${WEB}/RC/pendientes`)
  await page.waitForSelector('.campana')
  await page.locator('.campana').click()
  await page.locator('.bandeja__cargando').waitFor({ timeout: 3000 }).catch(() => {})
  ok(/Cargando/.test(await page.locator('.bandeja__cargando').innerText().catch(() => '')), 'mientras llegan las novedades la bandeja dice «Cargando…»')
  await foto(p, 'bandeja-cargando', tema)
  await page.locator('.fila-notif').first().waitFor({ timeout: 6000 })
  ok((await page.locator('.fila-notif').count()) >= 3, 'después aparecen las notificaciones')
  await falso('modo', { latenciaMs: 0 })

  await falso('modo', { novedades: 'error' })
  await recargar()
  await page.locator('.campana').click()
  await page.getByText('No pude traer las notificaciones').waitFor({ timeout: 4000 })
  ok(true, 'con un error del servidor la bandeja dice «No pude traer las notificaciones»')
  await foto(p, 'bandeja-error', tema)
  await falso('modo', { novedades: 'ok' })
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await page.locator('.fila-notif').first().waitFor({ timeout: 4000 })
  ok(true, '«Reintentar» trae la lista')
  await page.keyboard.press('Escape')

  await falso('modo', { vacia: true })
  await recargar()
  await page.locator('.campana').click()
  await page.getByText('Nada nuevo').waitFor({ timeout: 4000 })
  ok(/Cuando alguien te mencione/.test(await page.locator('.bandeja').innerText()) && (await contador(page)) === 0, 'sin notificaciones: «Nada nuevo» y ningún número')
  await foto(p, 'bandeja-vacia', tema)
  await page.keyboard.press('Escape')
  await falso('modo', { vacia: false })

  await falso('semilla', { cantidad: 70 })
  await recargar()
  await page.locator('.campana').click()
  await page.locator('.fila-notif').first().waitFor()
  const primeras = await page.locator('.fila-notif').count()
  ok(primeras === 30, 'la bandeja muestra las 30 últimas', primeras)
  await page.getByRole('button', { name: 'Ver más' }).click()
  await page.waitForFunction((n) => document.querySelectorAll('.fila-notif').length > n, primeras)
  ok((await page.locator('.fila-notif').count()) === 60, '«Ver más» pide las 30 siguientes (de a 30)', await page.locator('.fila-notif').count())
  ok((await page.locator('.bandeja__grupo h3').allTextContents()).includes('Antes'), 'lo que no es de hoy va bajo «Antes»')
  await page.keyboard.press('Escape')
  await falso('reiniciar')

  await falso('modo', { leer: 'error' })
  await recargar()
  const n0 = await contador(page)
  await page.locator('.campana').click()
  await page.getByRole('button', { name: 'Marcar todo como leído' }).click()
  await espera(700)
  ok((await contador(page)) === n0 && n0 > 0, 'si el servidor no marca todo como leído, el número vuelve y no se pierde nada', { n0, ahora: await contador(page) })
  ok((await page.locator('.aviso--error').count()) >= 1, 'y avisa del error')
  await falso('modo', { leer: 'ok' })
  await page.getByRole('button', { name: 'Marcar todo como leído' }).click()
  await espera(500)
  ok((await contador(page)) === 0 && (await page.locator('.fila-notif--sin-leer').count()) === 0, '«Marcar todo como leído» apaga el número y los puntos')
  await page.keyboard.press('Escape')
  await falso('reiniciar')

  // Un servidor que todavía no tiene las rutas: la campana ni aparece y la app anda igual.
  await falso('modo', { novedades: '404' })
  await recargar()
  ok((await page.locator('.campana').count()) === 0 && (await page.locator('.lista').count()) > 0, 'si el servidor no tiene las rutas de la IA (404), no hay campana y el tablero anda normal')
  await falso('reiniciar')
  // Los errores de red que provocó la propia prueba (404 y 500) no cuentan.
  p.errores.splice(antesDeErrores, p.errores.length, ...p.errores.slice(antesDeErrores).filter((e) => !esperados(e)))
  await recargar()
}

async function configuracion(p, tema) {
  const { page } = p
  await ir(p, '/RC/pendientes')
  await page.keyboard.press('Control+Comma')
  await page.locator('.config').waitFor()
  await page.locator('[data-seccion=notificaciones]').click()
  const filas = page.locator('.config-fila')
  await filas.first().waitFor({ timeout: 4000 })
  ok((await page.locator('[role=switch]').count()) >= 7, 'Configuración → Notificaciones: un interruptor por tipo y el de «No molestar»', await page.locator('[role=switch]').count())
  const primero = page.locator('[role=switch]').first()
  const valor0 = await primero.getAttribute('aria-checked')
  await primero.click()
  await espera(500)
  ok((await primero.getAttribute('aria-checked')) !== valor0, 'el interruptor cambia al instante')
  await foto(p, 'config-notificaciones', tema)
  const prefs = await fetch(`${WEB}/api/notificaciones/preferencias`).then((r) => r.json())
  ok(prefs.push && prefs.push.mencion === (valor0 !== 'true'), 'la preferencia quedó guardada en el servidor', prefs.push)
  // Horario de silencio.
  const silencio = page.locator('[role=switch][aria-label="Horario de silencio"]')
  await silencio.click()
  await page.locator('.notif-config__horas input[type=time]').first().waitFor()
  const hora = await page.locator('.notif-config__horas input[type=time]').first().inputValue()
  ok(hora === '22:00', 'al prender «No molestar» el horario de fábrica es 22:00 a 08:00', hora)
  await espera(400)
  const prefs2 = await fetch(`${WEB}/api/notificaciones/preferencias`).then((r) => r.json())
  ok(prefs2.silencio?.desde === '22:00' && prefs2.silencio?.hasta === '08:00', 'el horario de silencio se guarda', prefs2.silencio)
  // Se respeta al recargar.
  await page.reload()
  await page.waitForSelector('.lista .tarjeta')
  await page.keyboard.press('Control+Comma')
  await page.locator('[data-seccion=notificaciones]').click()
  await page.locator('.config-fila').first().waitFor()
  ok((await page.locator('[role=switch]').first().getAttribute('aria-checked')) !== valor0, 'después de recargar, la preferencia sigue como la dejé')
  // Restaurar.
  await page.locator('[role=switch]').first().click()
  await silencio.click()
  await espera(500)

  // El alias propio en Cuenta.
  await page.locator('[data-seccion=cuenta]').click()
  const alias = page.locator('.perfil__alias input')
  await alias.waitFor({ timeout: 4000 })
  const original = await alias.inputValue()
  ok(/^[a-z0-9][a-z0-9_.-]+$/.test(original), 'Configuración → Cuenta muestra mi alias', original)
  await alias.fill('todos')
  await alias.blur()
  ok(/reservado/.test(await page.locator('.perfil__ayuda--error').innerText().catch(() => '')), 'un alias reservado (@todos) se rechaza con su explicación')
  await alias.fill('x')
  await alias.blur()
  ok((await page.locator('.perfil__ayuda--error').innerText().catch(() => '')).length > 10, 'un alias inválido dice cómo tiene que ser')
  const antes409 = p.errores.length
  await alias.fill('claude')
  await alias.blur()
  await espera(600)
  // El 409 de un alias repetido lo provoca la propia prueba: el navegador lo anota como error de red, no cuenta.
  p.errores.splice(antes409, p.errores.length, ...p.errores.slice(antes409).filter((e) => !/status of 409/.test(e)))
  ok(/ya lo usa|usa|existe|repetid|elegí|alias/i.test(await page.locator('.perfil__ayuda--error').innerText().catch(() => '')), 'un alias que ya usa otro miembro (@claude) vuelve del servidor con su mensaje', await page.locator('.perfil__ayuda').innerText())
  const nuevoAlias = `yo${TOKEN}`
  await alias.fill(nuevoAlias)
  await alias.blur()
  await espera(700)
  ok((await page.locator('.perfil__ayuda--error').count()) === 0 && (await fetch(`${WEB}/api/miembros`).then((r) => r.json())).some((m) => m.esYo && m.alias === nuevoAlias), 'un alias válido se guarda')
  await alias.fill(original)
  await alias.blur()
  await espera(600)
  ok((await fetch(`${WEB}/api/miembros`).then((r) => r.json())).some((m) => m.esYo && m.alias === original), 'y se puede volver al de antes')
  await page.keyboard.press('Escape')
}

// ───────────────────────── Recorrido del celular ─────────────────────────
async function recorridoMovil(p, tema) {
  const { page } = p
  console.log(`\n${p.d.nombre} · ${tema}`)
  await falso('reiniciar')
  await ir(p, '/RC/pendientes?tarjeta=RC-2', '.comentar-movil__campo')
  const campo = page.locator('.comentar-movil__campo')
  const barra = page.locator('.barra-menciones')

  // 1 · Escribir @cl con el teclado: la barra de chips.
  await conTeclado(p, async () => {
    await campo.tap()
    await page.keyboard.type(`Gracias ${TOKEN}, @cl`)
    await barra.waitFor({ timeout: 4000 })
    const chips = await page.locator('.barra-menciones__chip').allInnerTexts()
    ok(chips.some((c) => /Claude/.test(c) && /@claude/.test(c)), 'al escribir @cl aparecen chips con Claude y su @alias sobre el teclado', chips)
    ok(chips.some((c) => /le llega cuando se conecta|responde sola/.test(c)), 'cada chip dice qué va a pasar', chips)
    const cajas = await page.locator('.barra-menciones__chip').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    ok(cajas.every((h) => h >= 44), 'los chips miden 44 px de alto o más', cajas)
    const enlazada = await page.evaluate(() => {
      const b = document.querySelector('.barra-menciones').getBoundingClientRect()
      const c = document.querySelector('.comentar-movil').getBoundingClientRect()
      return { barraAbajo: Math.round(b.bottom), campoArriba: Math.round(c.top), dentro: b.top >= 0 && b.right <= innerWidth + 1 }
    })
    ok(enlazada.barraAbajo <= enlazada.campoArriba && enlazada.dentro, 'la barra queda pegada arriba del campo y dentro de la pantalla', enlazada)
    await fotoConTeclado(p, 'menciones-barra', tema)
    await page.locator('.barra-menciones__chip', { hasText: '@claude' }).first().tap()
    await espera(250)
    ok((await campo.inputValue()).endsWith('@claude '), 'tocar un chip inserta @claude', await campo.inputValue())
    ok(await enfocadoEs(page, '.comentar-movil__campo'), 'el campo conserva el foco (el teclado no se cierra)')
    ok((await barra.count()) === 0, 'la barra se va al elegir')
    await page.keyboard.type(`ya le respondí. Y @nadie${TOKEN} no existe.`)
    await page.locator('.comentar-movil__enviar').tap()
  })
  const nuevo = page.locator('.comentario', { hasText: `Gracias ${TOKEN}` }).first()
  await nuevo.waitFor({ timeout: 8000 })
  const pastillas = await nuevo.locator('.md-mencion').allInnerTexts()
  ok(pastillas.length === 1 && pastillas[0] === '@claude', 'el comentario muestra una sola pastilla: @claude', pastillas)
  ok((await nuevo.locator('.md-mencion', { hasText: 'nadie' }).count()) === 0, 'el alias que no existe queda como texto')
  await nuevo.locator('.md-mencion').tap()
  await page.locator('.aviso', { hasText: 'Claude' }).first().waitFor({ timeout: 2000 }).catch(() => {})
  ok((await page.locator('.aviso', { hasText: 'Claude' }).count()) >= 1, 'tocar la pastilla muestra el nombre completo')

  // 1b · La descripción (un campo del contenido, con la barra de Cancelar y Guardar): la barra de chips también aparece.
  await page.locator('.descripcion--vacia').first().tap().catch(() => {})
  if (!(await page.locator('.editor-md textarea').count())) await page.locator('.descripcion').first().dispatchEvent('dblclick')
  await page.locator('.editor-md textarea').waitFor({ timeout: 4000 })
  await conTeclado(p, async () => {
    await page.locator('.editor-md textarea').tap()
    await page.keyboard.type(` Descripción ${TOKEN} con @cl`)
    await barra.waitFor({ timeout: 4000 })
    const caja = await page.evaluate(() => {
      const b = document.querySelector('.barra-menciones').getBoundingClientRect()
      const c = document.querySelector('.editor-md textarea').getBoundingClientRect()
      return { barraArriba: Math.round(b.top), barraAbajo: Math.round(b.bottom), campoArriba: Math.round(c.top), campoAbajo: Math.round(c.bottom), alto: innerHeight }
    })
    ok(caja.barraArriba >= 0 && caja.barraAbajo <= caja.alto, 'en la descripción, la barra de chips queda dentro de la pantalla', caja)
    await fotoConTeclado(p, 'menciones-barra-descripcion', tema)
    await page.locator('.barra-menciones__chip', { hasText: '@claude' }).first().tap()
    await page.locator('.editor-md__pie .boton--primario').tap()
  })
  await page.locator('.descripcion .md-mencion--ia').first().waitFor({ timeout: 6000 })
  ok((await page.locator('.descripcion .md-mencion--ia').count()) >= 1, 'la descripción guardada dibuja @claude como pastilla')

  // 2 · Una IA responde: la campana marca +1, la hoja, tocar abre la tarjeta.
  await page.locator('.hoja-movil__cerrar').tap()
  await page.waitForSelector('.hoja-movil', { state: 'detached' })
  await espera(300)
  const antes = await contador(page)
  await claudeComenta('RC-2', `**Respuesta ${TOKEN}:** ya lo vi, con 30 clientes anda bien.`)
  if (!REAL) await falso('notificar', { tipo: 'respuesta', titulo: 'Claude respondió en RC-2', cuerpo: `Respuesta ${TOKEN}: ya lo vi, con 30 clientes anda bien.`, enlace: '/RC/pendientes?tarjeta=RC-2' })
  const t0 = Date.now()
  while ((await contador(page)) !== antes + 1 && Date.now() - t0 < 15000) await espera(250)
  ok((await contador(page)) === antes + 1, `la campana pasa de ${antes} a ${antes + 1} sin recargar`)
  await foto(p, 'barra-con-campana', tema, { clip: { x: 0, y: 0, width: page.viewportSize().width, height: 70 } })
  await page.locator('.campana').tap()
  await page.locator('.hoja-notificaciones').waitFor()
  await espera(500)
  const primera = page.locator('.fila-notif').first()
  ok(/RC-2/.test(await primera.innerText()) && (await primera.getAttribute('class')).includes('fila-notif--sin-leer'), 'la primera fila de la hoja es la nueva y figura sin leer')
  const chicosHoja = await chicos(page, ['.hoja-notificaciones .fila-notif', '.hoja-notificaciones .boton', '.campana'])
  ok(chicosHoja.length === 0, 'campana, filas y botones de la hoja miden 44 px o más', chicosHoja)
  await foto(p, 'hoja-notificaciones', tema)
  await primera.tap()
  await page.waitForSelector('.comentar-movil__campo')
  await espera(600) // que termine la animación de cierre de la hoja
  ok(/tarjeta=RC-2/.test(page.url()) && (await page.locator('.hoja-notificaciones').count()) === 0, 'tocar la fila cierra la hoja y abre la tarjeta', page.url())
  await espera(600)
  ok((await contador(page)) === antes, 'queda leída (el número vuelve a ' + antes + ')')

  // 3 · Responder y la cita, con el teclado.
  const deClaude = page.locator('.comentario--ia', { hasText: `Respuesta ${TOKEN}` }).first()
  await deClaude.waitFor({ timeout: 8000 })
  await conTeclado(p, async () => {
    await deClaude.locator('.comentario__responder').tap()
    ok(/Respondiendo a Claude/.test(await page.locator('.comentar-movil__respondiendo').innerText()), 'queda «Respondiendo a Claude» sobre el campo de abajo')
    ok(await enfocadoEs(page, '.comentar-movil__campo'), 'el foco pasa al campo')
    const chicosR = await chicos(page, ['.comentar-movil__respondiendo .boton-icono', '.comentar-movil__enviar'])
    await page.keyboard.type(`Perfecto ${TOKEN}, lo dejamos así.`)
    ok(chicosR.length === 0, 'la ✕ de «Respondiendo a…» y el botón de enviar miden 44 px o más', chicosR)
    await fotoConTeclado(p, 'hilo-respondiendo', tema)
    await page.locator('.comentar-movil__enviar').tap()
  })
  const respuesta = page.locator('.comentario', { hasText: `Perfecto ${TOKEN}` }).first()
  await respuesta.waitFor({ timeout: 8000 })
  const cita = respuesta.locator('.comentario__cita')
  ok(/a Claude/.test(await cita.innerText().catch(() => '')), 'la respuesta lleva la cita «↪ a Claude: “…”»', await cita.innerText().catch(() => ''))
  await respuesta.scrollIntoViewIfNeeded()
  await foto(p, 'hilo-respuesta', tema)
  // La zona de toque de «Responder» llega a 44 px aunque se vea chico.
  const zona = await deClaude.locator('.comentario__responder').evaluate((el) => {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    return [-20, 20].map((dy) => {
      const e = document.elementFromPoint(x, r.top + r.height / 2 + dy)
      return !!e && (e === el || el.contains(e))
    })
  })
  ok(zona.every(Boolean), 'la zona de toque de «Responder» llega a unos 44 px de alto', zona)

  // 4 · Preferencias desde la hoja y el alias en el menú.
  await page.locator('.hoja-movil__cerrar').tap()
  await page.waitForSelector('.hoja-movil', { state: 'detached' })
  await page.locator('.campana').tap()
  await page.locator('.hoja-notificaciones').waitFor()
  await page.getByRole('button', { name: 'Preferencias' }).tap()
  await page.locator('.hoja-preferencias').waitFor()
  await page.locator('.hoja-preferencias [role=switch]').first().waitFor({ timeout: 4000 })
  ok((await page.locator('.hoja-preferencias [role=switch]').count()) >= 7, 'en el celular, «Preferencias» abre una hoja con los interruptores')
  const sw = page.locator('.hoja-preferencias [role=switch]').first()
  const v0 = await sw.getAttribute('aria-checked')
  await sw.tap()
  await espera(500)
  ok((await sw.getAttribute('aria-checked')) !== v0, 'el interruptor cambia al tocarlo')
  await foto(p, 'hoja-preferencias', tema)
  await sw.tap()
  await espera(400)
  await page.keyboard.press('Escape')
  await espera(400)
  await page.keyboard.press('Escape')
  await espera(500)
  await page.locator('.barra-movil__menu').tap()
  await page.getByText('Mi perfil').tap()
  const alias = page.locator('.hoja-mas__perfil .perfil__alias input')
  await alias.waitFor({ timeout: 4000 })
  ok(/^[a-z0-9][a-z0-9_.-]+$/.test(await alias.inputValue()), 'el menú muestra mi alias (@…) en Mi perfil', await alias.inputValue())

  ok(p.errores.length === 0, 'la consola quedó limpia', p.errores)
}

// ───────────────────────── «Antes» y «después» de lo protegido ─────────────────────────
/** La tarjeta RC-3 (con un comentario mío y uno de Claude) y la barra de arriba, para comparar con lo que había antes. */
async function capturasComparables(base, combinaciones, browser) {
  console.log(`\nCapturas «${PREFIJO}» (${base})`)
  for (const [clave, tema] of combinaciones) {
    const p = await nueva(browser, clave, tema, base)
    p.clave = clave
    const d = DISPOSITIVOS[clave]
    await ir(p, '/RC/pendientes')
    await foto(p, 'barra', tema, { clip: { x: 0, y: 0, width: p.page.viewportSize().width, height: d.movil ? 130 : 72 } })
    await p.page.goto(`${base}/RC/pendientes?tarjeta=RC-3`)
    await p.page.waitForSelector(d.movil ? '.comentar-movil__campo' : '.comentar__caja textarea', { timeout: 20000 })
    await espera(900)
    if (d.movil) {
      // La hoja del celular es larga: se baja hasta los comentarios para ver el hilo.
      await p.page.locator('.linea-tiempo').first().scrollIntoViewIfNeeded()
      await espera(300)
    } else {
      await p.page.locator('.linea-tiempo').first().scrollIntoViewIfNeeded().catch(() => {})
    }
    await foto(p, 'tarjeta', tema)
    await p.ctx.close()
  }
}

// ───────────────────────── Principal ─────────────────────────
;(async () => {
  const browser = await chromium.launch()
  try {
    if (ANTES) {
      await capturasComparables(ANTES, COMBINACIONES, browser)
    } else {
      const info = await fetch(`${WEB}/api/miembros`).then((r) => r.json())
      ok(Array.isArray(info), `el Telar contesta en ${WEB}${REAL ? ' (modo real: la IA y las notificaciones son las del servidor)' : ' (con el servidor de mentira)'}`)
      await prepararDatos()
      for (const [clave, tema] of COMBINACIONES) {
        const p = await nueva(browser, clave, tema)
        p.clave = clave
        try {
          if (DISPOSITIVOS[clave].movil) await recorridoMovil(p, tema)
          else await recorridoPC(p, tema)
        } catch (e) {
          fallos++
          console.log(`  MAL  el recorrido se cortó: ${e.message.split('\n').slice(0, 4).join(' · ')} (${(e.stack.match(/probar-ia-ui.cjs:\d+/) || [''])[0]})`)
          if (SALIDA) await p.page.screenshot({ path: path.join(SALIDA, `error-${clave}-${tema}.png`) }).catch(() => {})
        } finally {
          await p.ctx.close()
        }
      }
      await capturasComparables(WEB, COMBINACIONES, browser)
    }
  } finally {
    await browser.close()
    if (mcp) await mcp.close().catch(() => {})
  }
  console.log(fallos ? `\n${fallos} cosa(s) mal.` : '\nTodo en orden.')
  process.exit(fallos ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
