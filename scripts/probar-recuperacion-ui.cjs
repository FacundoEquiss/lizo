// Recorrido de «recuperar la contraseña sin correo» con Playwright, SOLO contra un Telar local descartable (nunca producción, nunca claves
// reales). Levanta su propio Telar online-de-mentira (TABLERO_PUBLICO=1, base en una carpeta temporal) y recorre, en PC (1440 × 900) y en
// celular emulado (iPhone 15 y Pixel 8), en claro y en oscuro:
//   1. Un amigo abre el enlace de invitación y se registra → «Guardá estos códigos»: 8 códigos, aviso de que se ven una sola vez, «Copiar»
//      (se lee el portapapeles), «Descargar .txt» (se lee el archivo) y la casilla «Ya los guardé», sin la cual no se puede seguir.
//   2. Cierra sesión → «¿Olvidaste tu contraseña?» → mail + un código inventado (error) + contraseña floja (error) → un código bueno y una
//      contraseña nueva → «Listo, ya entraste», «Te quedan 7 códigos» → entra con la contraseña nueva; el código gastado ya no sirve.
//   3. Configuración → Cuenta (en el celular, Menú → Mi perfil): «Te quedan 7 de 8» → «Generar códigos nuevos» (contraseña mala: error;
//      buena: los 8 nuevos, «Guardá estos códigos») → «Te quedan 8 de 8»; los de antes no sirven.
//   4. Se gastan códigos hasta que quedan 2 → Configuración muestra el aviso fuerte → cierra sesión → recupera con otro código (queda 1) →
//      «Quedan pocos» y «Generar códigos nuevos» ahí mismo → «Guardá estos códigos» → entra y quedan 8.
//   5. El camino del dueño: Configuración → Amigos → «Restablecer contraseña» del amigo (dice que el dueño NO ve ni elige la contraseña) →
//      «Crear enlace» → el enlace una sola vez con «Copiar enlace» (y «Compartir» en el celular) → el amigo lo abre SIN sesión, pone una
//      contraseña floja (error) y una buena → queda adentro con 8 códigos nuevos para guardar → el dueño lo ve («contraseña restablecida,
//      con tu enlace», sin enlace pendiente) → el mismo enlace otra vez no sirve → otro enlace, «Cancelar enlace» → no sirve.
//   Cuenta los controles táctiles de menos de 44 px (meta: 0) y la consola tiene que quedar limpia (los errores de red que el recorrido
//   provoca a propósito —un código malo, un enlace que ya no sirve— se anotan aparte).
//
//   NODE_PATH=$(npm root -g) node scripts/probar-recuperacion-ui.cjs [--puerto 4730] [--capturas docs/capturas/recuperacion] [--solo=pc-claro,iphone15-oscuro]
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
const PUERTO = Number(opcion('puerto', '4730'))
const SOLO = opcion('solo', '')
const CAPTURAS = opcion('capturas', '')
const RAIZ = path.resolve(__dirname, '..')
const WEB = `http://127.0.0.1:${PUERTO}`
const SECRETO = 'secreto-de-prueba-recuperacion-ui-0123456789-abcdefghijklmnop'
const CLAVE = 'clave-de-prueba-del-mcp-recuperacion-ui'
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
// Las capturas que se guardan en las combinaciones que no son la completa.
const CLAVES_CAPTURA = ['codigos', 'codigos-fin', 'olvide', 'cuenta-codigos', 'amigos-enlace', 'restablecer']

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
const FORMA = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/
let ipN = 0
const ipNueva = () => `10.60.${Math.floor(++ipN / 250)}.${ipN % 250}`

function cookieJuego() {
  const base = `v1.${USUARIO_JUEGO}.${Math.floor(Date.now() / 1000) + 7200}`
  return `${base}.${createHmac('sha256', SECRETO).update(base).digest('base64url')}`
}

// ───────── el Telar de prueba ─────────
let hijo = null
let salida = ''
async function levantar() {
  salida = ''
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'telar-recuperacion-ui-'))
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
      TABLERO_INVITACION: '',
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
    headers: { origin: WEB, 'content-type': 'application/json', 'x-forwarded-for': ipNueva(), ...cabeceras },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
const comoDueno = () => ({ cookie: `tablero_sesion=${cookieJuego()}` })

/** Los controles táctiles de menos de 44 px dentro de lo que cae bajo `selector` (la casilla se cuenta por su rótulo, que es lo que se toca). */
const chicos = (page, selector) =>
  page.evaluate((sel) => {
    const visibles = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
    })
    return visibles
      .filter((e) => !(e instanceof HTMLInputElement && e.type === 'checkbox'))
      .map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 36), a: Math.round(e.getBoundingClientRect().height), l: Math.round(e.getBoundingClientRect().width) }))
      .filter((e) => Math.min(e.a, e.l) < 44)
  }, selector)

// ───────── un recorrido ─────────
async function recorrer(browser, c, n) {
  console.log(`\n── ${c.nombre} · ${c.tema} ──`)
  const errores = []
  const esperados = []
  const mirar = (page, etiqueta) => {
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      // Los pedidos que el recorrido hace fallar a propósito (código malo, enlace que ya no sirve, sesión cerrada).
      if (/Failed to load resource/.test(t)) esperados.push(`${etiqueta}: ${t}`)
      else errores.push(`${etiqueta}: ${t}`)
    })
    page.on('pageerror', (e) => errores.push(`${etiqueta}: ${e.message}`))
  }
  const foto = async (page, nombre) => {
    if (!CAPTURAS) return
    if (!c.todas && !CLAVES_CAPTURA.includes(nombre)) return
    await page.screenshot({ path: path.resolve(CAPTURAS, `${c.id}-${nombre}.png`), scale: 'css' })
  }
  const tema = (ctx) => ctx.addInitScript((t) => localStorage.setItem('tablero.tema', t), c.tema)
  const NOMBRE = `Pablo ${n}`
  const MAIL = `pablo${n}@ejemplo.com`
  let clave = FRASE

  // ── el dueño genera la invitación (por la API: lo de Amigos tiene su propio recorrido, probar-amigos-ui.cjs) ──
  const inv = await (await api('/api/amigos/invitaciones', 'POST', { nota: 'para Pablo' }, comoDueno())).json()

  // ── 1. el amigo se registra y guarda los códigos ──
  const ctxAmigo = await browser.newContext({ ...c.contexto, permissions: ['clipboard-read', 'clipboard-write'], locale: 'es-AR', acceptDownloads: true })
  await tema(ctxAmigo)
  const amigo = await ctxAmigo.newPage()
  mirar(amigo, 'amigo')
  await amigo.goto(inv.enlace)
  await amigo.locator('#unirse-nombre').waitFor({ timeout: 10000 })
  await amigo.locator('#unirse-nombre').fill(NOMBRE)
  await amigo.locator('#unirse-mail').fill(MAIL)
  await amigo.locator('#unirse-clave').fill(clave)
  await amigo.getByRole('button', { name: 'Crear mi cuenta' }).click()
  await amigo.getByRole('heading', { name: /Guardá estos códigos/ }).waitFor({ timeout: 20000 })
  chequear(true, 'al crear la cuenta, antes de entrar, aparece «Guardá estos códigos»')
  const codigos = await amigo.locator('.codigos__lista code').allInnerTexts()
  chequear(codigos.length === 8 && codigos.every((x) => FORMA.test(x)) && new Set(codigos).size === 8, 'son 8 códigos distintos, con el formato XXXX-XXXX-XXXX', codigos.join(' '))
  const textoPantalla = await amigo.locator('.codigos').innerText()
  chequear(/una sola vez/.test(textoPantalla) && /vale como tu\s+contraseña/.test(textoPantalla) && /única vez que los ves/.test(textoPantalla), 'dice para qué sirven, que cada uno sirve una vez, que valen como una contraseña y que es la única vez que se ven', textoPantalla)
  chequear(/Guardá estos códigos/.test(await amigo.locator('h1').innerText()), 'el título es un h1 (pantalla entera)')
  const seguir = amigo.getByRole('button', { name: 'Entrar a mi Telar' })
  chequear(await seguir.isDisabled(), 'el botón de seguir está apagado hasta marcar «Ya los guardé»')
  chequear(await amigo.getByText('Marcá «Ya los guardé» para seguir.').isVisible(), 'y dice por qué')
  await foto(amigo, 'codigos')
  if (c.movil) {
    await amigo.locator('.codigos__seguir').scrollIntoViewIfNeeded()
    await espera(250)
    await foto(amigo, 'codigos-fin')
  }
  await amigo.getByRole('button', { name: 'Copiar' }).click()
  const portapapeles = await amigo.evaluate(() => navigator.clipboard.readText())
  chequear(portapapeles === codigos.join('\n'), '«Copiar» deja los 8 códigos en el portapapeles, uno por línea', portapapeles)
  await amigo.getByRole('button', { name: 'Copiados' }).waitFor({ timeout: 3000 })
  const [descarga] = await Promise.all([amigo.waitForEvent('download'), amigo.getByRole('button', { name: 'Descargar .txt' }).click()])
  const archivo = fs.readFileSync(await descarga.path(), 'utf8')
  chequear(descarga.suggestedFilename() === 'telar-codigos-de-recuperacion.txt' && codigos.every((x) => archivo.includes(x)) && archivo.includes(MAIL) && /UNA sola vez/.test(archivo), '«Descargar .txt» baja un archivo con los códigos, el mail y cómo se usan', archivo.slice(0, 300))
  if (c.movil) {
    const mal = await chicos(amigo, '.entrar button, .entrar a, .entrar input, .codigos__confirmar')
    const labelAlto = await amigo.locator('.codigos__confirmar').evaluate((e) => Math.round(e.getBoundingClientRect().height))
    chequear(mal.length === 0 && labelAlto >= 44, 'celular: ningún control táctil de menos de 44 px en «Guardá estos códigos» (la casilla incluida)', JSON.stringify({ mal, labelAlto }))
  }
  await amigo.getByRole('checkbox', { name: 'Ya los guardé' }).check()
  chequear(await seguir.isEnabled(), 'con «Ya los guardé» marcada, se puede entrar')
  await seguir.click()
  await amigo.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  chequear(true, 'entra a su Telar vacío')
  const cuenta1 = await amigo.evaluate(async () => (await (await fetch('/api/cuenta/codigos')).json()))
  chequear(cuenta1.restantes === 8, 'le quedan 8 códigos', JSON.stringify(cuenta1))

  // ── Helpers de la app ──
  const abrirCuenta = async (page) => {
    if (c.movil) {
      await page.getByRole('button', { name: /^Menú:/ }).click()
      await page.locator('.hoja-mas').getByRole('button', { name: /Mi perfil/ }).click()
    } else {
      await page.keyboard.press('Control+Comma')
      await page.getByRole('tab', { name: 'Cuenta' }).click()
    }
    await page.locator('.codigos-cuenta').waitFor({ timeout: 10000 })
    await page.locator('.codigos-cuenta .codigos-cuenta__numero').waitFor({ timeout: 10000 })
    await mostrarCuenta(page)
  }
  // Las capturas y los toques de esta fila: a la vista (en Configuración queda debajo del perfil).
  const mostrarCuenta = async (page) => {
    await page.locator('.codigos-cuenta').scrollIntoViewIfNeeded()
    await page.locator('.codigos-cuenta').evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await espera(250)
  }
  const cerrarSesion = async (page) => {
    if (c.movil) {
      await page.getByRole('button', { name: /^Menú:/ }).click()
      await page.locator('.hoja-mas').getByRole('button', { name: 'Salir' }).click()
      await page.locator('.hoja-mas__confirmar').getByRole('button', { name: 'Salir' }).click()
    } else {
      await page.keyboard.press('Control+Comma')
      await page.getByRole('tab', { name: 'Cuenta' }).click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).click()
      await page.getByRole('button', { name: 'Salir' }).click()
    }
    await page.locator('.entrar').waitFor({ timeout: 15000 })
  }
  const olvide = async (page) => {
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click()
    await page.locator('#olvide-codigo').waitFor({ timeout: 8000 })
  }

  // ── 2. cierra sesión y recupera con un código ──
  await cerrarSesion(amigo)
  chequear((await amigo.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).count()) === 1, 'en Entrar hay un «¿Olvidaste tu contraseña?» bajo el formulario')
  await olvide(amigo)
  chequear(/Recuperá tu cuenta/.test(await amigo.locator('h1').innerText()), 'abre «Recuperá tu cuenta» (mail, código de recuperación y contraseña nueva)')
  chequear((await amigo.locator('#entrar-mail, #olvide-codigo, #olvide-clave').count()) === 3, 'con los tres campos')
  chequear(/dueño de Telar/.test(await amigo.locator('.entrar__ayuda-extra').innerText()), 'y dice qué hacer si no están los códigos: pedirle un enlace al dueño')
  await foto(amigo, 'olvide')
  await amigo.locator('#entrar-mail').fill(MAIL)
  await amigo.locator('#olvide-codigo').fill('ABCD-EFGH-JKLM')
  await amigo.locator('#olvide-clave').fill('la contraseña nueva del 1')
  await amigo.getByRole('button', { name: 'Cambiar contraseña y entrar' }).click()
  await amigo.getByRole('alert').getByText(/no son correctos/).waitFor({ timeout: 8000 })
  chequear(true, 'un código inventado: «El mail o el código de recuperación no son correctos, o ese código ya se usó.»')
  await foto(amigo, 'olvide-error')
  await amigo.locator('#olvide-codigo').fill(codigos[0])
  await amigo.locator('#olvide-clave').fill('corta')
  await amigo.getByRole('button', { name: 'Cambiar contraseña y entrar' }).click()
  await amigo.getByRole('alert').getByText(/al menos 10/).waitFor({ timeout: 5000 })
  chequear(true, 'una contraseña floja se explica en la misma pantalla (y no gasta el código: el siguiente intento lo usa)')
  if (c.movil) {
    const mal = await chicos(amigo, '.entrar button, .entrar a, .entrar input')
    chequear(mal.length === 0, 'celular: ningún control táctil de menos de 44 px en «Recuperá tu cuenta»', JSON.stringify(mal))
  }
  clave = 'la contraseña nueva del 1'
  await amigo.locator('#olvide-clave').fill(clave)
  await amigo.getByRole('button', { name: 'Cambiar contraseña y entrar' }).click()
  await amigo.getByRole('heading', { name: 'Listo, ya entraste' }).waitFor({ timeout: 15000 })
  chequear(/Te quedan\s+7\s+códigos de recuperación/.test(await amigo.locator('.recuperada__cuenta').innerText()), '«Listo, ya entraste. Te quedan 7 códigos de recuperación»', await amigo.locator('.recuperada__cuenta').innerText())
  chequear((await amigo.locator('.codigos__aviso--fuerte').count()) === 0, 'sin aviso fuerte (quedan más de 2)')
  await foto(amigo, 'recuperada')
  if (c.movil) {
    const mal = await chicos(amigo, '.entrar button, .entrar a')
    chequear(mal.length === 0, 'celular: ningún control táctil de menos de 44 px en «Listo, ya entraste»', JSON.stringify(mal))
  }
  await amigo.getByRole('button', { name: 'Seguir a Telar' }).click()
  await amigo.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  chequear(true, 'entra con la contraseña nueva')
  const reusado = await api('/api/recuperar', 'POST', { email: MAIL, codigo: codigos[0], clave: 'otra contraseña larga 9' })
  chequear(reusado.status === 401, 'el código gastado ya no sirve (401)')
  const viejaClave = await api('/api/sesion', 'POST', { email: MAIL, clave: FRASE })
  chequear(viejaClave.status === 401, 'y la contraseña de antes tampoco')

  // ── 3. Configuración → Cuenta: cuántos quedan y generar nuevos ──
  await abrirCuenta(amigo)
  chequear(/Te quedan 7 de 8/.test(await amigo.locator('.codigos-cuenta__numero').innerText()), 'Configuración → Cuenta: «Te quedan 7 de 8»')
  await foto(amigo, 'cuenta-codigos')
  await amigo.getByRole('button', { name: 'Generar códigos nuevos' }).click()
  await amigo.locator('.codigos-cuenta input[name="current-password"]').fill('no es esa contraseña')
  await amigo.locator('.codigos-cuenta').getByRole('button', { name: 'Generar', exact: true }).click()
  await amigo.locator('.codigos-cuenta').getByRole('alert').getByText(/no es esa/).waitFor({ timeout: 8000 })
  chequear(true, 'con la contraseña mala: «La contraseña no es esa.» (y no cambia nada)')
  await amigo.locator('.codigos-cuenta input[name="current-password"]').fill(clave)
  await mostrarCuenta(amigo)
  await foto(amigo, 'cuenta-generar')
  await amigo.locator('.codigos-cuenta').getByRole('button', { name: 'Generar', exact: true }).click()
  await amigo.locator('.codigos-cuenta .codigos__lista').waitFor({ timeout: 10000 })
  const nuevos = await amigo.locator('.codigos-cuenta .codigos__lista code').allInnerTexts()
  chequear(nuevos.length === 8 && nuevos.every((x) => FORMA.test(x)) && nuevos.every((x) => !codigos.includes(x)), 'con la contraseña buena salen 8 códigos nuevos, distintos de los de antes', nuevos.join(' '))
  chequear(/Los códigos de antes ya no sirven/.test(await amigo.locator('.codigos-cuenta').innerText()), 'y dice que los anteriores ya no sirven')
  await mostrarCuenta(amigo)
  await foto(amigo, 'cuenta-nuevos')
  if (c.movil) {
    const mal = await chicos(amigo, '.codigos-cuenta button, .codigos-cuenta a, .codigos-cuenta input')
    const alto = await amigo.locator('.codigos-cuenta .codigos__confirmar').evaluate((e) => Math.round(e.getBoundingClientRect().height))
    chequear(mal.length === 0 && alto >= 44, 'celular: ningún control táctil de menos de 44 px en «Generar códigos nuevos»', JSON.stringify({ mal, alto }))
  }
  chequear(await amigo.locator('.codigos-cuenta').getByRole('button', { name: 'Listo' }).isDisabled(), 'sin marcar «Ya los guardé», «Listo» está apagado')
  await amigo.locator('.codigos-cuenta').getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await amigo.locator('.codigos-cuenta').getByRole('button', { name: 'Listo' }).click()
  await amigo.locator('.codigos-cuenta__numero', { hasText: 'Te quedan 8 de 8' }).waitFor({ timeout: 8000 })
  chequear(true, 'queda «Te quedan 8 de 8»')
  const viejoCodigo = await api('/api/recuperar', 'POST', { email: MAIL, codigo: codigos[3], clave: 'otra contraseña larga 9' })
  chequear(viejoCodigo.status === 401, 'un código de los anteriores ya no sirve (aunque no estuviera gastado)')
  await amigo.keyboard.press('Escape')

  // ── 4. quedan pocos: el aviso fuerte ──
  for (let i = 0; i < 6; i++) {
    const r = await api('/api/recuperar', 'POST', { email: MAIL, codigo: nuevos[i], clave: `la contraseña del uso ${i} larga` })
    if (r.status !== 200) throw new Error(`no pude gastar un código de prueba: ${r.status} ${await r.text()}`)
    clave = `la contraseña del uso ${i} larga`
  }
  // (cada uso cerró las sesiones: se vuelve a entrar con la última contraseña, como lo haría la persona)
  await amigo.reload()
  await amigo.locator('#entrar-mail').waitFor({ timeout: 15000 })
  await amigo.locator('#entrar-mail').fill(MAIL)
  await amigo.locator('#entrar-clave').fill(clave)
  await amigo.getByRole('button', { name: 'Entrar', exact: true }).click()
  await amigo.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  await abrirCuenta(amigo)
  chequear(/Te quedan 2 de 8/.test(await amigo.locator('.codigos-cuenta__numero').innerText()), 'Configuración → Cuenta: «Te quedan 2 de 8»')
  const avisoCuenta = amigo.locator('.codigos-cuenta .codigos__aviso--fuerte')
  chequear((await avisoCuenta.count()) === 1 && /Quedan pocos/.test(await avisoCuenta.innerText()), 'con 2 o menos, aviso fuerte: «Quedan pocos…» (y «Generar códigos nuevos» pasa a ser el botón principal)')
  chequear(await amigo.locator('.codigos-cuenta').getByRole('button', { name: 'Generar códigos nuevos' }).evaluate((e) => e.classList.contains('boton--primario')), 'el botón «Generar códigos nuevos» se vuelve el principal')
  await foto(amigo, 'cuenta-pocos')
  await amigo.keyboard.press('Escape')
  await cerrarSesion(amigo)
  await olvide(amigo)
  await amigo.locator('#entrar-mail').fill(MAIL)
  await amigo.locator('#olvide-codigo').fill(nuevos[6].toLowerCase().replace(/-/g, ' '))
  clave = 'la contraseña del uso 6 larga'
  await amigo.locator('#olvide-clave').fill(clave)
  await amigo.getByRole('button', { name: 'Cambiar contraseña y entrar' }).click()
  await amigo.getByRole('heading', { name: 'Listo, ya entraste' }).waitFor({ timeout: 15000 })
  chequear(/Te queda\s+1\s+código de recuperación/.test(await amigo.locator('.recuperada__cuenta').innerText()), 'el código se acepta en minúsculas, con espacios y sin guiones; «Te queda 1 código de recuperación»', await amigo.locator('.recuperada__cuenta').innerText())
  chequear((await amigo.locator('.codigos__aviso--fuerte').count()) === 1 && /Quedan pocos/.test(await amigo.locator('.codigos__aviso--fuerte').innerText()), 'con 2 o menos, aviso fuerte: «Quedan pocos…»')
  await foto(amigo, 'recuperada-pocos')
  await amigo.getByRole('button', { name: 'Generar códigos nuevos' }).click()
  await amigo.getByRole('heading', { name: /Guardá estos códigos/ }).waitFor({ timeout: 10000 })
  chequear(/Los códigos de antes ya no sirven/.test(await amigo.locator('.codigos').innerText()), '«Generar códigos nuevos» desde ahí mismo: los muestra y avisa que los de antes ya no sirven')
  const codigosFinal = await amigo.locator('.codigos__lista code').allInnerTexts()
  await amigo.getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await amigo.getByRole('button', { name: 'Entrar a Telar' }).click()
  await amigo.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  const cuenta4 = await amigo.evaluate(async () => (await (await fetch('/api/cuenta/codigos')).json()))
  chequear(cuenta4.restantes === 8 && cuenta4.pocos === false, 'entra y le quedan 8 códigos', JSON.stringify(cuenta4))
  chequear(!errores.some((e) => /amigo/.test(e)), 'hasta acá, la consola del amigo sigue limpia', errores.join('\n'))

  // ── 4b. sin ningún código (también es lo que ve una cuenta anterior a esta función): lo dice y deja generar ──
  for (let i = 0; i < codigosFinal.length; i++) {
    const r = await api('/api/recuperar', 'POST', { email: MAIL, codigo: codigosFinal[i], clave: `la contraseña del cierre ${i} larga` })
    if (r.status !== 200) throw new Error(`no pude gastar un código de prueba: ${r.status} ${await r.text()}`)
    clave = `la contraseña del cierre ${i} larga`
  }
  await amigo.reload()
  await amigo.locator('#entrar-mail').waitFor({ timeout: 15000 })
  await amigo.locator('#entrar-mail').fill(MAIL)
  await amigo.locator('#entrar-clave').fill(clave)
  await amigo.getByRole('button', { name: 'Entrar', exact: true }).click()
  await amigo.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  await abrirCuenta(amigo)
  chequear(/No te queda ninguno/.test(await amigo.locator('.codigos-cuenta__numero').innerText()), 'sin códigos: «No te queda ninguno»')
  chequear(/únicamente el dueño de Telar/.test(await amigo.locator('.codigos-cuenta .codigos__aviso--fuerte').innerText()), 'con el aviso fuerte: solo el dueño de Telar podría ayudar, y «Generá códigos nuevos ahora»')
  await foto(amigo, 'cuenta-sin-codigos')
  await amigo.getByRole('button', { name: 'Generar códigos nuevos' }).click()
  await amigo.locator('.codigos-cuenta input[name="current-password"]').fill(clave)
  await amigo.locator('.codigos-cuenta').getByRole('button', { name: 'Generar', exact: true }).click()
  await amigo.locator('.codigos-cuenta .codigos__lista').waitFor({ timeout: 10000 })
  await amigo.locator('.codigos-cuenta').getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await amigo.locator('.codigos-cuenta').getByRole('button', { name: 'Listo' }).click()
  await amigo.locator('.codigos-cuenta__numero', { hasText: 'Te quedan 8 de 8' }).waitFor({ timeout: 8000 })
  chequear(true, 'y genera 8 nuevos desde Configuración → Cuenta')
  await amigo.keyboard.press('Escape')

  // ── 5. el camino del dueño ──
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
  await abrirAmigos()
  const fila = dueno.locator('.amigos-fila--amigo', { hasText: NOMBRE })
  await fila.waitFor({ timeout: 10000 })
  chequear(/Contraseña restablecida .*\(con un código de recuperación\)/.test(await fila.innerText()), 'el dueño ve en la fila del amigo «Contraseña restablecida … (con un código de recuperación)»: sin los códigos ni nada más', await fila.innerText())
  await fila.getByRole('button', { name: `Restablecer la contraseña de ${NOMBRE}` }).click()
  const panel = fila.locator('.amigos-restablecer')
  await panel.waitFor({ timeout: 5000 })
  const textoPanel = await panel.innerText()
  chequear(/Vos no ves ni elegís la contraseña de/.test(textoPanel) && /una sola vez/.test(textoPanel) && /24 horas/.test(textoPanel), 'el panel dice sin vueltas: el dueño NO ve ni elige la contraseña; el enlace sirve una vez y vence en 24 horas', textoPanel)
  await panel.evaluate((e) => e.scrollIntoView({ block: 'end' }))
  await espera(400)
  await foto(dueno, 'amigos-restablecer')
  await panel.getByRole('button', { name: 'Crear enlace' }).click()
  const campo = panel.locator('input[aria-label="Enlace para restablecer la contraseña"]')
  await campo.waitFor({ timeout: 8000 })
  const enlace = await campo.inputValue()
  chequear(new RegExp(`^${WEB.replace(/[.]/g, '\\.')}/restablecer/[A-Za-z0-9_-]{43}$`).test(enlace), 'se muestra el enlace «<la web>/restablecer/<token>»', enlace)
  chequear(/solo ahora/.test(await panel.innerText()), 'avisa «el enlace se muestra solo ahora»')
  await panel.evaluate((e) => e.scrollIntoView({ block: 'end' }))
  await espera(400)
  await foto(dueno, 'amigos-enlace')
  await panel.getByRole('button', { name: 'Copiar enlace' }).click()
  chequear((await dueno.evaluate(() => navigator.clipboard.readText())) === enlace, '«Copiar enlace» deja el enlace en el portapapeles')
  if (c.movil) {
    await panel.getByRole('button', { name: 'Compartir' }).click()
    const compartido = await dueno.evaluate(() => window.__compartido)
    chequear(compartido?.url === enlace && /ponés una contraseña nueva/.test(compartido?.text ?? ''), '«Compartir» le pasa el enlace y un texto a Web Share', JSON.stringify(compartido))
    const mal = await chicos(dueno, '.amigos-seccion button, .amigos-seccion input, .amigos-seccion a')
    chequear(mal.length === 0, 'celular: ningún control táctil de menos de 44 px en «Restablecer contraseña»', JSON.stringify(mal))
  } else chequear((await panel.getByRole('button', { name: 'Compartir' }).count()) === 0, 'sin Web Share (PC) no aparece «Compartir»')
  await panel.getByRole('button', { name: 'Listo' }).click()
  await fila.getByText(/Enlace para restablecer pendiente · vence/).waitFor({ timeout: 8000 })
  chequear(true, 'en la fila queda «Enlace para restablecer pendiente · vence …» con «Cancelar enlace»')
  chequear(!(await fila.innerText()).includes(enlace.split('/restablecer/')[1]), 'y la lista no trae el token')

  // el amigo lo abre SIN sesión (como si le llegara por WhatsApp)
  const ctxLink = await browser.newContext({ ...c.contexto, locale: 'es-AR' })
  await tema(ctxLink)
  const abre = await ctxLink.newPage()
  mirar(abre, 'amigo (con el enlace)')
  await abre.goto(enlace)
  await abre.locator('#restablecer-clave').waitFor({ timeout: 10000 })
  chequear(new RegExp(`Hola, ${NOMBRE}: poné tu contraseña nueva`).test(await abre.locator('h1').innerText()), 'el enlace abre «Hola, <nombre>: poné tu contraseña nueva» (sin pedir mail)', await abre.locator('h1').innerText())
  chequear(/él no la ve ni la elige/.test(await abre.locator('.entrar__texto').innerText()), 'y dice que el dueño no la ve ni la elige')
  await foto(abre, 'restablecer')
  await abre.locator('#restablecer-clave').fill('corta')
  await abre.getByRole('button', { name: 'Guardar y entrar' }).click()
  await abre.getByRole('alert').getByText(/al menos 10/).waitFor({ timeout: 5000 })
  chequear(true, 'una contraseña floja se explica en la pantalla')
  if (c.movil) {
    const mal = await chicos(abre, '.entrar button, .entrar a, .entrar input')
    chequear(mal.length === 0, 'celular: ningún control táctil de menos de 44 px en la pantalla del enlace', JSON.stringify(mal))
  }
  const ELEGIDA = 'la que eligió pablo desde el enlace'
  await abre.locator('#restablecer-clave').fill(ELEGIDA)
  await abre.getByRole('button', { name: 'Guardar y entrar' }).click()
  await abre.getByRole('heading', { name: /Guardá estos códigos/ }).waitFor({ timeout: 15000 })
  chequear(/Los códigos de antes ya no sirven/.test(await abre.locator('.codigos').innerText()), 'queda adentro y antes de seguir le muestra 8 códigos NUEVOS para guardar (los de antes ya no sirven)')
  chequear((await abre.locator('.codigos__lista code').count()) === 8, 'son 8')
  await abre.getByRole('checkbox', { name: 'Ya los guardé' }).check()
  await abre.getByRole('button', { name: 'Entrar a mi Telar' }).click()
  await abre.getByText('Creá tu primer proyecto').first().waitFor({ timeout: 20000 })
  chequear(true, 'entra a su Telar con la contraseña que eligió')
  chequear((await api('/api/cuenta', 'GET', undefined, { cookie: `tablero_sesion=${(await ctxAmigo.cookies())[0]?.value}` })).status === 401, 'sus otras sesiones se cerraron (la del otro navegador, 401)')
  chequear((await api('/api/sesion', 'POST', { email: MAIL, clave })).status === 401 && (await api('/api/sesion', 'POST', { email: MAIL, clave: ELEGIDA })).status === 200, 'la contraseña de antes ya no entra; la que eligió, sí')
  await ctxAmigo.close()

  // el dueño lo ve, sin enlace pendiente y sin la contraseña
  await dueno.reload()
  await dueno.waitForFunction(() => document.body.innerText.length > 40)
  await abrirAmigos()
  const fila2 = dueno.locator('.amigos-fila--amigo', { hasText: NOMBRE })
  await fila2.waitFor({ timeout: 10000 })
  const t2 = await fila2.innerText()
  chequear(/Contraseña restablecida .*\(con tu enlace\)/.test(t2) && !/Enlace para restablecer pendiente/.test(t2) && !t2.includes(ELEGIDA), 'el dueño ve «Contraseña restablecida … (con tu enlace)», sin enlace pendiente y sin contraseña', t2)
  await foto(dueno, 'amigos-restablecida')
  const novedades = await (await api('/api/notificaciones', 'GET', undefined, comoDueno())).json()
  chequear(novedades.some((x) => new RegExp(`${NOMBRE} restableció su contraseña`).test(x.titulo)) && !JSON.stringify(novedades).includes(ELEGIDA), 'y recibió un aviso en la campana («… restableció su contraseña»)', JSON.stringify(novedades.map((x) => x.titulo)))

  // el mismo enlace otra vez, y uno cancelado
  const ctxOtro = await browser.newContext({ ...c.contexto, locale: 'es-AR' }) // (sin sesión: el de antes ya entró con el enlace)
  await tema(ctxOtro)
  const otro = await ctxOtro.newPage()
  mirar(otro, 'enlace usado')
  await otro.goto(enlace)
  await otro.getByRole('heading', { name: 'Este enlace ya no sirve' }).waitFor({ timeout: 10000 })
  chequear((await otro.locator('input').count()) === 0 && /una sola vez y vence a las 24 horas/.test(await otro.locator('.entrar__texto').innerText()), 'el mismo enlace otra vez: «Este enlace ya no sirve» (sin formulario)')
  await foto(otro, 'restablecer-no-sirve')
  await fila2.getByRole('button', { name: `Restablecer la contraseña de ${NOMBRE}` }).click()
  await fila2.locator('.amigos-restablecer').getByRole('button', { name: 'Crear enlace' }).click()
  const enlace2 = await fila2.locator('input[aria-label="Enlace para restablecer la contraseña"]').inputValue()
  await fila2.locator('.amigos-restablecer').getByRole('button', { name: 'Listo' }).click()
  await fila2.getByRole('button', { name: new RegExp(`^Cancelar el enlace para restablecer la contraseña de ${NOMBRE}`) }).click()
  await fila2.getByText(/Enlace para restablecer pendiente/).waitFor({ state: 'detached', timeout: 8000 })
  chequear(true, '«Cancelar enlace»: desaparece de la fila')
  await otro.goto(enlace2)
  await otro.getByRole('heading', { name: 'Este enlace ya no sirve' }).waitFor({ timeout: 10000 })
  chequear(true, 'y el enlace cancelado no sirve')
  // con una sesión abierta en el navegador, el enlace no pisa la sesión
  const ctxSesion = await browser.newContext({ ...c.contexto, locale: 'es-AR' })
  await tema(ctxSesion)
  await ctxSesion.addCookies([{ name: 'tablero_sesion', value: cookieJuego(), url: WEB, httpOnly: true, sameSite: 'Lax' }])
  const conSesion = await ctxSesion.newPage()
  mirar(conSesion, 'con sesión')
  const enlace3 = await (await api(`/api/amigos/${(await (await api('/api/amigos', 'GET', undefined, comoDueno())).json()).amigos[0].id}/restablecer`, 'POST', undefined, comoDueno())).json()
  await conSesion.goto(enlace3.enlace)
  await conSesion.getByRole('heading', { name: 'Ya entraste a Telar' }).waitFor({ timeout: 10000 })
  chequear((await conSesion.locator('#restablecer-clave').count()) === 0, 'con una sesión abierta en ese navegador, el enlace no muestra el formulario («Ya entraste a Telar»): el dueño que prueba el suyo no pierde su sesión')
  await ctxSesion.close()
  await ctxOtro.close()
  await ctxLink.close()

  chequear(errores.length === 0, `la consola quedó limpia (${esperados.length} errores de red provocados a propósito)`, errores.join('\n'))
  await ctxDueno.close()
}

async function principal() {
  const browser = await chromium.launch()
  let datos = null
  try {
    let n = 0
    for (const c of COMBINACIONES) {
      datos = await levantar()
      await api('/api/proyectos', 'POST', { nombre: 'Restaurant City', prefijo: 'RC' }, { 'x-forwarded-for': '10.99.0.1', authorization: `Bearer ${CLAVE}` })
      await recorrer(browser, c, ++n)
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
