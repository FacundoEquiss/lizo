// Recorrido de «Crear cuenta» con aprobación del dueño (Entrar → solicitud → Configuración → Amigos → Solicitudes), con Playwright, SOLO contra un
// Telar local descartable (nunca producción, nunca claves reales). Levanta su propio Telar online-de-mentira (TABLERO_PUBLICO=1, base en una
// carpeta temporal, SIN TABLERO_INVITACION) y recorre, en PC (1440 × 900) y en celular emulado (iPhone 15 y Pixel 8), en claro y en oscuro:
//   una visita (sin sesión) ve «Crear cuenta» en la pantalla de Entrar → el formulario tiene nombre, mail y contraseña (sin campo de invitación
//   ni de código ni «pegá el enlace») → con el celular emulado con la barra del navegador abajo y el TECLADO abierto (la ventana visible se
//   achica), cada campo con foco queda a la vista y el botón se alcanza desplazando → contraseña corta (error) → crea la cuenta → «Guardá estos
//   códigos» → «Tu cuenta espera la aprobación de <dueño>» → intenta entrar: «Tu cuenta todavía espera la aprobación…» (y con la contraseña mala,
//   el error de siempre) → el dueño ve la solicitud en la campana (con número), en la marca del menú y en Configuración → Amigos → Solicitudes
//   (en el celular: Menú ⋮ → Amigos) → toca la notificación y llega a Amigos → «Aprobar» → la persona entra a su Telar vacío → otra solicitud:
//   «Rechazar» (con confirmación suave) → la rechazada entra: el error de siempre → «Reconsiderar» → el tope de amigos frena la aprobación → «Borrar
//   solicitudes viejas». Cuenta los controles táctiles de menos de 44 px (meta: 0) y la consola tiene que quedar limpia (los errores de red que el
//   recorrido provoca a propósito —entrar con una cuenta que espera— se anotan aparte).
//
//   NODE_PATH=$(npm root -g) node scripts/probar-solicitudes-ui.cjs [--puerto 4780] [--capturas docs/capturas/solicitudes] [--solo=pc-claro,iphone15-oscuro]
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
const PUERTO = Number(opcion('puerto', '4780'))
const SOLO = opcion('solo', '')
const CAPTURAS = opcion('capturas', '')
const RAIZ = path.resolve(__dirname, '..')
const WEB = `http://127.0.0.1:${PUERTO}`
if (new URL(WEB).hostname !== '127.0.0.1') throw new Error('Solo 127.0.0.1')
const SECRETO = 'secreto-de-prueba-solicitudes-ui-0123456789-abcdefghijklmnop'
const CLAVE = 'clave-de-prueba-del-mcp-solicitudes-ui'
const USUARIO_JUEGO = 'usuario-juego-prueba-solicitudes'
if (CAPTURAS) fs.mkdirSync(path.resolve(CAPTURAS), { recursive: true })

// `barra`: lo que la barra del navegador (abajo) le saca a la ventana; `teclado`: lo que le saca el teclado abierto.
const COMBINACIONES = [
  { id: 'pc-claro', nombre: 'PC 1440 × 900', tema: 'claro', contexto: { viewport: { width: 1440, height: 900 } }, movil: false, todas: true, barra: 0, teclado: 0 },
  { id: 'pc-oscuro', nombre: 'PC 1440 × 900', tema: 'oscuro', contexto: { viewport: { width: 1440, height: 900 } }, movil: false, barra: 0, teclado: 0 },
  { id: 'iphone15-claro', nombre: 'iPhone 15', tema: 'claro', contexto: devices['iPhone 15'], movil: true, barra: 84, teclado: 300 },
  { id: 'iphone15-oscuro', nombre: 'iPhone 15', tema: 'oscuro', contexto: devices['iPhone 15'], movil: true, barra: 84, teclado: 300 },
  { id: 'pixel8-claro', nombre: 'Pixel 8', tema: 'claro', contexto: devices['Pixel 8'], movil: true, barra: 72, teclado: 330 },
  { id: 'pixel8-oscuro', nombre: 'Pixel 8', tema: 'oscuro', contexto: devices['Pixel 8'], movil: true, barra: 72, teclado: 330 },
].filter((c) => !SOLO || SOLO.split(',').some((s) => c.id === s || c.id.startsWith(`${s}-`)))

let fallos = 0
let pruebas = 0
const chequear = (cond, que, detalle) => {
  pruebas++
  if (!cond) fallos++
  console.log(`${cond ? '  ✓' : '  ✗'} ${que}${!cond && detalle ? `\n      ${String(detalle).slice(0, 600)}` : ''}`)
  return cond
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const FRASE = 'una frase larga de prueba'
const FRASE_NUEVA = 'la frase nueva de la recuperación'

function cookieJuego() {
  const base = `v1.${USUARIO_JUEGO}.${Math.floor(Date.now() / 1000) + 7200}`
  return `${base}.${createHmac('sha256', SECRETO).update(base).digest('base64url')}`
}

// ───────── el Telar de prueba ─────────
let hijo = null
let salida = ''
async function levantar() {
  salida = ''
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'telar-solicitudes-ui-'))
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
      TABLERO_INVITACION: '', // sin variable: lo que se prueba es la cuenta abierta con aprobación
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
const comoDueno = (ruta, metodo = 'GET', cuerpo) => api(ruta, metodo, cuerpo, { authorization: '', cookie: `tablero_sesion=${cookieJuego()}` })

/** Los controles táctiles de menos de 44 px dentro de `selector` (los que se ven). */
const chicos = (page, selector) =>
  page.evaluate((sel) => {
    return [...document.querySelectorAll(`${sel} button, ${sel} input, ${sel} a, ${sel} [role=radio], ${sel} summary`)]
      .filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 30), a: Math.round(e.getBoundingClientRect().height), l: Math.round(e.getBoundingClientRect().width) }))
      .filter((e) => Math.min(e.a, e.l) < 44)
  }, selector)

// ───────── un recorrido ─────────
async function recorrer(browser, c, n) {
  console.log(`\n── ${c.nombre} · ${c.tema} ──`)
  const errores = []
  const esperados = []
  // `permitirRed`: true = cualquier error de red provocado; una expresión = solo los que la cumplen (el tope de amigos da 409 a propósito).
  const mirar = (page, etiqueta, permitirRed = false) => {
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (permitirRed && /Failed to load resource/.test(t) && (permitirRed === true || permitirRed.test(t))) esperados.push(`${etiqueta}: ${t}`)
      else errores.push(`${etiqueta}: ${t}`)
    })
    page.on('pageerror', (e) => errores.push(`${etiqueta}: ${e.message}`))
  }
  // Capturas a tamaño de pantalla (`scale: 'css'`, sin los 3 píxeles por punto del celular): las del repo son para mirar, no para imprimir.
  // En PC claro van todas; en el resto, las que muestran algo distinto.
  const foto = async (page, nombre) => {
    if (!CAPTURAS) return
    if (!c.todas && !['entrar', 'crear-teclado', 'espera', 'entrar-espera', 'campana-marca', 'solicitudes', 'rechazar-confirmar', 'tope'].includes(nombre)) return
    await page.screenshot({ path: path.resolve(CAPTURAS, `${c.id}-${nombre}.png`), scale: 'css' })
  }
  const tema = (ctx) => ctx.addInitScript((t) => localStorage.setItem('tablero.tema', t), c.tema)
  const nombreDueno = (await (await api('/api/miembros')).json()).find((m) => m.esYo)?.nombre ?? 'Dueño'

  // ── el dueño: ya está adentro, con la app abierta, cuando llega la solicitud ──
  const ctxDueno = await browser.newContext({ ...c.contexto, locale: 'es-AR' })
  await tema(ctxDueno)
  await ctxDueno.addCookies([{ name: 'tablero_sesion', value: cookieJuego(), url: WEB, httpOnly: true, sameSite: 'Lax' }])
  const dueno = await ctxDueno.newPage()
  mirar(dueno, 'dueño', /status of 409/)
  await dueno.goto(`${WEB}/`)
  await dueno.waitForFunction(() => document.body.innerText.length > 40, null, { timeout: 20000 })
  await espera(600)
  chequear((await dueno.locator('.marca-solicitudes').count()) === 0, 'sin solicitudes, el menú no tiene ninguna marca con número')

  // ── la visita: Entrar ──
  const ctxVisita = await browser.newContext({ ...c.contexto, locale: 'es-AR' })
  await tema(ctxVisita)
  const visita = await ctxVisita.newPage()
  mirar(visita, 'visita (sesión cortada a propósito)', true)
  await visita.goto(`${WEB}/`)
  await visita.locator('.entrar').waitFor({ timeout: 15000 })
  const botonCrear = visita.locator('.entrar__crear')
  chequear((await botonCrear.count()) === 1 && (await botonCrear.isVisible()), '«Crear cuenta» está siempre a la vista en Entrar (sin ninguna variable cargada)')
  const textoEntrar = await visita.locator('.entrar').innerText()
  chequear(!/enlace de invitación|Pegá el enlace|Código de invitación/.test(textoEntrar.replace('¿Te pasaron un enlace de invitación? Abrilo y entrás directo.', '')), 'Entrar no pide ni enlace ni código de invitación')
  await foto(visita, 'entrar')
  await botonCrear.click()
  await visita.locator('#crear-nombre').waitFor()
  chequear((await visita.locator('#crear-nombre, #entrar-mail, #crear-clave').count()) === 3, 'el formulario pide nombre, mail y contraseña')
  chequear((await visita.locator('input[name=invitacion], #crear-invitacion, #entrar-enlace').count()) === 0, 'y no hay ningún campo de invitación ni de código')
  chequear(/la tiene que aprobar/.test(await visita.locator('.entrar__texto').innerText()), 'avisa que el dueño la tiene que aprobar antes de entrar')
  await foto(visita, 'crear')
  if (c.movil) {
    const ch = await chicos(visita, '.entrar')
    chequear(ch.length === 0, 'celular: ningún control táctil de menos de 44 px en el formulario de crear cuenta', JSON.stringify(ch))
  }

  // ── el celular con la barra del navegador abajo y el teclado abierto: cada campo con foco se ve, y el botón se alcanza ──
  const original = visita.viewportSize()
  const medirCampo = (sel) =>
    visita.evaluate((s) => {
      const el = document.querySelector(s)
      const r = el.getBoundingClientRect()
      return { arriba: Math.round(r.top), abajo: Math.round(r.bottom), alto: window.innerHeight }
    }, sel)
  if (c.movil) {
    await visita.setViewportSize({ width: original.width, height: original.height - c.barra })
    await espera(300)
    const entra = await visita.evaluate(() => {
      const e = document.querySelector('.entrar')
      return { desplazable: e.scrollHeight > e.clientHeight, hasta: e.scrollHeight - e.clientHeight, cuerpo: document.scrollingElement.scrollTop }
    })
    chequear(entra.cuerpo === 0, 'con la barra del navegador abajo, la pantalla no queda cortada ni se corre', JSON.stringify(entra))
    await visita.setViewportSize({ width: original.width, height: original.height - c.barra - c.teclado })
    await espera(300)
    const tec = await visita.evaluate(() => {
      const e = document.querySelector('.entrar')
      return { desplazable: e.scrollHeight > e.clientHeight, alto: window.innerHeight }
    })
    chequear(tec.desplazable, `con el teclado abierto (ventana de ${tec.alto} px) el formulario se desplaza dentro de la misma caja`, JSON.stringify(tec))
    for (const sel of ['#crear-nombre', '#entrar-mail', '#crear-clave']) {
      await visita.locator(sel).focus()
      await espera(500)
      const r = await medirCampo(sel)
      chequear(r.arriba >= 0 && r.abajo <= r.alto, `con el teclado abierto, ${sel} queda a la vista al darle foco (${r.arriba}–${r.abajo} de ${r.alto})`, JSON.stringify(r))
    }
    await foto(visita, 'crear-teclado')
    // el botón de crear: se alcanza desplazando
    await visita.locator('.entrar button[type=submit]').scrollIntoViewIfNeeded()
    await espera(200)
    const b = await visita.evaluate(() => {
      const r = document.querySelector('.entrar button[type=submit]').getBoundingClientRect()
      return { arriba: Math.round(r.top), abajo: Math.round(r.bottom), alto: window.innerHeight }
    })
    chequear(b.arriba >= 0 && b.abajo <= b.alto, 'el botón «Crear cuenta» se alcanza desplazando con el teclado abierto', JSON.stringify(b))
    const hasta = await visita.evaluate(() => {
      const e = document.querySelector('.entrar')
      e.scrollTop = e.scrollHeight
      const ultimo = [...e.querySelectorAll('button, a')].filter((x) => x.getBoundingClientRect().width > 0).pop()
      const r = ultimo.getBoundingClientRect()
      return { abajo: Math.round(r.bottom), alto: window.innerHeight }
    })
    chequear(hasta.abajo <= hasta.alto, 'al llegar al final, lo último de la pantalla (los botones de abajo) queda a la vista, no tapado por la barra', JSON.stringify(hasta))
    await visita.setViewportSize(original)
    await espera(300)
  } else {
    for (const sel of ['#crear-nombre', '#entrar-mail', '#crear-clave']) {
      await visita.locator(sel).focus()
      const r = await medirCampo(sel)
      chequear(r.arriba >= 0 && r.abajo <= r.alto, `PC: ${sel} se ve con el foco`, JSON.stringify(r))
    }
  }

  // ── crear la cuenta ──
  const NOMBRE = `Pablo ${n}`
  const MAIL = `pablo${n}@ejemplo.com`
  await visita.locator('#crear-nombre').fill(NOMBRE)
  await visita.locator('#entrar-mail').fill(MAIL)
  await visita.locator('#crear-clave').fill('corta')
  await visita.locator('.entrar button[type=submit]').click()
  await visita.getByRole('alert').getByText(/al menos 10/).waitFor({ timeout: 5000 })
  chequear(true, 'una contraseña corta se explica en la misma pantalla')
  await visita.locator('#crear-clave').fill(FRASE)
  await visita.locator('.entrar button[type=submit]').click()
  await visita.getByRole('heading', { name: /Guardá estos códigos/ }).waitFor({ timeout: 20000 })
  const codigos = await visita.locator('.codigos__lista code').count()
  chequear(codigos === 8, 'se muestran los 8 códigos de recuperación (la pantalla «Guardá estos códigos» de siempre)', codigos)
  await foto(visita, 'codigos')
  const codigoUno = await visita.locator('.codigos__lista code').first().innerText()
  chequear((await visita.evaluate(async () => (await fetch('/api/proyectos')).status)) === 401, 'la cuenta recién pedida NO tiene sesión: no puede pedir nada (401)')
  await visita.getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await visita.getByRole('button', { name: 'Seguir' }).click()
  await visita.getByRole('heading', { name: 'Listo' }).waitFor({ timeout: 8000 })
  const espera1 = await visita.locator('.espera__texto').innerText()
  chequear(espera1.includes(`Tu cuenta espera la aprobación de ${nombreDueno}.`) && /Cuando la apruebe, entrás con tu mail y tu contraseña\./.test(espera1), `dice «Tu cuenta espera la aprobación de ${nombreDueno}. Cuando la apruebe, entrás con tu mail y tu contraseña.»`, espera1)
  await foto(visita, 'espera')
  if (c.movil) {
    const ch = await chicos(visita, '.espera')
    chequear(ch.length === 0, 'celular: ningún control táctil de menos de 44 px en la pantalla de espera', JSON.stringify(ch))
  }

  // ── intentar entrar mientras espera ──
  await visita.getByRole('button', { name: 'Ir a Entrar' }).click()
  await visita.locator('#entrar-clave').waitFor()
  chequear((await visita.locator('#entrar-mail').inputValue()) === MAIL, 'vuelve a Entrar con el mail ya escrito')
  await visita.locator('#entrar-clave').fill(FRASE)
  await visita.locator('.entrar button[type=submit]').click()
  await visita.locator('.entrar__error').waitFor({ timeout: 8000 })
  const textoEspera = await visita.locator('.entrar__error').innerText()
  chequear(textoEspera === `Tu cuenta todavía espera la aprobación de ${nombreDueno}.`, `entrar mientras espera: «${textoEspera}»`)
  await foto(visita, 'entrar-espera')
  await visita.locator('#entrar-clave').fill('otra contraseña cualquiera')
  await visita.locator('.entrar button[type=submit]').click()
  await visita.locator('.entrar__error', { hasText: 'Mail o contraseña incorrectos.' }).waitFor({ timeout: 8000 })
  chequear(true, 'con la contraseña mala, el error de siempre («Mail o contraseña incorrectos.»): no se cuenta que la cuenta existe')

  // ── mientras espera, se puede recuperar la contraseña con un código, pero eso NO la deja entrar ──
  await visita.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click()
  await visita.locator('#olvide-codigo').fill(codigoUno)
  await visita.locator('#olvide-clave').fill(FRASE_NUEVA)
  await visita.locator('.entrar button[type=submit]').click()
  await visita.getByRole('heading', { name: 'Listo' }).waitFor({ timeout: 10000 })
  const textoRecuperada = await visita.locator('.espera__texto').innerText()
  chequear(/Cambiamos tu contraseña\. Tu cuenta espera la aprobación de/.test(textoRecuperada), 'recuperar con un código mientras espera: cambia la contraseña y dice que sigue esperando', textoRecuperada)
  chequear((await visita.evaluate(async () => (await fetch('/api/proyectos')).status)) === 401, 'y no le abre la sesión (sigue sin poder: 401)')
  await foto(visita, 'recuperada-espera')
  await visita.getByRole('button', { name: 'Ir a Entrar' }).click()
  await visita.locator('#entrar-clave').fill(FRASE_NUEVA)
  await visita.locator('.entrar button[type=submit]').click()
  await visita.locator('.entrar__error', { hasText: 'todavía espera la aprobación' }).waitFor({ timeout: 8000 })
  chequear(true, 'con la contraseña nueva, sigue oyendo que espera la aprobación')

  // ── el dueño ve la solicitud: campana, marca del menú y Amigos ──
  await dueno.mouse.move(40, 40)
  const campana = dueno.locator('.campana').first()
  await dueno.locator('.campana__numero').waitFor({ timeout: 30000 }).catch(() => {})
  chequear((await dueno.locator('.campana__numero').count()) > 0 && (await dueno.locator('.campana__numero').first().innerText()) === '1', 'la campana del dueño suma 1 sin leer (llegó sola, sin recargar)')
  await dueno.locator('.marca-solicitudes').first().waitFor({ timeout: 15000 }).catch(() => {})
  chequear((await dueno.locator('.marca-solicitudes').first().innerText().catch(() => '')) === '1', c.movil ? 'el menú ⋮ muestra la marca con el número 1' : 'el botón Configuración de la barra lateral muestra la marca con el número 1')
  await foto(dueno, 'campana-marca')
  await campana.click()
  const fila = dueno.locator('.fila-notif', { hasText: `${NOMBRE} pidió una cuenta` })
  await fila.waitFor({ timeout: 8000 })
  chequear(true, `la campana dice «${NOMBRE} pidió una cuenta»`)
  await foto(dueno, 'campana')
  await fila.click()
  await dueno.locator('.amigos-seccion').waitFor({ timeout: 10000 })
  chequear(true, 'tocar la notificación lleva directo a Configuración → Amigos' + (c.movil ? ' (la hoja «Amigos»)' : ''))

  // ── Solicitudes ──
  const lista = dueno.locator('.amigos-fila--solicitud', { hasText: NOMBRE })
  await lista.waitFor({ timeout: 8000 })
  const texto = await lista.innerText()
  chequear(texto.includes(MAIL) && /Pidió su cuenta/.test(texto) && /Espera/.test(texto), 'la solicitud muestra nombre, mail y desde cuándo', texto)
  chequear((await lista.getByRole('button', { name: `Aprobar a ${NOMBRE}` }).isVisible()) && (await lista.getByRole('button', { name: `Rechazar a ${NOMBRE}` }).isVisible()), 'con dos botones grandes: «Aprobar» y «Rechazar»')
  const grupo = await dueno.locator('.amigos-seccion h3, .amigos-seccion h4, .amigos-seccion .config-grupo__titulo').first().innerText().catch(() => '')
  chequear(/Solicitudes \(1\)/i.test(await dueno.locator('.amigos-seccion').innerText()), 'el grupo se llama «Solicitudes (1)» y está arriba de todo', grupo)
  const miedos = await dueno.locator('.amigos-tranquilidad li').allInnerTexts()
  chequear(miedos.length === 8 && /Nadie entra sin tu aprobación/.test(miedos[0]) && miedos.some((m) => /30 solicitudes/.test(m)) && miedos.some((m) => /aprobado al instante/.test(m)), 'los miedos del dueño, una línea cada uno (sin aprobación no entra nadie, tope de 30, invitaciones al instante…)', miedos.join(' | '))
  chequear(/aprobado al instante, sin pasar por Solicitudes/.test(await dueno.locator('.amigos-seccion').innerText()), 'la pantalla de invitar dice que quien entra con un enlace queda aprobado al instante')
  await foto(dueno, 'solicitudes')
  if (c.movil) {
    const ch = await chicos(dueno, '.amigos-seccion')
    chequear(ch.length === 0, 'celular: ningún control táctil de menos de 44 px en Solicitudes ni en el resto de Amigos', JSON.stringify(ch))
  }
  // El dueño todavía no aprobó: la persona sigue sin poder.
  const aunNo = await api('/api/sesion', 'POST', { email: MAIL, clave: FRASE_NUEVA }, { authorization: '' })
  chequear(aunNo.status === 403, 'mientras espera, la API de entrar le dice 403 «espera la aprobación»', aunNo.status)

  // ── aprobar ──
  await lista.getByRole('button', { name: `Aprobar a ${NOMBRE}` }).click()
  await dueno.getByText(`${NOMBRE} ya puede entrar con su mail y su contraseña.`).waitFor({ timeout: 8000 })
  chequear(true, 'al aprobar, avisa «ya puede entrar con su mail y su contraseña»')
  await dueno.locator('.amigos-fila--amigo', { hasText: NOMBRE }).waitFor({ timeout: 8000 })
  const filaAmigo = await dueno.locator('.amigos-fila--amigo', { hasText: NOMBRE }).innerText()
  chequear(/pidió su cuenta y la aprobaste/.test(filaAmigo) && /Activo/.test(filaAmigo), 'pasa a «Amigos con cuenta» como Activo («pidió su cuenta y la aprobaste»)', filaAmigo)
  chequear((await dueno.locator('.amigos-fila--solicitud').count()) === 0, 'y sale de Solicitudes')
  await dueno.locator('.marca-solicitudes').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  chequear((await dueno.locator('.marca-solicitudes').count()) === 0, 'la marca con el número desaparece')
  await foto(dueno, 'aprobada')

  // ── la persona entra a su Telar vacío ──
  await visita.locator('#entrar-clave').fill(FRASE_NUEVA)
  await visita.locator('.entrar button[type=submit]').click()
  await visita.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  chequear(true, 'aprobada, entra con su mail y su contraseña a su Telar vacío («Creá tu primer proyecto»)')
  chequear((await visita.evaluate(async () => (await (await fetch('/api/proyectos?archivados=1')).json()).length)) === 0, 'su base está vacía (nada del dueño)')
  chequear((await visita.evaluate(async () => (await (await fetch('/api/miembros')).json()).filter((m) => m.esYo).map((m) => m.nombre))).join() === NOMBRE, 'con su miembro «yo» (su nombre)')
  await foto(visita, 'telar-vacio')
  chequear((await visita.evaluate(async () => (await fetch('/api/amigos')).status)) === 403, 'y no tiene nada de Amigos (403)')

  // ── una segunda solicitud, rechazada ──
  const ctxDos = await browser.newContext({ ...c.contexto, locale: 'es-AR' })
  await tema(ctxDos)
  const dos = await ctxDos.newPage()
  mirar(dos, 'segunda visita', true)
  await dos.goto(`${WEB}/`)
  await dos.locator('.entrar__crear').click()
  const NOMBRE2 = `Rita ${n}`
  const MAIL2 = `rita${n}@ejemplo.com`
  await dos.locator('#crear-nombre').fill(NOMBRE2)
  await dos.locator('#entrar-mail').fill(MAIL2)
  await dos.locator('#crear-clave').fill(FRASE)
  await dos.locator('.entrar button[type=submit]').click()
  await dos.getByRole('heading', { name: /Guardá estos códigos/ }).waitFor({ timeout: 20000 })
  await dos.getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await dos.getByRole('button', { name: 'Seguir' }).click()
  await dos.getByRole('heading', { name: 'Listo' }).waitFor({ timeout: 8000 })
  // Intentar con el mismo mail: «ya hay una cuenta» (la misma frase para cualquier cuenta)
  await dos.getByRole('button', { name: 'Ir a Entrar' }).click()
  await dueno.reload()
  await dueno.waitForFunction(() => document.body.innerText.length > 40)
  await dueno.locator('.marca-solicitudes').first().waitFor({ timeout: 15000 })
  chequear((await dueno.locator('.marca-solicitudes').first().innerText()) === '1', 'otra solicitud: la marca vuelve a decir 1')
  if (c.movil) {
    await dueno.getByRole('button', { name: /^Menú:/ }).click()
    chequear((await dueno.locator('.hoja-mas .marca-solicitudes').innerText()) === '1', 'en el menú ⋮, la fila «Amigos» lleva el número')
    await foto(dueno, 'menu-marca')
    await dueno.locator('.hoja-mas').getByRole('button', { name: /Amigos/ }).click()
  } else {
    await dueno.keyboard.press('Control+Comma')
    chequear((await dueno.locator('.config__seccion-marca').innerText()) === '1', 'en Configuración, la sección «Amigos» lleva el número')
    await dueno.getByRole('tab', { name: /Amigos/ }).click()
  }
  const lista2 = dueno.locator('.amigos-fila--solicitud', { hasText: NOMBRE2 })
  await lista2.waitFor({ timeout: 8000 })
  await lista2.getByRole('button', { name: `Rechazar a ${NOMBRE2}` }).click()
  await lista2.getByRole('alert').getByText(/no puede entrar y su mail queda ocupado unos días/).waitFor()
  chequear(true, 'rechazar pide una confirmación suave: «no puede entrar y su mail queda ocupado unos días»')
  await foto(dueno, 'rechazar-confirmar')
  await lista2.getByRole('button', { name: 'Cancelar' }).click()
  chequear((await lista2.getByRole('alert').count()) === 0, '«Cancelar» no rechaza')
  await lista2.getByRole('button', { name: `Rechazar a ${NOMBRE2}` }).click()
  await lista2.getByRole('button', { name: `Rechazar a ${NOMBRE2}`, exact: true }).last().click()
  await dueno.getByText(`Rechazaste a ${NOMBRE2}. No puede entrar.`).waitFor({ timeout: 8000 })
  const rech = dueno.locator('.amigos-rechazadas')
  await rech.locator('summary').click()
  await rech.locator('.amigos-fila', { hasText: NOMBRE2 }).waitFor({ timeout: 5000 })
  chequear(/su mail queda ocupado hasta/.test(await rech.innerText()), 'queda en «Rechazadas», con hasta cuándo queda ocupado su mail')
  await foto(dueno, 'rechazada')
  // la rechazada: el error de siempre (no se le revela el rechazo)
  await dos.locator('#entrar-clave').fill(FRASE)
  await dos.locator('.entrar button[type=submit]').click()
  await dos.locator('.entrar__error').waitFor({ timeout: 8000 })
  chequear((await dos.locator('.entrar__error').innerText()) === 'Mail o contraseña incorrectos.', 'la rechazada que intenta entrar oye «Mail o contraseña incorrectos.» (no se le revela el rechazo)', await dos.locator('.entrar__error').innerText())
  // reconsiderar
  await rech.locator('.amigos-fila', { hasText: NOMBRE2 }).getByRole('button', { name: `Reconsiderar a ${NOMBRE2}` }).click()
  await dueno.locator('.amigos-fila--solicitud', { hasText: NOMBRE2 }).waitFor({ timeout: 8000 })
  chequear(true, '«Reconsiderar» la devuelve a Solicitudes')

  // ── el tope de amigos frena la aprobación ──
  const hay = (await (await comoDueno('/api/amigos')).json()).amigos.length
  await comoDueno('/api/amigos/ajustes', 'PUT', { topeAmigos: hay })
  await dueno.reload()
  await dueno.waitForFunction(() => document.body.innerText.length > 40)
  if (c.movil) {
    await dueno.getByRole('button', { name: /^Menú:/ }).click()
    await dueno.locator('.hoja-mas').getByRole('button', { name: /Amigos/ }).click()
  } else {
    await dueno.keyboard.press('Control+Comma')
    await dueno.getByRole('tab', { name: /Amigos/ }).click()
  }
  const lista3 = dueno.locator('.amigos-fila--solicitud', { hasText: NOMBRE2 })
  await lista3.getByRole('button', { name: `Aprobar a ${NOMBRE2}` }).click()
  await lista3.getByRole('alert').getByText(/es el tope/).waitFor({ timeout: 8000 })
  chequear(true, 'con el tope de amigos lleno, «Aprobar» avisa ahí mismo que es el tope y no aprueba')
  await foto(dueno, 'tope')
  chequear((await dueno.locator('.amigos-fila--solicitud', { hasText: NOMBRE2 }).count()) === 1, 'y la solicitud sigue esperando')
  await comoDueno('/api/amigos/ajustes', 'PUT', { topeAmigos: 15 })

  // ── borrar solicitudes viejas ──
  chequear((await dueno.getByRole('button', { name: 'Borrar solicitudes viejas' }).isDisabled()) && /No hay solicitudes de más de 30 días/.test(await dueno.locator('.amigos-limpiar').innerText()), '«Borrar solicitudes viejas» está apagado y dice por qué cuando no hay ninguna de más de 30 días')

  chequear(errores.length === 0, `la consola quedó limpia (${esperados.length} errores de red provocados a propósito)`, errores.join('\n'))
  await ctxDos.close()
  await ctxVisita.close()
  await ctxDueno.close()
}

async function principal() {
  const browser = await chromium.launch()
  let datos = null
  try {
    let n = 0
    for (const c of COMBINACIONES) {
      datos = await levantar()
      await api('/api/proyectos', 'POST', { nombre: 'Restaurant City', prefijo: 'RC' })
      await recorrer(browser, c, ++n)
      chequear(!/tablero\] error/.test(salida), 'el servidor no registró errores', salida.split('\n').filter((l) => /error/.test(l)).slice(0, 3).join('\n'))
      chequear(!salida.includes(FRASE) && !salida.includes(FRASE_NUEVA), 'ni las contraseñas están en lo que escribió el servidor')
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
