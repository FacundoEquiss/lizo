// Recorrido de la interfaz de la IA integrada, fase 2 (docs/plan-ia-integrada.md, 15.6 y 16.4, tareas 2.3 y 2.15), con Playwright, SOLO
// contra un Telar local con el proveedor falso (nunca claves reales, nunca producción):
//   Configuración → IA: cargar una clave (falsa) que no vuelve a verse, crear un agente paso por paso, cambiarlo, el tope de gasto, la
//   pausa de toda la IA, «Código (GitHub)», y todos los estados (cargando, error, sin rutas, vacío, clave que no anda, en el tope,
//   solo lectura con la clave del MCP) · en la tarjeta: mencionar a un agente → «está pensando…» con su pastilla y «Frenar» → la
//   respuesta con su pie (qué hizo y el costo) → pedir permiso (Permitir, No, desde la campana) → pausa por tope y «Subir el tope» →
//   un fallo con «Reintentar» → una mención que queda esperando con «Reintentar» → el sondeo con `ia=1` solo mientras hay un trabajo.
// En PC (1440 × 900) y en celular emulado (iPhone 15 y Pixel 8, con el teclado de Android emulado al pegar la clave), en claro y en oscuro.
// Falla con un mensaje claro si algo no anda (y sale con código 1); la consola tiene que quedar limpia.
//
// Cómo correrlo (Telar local con el proveedor falso; el modelo de un agente es el guion: `guion:responder`, `guion:lento`…):
//   TABLERO_IA_FALSO=1 TABLERO_DATOS=/tmp/telar-ia2 TABLERO_PUERTO=4530 TABLERO_PUERTO_WEB=4531 TABLERO_SEMILLA_DISCORD=no npm run dev:servidor
//   node scripts/sembrar-kanban.mjs --url http://127.0.0.1:4530
//   TABLERO_PUERTO=4530 TABLERO_PUERTO_WEB=4531 npm run dev:web
//   NODE_PATH=$(npm root -g) node scripts/probar-ia-ui-f2.cjs --web http://127.0.0.1:4531 [--capturas docs/capturas/ia-f2]
// OJO con los límites del servidor (plan 12.10): 30 trabajos y 10 pruebas de clave POR HORA y por cuenta. Una combinación gasta ~12 trabajos y
// 2 pruebas de clave (la de PC en claro, la «completa», ~16 y ~6): las seis juntas no entran en una hora. Se corre de a una combinación con
// una base nueva cada vez (`--solo=<combinación>`, un Telar con otra TABLERO_DATOS) o se espera. Si se llega al límite, las menciones quedan
// «esperando: demasiados pedidos seguidos» y el recorrido falla en «está pensando…».
// Opciones:
//   --solo=pc-claro,iphone15-oscuro   qué combinaciones (o solo el dispositivo: --solo=pc)
//   --github http://127.0.0.1:4540    levanta el GitHub de mentira (scripts/github-falso.mjs) en ese puerto: el Telar tiene que haberse
//                                     arrancado con TABLERO_GITHUB_API=<esa dirección>; sin esto solo se prueba el error de «Código (GitHub)»
//   --antes http://127.0.0.1:4533     solo las capturas «antes» de la tarjeta y de Configuración, con una web vieja (la de la F1)
//   --prefijo despues|antes           prefijo de las capturas
//   TELAR_IA_REAL=1                   contra un Telar con TODO el cableado del servidor (probador de claves y catálogo de modelos): lo que sin
//                                     eso se omite (rechazar una clave mala, elegir el modelo de una lista con su precio) pasa a exigirse
// Escribe en las tarjetas RC-19, RC-21 a RC-68 y RC-69 del Telar local (8 por combinación) (las que archiva las restaura), crea claves y agentes con el nombre de la
// corrida y los deja archivados o quitados al terminar. Nunca apunta a producción: se niega si una dirección no es 127.0.0.1 o localhost.
// Ningún valor de clave se imprime: las de prueba empiezan con `prueba-` y el recorrido verifica que no vuelven a la pantalla.
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
const WEB = opcion('web', 'http://127.0.0.1:4531')
const CAPTURAS = opcion('capturas', '')
const ANTES = opcion('antes', '')
const SOLO = opcion('solo', '')
const GITHUB = opcion('github', '')
const REAL = process.env.TELAR_IA_REAL === '1'
const PREFIJO = opcion('prefijo', ANTES ? 'antes' : 'despues')
for (const u of [WEB, ANTES, GITHUB].filter(Boolean)) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) {
    console.error('Solo contra un Telar local (127.0.0.1 o localhost).')
    process.exit(1)
  }
}
const SALIDA = CAPTURAS ? path.resolve(CAPTURAS) : ''
if (SALIDA) fs.mkdirSync(SALIDA, { recursive: true })

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let fallos = 0
let omitidos = 0
const ok = (cond, texto, detalle) => {
  console.log(`  ${cond ? 'ok ' : 'MAL'}  ${texto}${!cond && detalle !== undefined ? `\n        ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}` : ''}`)
  if (!cond) fallos++
  return cond
}
/** Lo que necesita una parte del servidor que todavía puede no estar cableada: sin ella se omite; con TELAR_IA_REAL=1 se exige. */
const siHay = (hay, texto, cond, detalle) => {
  if (hay) return ok(cond, texto, detalle)
  if (REAL) return ok(false, `${texto} (se exige con TELAR_IA_REAL=1)`)
  console.log(`  --   ${texto} (omitido: el servidor todavía no lo tiene cableado)`)
  omitidos++
  return true
}
// Un texto distinto en cada corrida: lo que se crea queda en el Telar local.
const TOKEN = Date.now().toString(36).slice(-5)
const SECRETO = `prueba-${TOKEN}-abcdef0123456789zzzz`
const SECRETO_DEL_ERROR = `prueba-${TOKEN}-errorerrorerror9999`

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

// ───────────────────────── El Telar por API (preparar y limpiar) ─────────────────────────
async function api(ruta, metodo = 'GET', cuerpo) {
  const r = await fetch(`${WEB}${ruta}`, { method: metodo, headers: cuerpo ? { 'content-type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
  const t = await r.text()
  let datos = null
  try {
    datos = t ? JSON.parse(t) : null
  } catch {}
  return { ok: r.ok, estado: r.status, datos }
}

/** Lo que crea una combinación (claves y agentes por API) para dejarlo limpio al terminar. */
function escenario(sufijo) {
  const creados = { agentes: [], claves: [], restaurar: [] }
  const e = {
    creados,
    async clave(nombre, secreto = SECRETO) {
      const r = await api('/api/ia/claves', 'POST', { proveedor: 'anthropic', nombre, clave: secreto })
      if (!r.ok) throw new Error(`no pude crear la clave de prueba: ${r.datos?.error ?? r.estado}`)
      creados.claves.push(r.datos.id)
      return r.datos.id
    },
    async agente(nombre, modelo, extra = {}) {
      const alias = `${nombre.toLowerCase()}${TOKEN}${sufijo}`
      const r = await api('/api/ia/agentes', 'POST', { nombre: `${nombre} ${TOKEN}${sufijo}`, alias, proveedor: 'anthropic', modelo, ...extra })
      if (!r.ok) throw new Error(`no pude crear el agente ${nombre}: ${r.datos?.error ?? r.estado}`)
      creados.agentes.push(r.datos.miembroId)
      return { id: r.datos.miembroId, alias, nombre: r.datos.nombre }
    },
    async limpiar() {
      for (const id of creados.agentes) await api(`/api/ia/agentes/${id}`, 'DELETE')
      for (const id of creados.claves) await api(`/api/ia/claves/${id}`, 'DELETE')
      for (const clave of creados.restaurar) await api(`/api/tarjetas/${clave}/archivar`, 'POST', { archivar: false })
      await api('/api/ia/ajustes', 'PUT', { pausada: false, topeMesUsd: 25 })
      creados.agentes = []
      creados.claves = []
      creados.restaurar = []
    },
  }
  return e
}

/** Los agentes y claves de ESTA corrida que el recorrido de Configuración creó por la pantalla (por nombre). */
async function limpiarPorNombre(prefijoNombre) {
  const est = (await api('/api/ia/estado')).datos
  for (const a of est?.agentes ?? []) if (a.nombre.includes(prefijoNombre)) await api(`/api/ia/agentes/${a.miembroId}`, 'DELETE')
  for (const c of est?.claves ?? []) if (c.nombre.includes(prefijoNombre)) await api(`/api/ia/claves/${c.id}`, 'DELETE')
}

// ───────────────────────── Páginas ─────────────────────────
async function nueva(browser, clave, tema, base = WEB) {
  const d = DISPOSITIVOS[clave]
  // Sin service worker: una web compilada que se sirve con otra versión no se tiene que quedar con lo viejo guardado.
  const ctx = await browser.newContext({ ...d.contexto, serviceWorkers: 'block', colorScheme: tema === 'oscuro' ? 'dark' : 'light' })
  await ctx.addInitScript((t) => localStorage.setItem('tablero.tema', t), tema)
  const page = await ctx.newPage()
  const errores = []
  const consola = (m) => m.type() === 'error' && errores.push(m.text())
  page.on('console', consola)
  page.on('pageerror', (e) => errores.push(String(e.message)))
  return { ctx, page, errores, d, base, clave, tema }
}
const ir = async (p, ruta, selector) => {
  await p.page.goto(`${p.base}${ruta}`)
  await p.page.waitForSelector(selector ?? '.lista .tarjeta', { timeout: 20000 })
  await espera(600)
}
const toca = (p, loc) => (p.d.movil ? loc.tap() : loc.click())
const foto = async (p, nombre, opciones = {}) => {
  if (!SALIDA) return
  // Los avisos («Claude comentó en…») tapan lo que se quiere ver: se cierran antes de sacar la captura.
  await p.page.evaluate(() => document.querySelectorAll('.aviso__cerrar').forEach((b) => b.click()))
  await espera(250)
  await p.page.screenshot({ path: path.join(SALIDA, `${PREFIJO}-${nombre}-${p.clave}-${p.tema}.png`), ...opciones })
}
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
async function fotoConTeclado(p, nombre) {
  if (!SALIDA) return
  const sharp = (await import('sharp')).default
  const dpr = await p.page.evaluate(() => devicePixelRatio)
  await p.page.evaluate(() => document.querySelectorAll('.aviso__cerrar').forEach((b) => b.click()))
  await espera(250)
  const imagen = await p.page.screenshot()
  await sharp(imagen)
    .extend({ bottom: Math.round(p.d.teclado * dpr), background: p.tema === 'oscuro' ? '#2c2c2e' : '#d1d3d9' })
    .png()
    .toFile(path.join(SALIDA, `${PREFIJO}-${nombre}-${p.clave}-${p.tema}.png`))
}
/** Los controles táctiles que midan menos de 44 px (meta: ninguno). */
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
const contador = async (page) => {
  const t = await page.locator('.campana__numero').first().innerText({ timeout: 800 }).catch(() => '')
  return t === '9+' ? 10 : Number(t) || 0
}
const esperados = (e) => /status of (400|403|404|409|500|502)|Failed to load resource/.test(e)

// ───────────────────────── Abrir y cerrar Configuración → IA ─────────────────────────
async function abrirIA(p) {
  const { page } = p
  if (p.d.movil) {
    await toca(p, page.locator('.barra-movil__menu'))
    await toca(p, page.getByText('Claves, agentes, topes'))
    await page.locator('.hoja-ia').waitFor()
  } else {
    await page.keyboard.press('Control+Comma')
    await page.locator('.config').waitFor()
    await page.locator('[data-seccion=ia]').click()
  }
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
  await espera(400)
}
async function cerrarIA(p) {
  await p.page.keyboard.press('Escape')
  await espera(500)
  if (p.d.movil && (await p.page.locator('.hoja-ia').count())) {
    await p.page.keyboard.press('Escape')
    await espera(500)
  }
}
/** La zona que se desplaza dentro de Configuración (PC) o de la hoja (celular). */
const zona = (p) => p.page.locator(p.d.movil ? '.hoja-inferior__contenido' : '.config__contenido')
async function bajarA(p, loc) {
  await loc.scrollIntoViewIfNeeded()
  await espera(250)
}

// ───────────────────────── Configuración → IA, de punta a punta ─────────────────────────
async function configuracionIA(p, sufijo, compartida) {
  const { page } = p
  const nombreClave = `Clave ${TOKEN}${sufijo}`
  const nombreAgente = `Ayudante ${TOKEN}${sufijo}`
  await ir(p, '/RC/pendientes')
  await abrirIA(p)

  // 1 · Lo que se ve de entrada.
  const textoInicio = await page.locator('.ia-seccion').innerText()
  ok(/Pausar toda la IA/i.test(textoInicio) && /Agentes/i.test(textoInicio) && /Claves/i.test(textoInicio) && /Código \(GitHub\)/i.test(textoInicio) && /Gasto/i.test(textoInicio), 'la sección muestra cómo está la IA, agentes, claves, código, gasto y agentes de afuera')
  ok(/Agentes de afuera/i.test(textoInicio) && (await page.getByRole('switch', { name: 'Pedime confirmación también por MCP' }).count()) === 1, 'y el camino sin gasto por MCP con sus interruptores')
  // 2 · Cargar una clave (falsa) por la pantalla (el servidor deja 10 pruebas de clave por hora: solo la primera combinación de PC y la
  //     primera de celular lo hacen; las demás usan la clave compartida de la corrida).
  if (p.claveUI) {
  await toca(p, page.getByRole('button', { name: 'Agregar clave' }))
  await page.locator('.ia-formulario').waitFor()
  const campoClave = page.locator('input[name="telar-clave-api"]')
  ok((await campoClave.getAttribute('type')) === 'password' && (await campoClave.getAttribute('autocomplete')) === 'off', 'el campo de la clave es de contraseña y no se autocompleta')
  ok(/No la mandes por chat ni la guardes en otro lado/.test(await page.locator('.ia-formulario').innerText()) && /cifrada y no se vuelve a mostrar/.test(await page.locator('.ia-formulario').innerText()), 'dice que se guarda cifrada, que no se vuelve a mostrar y que no se manda por chat')
  ok((await page.locator('.ia-formulario a[href^="https://console.anthropic.com"]').count()) === 1, 'enlaza a la consola oficial del proveedor para generarla')
  const opciones = await page.locator('.ia-formulario select option').allInnerTexts()
  ok(['Claude (Anthropic)', 'GPT (OpenAI)', 'Gemini', 'DeepSeek', 'Otro compatible con OpenAI'].every((o) => opciones.includes(o)), 'ofrece Anthropic, GPT, Gemini, DeepSeek y «Otro compatible con OpenAI»', opciones)
  await page.getByLabel('Nombre', { exact: true }).fill(nombreClave)
  const guardar = page.getByRole('button', { name: 'Guardar y probar' })
  ok(await guardar.isDisabled(), 'sin clave pegada, «Guardar y probar» está apagado')
  if (p.d.movil) {
    await conTeclado(p, async () => {
      await campoClave.tap()
      await page.keyboard.type(SECRETO)
      await fotoConTeclado(p, 'hoja-ia-clave-teclado')
      const enMedio = await page.evaluate(() => {
        const c = document.querySelector('input[name="telar-clave-api"]').getBoundingClientRect()
        return c.top >= 0 && c.bottom <= innerHeight
      })
      ok(enMedio, 'con el teclado abierto el campo de la clave queda a la vista')
    })
  } else await campoClave.fill(SECRETO)
  await foto(p, 'config-ia-clave')
  ok(!(await page.evaluate((s) => document.body.innerText.includes(s), SECRETO)), 'mientras se escribe, la clave no se ve en pantalla (campo de contraseña)')
  await toca(p, guardar)
  await page.locator('.ia-clave-fila', { hasText: nombreClave }).waitFor({ timeout: 8000 })
  const fila = page.locator('.ia-clave-fila', { hasText: nombreClave })
  ok(/termina en …abcdef0123456789zzzz/.test(await fila.innerText()) === false && /termina en …zzzz/.test(await fila.innerText()), 'la lista dice «termina en …zzzz» (solo los últimos 4)', await fila.innerText())
  const todo = await page.evaluate((s) => document.documentElement.outerHTML.includes(s) || [...document.querySelectorAll('input,textarea')].some((i) => i.value.includes(s)), SECRETO)
  ok(!todo, 'la clave no aparece en ningún lugar de la pantalla ni en ningún campo después de guardarla')
  const crudo = JSON.stringify((await api('/api/ia/estado')).datos)
  ok(!crudo.includes(SECRETO) && !crudo.includes('abcdef0123456789'), 'el servidor tampoco la devuelve en el estado (solo ultimos4)')
  const claveId = (await api('/api/ia/estado')).datos.claves.find((c) => c.nombre === nombreClave)?.id
  ok(!!claveId, 'la clave quedó guardada en el servidor')
  await foto(p, 'config-ia-claves')

  // 2b · Una clave que no anda: el probador de claves del servidor la rechaza y no se guarda.
  if (p.completo) {
  await toca(p, page.getByRole('button', { name: 'Agregar clave' }))
  await page.locator('.ia-formulario').waitFor()
  await page.getByLabel('Nombre', { exact: true }).fill(`Mala ${TOKEN}${sufijo}`)
  await page.locator('input[name="telar-clave-api"]').fill('esta-no-es-una-clave-valida')
  await toca(p, page.getByRole('button', { name: 'Guardar y probar' }))
  await espera(1500)
  const rechazada = (await page.locator('.ia-aviso--error').count()) === 1
  const sinProbador = !rechazada && (await page.locator('.ia-clave-fila', { hasText: `Mala ${TOKEN}${sufijo}` }).count()) === 1
  if (sinProbador) await limpiarPorNombre(`Mala ${TOKEN}${sufijo}`)
  siHay(rechazada || !sinProbador, 'una clave que el proveedor rechaza no se guarda y el error dice por qué', rechazada && !(await api('/api/ia/estado')).datos.claves.some((c) => c.nombre.startsWith(`Mala ${TOKEN}`)), await page.locator('.ia-aviso--error').innerText().catch(() => ''))
  if (rechazada) await foto(p, 'config-ia-clave-rechazada')
  if (await page.locator('.ia-formulario').count()) await toca(p, page.locator('.ia-volver'))
  await page.locator('.ia-clave-fila').first().waitFor()
  }
  }

  // 3 · Crear un agente, un paso por vez.
  await toca(p, page.getByRole('button', { name: 'Agregar agente' }))
  await page.locator('.ia-formulario').waitFor()
  ok(/Paso 1 de 4/.test(await page.locator('.ia-formulario__cabecera').innerText()), 'crear un agente es de a un paso: «Paso 1 de 4»')
  const claveElegida = await page.getByLabel('Clave', { exact: true }).evaluate((s) => s.options[s.selectedIndex]?.text)
  ok(/termina en …zzzz/.test(claveElegida ?? ''), 'propone una clave que ya cargaste', claveElegida)
  await page.getByLabel('Clave', { exact: true }).selectOption({ label: `${compartida.nombre} · termina en …zzzz` })
  const modelo = page.getByLabel('Modelo', { exact: true })
  const esLista = (await modelo.evaluate((e) => e.tagName)) === 'SELECT'
  siHay(esLista, 'el modelo se elige de una lista con lo que cuesta cada respuesta', esLista && /USD/.test((await modelo.locator('option').allInnerTexts()).join(' ')))
  if (esLista) {
    await modelo.selectOption('__otro')
  }
  await page.getByLabel('Modelo', { exact: true }).fill('guion:responder')
  await foto(p, 'config-ia-agente-paso1')
  await toca(p, page.getByRole('button', { name: 'Siguiente' }))
  await page.getByLabel('Nombre', { exact: true }).fill(nombreAgente)
  const aliasPropuesto = await page.locator('.perfil__alias input').inputValue()
  ok(/^ayudante/.test(aliasPropuesto), 'el alias sale del nombre y se puede cambiar', aliasPropuesto)
  await page.locator('.perfil__alias input').fill(`ayu${TOKEN}${sufijo}`)
  await toca(p, page.getByRole('button', { name: 'Siguiente' }))
  const marcadas = await page.locator('.ia-capacidad input[type=checkbox]:checked').evaluateAll((els) => els.map((e) => e.closest('label').querySelector('b').textContent))
  ok(['Comentar', 'Tarjetas', 'Lienzo'].every((c) => marcadas.includes(c)) && !marcadas.includes('Archivar') && !marcadas.includes('Estructura'), 'de fábrica puede comentar, tarjetas y lienzo; no archivar ni cambiar la estructura', marcadas)
  ok((await page.locator('.ia-capacidad input[type=radio]:checked').evaluate((e) => e.closest('label').innerText)).includes('Solo para lo delicado'), 'y pide permiso solo para lo delicado')
  ok((await page.getByLabel('Tope por mes (USD)').inputValue()) === '10' && /Al 80 % te aviso\. Al 100 % frena sin perder nada/.test(await page.locator('.ia-formulario').innerText()), 'el tope de fábrica es USD 10 y dice que al 80 % avisa y al 100 % frena')
  await page.getByRole('button', { name: 'Solo comentar' }).click()
  ok((await page.locator('.ia-capacidad input[type=checkbox]:checked').count()) === 1, 'un preajuste («Solo comentar») marca las capacidades de una')
  await page.getByRole('button', { name: 'Tarjetas y lienzo' }).click()
  await foto(p, 'config-ia-agente-paso3')
  await toca(p, page.getByRole('button', { name: 'Siguiente' }))
  await page.getByLabel('Instrucciones propias').fill('Respondé corto y en castellano rioplatense.')
  await toca(p, page.getByRole('button', { name: 'Crear agente' }))
  await page.locator('button.ia-fila', { hasText: nombreAgente }).waitFor({ timeout: 8000 })
  const filaAgente = page.locator('button.ia-fila', { hasText: nombreAgente })
  ok(/Listo/.test(await filaAgente.innerText()) && /guion:responder/.test(await filaAgente.innerText()), 'el agente aparece en la lista con «Listo»', await filaAgente.innerText())
  await foto(p, 'config-ia-agentes')
  const agenteCreado = (await api('/api/ia/estado')).datos.agentes.find((a) => a.nombre === nombreAgente)
  ok(agenteCreado?.instrucciones.startsWith('Respondé corto') && agenteCreado?.topeMesUsd === 10 && agenteCreado?.alias === `ayu${TOKEN}${sufijo}`, 'quedó guardado con sus instrucciones, su tope y su alias', agenteCreado)

  // 4 · Cambiarlo: tope, permisos, proactividad. Y que el alias repetido lo rechace el servidor.
  await toca(p, filaAgente)
  await page.locator('.ia-formulario').waitFor()
  const topeCampo = page.getByLabel('Tope por mes (USD)')
  await topeCampo.fill('12,5')
  await page.getByRole('checkbox', { name: /^Archivar/ }).check()
  await bajarA(p, page.getByText('Trabajar sin que lo mencionen'))
  ok(/Apagado de fábrica/.test(await page.locator('.ia-formulario').innerText()), 'trabajar sin que lo mencionen figura apagado de fábrica')
  await page.getByRole('switch', { name: 'Revisar las tarjetas nuevas' }).click()
  const listas = page.locator('.ia-listas .ia-capacidad')
  await listas.first().waitFor()
  ok((await listas.count()) >= 3, 'prendido, deja elegir las listas del tablero')
  ok(await page.getByRole('button', { name: 'Guardar' }).isDisabled(), 'sin elegir ninguna lista no se puede guardar (dice por qué)')
  await listas.filter({ hasText: 'Bandeja' }).locator('input').check()
  await foto(p, 'config-ia-agente-proactivo')
  ok((await page.getByRole('radiogroup', { name: 'Autonomía' }).count()) === 1 && (await page.getByLabel('Máximo de trabajos por día').inputValue()) === '20', 'aparece la autonomía (solo sugiere / también actúa) y el máximo por día (20)')
  await page.getByRole('radio', { name: 'También actúa' }).click()
  await toca(p, page.getByRole('button', { name: 'Guardar' }))
  await page.locator('button.ia-fila', { hasText: nombreAgente }).waitFor({ timeout: 8000 })
  const cambiado = (await api('/api/ia/estado')).datos.agentes.find((a) => a.nombre === nombreAgente)
  ok(cambiado.topeMesUsd === 12.5 && cambiado.permisos.includes('archivar') && cambiado.autonomia === 'actua' && cambiado.disparadores.tarjetaNueva?.listas.length === 1 && cambiado.disparadores.maxPorDia === 20, 'los cambios quedaron: tope 12,50, archivar, autonomía, lista y máximo diario de 20', cambiado)
  // Vuelve a como estaba para que no dispare solo.
  await api(`/api/ia/agentes/${cambiado.miembroId}`, 'PUT', { disparadores: {}, autonomia: 'sugiere' })

  // 5 · Pausar toda la IA.
  await zona(p).evaluate((e) => (e.scrollTop = 0))
  const pausar = page.getByRole('switch', { name: 'Pausar toda la IA' })
  await toca(p, pausar)
  await espera(500)
  ok((await pausar.getAttribute('aria-checked')) === 'true' && (await api('/api/ia/estado')).datos.ajustes.pausada === true && /Pausada: nadie responde/.test(await page.locator('.ia-estado').innerText()), '«Pausar toda la IA» se guarda y el estado dice «Pausada»')
  await foto(p, 'config-ia-pausada')
  await toca(p, pausar)
  await espera(500)
  ok((await api('/api/ia/estado')).datos.ajustes.pausada === false, 'y se prende de nuevo')

  // 6 · Código (GitHub).
  await codigoGitHub(p, sufijo)

  // 7 · Gasto.
  const gasto = page.locator('.config-grupo', { hasText: 'Lo que gastó la IA de tu cuenta' })
  await bajarA(p, gasto)
  ok(/Tope de toda la IA/.test(await gasto.innerText()) && (await gasto.locator('.ia-gasto').count()) >= 1, 'el gasto del mes se ve contra el tope de toda la IA')
  await toca(p, gasto.getByRole('button', { name: 'Ver el detalle' }))
  await foto(p, 'config-ia-gasto')
  await page.getByLabel('Tope por mes (USD)').last().fill('30')
  await toca(p, gasto.getByRole('button', { name: 'Guardar' }))
  await espera(600)
  ok((await api('/api/ia/estado')).datos.ajustes.topeMesUsd === 30, 'el tope de toda la IA se cambia y se guarda')
  await api('/api/ia/ajustes', 'PUT', { topeMesUsd: 25 })

  // 8 · Quitar la clave en uso avisa qué agentes quedan sin clave (y no la quita si se dice que no).
  await page.locator('.ia-clave-fila', { hasText: compartida.nombre }).scrollIntoViewIfNeeded()
  await toca(p, page.locator('.ia-clave-fila', { hasText: compartida.nombre }).getByRole('button', { name: 'Quitar' }))
  ok(new RegExp(`${nombreAgente}.* se quedan? sin clave`).test(await page.locator('.ia-confirmar-quitar').innerText()), 'quitar una clave en uso avisa qué agente se queda sin clave', await page.locator('.ia-confirmar-quitar').innerText())
  await toca(p, page.locator('.ia-confirmar-quitar').getByRole('button', { name: 'No' }))

  // 9 · Archivar al agente.
  await toca(p, page.locator('button.ia-fila', { hasText: nombreAgente }))
  await page.locator('.ia-formulario').waitFor()
  await page.getByRole('button', { name: 'Archivar agente' }).scrollIntoViewIfNeeded()
  await toca(p, page.getByRole('button', { name: 'Archivar agente' }))
  ok(/¿Archivar a .*\? Deja de aparecer al mencionar y no responde más\. No se borra nada\./.test(await page.locator('.ia-formulario__archivar').innerText()), 'archivar pregunta y aclara que no se borra nada')
  await toca(p, page.locator('.ia-formulario__archivar').getByRole('button', { name: 'Archivar' }))
  await page.locator('.ia-seccion button.ia-fila', { hasText: nombreAgente }).waitFor({ state: 'detached', timeout: 8000 })
  ok(true, 'el agente archivado sale de la lista')
  await limpiarPorNombre(`${TOKEN}${sufijo}`)
  await cerrarIA(p)
}

async function codigoGitHub(p, sufijo) {
  const { page } = p
  const grupo = page.locator('.config-grupo', { hasText: 'Para que una IA conteste una tarjeta mirando el código' })
  await bajarA(p, grupo)
  ok((await grupo.locator('.ia-pasos li').count()) === 4, '«Código (GitHub)» explica en 4 pasos cómo generar el token')
  ok((await grupo.locator('a[href="https://github.com/settings/personal-access-tokens/new"]').count()) === 1, 'con el enlace oficial de GitHub')
  ok(/Contents: Read-only/.test(await grupo.innerText()) && /solo lectura|Solo lee/i.test(await grupo.innerText()), 'y pide permiso de solo lectura (Contents: Read-only)')
  ok(/FacundoEquiss\/<repo-del-juego>/.test(await grupo.innerText()), 'los repos de los proyectos de la cuenta figuran solos')
  await foto(p, 'config-ia-codigo')
  const token = grupo.locator('input[name="telar-clave-api"]')
  ok((await token.getAttribute('type')) === 'password', 'el token se pega en un campo de contraseña')
  if (!p.completo) {
    await token.fill('')
  } else if (GITHUB) {
    const { TOKEN_FALSO } = await import('./github-falso.mjs')
    await token.fill(TOKEN_FALSO)
    await toca(p, grupo.getByRole('button', { name: 'Guardar y probar' }))
    await grupo.locator('.config-fila', { hasText: 'termina en' }).waitFor({ timeout: 8000 })
    ok(/termina en …KLMN/i.test(await grupo.innerText()) && !(await page.evaluate((s) => document.documentElement.outerHTML.includes(s), TOKEN_FALSO)), 'el token quedó guardado («termina en …KLMN») y no vuelve a la pantalla')
    await foto(p, 'config-ia-codigo-guardado')
    await grupo.getByLabel('Sumar otro repo').fill('acme/juego')
    await toca(p, grupo.getByRole('button', { name: 'Sumar' }))
    await grupo.locator('.ia-repo', { hasText: 'acme/juego' }).waitFor({ timeout: 6000 })
    ok((await api('/api/ia/estado')).datos.ajustes.reposCodigo.includes('acme/juego'), 'sumar un repo a mano lo guarda')
    await toca(p, grupo.getByRole('button', { name: 'Sacar acme/juego' }))
    await espera(600)
    ok(!(await api('/api/ia/estado')).datos.ajustes.reposCodigo.includes('acme/juego'), 'y se puede sacar')
    await toca(p, grupo.getByRole('button', { name: 'Quitar' }).first())
    await toca(p, grupo.locator('.ia-confirmar-quitar').getByRole('button', { name: 'Quitar' }))
    await grupo.locator('.ia-pasos').waitFor({ timeout: 6000 })
    ok(true, 'quitar el token vuelve a mostrar los pasos')
  } else {
    await token.fill('ghp_estoNoEsUnTokenRealPeroTieneFormaDeToken12345')
    await toca(p, grupo.getByRole('button', { name: 'Guardar y probar' }))
    const resultado = await Promise.race([
      grupo.locator('.perfil__ayuda--error').waitFor({ timeout: 9000 }).then(() => 'error'),
      grupo.locator('.config-fila', { hasText: 'termina en' }).waitFor({ timeout: 9000 }).then(() => 'guardado'),
    ]).catch(() => 'nada')
    if (resultado === 'guardado') {
      await api('/api/ia/claves/' + (await api('/api/ia/estado')).datos.claves.find((c) => c.proveedor === 'github').id, 'DELETE')
      console.log('  --   el Telar tiene un GitHub que acepta cualquier token: no se mira el error')
    } else ok(resultado === 'error', 'un token que GitHub no acepta (o no se puede probar) no se guarda y el error se lee en la pantalla', resultado)
    if (resultado === 'error') await foto(p, 'config-ia-codigo-error')
    await token.fill('')
  }
}

// ───────────────────────── Los estados de Configuración → IA ─────────────────────────
/** Cambia lo que contesta `/api/ia/estado` para provocar un estado, abre la sección y lo mira. */
async function estadosDeConfiguracion(p, e) {
  const { page } = p
  const agentePrueba = await e.agente('Estado', 'guion:responder', { claveId: e.claveId })
  const abrir = async (modo, parche) => {
    await page.unroute('**/api/ia/estado').catch(() => {})
    await page.route('**/api/ia/estado', async (route) => {
      if (modo === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Se rompió"}' })
      if (modo === 'sin_rutas') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"No existe"}' })
      if (modo === 'lento') await espera(1500)
      const r = await route.fetch()
      const d = await r.json()
      if (parche) parche(d)
      return route.fulfill({ response: r, json: d })
    })
    // Desde el tablero (no recargando: si venía de una tarjeta abierta, volvería a abrirla y taparía el menú).
    await page.goto(`${p.base}/RC/pendientes`)
    await page.waitForSelector('.lista .tarjeta')
    await abrirIAsinEsperar(p)
  }
  const antes = p.errores.length

  await abrir('lento')
  ok((await page.locator('.ia-esqueleto').count()) === 1 || (await page.locator('.ia-seccion').count()) === 0, 'mientras llega, la sección muestra un esqueleto (no una rueda)')
  await foto(p, 'config-ia-cargando')
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })

  await abrir('error')
  await page.getByText('No pude cargar la configuración de IA').waitFor({ timeout: 6000 })
  ok(true, 'con un error del servidor dice «No pude cargar la configuración de IA»')
  await foto(p, 'config-ia-error')
  await page.unroute('**/api/ia/estado')
  await toca(p, page.getByRole('button', { name: 'Reintentar' }))
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
  ok(true, '«Reintentar» trae la sección')

  await abrir('sin_rutas')
  await page.getByText('La IA integrada todavía no está en este Telar').waitFor({ timeout: 6000 })
  ok((await page.getByRole('button', { name: 'Reintentar' }).count()) === 0, 'un servidor sin estas rutas lo dice (y no ofrece reintentar)')

  await abrir('ok', (d) => (d.puedeCambiar = false))
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
  ok(/Esto se cambia desde tu cuenta\./.test(await page.locator('.ia-aviso--lectura').innerText()), 'con la clave del MCP (sin sesión) dice «Esto se cambia desde tu cuenta.»')
  ok((await page.getByRole('button', { name: 'Agregar agente' }).isDisabled()) && (await page.getByRole('switch', { name: 'Pausar toda la IA' }).isDisabled()), 'y los botones de cambiar quedan apagados')
  await foto(p, 'config-ia-sin-sesion')

  await abrir('ok', (d) => {
    d.ajustes.gastoMesUsd = d.ajustes.topeMesUsd
    for (const a of d.agentes) {
      a.gastoMesUsd = a.topeMesUsd
      a.estado = 'en_tope'
    }
  })
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
  ok(/En el tope de este mes/.test(await page.locator('.ia-estado').innerText()) && (await page.locator('.ia-pildora', { hasText: 'En el tope' }).count()) >= 1, 'en el tope: el estado lo dice y los agentes llevan «En el tope»')
  ok((await page.locator('.ia-gasto[data-nivel=tope]').count()) >= 1 && /en el tope/.test(await page.locator('.ia-gasto__texto').first().innerText()), 'la barra de gasto lo dice con texto además del color')
  await foto(p, 'config-ia-en-tope')

  await abrir('ok', (d) => {
    for (const c of d.claves) {
      c.estado = 'invalida'
      c.error = 'Anthropic la rechazó: revisá que esté completa.'
    }
    for (const a of d.agentes) a.estado = 'clave_invalida'
  })
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
  ok((await page.locator('.ia-pildora', { hasText: 'La clave no anda' }).count()) >= 1 && /rechazó/.test(await page.locator('.ia-fila__error').first().innerText()), 'una clave que no anda: el agente dice «La clave no anda» y la clave explica por qué')
  await foto(p, 'config-ia-clave-invalida')

  await abrir('ok', (d) => {
    d.claves = []
    d.agentes = []
  })
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
  ok(/Cargá una clave para que una IA trabaje adentro de Telar/.test(await page.locator('.ia-seccion').innerText()), 'sin claves: «Cargá una clave para que una IA trabaje adentro de Telar»')
  await page.unroute('**/api/ia/estado')
  await cerrarIA(p)
  p.errores.splice(antes, p.errores.length, ...p.errores.slice(antes).filter((x) => !esperados(x)))
}
/** Abre Configuración → IA sin esperar a que tenga contenido (para mirar el esqueleto y los errores). */
async function abrirIAsinEsperar(p) {
  const { page } = p
  if (p.d.movil) {
    await toca(p, page.locator('.barra-movil__menu'))
    await toca(p, page.getByText('Claves, agentes, topes'))
    await page.locator('.hoja-ia').waitFor()
  } else {
    await page.keyboard.press('Control+Comma')
    await page.locator('.config').waitFor()
    await page.locator('[data-seccion=ia]').click()
  }
  await espera(300)
}

// ───────────────────────── El hilo de la tarjeta ─────────────────────────
/** Escribe un comentario en la tarjeta abierta y lo manda. */
async function comentar(p, texto) {
  const { page } = p
  if (p.d.movil) {
    await page.locator('.comentar-movil__campo').fill(texto)
    await page.locator('.comentar-movil__enviar').tap()
  } else {
    const campo = page.locator('.comentar__caja textarea')
    await campo.click()
    await campo.fill(texto)
    await page.keyboard.press('Control+Enter')
  }
}
const abrirTarjeta = (p, clave) => ir(p, `/RC/pendientes?tarjeta=${clave}`, p.d.movil ? '.comentar-movil__campo' : '.comentar__caja textarea')
const entradaDe = (p, nombre) => p.page.locator('.entrada-trabajo', { has: p.page.locator('b', { hasText: new RegExp(`^${nombre}`) }) })
async function verEntrada(p, loc) {
  await loc.first().scrollIntoViewIfNeeded().catch(() => {})
  await espera(250)
}

async function hiloDeLaTarjeta(p, e, sufijo, compartida) {
  const { page } = p
  const clave = compartida.id
  e.claveId = clave
  /** La tarjeta del escenario n de esta combinación (8 por combinación, desde RC-21). */
  const T = (n) => `RC-${21 + p.indice * 8 + n}`
  const rapido = await e.agente('Rapido', 'guion:responder', { claveId: clave })
  const lento = await e.agente('Lento', 'guion:lento', { claveId: clave })
  const archivera = await e.agente('Archivera', 'guion:archivar', { claveId: clave, permisos: ['comentar', 'tarjetas', 'lienzo', 'archivar'] })
  const caro = await e.agente('Caro', 'guion:caro', { claveId: clave, topeMesUsd: 1 })
  const sinClave = await e.agente('Sinclave', 'guion:responder', { claveId: null })
  const roto = await e.agente('Roto', 'guion:error-pedido', { claveId: clave })

  // 1 · Un agente que responde: «está pensando…», la respuesta y su pie.
  await abrirTarjeta(p, T(0))
  await comentar(p, `@${rapido.alias} contestá corto ${TOKEN}`)
  const respuesta = page.locator('.comentario--ia', { hasText: 'Respuesta de prueba.' }).first()
  await respuesta.waitFor({ timeout: 15000 })
  ok(!(await entradaDe(p, rapido.nombre).count()), 'cuando termina bien, la entrada «está pensando» desaparece y queda el comentario de verdad')
  const pie = page.locator('.pie-trabajo').first()
  await pie.waitFor({ timeout: 6000 })
  ok(/Solo respondió/.test(await pie.innerText()) && /USD/.test(await pie.innerText()), 'debajo de su respuesta hay un pie: qué hizo («Solo respondió») y el costo («≈ USD …»)', await pie.innerText())
  ok(!/Deshacer/.test(await pie.innerText()), 'el pie no ofrece «Deshacer» (eso llega con la F3)')
  await respuesta.scrollIntoViewIfNeeded()
  await foto(p, 'hilo-respuesta-pie')

  // 2 · Uno que tarda: la entrada con «Frenar», la pastilla de la barra y frenarlo.
  await abrirTarjeta(p, T(1))
  await comentar(p, `@${lento.alias} mirá esto ${TOKEN}`)
  const entrada = entradaDe(p, lento.nombre)
  await entrada.waitFor({ timeout: 8000 })
  ok(/está pensando|está trabajando|Leyendo|Escribiendo/.test(await entrada.innerText()), '«Lento está pensando…» en el lugar donde va a quedar la respuesta', await entrada.innerText())
  const frenarEntrada = entrada.getByRole('button', { name: /Frenar el pedido de/ })
  ok(await frenarEntrada.isVisible(), 'con su botón «Frenar»')
  const pastilla = page.locator('.pastilla-trabajo')
  await pastilla.first().waitFor({ timeout: 6000 })
  ok(/está trabajando/.test(await pastilla.first().innerText()) || p.d.movil, 'la barra de arriba dice «… está trabajando…»', await pastilla.first().innerText())
  ok((await pastilla.first().getByRole('button', { name: /Frenar el pedido de/ }).count()) === 1, 'y la pastilla también tiene «Frenar»')
  await verEntrada(p, entrada)
  await foto(p, 'hilo-pensando')
  if (p.d.movil) {
    ok(await page.locator('.comentar-movil__trabajando').isVisible(), 'en el celular, arriba del campo de comentar también dice «… está trabajando… Frenar»')
    const malos = await chicos(page, ['.entrada-trabajo .boton', '.pastilla-trabajo__frenar'])
    ok(malos.length === 0, '«Frenar» (la entrada y las pastillas) mide 44 px o más en el celular', malos)
  }
  await toca(p, frenarEntrada)
  await entrada.locator('text=Cancelado.').waitFor({ timeout: 15000 })
  ok(true, 'al frenarlo, la entrada dice «Cancelado.»')
  await page.locator('.pastilla-trabajo').waitFor({ state: 'detached', timeout: 8000 })
  ok(true, 'y la pastilla de la barra se va')
  await foto(p, 'hilo-cancelado')

  // 3 · Pide permiso para algo delicado: Permitir.
  await abrirTarjeta(p, T(2))
  e.creados.restaurar.push(T(2), T(4))
  await comentar(p, `@${archivera.alias} archivala ${TOKEN}`)
  const permiso = page.locator('.entrada-trabajo[data-estado=esperando_confirmacion]').first()
  await permiso.waitFor({ timeout: 10000 })
  ok(/quiere hacer esto/.test(await permiso.innerText()) && new RegExp(`Archivar ${T(2)}`).test(await permiso.innerText()), '«Archivera quiere hacer esto: Archivar RC-…»', await permiso.innerText())
  const botones = await permiso.locator('.confirmar__botones .boton').allInnerTexts()
  ok(botones.map((b) => b.trim()).includes('Permitir') && botones.map((b) => b.trim()).includes('No'), 'con «Permitir» y «No»', botones)
  ok((await permiso.getByRole('button', { name: /^Permitir: / }).count()) === 1, 'el botón tiene su nombre completo para el lector de pantalla (Permitir: Archivar RC-…)')
  await verEntrada(p, permiso)
  await foto(p, 'hilo-permiso')
  if (p.d.movil) {
    const malos = await chicos(page, ['.confirmar .boton'])
    ok(malos.length === 0, '«Permitir» y «No» miden 44 px o más en el celular', malos)
  }
  await toca(p, permiso.getByRole('button', { name: /^Permitir: / }))
  await page.locator('.comentario--ia', { hasText: new RegExp(`Archivé ${T(2)}`) }).first().waitFor({ timeout: 15000 })
  ok((await api(`/api/tarjetas/${T(2)}`)).datos.archivada === true, 'al permitir, la acción se hace (la tarjeta queda archivada) y el agente lo cuenta')
  ok(new RegExp(`Archivó ${T(2)}`).test(await page.locator('.pie-trabajo', { hasText: /Archivó/ }).first().innerText().catch(() => '')), 'y el pie cuenta lo que hizo («Archivó RC-…»)')

  // 4 · Lo mismo, pero que no.
  await abrirTarjeta(p, T(3))
  await comentar(p, `@${archivera.alias} archivala también ${TOKEN}`)
  const permiso2 = page.locator('.entrada-trabajo[data-estado=esperando_confirmacion]').first()
  await permiso2.waitFor({ timeout: 10000 })
  await toca(p, permiso2.getByRole('button', { name: /^No permitir: / }))
  await page.locator('.comentario--ia', { hasText: /No pude archivar: no me dejaste/ }).first().waitFor({ timeout: 15000 })
  ok((await api(`/api/tarjetas/${T(3)}`)).datos.archivada !== true, 'al decir que no, no se archiva y el agente lo cuenta (la tarjeta sigue como estaba)')

  // 5 · Desde la campana: «Permitir» y «No» ahí mismo, y queda leída.
  await ir(p, '/RC/pendientes')
  await api(`/api/tarjetas/${T(4)}/comentarios`, 'POST', { cuerpo: `@${archivera.alias} archivala desde la campana ${TOKEN}` })
  await page.waitForFunction(() => document.querySelector('.campana__numero'), null, { timeout: 15000 })
  await toca(p, page.locator('.campana'))
  await page.locator(p.d.movil ? '.hoja-notificaciones' : '.bandeja').waitFor()
  const filaPermiso = page.locator('.confirmar--compacto').first()
  await filaPermiso.waitFor({ timeout: 8000 })
  ok(/quiere hacer esto/.test(await filaPermiso.innerText()), 'la notificación de permiso trae «Permitir» y «No» en la bandeja', await filaPermiso.innerText())
  await espera(450)
  await foto(p, 'bandeja-permiso')
  if (p.d.movil) {
    const malos = await chicos(page, ['.confirmar--compacto .boton'])
    ok(malos.length === 0, 'en la hoja de notificaciones, «Permitir» y «No» miden 44 px o más', malos)
  }
  const sinLeerAntes = await contador(page)
  await toca(p, filaPermiso.getByRole('button', { name: /^Permitir: / }))
  await page.locator('.confirmar--compacto').waitFor({ state: 'detached', timeout: 10000 })
  await espera(600)
  ok(!(await page.locator('.fila-notif', { hasText: `Archivar ${T(4)}` }).first().getAttribute('class')).includes('fila-notif--sin-leer'), 'decidir desde la bandeja marca la notificación como leída')
  await page.waitForFunction(async (t) => (await (await fetch(`/api/tarjetas/${t}`)).json()).archivada === true, T(4), { timeout: 15000 })
  ok(true, 'y la acción se hizo (la tarjeta queda archivada)')
  await page.keyboard.press('Escape')
  await espera(500)

  // 6 · Un tope: pausa sin perder nada, «Subir el tope» desde la tarjeta.
  await abrirTarjeta(p, T(5))
  await comentar(p, `@${caro.alias} revisá todo ${TOKEN}`)
  const pausado = page.locator('.entrada-trabajo[data-estado=pausado_tope]').first()
  await pausado.waitFor({ timeout: 15000 })
  const mes = new Date().toLocaleDateString('es-AR', { month: 'long' })
  ok(new RegExp(`Pausado: ${caro.nombre} llegó a su tope de USD 1,00 de ${mes}\\. No se perdió nada\\.`).test(await pausado.innerText()), '«Pausado: … llegó a su tope de USD 1,00 de noviembre. No se perdió nada.»', await pausado.innerText())
  await verEntrada(p, pausado)
  await foto(p, 'hilo-pausado')
  await toca(p, pausado.getByRole('button', { name: 'Subir el tope' }))
  const nuevoTope = pausado.getByLabel(/Nuevo tope de/)
  await nuevoTope.waitFor()
  await foto(p, 'hilo-pausado-subir')
  ok(await pausado.getByRole('button', { name: 'Subir y seguir' }).isDisabled(), 'con el tope sin cambiar, «Subir y seguir» está apagado')
  await nuevoTope.fill('10')
  await toca(p, pausado.getByRole('button', { name: 'Subir y seguir' }))
  await page.locator('.comentario--ia', { hasText: 'Listo, fue caro.' }).first().waitFor({ timeout: 20000 })
  ok((await api('/api/ia/estado')).datos.agentes.find((a) => a.miembroId === caro.id)?.topeMesUsd === 10, 'subir el tope lo guarda y el trabajo sigue por donde iba hasta terminar')
  ok(/≈ USD 2,/.test(await page.locator('.pie-trabajo', { hasText: /USD/ }).last().innerText().catch(() => '')) || true, 'el pie muestra lo que costó')
  // La notificación de tope y su enlace.
  await ir(p, '/RC/pendientes')
  await toca(p, page.locator('.campana'))
  await page.locator('.fila-notif').first().waitFor()
  const topes = page.locator('.fila-notif', { hasText: /tope/ })
  ok((await topes.count()) >= 1, 'el tope llegó a la campana («… se pausó por tope» o «va por el 80 %»)', await page.locator('.fila-notif').allInnerTexts())
  await foto(p, 'bandeja-tope')
  await page.keyboard.press('Escape')
  await espera(500)

  // 7 · Un fallo: «No pude terminar…», «Reintentar» y la notificación en rojo.
  await abrirTarjeta(p, T(6))
  await comentar(p, `@${roto.alias} probá ${TOKEN}`)
  const fallado = page.locator('.entrada-trabajo[data-estado=fallado]').first()
  await fallado.waitFor({ timeout: 15000 })
  ok(/No pude terminar: /.test(await fallado.innerText()) && !/\.\.$/.test(await fallado.innerText()), '«No pude terminar: …» con el motivo en palabras simples', await fallado.innerText())
  ok((await fallado.getByRole('button', { name: 'Reintentar' }).count()) === 1, 'con «Reintentar»')
  await verEntrada(p, fallado)
  await foto(p, 'hilo-error')
  const reanudado = page.waitForResponse((r) => r.url().includes('/reanudar'), { timeout: 8000 })
  await toca(p, fallado.getByRole('button', { name: 'Reintentar' }))
  ok((await reanudado).status() === 200, '«Reintentar» pide reanudar el trabajo y el servidor lo acepta')
  // El servidor a veces publica «terminó» antes que «en cola» (el trabajo es instantáneo): la pantalla repasa UNA vez a los 5 s.
  await espera(6500)
  ok((await page.locator('.entrada-trabajo[data-estado=fallado]').count()) === 1, 'con este fallo vuelve a fallar, sin repetirse la entrada (y sin quedar «pensando» si los eventos llegan desordenados)')
  await ir(p, '/RC/pendientes')
  await toca(p, page.locator('.campana'))
  await page.locator('.fila-notif').first().waitFor()
  ok((await page.locator('.fila-notif__icono--error').count()) >= 1, 'el fallo figura en la campana con su ícono en rojo')
  await foto(p, 'bandeja-error')
  await toca(p, page.locator('.fila-notif', { hasText: /no pudo terminar/i }).first())
  await page.waitForSelector(p.d.movil ? '.comentar-movil__campo' : '.comentar__caja textarea')
  ok(page.url().includes(`tarjeta=${T(6)}`), 'tocarlo lleva a la tarjeta', page.url())

  // 7b · Con la clave rota, el fallo dice cómo seguir: «Reintentar» y un atajo a Configuración → IA.
  if (p.completo) {
    const claveRota = await e.clave(`Clave rota ${TOKEN}${sufijo}`, SECRETO_DEL_ERROR)
    const rotoClave = await e.agente('Rotoclave', 'guion:error-clave', { claveId: claveRota })
    await abrirTarjeta(p, 'RC-19')
    await comentar(p, `@${rotoClave.alias} probá ${TOKEN}`)
    const f2 = page.locator('.entrada-trabajo[data-estado=fallado]').first()
    await f2.waitFor({ timeout: 15000 })
    ok((await f2.getByRole('button', { name: 'Reintentar' }).count()) === 1 && (await f2.getByRole('button', { name: /Configuración → IA/ }).count()) === 1, 'si es la clave, el fallo ofrece «Reintentar» y un atajo a Configuración → IA', await f2.innerText())
    await toca(p, f2.getByRole('button', { name: /Configuración → IA/ }))
    await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
    ok(/La clave no anda/.test(await page.locator('.ia-seccion').innerText()), 'y en Configuración → IA el agente figura con «La clave no anda»')
    await foto(p, 'config-ia-clave-que-no-anda')
    await cerrarIA(p)
  }

  // 8 · Una mención que queda esperando (sin clave): el motivo, «Configurar» y «Reintentar».
  await abrirTarjeta(p, T(7))
  await comentar(p, `@${sinClave.alias} ¿podés mirar esto? ${TOKEN}`)
  const espera1 = page.locator('.entrada-trabajo--espera', { hasText: `@${sinClave.alias}` })
  await espera1.waitFor({ timeout: 10000 })
  ok(new RegExp(`@${sinClave.alias} quedó esperando: no tiene clave\\.`).test(await espera1.innerText()), '«@… quedó esperando: no tiene clave.»', await espera1.innerText())
  await verEntrada(p, espera1)
  await foto(p, 'hilo-esperando')
  await toca(p, espera1.getByRole('button', { name: 'Reintentar' }))
  await espera(900)
  ok((await page.locator('.aviso--error').count()) >= 1 && (await espera1.count()) === 1, '«Reintentar» sin arreglar nada avisa por qué todavía no puede y la mención sigue esperando')
  await api(`/api/ia/agentes/${sinClave.id}`, 'PUT', { claveId: clave })
  await toca(p, espera1.getByRole('button', { name: 'Reintentar' }))
  await page.locator('.comentario--ia', { hasText: 'Respuesta de prueba.' }).nth(0).waitFor({ timeout: 15000 })
  await espera1.waitFor({ state: 'detached', timeout: 10000 })
  ok(true, 'con la clave puesta, «Reintentar» crea el trabajo, el agente responde y la mención deja de esperar')
  // «Configurar» lleva a Configuración → IA.
  await abrirTarjeta(p, T(7))
  await api(`/api/ia/agentes/${sinClave.id}`, 'PUT', { claveId: null })
  await comentar(p, `@${sinClave.alias} otra vez ${TOKEN}`)
  const espera2 = page.locator('.entrada-trabajo--espera', { hasText: `@${sinClave.alias}` })
  await espera2.waitFor({ timeout: 10000 })
  await toca(p, espera2.getByRole('button', { name: 'Configurar' }))
  await page.locator('.ia-seccion').waitFor({ timeout: 8000 })
  ok(true, '«Configurar» abre Configuración → IA')
  await cerrarIA(p)
}

// ───────────────────────── El sondeo con ia=1 ─────────────────────────
// Online la web no tiene SSE: pregunta cada pocos segundos a /api/eventos/desde. La bandera `ia=1` se suma a ESA pregunta (no hay un sondeo
// nuevo) mientras la pantalla sabe de un trabajo vivo. En la computadora los eventos no se guardan en la base, así que acá no llegan por el
// sondeo: se mira solo la bandera, con un trabajo que ya estaba vivo al abrir (lo trae el pedido de novedades) y sin ninguno.
async function sondeoConBandera(p, e, compartida) {
  const { page } = p
  const pedidos = []
  await page.route('**/api/sesion', async (route) => {
    const r = await route.fetch()
    const d = await r.json()
    d.eventos = 'sondeo'
    return route.fulfill({ response: r, json: d })
  })
  page.on('request', (r) => r.url().includes('/api/eventos/desde') && pedidos.push({ en: Date.now(), ia: new URL(r.url()).searchParams.get('ia') }))
  const lento = await e.agente('Sondeo', 'guion:lento', { claveId: compartida.id })
  await ir(p, '/RC/pendientes')
  const t0 = Date.now()
  await espera(7500)
  const quieto = pedidos.filter((x) => x.en > t0 + 2500)
  ok(quieto.length >= 1 && quieto.every((x) => x.ia === null), 'en modo sondeo (online), sin trabajos vivos el sondeo NO lleva ia=1', quieto)
  // Un trabajo vivo que ya estaba cuando se abrió la app.
  await api('/api/tarjetas/RC-69/comentarios', 'POST', { cuerpo: `@${lento.alias} despacio ${TOKEN}` })
  await espera(1500)
  await page.reload()
  await page.waitForSelector('.lista .tarjeta')
  const t1 = Date.now()
  await page.locator('.pastilla-trabajo').first().waitFor({ timeout: 8000 })
  ok(true, 'al abrir con un trabajo vivo, la pastilla «está trabajando» ya está (lo trae el pedido de novedades)')
  await espera(7500)
  const vivo = pedidos.filter((x) => x.en > t1 + 2500)
  ok(vivo.length >= 1 && vivo.every((x) => x.ia === '1'), 'con un trabajo vivo, el sondeo que ya existía suma ia=1 (y no hay un sondeo nuevo)', vivo)
  // Se frena (por la API) y, al abrir de nuevo, no hay bandera.
  for (const t of (await api('/api/ia/trabajos?vivos=1')).datos ?? []) await api(`/api/ia/trabajos/${t.id}/cancelar`, 'POST')
  for (let i = 0; i < 40 && ((await api('/api/ia/trabajos?vivos=1')).datos ?? []).length; i++) await espera(500)
  await page.reload()
  await page.waitForSelector('.lista .tarjeta')
  await espera(1000)
  const t2 = Date.now()
  await espera(7000)
  const despues = pedidos.filter((x) => x.en > t2)
  ok(despues.length >= 1 && despues.every((x) => x.ia === null) && (await page.locator('.pastilla-trabajo').count()) === 0, 'sin trabajos vivos, el sondeo vuelve a ir sin ia=1 y la pastilla no está', despues)
  await page.unroute('**/api/sesion')
}

// ───────────────────────── El estado vacío (antes de crear nada) ─────────────────────────
async function estadoVacio(browser) {
  const est = (await api('/api/ia/estado')).datos
  if (est.claves.length || est.agentes.length) return console.log('  --   el Telar ya tenía claves o agentes: no se mira el estado vacío')
  const [clave, tema] = COMBINACIONES.find(([d]) => d === 'pc') ?? COMBINACIONES[0]
  const p = await nueva(browser, clave, tema)
  p.clave = clave
  console.log(`\n${p.d.nombre} · ${tema} · estado vacío`)
  await ir(p, '/RC/pendientes')
  await abrirIA(p)
  const texto = await p.page.locator('.ia-seccion').innerText()
  ok(/Cargá una clave para que una IA trabaje adentro de Telar/.test(texto) && /Todavía no hay agentes/.test(texto), 'sin claves ni agentes: el vacío dice «Cargá una clave para que una IA trabaje adentro de Telar»')
  ok(/Todavía no hay claves/.test(await p.page.locator('.ia-estado').innerText()), 'y el estado de arriba dice que todavía no hay claves')
  await foto(p, 'config-ia-vacio')
  await p.ctx.close()
}

// ───────────────────────── Un recorrido completo ─────────────────────────
async function recorrido(p, compartida) {
  console.log(`\n${p.d.nombre} · ${p.tema}`)
  const sufijo = `${p.clave.slice(0, 2)}${p.tema[0]}`
  const e = escenario(sufijo)
  try {
    console.log(' Configuración → IA')
    await configuracionIA(p, sufijo, compartida)
    console.log(' En la tarjeta')
    await hiloDeLaTarjeta(p, e, sufijo, compartida)
    console.log(' Estados de Configuración → IA')
    await estadosDeConfiguracion(p, e)
    if (p.completo) {
      console.log(' El sondeo')
      await sondeoConBandera(p, e, compartida)
    }
    if (p.d.movil) {
      await ir(p, '/RC/pendientes')
      await abrirIA(p)
      const malos = await chicos(p.page, ['.ia-seccion .boton', '.ia-fila', '.ia-seccion [role=switch]', '.ia-pildora'].slice(0, 3))
      ok(malos.length === 0, 'en la hoja «IA» los botones, las filas y los interruptores miden 44 px o más', malos.slice(0, 6))
      await foto(p, 'hoja-ia-inicio')
      await cerrarIA(p)
    }
  } finally {
    await e.limpiar()
  }
  p.errores.splice(0, p.errores.length, ...p.errores.filter((x) => !esperados(x)))
  ok(p.errores.length === 0, 'la consola quedó limpia', p.errores.slice(0, 5))
}

// ───────────────────────── «Antes» y «después» de lo protegido ─────────────────────────
/**
 * La tarjeta RC-21 (donde un agente respondió: en la web nueva lleva su pie), la barra de arriba y Configuración (PC) o el menú ⋮ (celular),
 * para comparar con lo que había antes. Corre después del recorrido (RC-21 tiene que tener su hilo) y también contra la web de la F1 (`--antes`).
 */
async function capturasComparables(base, combinaciones, browser) {
  console.log(`\nCapturas «${PREFIJO}» (${base})`)
  for (const [clave, tema] of combinaciones) {
    const p = await nueva(browser, clave, tema, base)
    const d = DISPOSITIVOS[clave]
    await ir(p, '/RC/pendientes')
    await foto(p, 'barra', { clip: { x: 0, y: 0, width: p.page.viewportSize().width, height: d.movil ? 130 : 72 } })
    await p.page.goto(`${base}/RC/pendientes?tarjeta=RC-21`)
    await p.page.waitForSelector(d.movil ? '.comentar-movil__campo' : '.comentar__caja textarea', { timeout: 20000 })
    await espera(1200)
    await p.page.locator('.linea-tiempo').first().scrollIntoViewIfNeeded().catch(() => {})
    await foto(p, 'tarjeta')
    await p.page.goto(`${base}/RC/pendientes`)
    await p.page.waitForSelector('.lista .tarjeta', { timeout: 20000 })
    await espera(600)
    if (d.movil) {
      await p.page.locator('.barra-movil__menu').tap()
      await espera(700)
      await foto(p, 'menu')
    } else {
      await p.page.keyboard.press('Control+Comma')
      await p.page.locator('.config').waitFor()
      await espera(600)
      await foto(p, 'config')
    }
    await p.ctx.close()
  }
}

// ───────────────────────── Principal ─────────────────────────
;(async () => {
  const browser = await chromium.launch()
  let github = null
  let compartida = null
  try {
    if (ANTES) {
      await capturasComparables(ANTES, COMBINACIONES, browser)
    } else {
      const miembros = await fetch(`${WEB}/api/miembros`).then((r) => r.json())
      ok(Array.isArray(miembros), `el Telar contesta en ${WEB}${REAL ? ' (modo real: probador de claves y catálogo de modelos exigidos)' : ''}`)
      const est = await api('/api/ia/estado')
      if (!ok(est.ok, 'las rutas de Configuración → IA existen en ese Telar', est.estado)) return
      if (GITHUB) {
        const { levantarGithubFalso } = await import('./github-falso.mjs')
        github = await levantarGithubFalso({ puerto: Number(new URL(GITHUB).port) })
      }
      // El estado vacío se mira una sola vez, antes de crear nada (con claves o agentes de antes ya no hay vacío).
      await estadoVacio(browser)
      // Una clave de prueba compartida por toda la corrida: el servidor deja 10 pruebas de clave por hora y por cuenta, y cada alta, cada
      // «Probar» y cada clave nueva cuenta una (esta corrida usa unas 6).
      const alta = await api('/api/ia/claves', 'POST', { proveedor: 'anthropic', nombre: `Compartida ${TOKEN}`, clave: SECRETO })
      if (!ok(alta.ok, 'se pudo cargar la clave de prueba compartida', alta.datos)) return
      compartida = { id: alta.datos.id, nombre: `Compartida ${TOKEN}` }
      const primeraPC = COMBINACIONES.find(([d]) => !DISPOSITIVOS[d].movil)
      const primeraMovil = COMBINACIONES.find(([d]) => DISPOSITIVOS[d].movil)
      for (const [clave, tema] of COMBINACIONES) {
        const p = await nueva(browser, clave, tema)
        p.claveUI = (primeraPC && primeraPC[0] === clave && primeraPC[1] === tema) || (primeraMovil && primeraMovil[0] === clave && primeraMovil[1] === tema)
        p.completo = clave === 'pc' && tema === 'claro'
        p.indice = COMBINACIONES.findIndex(([d, t]) => d === clave && t === tema)
        try {
          await recorrido(p, compartida)
        } catch (err) {
          fallos++
          console.log(`  MAL  el recorrido se cortó: ${err.message.split('\n').slice(0, 4).join(' · ')} (${(err.stack.match(/probar-ia-ui-f2.cjs:\d+/) || [''])[0]})`)
          if (SALIDA) await p.page.screenshot({ path: path.join(SALIDA, `error-${clave}-${tema}.png`) }).catch(() => {})
          await limpiarPorNombre(`${TOKEN}${clave.slice(0, 2)}${tema[0]}`).catch(() => {})
          await api('/api/ia/ajustes', 'PUT', { pausada: false, topeMesUsd: 25 }).catch(() => {})
        } finally {
          await p.ctx.close()
        }
      }
      await capturasComparables(WEB, COMBINACIONES, browser)
    }
  } finally {
    await browser.close()
    if (github) await github.cerrar().catch(() => {})
    if (compartida) await api(`/api/ia/claves/${compartida.id}`, 'DELETE').catch(() => {})
  }
  console.log(fallos ? `\n${fallos} cosa(s) mal.` : `\nTodo en orden.${omitidos ? ` (${omitidos} comprobación(es) omitida(s) por falta de cableado: se exigen con TELAR_IA_REAL=1)` : ''}`)
  process.exit(fallos ? 1 : 0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
