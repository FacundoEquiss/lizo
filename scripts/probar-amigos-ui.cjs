// Recorrido de Configuración → Amigos y del enlace de invitación, con Playwright, SOLO contra un Telar local descartable (nunca
// producción, nunca claves reales). Levanta su propio Telar online-de-mentira (TABLERO_PUBLICO=1, base en una carpeta temporal) y recorre,
// en PC (1440 × 900) y en celular emulado (iPhone 15 y Pixel 8), en claro y en oscuro:
//   el dueño abre Configuración → Amigos (en el celular: Menú ⋮ → Amigos) → «Todavía no invitaste a nadie» → «Invitar a un amigo» con los
//   valores de fábrica → «Crear enlace» → el enlace con «Copiar enlace» (se lee el portapapeles) y «Compartir» (Web Share, en el celular) y el
//   aviso «el enlace se muestra solo ahora» → un contexto de navegador SIN sesión abre el enlace → «<dueño> te invitó a Telar» → contraseña
//   corta (error) → se registra → entra a su Telar vacío → el mismo enlace otra vez: «Esta invitación ya no sirve» → el amigo con sesión abierta
//   que lo abre ve «Ya entraste a Telar» (no se pisa su sesión) → vuelta al dueño: el amigo en la lista (nombre, mail, desde cuándo, proyectos,
//   espacio, de qué invitación vino) → «Suspender» (qué pasa) → la sesión del amigo se corta → «Reactivar» → otra invitación y «Revocar» → su
//   enlace deja de servir → el tope de amigos editable → un amigo no ve «Amigos». Cuenta los controles táctiles de menos de 44 px (meta: 0) y la
//   consola tiene que quedar limpia (los errores de red que el recorrido provoca a propósito —un enlace que ya no sirve, una sesión
//   suspendida— se anotan aparte).
//
//   NODE_PATH=$(npm root -g) node scripts/probar-amigos-ui.cjs [--puerto 4660] [--capturas docs/capturas/amigos] [--solo=pc-claro,iphone15-oscuro]
// Necesita la web compilada (npm run build). Sale con código 1 si algo falla.
const { spawn } = require('node:child_process')
const { createHmac } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium, devices } = require('playwright')

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.find((a) => a.startsWith(`--${n}=`))
  if (i) return i.slice(n.length + 3)
  const j = args.indexOf(`--${n}`)
  return j === -1 ? d : args[j + 1]
}
const PUERTO = Number(opcion('puerto', '4660'))
const SOLO = opcion('solo', '')
const CAPTURAS = opcion('capturas', '')
const RAIZ = path.resolve(__dirname, '..')
const WEB = `http://127.0.0.1:${PUERTO}`
const SECRETO = 'secreto-de-prueba-amigos-ui-0123456789-abcdefghijklmnop'
const CLAVE = 'clave-de-prueba-del-mcp-amigos-ui'
const USUARIO_JUEGO = 'usuario-juego-prueba-ui'
if (CAPTURAS) fs.mkdirSync(path.resolve(CAPTURAS), { recursive: true })

const COMBINACIONES = [
  { id: 'pc-claro', nombre: 'PC 1440 × 900', tema: 'claro', contexto: { viewport: { width: 1440, height: 900 } }, movil: false, todas: true },
  { id: 'pc-oscuro', nombre: 'PC 1440 × 900', tema: 'oscuro', contexto: { viewport: { width: 1440, height: 900 } }, movil: false },
  { id: 'iphone15-claro', nombre: 'iPhone 15', tema: 'claro', contexto: devices['iPhone 15'], movil: true },
  { id: 'iphone15-oscuro', nombre: 'iPhone 15', tema: 'oscuro', contexto: devices['iPhone 15'], movil: true },
  { id: 'pixel8-claro', nombre: 'Pixel 8', tema: 'claro', contexto: devices['Pixel 8'], movil: true },
  { id: 'pixel8-oscuro', nombre: 'Pixel 8', tema: 'oscuro', contexto: devices['Pixel 8'], movil: true },
].filter((c) => !SOLO || SOLO.split(',').some((s) => c.id === s || c.id.startsWith(`${s}-`)))

let fallos = 0
let pruebas = 0
const chequear = (cond, que, detalle) => {
  pruebas++
  if (!cond) fallos++
  console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle ? `\n      ${String(detalle).slice(0, 500)}` : ''}`)
  return cond
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const FRASE = 'una frase larga de prueba'

function cookieJuego() {
  const base = `v1.${USUARIO_JUEGO}.${Math.floor(Date.now() / 1000) + 7200}`
  return `${base}.${createHmac('sha256', SECRETO).update(base).digest('base64url')}`
}

// ───────── el Telar de prueba ─────────
let hijo = null
let salida = ''
async function levantar() {
  salida = ''
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'telar-amigos-ui-'))
  if (await fetch(`${WEB}/api/salud`).then(() => true, () => false)) throw new Error(`El puerto ${PUERTO} ya está ocupado.`)
  hijo = spawn(path.join(RAIZ, 'node_modules', '.bin', 'tsx'), ['servidor/src/principal.ts'], {
    cwd: RAIZ,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TABLERO_DATOS: datos,
      TABLERO_PUERTO: String(PUERTO),
      TABLERO_SEMILLA_DISCORD: 'no',
      TABLERO_IA_FALSO: '1',
      TABLERO_PUBLICO: '1',
      TABLERO_SECRETO: SECRETO,
      TABLERO_USUARIOS: USUARIO_JUEGO,
      TABLERO_URL_PUBLICA: WEB,
      TABLERO_CLAVE: CLAVE,
      TABLERO_INVITACION: '', // sin variable: ni el enlace ni la cuenta abierta la necesitan
      TABLERO_EVENTOS_EN_BASE: '1',
      TABLERO_SUPABASE_URL: '',
      TABLERO_SUPABASE_ANON: '',
    },
  })
  hijo.stdout.on('data', (d) => (salida += d))
  hijo.stderr.on('data', (d) => (salida += d))
  for (let i = 0; i < 160; i++) {
    try {
      const r = await fetch(`${WEB}/api/salud`)
      if (r.ok && (await r.json()).listo) return datos
    } catch {}
    if (hijo.exitCode !== null) break
    await espera(500)
  }
  throw new Error(`El Telar de prueba no arrancó:\n${salida.slice(-1500)}`)
}
async function apagar(datos) {
  if (hijo && hijo.exitCode === null) {
    hijo.kill('SIGTERM')
    for (let i = 0; i < 40 && hijo.exitCode === null; i++) await espera(150)
    if (hijo.exitCode === null) hijo.kill('SIGKILL')
  }
  if (datos) fs.rmSync(datos, { recursive: true, force: true })
}
const api = (ruta, metodo = 'GET', cuerpo, cabeceras = {}) =>
  fetch(`${WEB}${ruta}`, {
    method: metodo,
    headers: { origin: WEB, 'content-type': 'application/json', authorization: `Bearer ${CLAVE}`, ...cabeceras },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })

// ───────── un recorrido ─────────
async function recorrer(browser, c, n) {
  console.log(`\n── ${c.nombre} · ${c.tema} ──`)
  const errores = []
  const esperados = []
  const mirar = (page, etiqueta, permitirRed = false) => {
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (permitirRed && /Failed to load resource/.test(t)) esperados.push(`${etiqueta}: ${t}`)
      else errores.push(`${etiqueta}: ${t}`)
    })
    page.on('pageerror', (e) => errores.push(`${etiqueta}: ${e.message}`))
  }
  const foto = async (page, nombre) => {
    if (!CAPTURAS) return
    if (!c.todas && !['amigos-enlace', 'unirse', 'amigos-lista'].includes(nombre)) return
    await page.screenshot({ path: path.resolve(CAPTURAS, `${c.id}-${nombre}.png`) })
  }
  const tema = (ctx) => ctx.addInitScript((t) => localStorage.setItem('tablero.tema', t), c.tema)

  // ── el dueño ──
  const ctxDueno = await browser.newContext({ ...c.contexto, permissions: ['clipboard-read', 'clipboard-write'], locale: 'es-AR' })
  await tema(ctxDueno)
  if (c.movil)
    await ctxDueno.addInitScript(() => {
      // Web Share como en un celular de verdad (Chromium de escritorio no lo trae): guarda lo que se le pasó.
      navigator.share = async (d) => {
        window.__compartido = d
      }
    })
  await ctxDueno.addCookies([{ name: 'tablero_sesion', value: cookieJuego(), url: WEB, httpOnly: true, sameSite: 'Lax' }])
  const dueno = await ctxDueno.newPage()
  mirar(dueno, 'dueño')
  await dueno.goto(`${WEB}/`)
  await dueno.waitForSelector('.app, [data-movil] .app-movil, main', { timeout: 20000 })
  await dueno.waitForFunction(() => document.body.innerText.length > 40, null, { timeout: 20000 })
  await espera(600)

  const abrirAmigos = async () => {
    if (c.movil) {
      await dueno.getByRole('button', { name: /^Menú:/ }).click()
      await dueno.locator('.hoja-mas').getByRole('button', { name: /Amigos/ }).click()
    } else {
      await dueno.keyboard.press('Control+Comma')
      await dueno.getByRole('tab', { name: 'Amigos' }).click()
    }
    await dueno.waitForSelector('.amigos-seccion', { timeout: 10000 })
  }
  // «Amigos» solo está para el dueño: en el menú del celular y en las secciones de Configuración.
  await abrirAmigos()
  chequear(true, `${c.movil ? 'el menú ⋮ tiene «Amigos»' : 'Configuración tiene la sección «Amigos»'} para el dueño`)
  await dueno.getByText('Todavía no invitaste a nadie').waitFor({ timeout: 8000 })
  chequear(true, 'estado vacío: «Todavía no invitaste a nadie»')
  chequear((await dueno.locator('.amigos-tranquilidad li').count()) === 8, 'los ocho miedos del dueño, una línea cada uno (sin aprobación no entra nadie, solicitudes, enlaces, suspender, topes, IA)')
  const textoMiedos = await dueno.locator('.amigos-tranquilidad').innerText()
  chequear(/solo lo suyo/.test(textoMiedos) && /vence solo/.test(textoMiedos) && /revocar/.test(textoMiedos) && /tope/.test(textoMiedos) && /propia clave/.test(textoMiedos), 'dicen: ve solo lo suyo, el enlace vence, se revoca/suspende, hay tope y la IA usa su propia clave')
  await foto(dueno, 'amigos-vacio')

  // ── invitar ──
  await dueno.getByRole('button', { name: 'Invitar a un amigo' }).click()
  await dueno.locator('#amigos-nota').waitFor()
  chequear((await dueno.getByRole('radio', { name: '1 persona' }).getAttribute('aria-checked')) === 'true' && (await dueno.getByRole('radio', { name: '7 días' }).getAttribute('aria-checked')) === 'true', 'los valores de fábrica ya están puestos: 1 persona y 7 días')
  await dueno.locator('#amigos-nota').fill('para Pablo')
  await foto(dueno, 'amigos-invitar')
  await dueno.getByRole('button', { name: 'Crear enlace' }).click()
  const campo = dueno.locator('input[aria-label="Enlace de invitación"]')
  await campo.waitFor({ timeout: 8000 })
  const enlace = await campo.inputValue()
  chequear(new RegExp(`^${WEB.replace(/[.]/g, '\\.')}/unirse/[A-Za-z0-9_-]{43}$`).test(enlace), 'se muestra el enlace «<la web>/unirse/<token>»', enlace)
  chequear(await dueno.getByText('El enlace se muestra solo ahora').isVisible(), 'avisa «el enlace se muestra solo ahora»')
  await foto(dueno, 'amigos-enlace')
  await dueno.getByRole('button', { name: 'Copiar enlace' }).click()
  const portapapeles = await dueno.evaluate(() => navigator.clipboard.readText())
  chequear(portapapeles === enlace, '«Copiar enlace» deja el enlace en el portapapeles', portapapeles)
  await dueno.getByRole('button', { name: 'Copiado' }).waitFor({ timeout: 3000 })
  chequear(true, 'el botón confirma «Copiado»')
  if (c.movil) {
    await dueno.getByRole('button', { name: 'Compartir' }).click()
    const compartido = await dueno.evaluate(() => window.__compartido)
    chequear(compartido?.url === enlace, '«Compartir» le pasa el enlace a Web Share', JSON.stringify(compartido))
  } else {
    chequear((await dueno.getByRole('button', { name: 'Compartir' }).count()) === 0, 'sin Web Share (PC) no aparece «Compartir»')
  }
  if (c.movil) {
    const chicos = await dueno.evaluate(() =>
      [...document.querySelectorAll('.amigos-seccion button, .amigos-seccion input, .amigos-seccion a, .amigos-seccion [role=radio]')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 30), a: Math.round(e.getBoundingClientRect().height), l: Math.round(e.getBoundingClientRect().width) }))
        .filter((e) => Math.min(e.a, e.l) < 44),
    )
    chequear(chicos.length === 0, 'celular: ningún control táctil de menos de 44 px en el panel del enlace', JSON.stringify(chicos))
  }
  await dueno.getByRole('button', { name: 'Listo' }).click()
  await dueno.getByRole('button', { name: 'Invitar a un amigo' }).waitFor()

  // ── el amigo, en un navegador SIN sesión ──
  const ctxAmigo = await browser.newContext({ ...c.contexto, locale: 'es-AR' })
  await tema(ctxAmigo)
  const amigo = await ctxAmigo.newPage()
  mirar(amigo, 'amigo (sesión cortada a propósito)', true)
  await amigo.goto(enlace)
  await amigo.locator('h1').waitFor({ timeout: 10000 })
  const titulo = await amigo.locator('h1').innerText()
  chequear(/te invitó a Telar$/.test(titulo) && !/null|undefined/.test(titulo), `la pantalla dice «${titulo}»`)
  chequear((await amigo.locator('#unirse-nombre, #unirse-mail, #unirse-clave').count()) === 3, 'pide nombre, mail y contraseña (sin campo de código)')
  chequear((await amigo.locator('input[name=invitacion]').count()) === 0, 'no hay campo de código de invitación')
  await foto(amigo, 'unirse')
  const NOMBRE = `Pablo ${n}`
  const MAIL = `pablo${n}@ejemplo.com`
  await amigo.locator('#unirse-nombre').fill(NOMBRE)
  await amigo.locator('#unirse-mail').fill(MAIL)
  await amigo.locator('#unirse-clave').fill('corta')
  await amigo.getByRole('button', { name: 'Crear mi cuenta' }).click()
  await amigo.getByRole('alert').getByText(/al menos 10/).waitFor({ timeout: 5000 })
  chequear(true, 'una contraseña corta se explica en la misma pantalla')
  await foto(amigo, 'unirse-error')
  await amigo.locator('#unirse-clave').fill(FRASE)
  await amigo.getByRole('button', { name: 'Crear mi cuenta' }).click()
  // Antes de entrar se ven, una sola vez, los 8 códigos de recuperación (probar-recuperacion-ui.cjs los recorre a fondo).
  await amigo.getByRole('heading', { name: /Guardá estos códigos/ }).waitFor({ timeout: 20000 })
  await amigo.getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await amigo.getByRole('button', { name: 'Entrar a mi Telar' }).click()
  await amigo.waitForFunction(() => location.pathname === '/' && !document.querySelector('.entrar'), null, { timeout: 20000 })
  await amigo.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  chequear(true, 'se registra, queda con la sesión abierta y entra a su Telar vacío («Creá tu primer proyecto»)')
  chequear(!amigo.url().includes('unirse'), 'la dirección del enlace no queda en la barra ni en el historial', amigo.url())
  await espera(500)
  await foto(amigo, 'amigo-vacio')
  const suyos = await amigo.evaluate(async () => (await (await fetch('/api/proyectos?archivados=1')).json()).length)
  chequear(suyos === 0, 'su base está vacía (ningún proyecto del dueño)', suyos)

  // ── el mismo enlace, otra vez ──
  const ctxOtro = await browser.newContext({ ...c.contexto, locale: 'es-AR' })
  await tema(ctxOtro)
  const otro = await ctxOtro.newPage()
  mirar(otro, 'otro (enlace usado)', true)
  await otro.goto(enlace)
  await otro.getByRole('heading', { name: 'Esta invitación ya no sirve' }).waitFor({ timeout: 10000 })
  chequear((await otro.getByText('Pedile otra a quien te invitó.').count()) === 1 && (await otro.locator('input').count()) === 0, 'el mismo enlace otra vez: «Esta invitación ya no sirve. Pedile otra a quien te invitó.» (sin formulario)')
  await foto(otro, 'enlace-no-sirve')
  await ctxOtro.close()
  // el amigo con la sesión abierta que abre un enlace: no se le pisa la sesión
  await amigo.goto(enlace)
  await amigo.getByRole('heading', { name: 'Ya entraste a Telar' }).waitFor({ timeout: 10000 })
  chequear((await amigo.locator('#unirse-clave').count()) === 0, 'con una sesión abierta en ese navegador, el enlace no muestra el formulario («Ya entraste a Telar»)')
  await amigo.goto(`${WEB}/`)

  // ── de vuelta con el dueño ──
  await dueno.reload()
  await dueno.waitForFunction(() => document.body.innerText.length > 40)
  await abrirAmigos()
  await dueno.locator('.amigos-fila--amigo').getByText(NOMBRE).waitFor({ timeout: 8000 })
  const fila = dueno.locator('.amigos-fila--amigo', { hasText: NOMBRE })
  const textoFila = await fila.innerText()
  chequear(textoFila.includes(MAIL) && /Desde/.test(textoFila) && /0 proyectos/.test(textoFila) && /MB de 200 MB/.test(textoFila) && /vino con «para Pablo»/.test(textoFila) && /Activo/.test(textoFila), 'el amigo aparece con su mail, desde cuándo, proyectos, espacio, de qué invitación vino y «Activo»', textoFila)
  const filaInv = dueno.locator('.amigos-lista:not(:has(.amigos-fila--amigo)) .amigos-fila', { hasText: 'para Pablo' })
  chequear(/Usada/.test(await filaInv.innerText()) && /1 de 1/.test(await filaInv.innerText()), 'la invitación figura «Usada» (1 de 1)', await filaInv.innerText())
  await foto(dueno, 'amigos-lista')

  // ── suspender / reactivar ──
  await fila.getByRole('button', { name: `Suspender a ${NOMBRE}` }).click()
  await dueno.getByRole('alert').getByText(/no puede entrar a Telar/).waitFor()
  chequear(/no se borra nada/.test(await fila.innerText()), 'antes de suspender, dice qué pasa: no puede entrar, sus datos quedan, no se borra nada')
  await foto(dueno, 'amigos-suspender')
  await fila.getByRole('button', { name: `Suspender a ${NOMBRE}`, exact: true }).last().click()
  await fila.locator('.amigos-pildora', { hasText: 'Suspendido' }).waitFor({ timeout: 8000 })
  chequear(true, 'queda «Suspendido»')
  const cortada = await amigo.evaluate(async () => (await fetch('/api/proyectos')).status)
  chequear(cortada === 401, 'la sesión del amigo se cortó (401 en el próximo pedido)', cortada)
  await fila.getByRole('button', { name: `Reactivar a ${NOMBRE}` }).click()
  await fila.locator('.amigos-pildora', { hasText: 'Activo' }).waitFor({ timeout: 8000 })
  const vuelve = await amigo.evaluate(async () => (await fetch('/api/proyectos')).status)
  chequear(vuelve === 200, 'reactivado, su sesión vuelve a andar', vuelve)
  await ctxAmigo.close()

  // ── revocar otra ──
  await dueno.getByRole('button', { name: 'Invitar a un amigo' }).click()
  await dueno.locator('#amigos-nota').fill('para revocar')
  await dueno.getByRole('radio', { name: '5 personas' }).click()
  await dueno.getByRole('radio', { name: '30 días' }).click()
  await dueno.getByRole('button', { name: 'Crear enlace' }).click()
  const enlace2 = await dueno.locator('input[aria-label="Enlace de invitación"]').inputValue()
  await dueno.getByRole('button', { name: 'Listo' }).click()
  const filaRev = dueno.locator('.amigos-fila', { hasText: 'para revocar' })
  await filaRev.waitFor()
  chequear(/Pendiente/.test(await filaRev.innerText()) && /0 de 5 usos/.test(await filaRev.innerText()), 'la invitación nueva figura «Pendiente» (0 de 5 usos)', await filaRev.innerText())
  const token2 = enlace2.split('/unirse/')[1]
  chequear((await (await api('/api/unirse/ver', 'POST', { token: token2 }, { authorization: '' })).status) === 200, 'su enlace sirve')
  await filaRev.getByRole('button', { name: /^Revocar/ }).click()
  await filaRev.locator('.amigos-pildora', { hasText: 'Revocada' }).waitFor({ timeout: 8000 })
  chequear((await (await api('/api/unirse/ver', 'POST', { token: token2 }, { authorization: '' })).status) === 404, 'revocada, su enlace deja de servir')
  chequear((await filaRev.getByRole('button', { name: /^Revocar/ }).count()) === 0, 'y ya no ofrece «Revocar»')

  // ── el tope ──
  const tope = dueno.locator('input[aria-label="Tope de cuentas de amigos"]')
  await tope.scrollIntoViewIfNeeded()
  chequear((await tope.inputValue()) === '15', 'el tope de amigos de fábrica es 15')
  await tope.fill('16')
  await dueno.getByRole('button', { name: 'Guardar' }).click()
  await dueno.getByText('Hay 1 de 16').waitFor({ timeout: 8000 }).catch(() => {})
  chequear((await (await api('/api/amigos', 'GET', undefined, { authorization: '', cookie: `tablero_sesion=${cookieJuego()}` })).json()).topeAmigos === 16, 'el tope se guarda (16)')
  await tope.fill('15')
  await dueno.getByRole('button', { name: 'Guardar' }).click()
  await dueno.getByRole('button', { name: 'Guardar' }).waitFor({ state: 'visible' }).catch(() => {})
  await espera(400)
  await tope.fill('0')
  chequear(await dueno.getByRole('button', { name: 'Guardar' }).isDisabled(), 'con un valor fuera de 1–100, «Guardar» queda apagado')
  await tope.fill('15')
  if (c.movil) {
    const chicos = await dueno.evaluate(() =>
      [...document.querySelectorAll('.amigos-seccion button, .amigos-seccion input, .amigos-seccion a, .amigos-seccion [role=radio]')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 30), a: Math.round(e.getBoundingClientRect().height), l: Math.round(e.getBoundingClientRect().width) }))
        .filter((e) => Math.min(e.a, e.l) < 44),
    )
    chequear(chicos.length === 0, 'celular: ningún control táctil de menos de 44 px en la lista, los botones y el tope', JSON.stringify(chicos))
  }
  await foto(dueno, 'amigos-tope')

  chequear(errores.length === 0, `la consola quedó limpia (${esperados.length} errores de red provocados a propósito)`, errores.join('\n'))
  await ctxDueno.close()
}

// ── un amigo no ve «Amigos» ──
async function sinAmigos(browser) {
  console.log('\n── un amigo no ve «Amigos» ──')
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errores = []
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()))
  page.on('pageerror', (e) => errores.push(e.message))
  const inv = await (await fetch(`${WEB}/api/amigos/invitaciones`, { method: 'POST', headers: { origin: WEB, 'content-type': 'application/json', cookie: `tablero_sesion=${cookieJuego()}` }, body: '{}' })).json()
  await page.goto(inv.enlace)
  await page.locator('#unirse-nombre').fill('Sin Amigos')
  await page.locator('#unirse-mail').fill('sinamigos@ejemplo.com')
  await page.locator('#unirse-clave').fill(FRASE)
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click()
  await page.getByRole('heading', { name: /Guardá estos códigos/ }).waitFor({ timeout: 20000 })
  await page.getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await page.getByRole('button', { name: 'Entrar a mi Telar' }).click()
  await page.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  await page.keyboard.press('Control+Comma')
  await page.getByRole('tab', { name: 'Cuenta' }).waitFor()
  chequear((await page.getByRole('tab', { name: 'Amigos' }).count()) === 0, 'la cuenta de un amigo no tiene la sección «Amigos» en Configuración')
  chequear(errores.length === 0, 'consola limpia', errores.join('\n'))
  await ctx.close()
}

async function principal() {
  const browser = await chromium.launch()
  let datos = null
  try {
    // Cada combinación con su Telar y su base nuevos: el estado vacío del dueño se ve en todas.
    let n = 0
    for (const c of COMBINACIONES) {
      datos = await levantar()
      // El dueño tiene algo en su Telar (para que la captura del dueño no sea una pantalla vacía).
      await api('/api/proyectos', 'POST', { nombre: 'Restaurant City', prefijo: 'RC' })
      await recorrer(browser, c, ++n)
      if (c.id === 'pc-claro') await sinAmigos(browser)
      chequear(!/tablero\] error/.test(salida), 'el servidor no registró errores', salida.split('\n').filter((l) => /error/.test(l)).slice(0, 3).join('\n'))
      await apagar(datos)
      datos = null
      salida = ''
    }
  } catch (e) {
    fallos++
    console.error('\n✗ El recorrido se cortó:', e && e.stack ? e.stack : e)
  } finally {
    await browser.close()
    await apagar(datos)
  }
  console.log(`\n${fallos ? `✗ ${fallos} de ${pruebas} fallaron` : `✓ ${pruebas} comprobaciones: todo bien`}`)
  process.exit(fallos ? 1 : 0)
}
principal()
