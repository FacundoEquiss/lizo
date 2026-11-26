// Capturas de Diseño (docs/plan-diseno.md, 12.2) contra un Telar local que ya está andando (npm run dev).
//   npm run diseno:capturas                      → todas, a docs/capturas/diseno/ (1440 × 900, escala 2)
//   npm run diseno:capturas -- --solo S1,R3      → solo esas
//   npm run diseno:capturas -- --medir           → además, la tabla de rendimiento (P1)
// Opciones: --web http://127.0.0.1:4397 (la web) · --api http://127.0.0.1:4398 (el servidor) · --escala 1 · --salida <carpeta>
// Las de Restaurant City (proyecto RC) llevan el prefijo rc- y están en .gitignore: el material original del juego nunca va
// al repo. Las del proyecto de prueba (EP) sí se suben.
// Ojo: algunas escenas cambian datos de la carpeta local (un comentario, una tarjeta propuesta, una página vacía).
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { RAIZ } from './comun.mjs'

const args = process.argv.slice(2)
const opcion = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const WEB = opcion('web', `http://127.0.0.1:${process.env.TABLERO_PUERTO_WEB || 4397}`)
const API = opcion('api', `http://127.0.0.1:${process.env.TABLERO_PUERTO || 4398}`)
const ESCALA = Number(opcion('escala', 2))
const SALIDA = path.resolve(RAIZ, opcion('salida', 'docs/capturas/diseno'))
const SOLO = opcion('solo', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const MEDIR = args.includes('--medir')
const CLAVE = process.env.TABLERO_CLAVE || leerClave()
mkdirSync(SALIDA, { recursive: true })

function leerClave() {
  const datos = process.env.TABLERO_DATOS
  try {
    return datos ? readFileSync(path.join(datos, 'clave-mcp.txt'), 'utf8').trim() : ''
  } catch {
    return ''
  }
}

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...(CLAVE ? { 'x-tablero-clave': CLAVE } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${t.slice(0, 200)}`)
  return t ? JSON.parse(t) : null
}

const { chromium } = await import('playwright-core')
const nav = await chromium.launch({ channel: 'chrome', headless: true })
const hechas = []
const fallas = []

/** Abre una ruta de la web en un contexto nuevo (tema claro u oscuro) y espera a que Diseño esté dibujado. */
async function abrir(ruta, o = {}) {
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: ESCALA, colorScheme: o.oscuro ? 'dark' : 'light' })
  await ctx.addInitScript(
    ([tema, extra]) => {
      localStorage.setItem('tablero.tema', tema)
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
    },
    [o.oscuro ? 'oscuro' : 'claro', o.localStorage ?? {}],
  )
  const p = await ctx.newPage()
  p.errores = []
  p.on('pageerror', (e) => p.errores.push(e.message))
  await p.goto(`${WEB}${ruta}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.dz-inspector', { timeout: 20000 })
  await p.waitForTimeout(o.espera ?? 2200)
  return p
}

async function guardar(p, nombre) {
  const archivo = path.join(SALIDA, `${nombre}.png`)
  await p.screenshot({ path: archivo })
  hechas.push(path.relative(RAIZ, archivo))
  if (p.errores.length) fallas.push(`${nombre}: ${p.errores.join(' | ')}`)
  await p.context().close()
}

/** Rectángulo en pantalla de una capa (o de un marco) de un marco vivo. */
async function rectDeCapa(p, marcoNombre, selector) {
  return p.evaluate(
    ([nombre, sel]) => {
      const f = [...document.querySelectorAll('iframe.dz-iframe')].find((x) => x.title === nombre)
      if (!f) return null
      const rf = f.getBoundingClientRect()
      const k = rf.width / Number(f.getAttribute('width'))
      const el = sel ? f.contentDocument.querySelector(sel) : f.contentDocument.body
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: rf.x + r.x * k, y: rf.y + r.y * k, w: r.width * k, h: r.height * k, id: el.getAttribute('data-id') }
    },
    [marcoNombre, selector],
  )
}

/** Elige la capa VISIBLE de un marco vivo que tiene ese texto (la de más adentro: la más chica que se ve). */
async function elegirTexto(p, marco, texto) {
  const capa = await p.evaluate(
    ([nombre, t]) => {
      const f = [...document.querySelectorAll('iframe.dz-iframe')].find((x) => x.title === nombre)
      if (!f) return null
      let mejor = null
      for (const el of f.contentDocument.querySelectorAll('[data-id]')) {
        if ((el.textContent ?? '').trim() !== t) continue
        const r = el.getBoundingClientRect()
        const area = r.width * r.height
        if (area > 0 && area < (mejor?.area ?? Infinity)) mejor = { id: el.getAttribute('data-id'), area }
      }
      return mejor?.id ?? null
    },
    [marco.nombre, texto],
  )
  if (capa) {
    await p.evaluate(([m, c]) => window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco: m, capa: c } })), [marco.id, capa])
    await p.waitForTimeout(900)
  }
  return capa
}

const evento = (p, nombre, detalle) => p.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n, { detail: d })), [nombre, detalle])

// ───────── datos que hacen falta ─────────
const rc = await api('GET', '/api/diseno/RC').catch(() => null)
const ep = await api('GET', '/api/diseno/EP').catch(() => null)
const marcosDe = async (p, pagina) => (await api('GET', `/api/diseno/${p}/paginas/${pagina}`)).marcos
const itemsDe = async (p, tipo) => (await api('GET', `/api/diseno/${p}/items?tipo=${tipo}&limite=1000`)).items
const marcoLlamado = (lista, nombre) => lista.find((m) => m.nombre === nombre) ?? lista.find((m) => m.nombre.startsWith(nombre))

const ESCENAS = []
const escena = (id, nombre, fn) => ESCENAS.push({ id, nombre, fn })

if (rc) {
  const celular = await marcosDe('RC', 'celular')
  const pc = await marcosDe('RC', 'pc')
  const componentes = await marcosDe('RC', 'componentes')
  const hud = marcoLlamado(celular, 'HUD del local')
  const hudPc = pc.find((m) => m.datos.par && m.datos.par === hud?.datos.par) ?? marcoLlamado(pc, 'HUD')
  const botonTexto = marcoLlamado(componentes, 'Botón con texto')
  const sueltos = await itemsDe('RC', 'color_suelto')
  const fuentes = await itemsDe('RC', 'fuente')
  const tokens = await itemsDe('RC', 'token')
  const textos = await itemsDe('RC', 'texto')
  const radio = tokens.find((t) => t.datos.clase === 'radio')
  const azul = tokens.find((t) => t.datos.css === '--azul-rc') ?? tokens.find((t) => t.datos.clase === 'color' && !t.datos.suelto)
  const conLlave = textos.find((t) => /\{[^}]+\}/.test(t.datos.valor)) ?? textos[0]

  for (const [sufijo, oscuro] of [
    ['claro', false],
    ['oscuro', true],
  ]) {
    escena(`S1`, `rc-S1-fundamentos-${sufijo}`, async () => guardar(await abrir('/RC/pendientes/diseno/fundamentos', { oscuro }), `rc-S1-fundamentos-${sufijo}`))
    if (hud) escena('E1', `rc-E1-vista-${sufijo}`, async () => guardar(await abrir(`/RC/pendientes/diseno/celular?sel=${hud.id}`, { oscuro }), `rc-E1-vista-${sufijo}`))
    if (hud)
      escena('E5', `rc-E5-inspector-texto-${sufijo}`, async () => {
        const p = await abrir(`/RC/pendientes/diseno/celular?sel=${hud.id}`, { oscuro })
        await elegirTexto(p, hud, '71.096')
        await guardar(p, `rc-E5-inspector-texto-${sufijo}`)
      })
    if (hud)
      escena('E6', `rc-E6-codigo-${sufijo}`, async () => {
        const p = await abrir(`/RC/pendientes/diseno/celular?sel=${hud.id}`, { oscuro })
        await elegirTexto(p, hud, '71.096')
        await p.click('role=tab[name="Código"]')
        await p.mouse.move(700, 700)
        await p.waitForTimeout(600)
        await guardar(p, `rc-E6-codigo-${sufijo}`)
      })
  }
  if (sueltos[0])
    escena('S1', 'rc-S1-colores-sueltos', async () => {
      const p = await abrir(`/RC/pendientes/diseno/fundamentos`)
      await evento(p, 'telar:diseno-encuadrar-item', { item: `color_suelto:${sueltos[0].clave}` })
      await p.waitForTimeout(900)
      await guardar(p, 'rc-S1-colores-sueltos')
    })
  if (fuentes[0])
    escena('S2', 'rc-S2-tipografia', async () => {
      const p = await abrir(`/RC/pendientes/diseno/fundamentos?sel=item:fuente:${encodeURIComponent(fuentes[0].clave)}`, { espera: 3200 })
      await guardar(p, 'rc-S2-tipografia')
    })
  if (radio)
    escena('S3', 'rc-S3-radios-sombras-movimiento', async () => {
      const p = await abrir(`/RC/pendientes/diseno/fundamentos?sel=item:token:${encodeURIComponent(radio.clave)}`, { espera: 3200 })
      await guardar(p, 'rc-S3-radios-sombras-movimiento')
    })
  escena('S4', 'rc-S4-salud', async () => {
    const p = await abrir('/RC/pendientes/diseno/fundamentos')
    await p.click('.dz-salud__tarjeta >> nth=0')
    await p.waitForTimeout(500)
    await guardar(p, 'rc-S4-salud')
  })
  escena('S5', 'rc-S5-iconos', async () => guardar(await abrir('/RC/pendientes/diseno/iconos'), 'rc-S5-iconos'))
  escena('S5', 'rc-S5-iconos-fondo-oscuro', async () => {
    const p = await abrir('/RC/pendientes/diseno/iconos')
    await p.click('.dz-fondo--oscuro')
    await p.waitForTimeout(400)
    await guardar(p, 'rc-S5-iconos-fondo-oscuro')
  })
  if (conLlave) escena('S6', 'rc-S6-textos', async () => guardar(await abrir(`/RC/pendientes/diseno/textos?sel=item:texto:${encodeURIComponent(conLlave.clave)}`), 'rc-S6-textos'))
  escena('S7', 'rc-S7-sincronizacion', async () => {
    const p = await abrir('/RC/pendientes/diseno/celular')
    await p.click('.dz-pastilla')
    await p.waitForTimeout(500)
    await guardar(p, 'rc-S7-sincronizacion')
  })
  if (botonTexto) escena('R1', 'rc-R1-componentes-boton', async () => guardar(await abrir(`/RC/pendientes/diseno/componentes?sel=${botonTexto.id}`, { espera: 3000 }), 'rc-R1-componentes-boton'))
  escena('R1', 'rc-R1-componentes', async () => guardar(await abrir(`/RC/pendientes/diseno/componentes`), 'rc-R1-componentes'))
  escena('R2', 'rc-R2-celular-todo', async () => guardar(await abrir('/RC/pendientes/diseno/celular'), 'rc-R2-celular-todo'))
  if (hud) escena('R3', 'rc-R3-celular-hud', async () => guardar(await abrir(`/RC/pendientes/diseno/celular?sel=${hud.id}`), 'rc-R3-celular-hud'))
  escena('R4', 'rc-R4-pc', async () => guardar(await abrir('/RC/pendientes/diseno/pc'), 'rc-R4-pc'))
  if (hudPc) escena('R4', 'rc-R4-pc-hud', async () => guardar(await abrir(`/RC/pendientes/diseno/pc?sel=${hudPc.id}`), 'rc-R4-pc-hud'))
  const decorarYBarrio = celular.filter((m) => m.seccion === 'Decorar' || m.seccion === 'Barrio')
  const decorar = celular.filter((m) => m.seccion === 'Decorar')
  if (decorar[1])
    escena('R5', 'rc-R5-decorar-y-barrio', async () => {
      const p = await abrir(`/RC/pendientes/diseno/celular?sel=${decorar[1].id}`)
      // las dos secciones enteras en pantalla
      await p.evaluate((ms) => {
        const r = document.querySelector('.dz-lienzo').getBoundingClientRect()
        const x1 = Math.min(...ms.map((m) => m.x))
        const y1 = Math.min(...ms.map((m) => m.y)) - 300
        const x2 = Math.max(...ms.map((m) => m.x + m.ancho))
        const y2 = Math.max(...ms.map((m) => m.y + m.alto))
        const zoom = Math.min((r.width - 60) / (x2 - x1), (r.height - 150) / (y2 - y1))
        window.dispatchEvent(new CustomEvent('telar:diseno-viewport', { detail: { x: (r.width - (x2 - x1) * zoom) / 2 - x1 * zoom, y: 50 - y1 * zoom, zoom } }))
      }, decorarYBarrio)
      await p.waitForTimeout(1500)
      await guardar(p, 'rc-R5-decorar-y-barrio')
    })
  if (hud)
    escena('E2', 'rc-E2-capas', async () => {
      const p = await abrir(`/RC/pendientes/diseno/celular?sel=${hud.id}`)
      const fila = p.locator('.dz-arbol__fila--capa').first()
      await fila.hover()
      await p.waitForTimeout(400)
      await guardar(p, 'rc-E2-capas')
    })
  if (hud)
    escena('E7', 'rc-E7-regla', async () => {
      const p = await abrir(`/RC/pendientes/diseno/celular?sel=${hud.id}`)
      // dos botones de abajo del HUD: se elige uno y, con Alt, se pasa por el otro
      const botones = await p.evaluate((nombre) => {
        const f = [...document.querySelectorAll('iframe.dz-iframe')].find((x) => x.title === nombre)
        if (!f) return []
        const rf = f.getBoundingClientRect()
        const k = rf.width / Number(f.getAttribute('width'))
        // los botones de abajo (Calle, Buzón…): cajas de 30 a 90 px, uno por lugar
        const vistos = new Set()
        return [...f.contentDocument.querySelectorAll('[data-id]')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 30 && r.width < 90 && r.height > 30 && r.top > 300)
          .map(({ el, r }) => ({ id: el.getAttribute('data-id'), x: Math.round(rf.x + (r.x + r.width / 2) * k), y: Math.round(rf.y + (r.y + r.height / 2) * k) }))
          .filter((b) => (vistos.has(b.x) ? false : (vistos.add(b.x), true)))
      }, hud.nombre)
      if (botones.length >= 2) {
        await p.evaluate(([m, c]) => window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco: m, capa: c } })), [hud.id, botones[0].id])
        await p.waitForTimeout(700)
        await p.mouse.move(botones[1].x - 8, botones[1].y - 8)
        await p.keyboard.down('Alt')
        await p.mouse.move(botones[1].x, botones[1].y, { steps: 4 })
        await p.waitForTimeout(500)
      }
      await guardar(p, 'rc-E7-regla')
      await p.keyboard.up('Alt').catch(() => {})
    })
  if (azul)
    escena('D8', 'rc-D8-proponer-cambio', async () => {
      const p = await abrir(`/RC/pendientes/diseno/fundamentos?sel=item:token:${encodeURIComponent(azul.clave)}`)
      await p.click('button:has-text("Proponer un cambio")')
      await p.fill('.dz-proponer input', '#1f8fc4')
      await p.fill('.dz-proponer textarea', 'Que el azul de los botones se lea mejor sobre el verde del piso.')
      await p.click('.dz-proponer button[type=submit]')
      await p.waitForTimeout(1200)
      await guardar(p, 'rc-D8-proponer-cambio')
      const t = (await api('GET', `/api/diseno/RC/vinculos?objetivo=${encodeURIComponent(`item:token:${azul.clave}`)}`)).pop()
      if (t) {
        const q = await abrir(`/RC/pendientes/diseno/fundamentos?tarjeta=${t.clave}`, { espera: 2500 })
        await guardar(q, 'rc-D8-tarjeta-creada')
      }
    })
}

if (ep) {
  const campana = ep.paginas.find((p) => p.slug.startsWith('campana')) ?? ep.paginas.find((p) => p.tipo === 'lienzo')
  const marcos = campana ? await marcosDe('EP', campana.slug) : []
  const posteo = marcos.find((m) => m.ancho === 1080 && m.alto === 1080)
  const historia = marcos.find((m) => m.ancho === 1080 && m.alto === 1920)
  const base = `/EP/pendientes/diseno/${campana?.slug}`
  if (historia)
    escena('C1', 'EP-campana-historia', async () => {
      const p = await abrir(`${base}?sel=${historia.id}`, { espera: 3000 })
      await guardar(p, 'EP-campana-historia')
    })
  if (historia)
    escena('C2', 'EP-exportar', async () => {
      const p = await abrir(`${base}?sel=${historia.id}`, { espera: 3000 })
      await p.locator('section.dz-isec:has(h3:has-text("Exportar"))').scrollIntoViewIfNeeded()
      await p.click('button:has-text("Adjuntar a la tarjeta")')
      await p.waitForTimeout(500)
      await guardar(p, 'EP-exportar')
      // el archivo exportado de verdad (PNG a 2x)
      const r = await fetch(`${API}/api/diseno/EP/marcos/${historia.id}/render?formato=png&escala=2`, { headers: CLAVE ? { 'x-tablero-clave': CLAVE } : {} })
      if (r.ok) {
        const archivo = path.join(SALIDA, 'EP-exportado-historia@2x.png')
        writeFileSync(archivo, Buffer.from(await r.arrayBuffer()))
        hechas.push(path.relative(RAIZ, archivo))
      } else fallas.push(`exportar: ${r.status}`)
    })
  escena('D4', 'EP-D4-variantes', async () => guardar(await abrir(base), 'EP-D4-variantes'))
  escena('E3', 'EP-E3-piezas', async () => {
    const p = await abrir(base, { localStorage: { 'telar.diseno': JSON.stringify({ pestanaIzq: 'piezas' }) } })
    await guardar(p, 'EP-E3-piezas')
  })
  if (posteo)
    for (const z of [0.25, 1, 4])
      escena('E4', `EP-E4-zoom-${z * 100}`, async () => {
        const p = await abrir(`${base}?sel=${posteo.id}`, { espera: 2600 })
        const c = await p.evaluate(() => {
          const r = document.querySelector('.dz-lienzo').getBoundingClientRect()
          return { w: r.width, h: r.height }
        })
        await p.evaluate(
          ([m, zoom, cw, ch]) => {
            // la esquina de arriba a la izquierda del marco (con su nombre) a un tercio de la pantalla
            const vp = { x: cw * 0.3 - m.x * zoom, y: ch * 0.4 - m.y * zoom, zoom }
            localStorage.setItem('telar.diseno.zoom-captura', JSON.stringify(vp))
            window.dispatchEvent(new CustomEvent('telar:diseno-viewport', { detail: vp }))
          },
          [posteo, z, c.w, c.h],
        )
        await p.waitForTimeout(900)
        await guardar(p, `EP-E4-zoom-${z * 100}`)
      })
  escena('E9', 'EP-E9-sin-paneles', async () => {
    const p = await abrir(base)
    await p.keyboard.press('Control+Backslash')
    await p.waitForTimeout(600)
    await guardar(p, 'EP-E9-sin-paneles')
  })
  escena('E8', 'EP-E8-pagina-vacia', async () => {
    let vacia = ep.paginas.find((p) => p.nombre === 'Página vacía')
    if (!vacia) vacia = await api('POST', '/api/diseno/EP/paginas', { nombre: 'Página vacía' })
    await guardar(await abrir(`/EP/pendientes/diseno/${vacia.slug}`), 'EP-E8-pagina-vacia')
    await api('PATCH', `/api/diseno/EP/paginas/${vacia.id}`, { archivada: true }).catch(() => {})
  })
  escena('D1', 'EP-D1-marco-nuevo', async () => {
    const p = await abrir(base)
    await p.keyboard.press('f')
    await p.waitForTimeout(500)
    await guardar(p, 'EP-D1-marco-nuevo')
  })
  if (posteo)
    escena('D2', 'EP-D2-texto-en-edicion', async () => {
      const p = await abrir(`${base}?sel=${posteo.id}`, { espera: 2600 })
      const r = await rectDeCapa(p, posteo.nombre, 'h1')
      if (r) {
        await p.mouse.dblclick(r.x + r.w / 3, r.y + r.h / 2)
        await p.waitForTimeout(300)
        await p.mouse.dblclick(r.x + r.w / 3, r.y + r.h / 2)
        await p.waitForTimeout(500)
      }
      await guardar(p, 'EP-D2-texto-en-edicion')
    })
  if (posteo)
    escena('D3', 'EP-D3-inspector-editable', async () => {
      const p = await abrir(`${base}?sel=${posteo.id}`, { espera: 2600 })
      const r = await rectDeCapa(p, posteo.nombre, 'h1')
      if (r) await p.evaluate(([m, c]) => window.dispatchEvent(new CustomEvent('telar:diseno-encuadrar', { detail: { marco: m, capa: c } })), [posteo.id, r.id])
      await p.waitForTimeout(800)
      await p.click('section.dz-isec:has(h3:has-text("Tipografía")) .dz-color-boton')
      await p.waitForTimeout(500)
      await guardar(p, 'EP-D3-inspector-editable')
    })
  if (posteo)
    escena('D6', 'EP-D6-codigo-con-error', async () => {
      const p = await abrir(`${base}?sel=${posteo.id}`, { espera: 2600 })
      await p.click('role=tab[name="Código"]')
      await p.click('button:has-text("Editar el CSS del marco")')
      await p.click('.dz-editor__campo')
      await p.keyboard.press('Control+End')
      await p.keyboard.type("\n.titulo{background:url(https://ejemplo.com/foto.jpg)}")
      await p.keyboard.press('Control+Enter')
      await p.waitForTimeout(900)
      await guardar(p, 'EP-D6-codigo-con-error')
    })
  if (posteo)
    escena('D7', 'EP-D7-comentario', async () => {
      const p = await abrir(`${base}?sel=${posteo.id}`, { espera: 2600 })
      const r = await rectDeCapa(p, posteo.nombre, null)
      if (r) {
        await p.keyboard.press('c')
        await p.mouse.click(r.x + r.w * 0.78, r.y + r.h * 0.2)
        await p.waitForTimeout(300)
        await p.keyboard.type('¿Probamos el título en dos líneas más cortas?')
        await p.keyboard.press('Control+Enter')
        await p.waitForTimeout(1200)
      }
      await guardar(p, 'EP-D7-comentario')
      // la tarjeta con la sección "Diseños" (la épica de la campaña: se crea si no está)
      const proyecto = (await api('GET', '/api/proyectos')).find((x) => x.prefijo === 'EP')
      const tablero = await api('GET', `/api/tableros/${proyecto.tableros[0].id}`)
      let epica = tablero.tarjetas.find((t) => t.titulo === 'Campaña de verano')
      if (!epica) epica = await api('POST', '/api/tarjetas', { tableroId: tablero.tablero.id, titulo: 'Campaña de verano', tipo: 'epica', descripcion: 'Posteos, historia y banners de la hamburguesería para el lanzamiento.' })
      for (const m of marcos.slice(0, 4)) await api('PUT', '/api/diseno/EP/vinculos', { objetivo: `marco:${m.id}`, tarjeta: epica.clave }).catch(() => {})
      const q = await abrir(`${base}?tarjeta=${epica.clave}`, { espera: 2500 })
      await guardar(q, 'EP-D7-tarjeta-disenos')
    })
}

// ───────── correr ─────────
for (const e of ESCENAS) {
  if (SOLO.length && !SOLO.includes(e.id) && !SOLO.includes(e.nombre)) continue
  try {
    await e.fn()
    console.log(`✔ ${e.nombre}`)
  } catch (err) {
    fallas.push(`${e.nombre}: ${err.message.split('\n')[0]}`)
    console.log(`✘ ${e.nombre}: ${err.message.split('\n')[0]}`)
  }
}

// ───────── rendimiento (P1) ─────────
if (MEDIR && rc) {
  const lineas = ['Rendimiento de Diseño (P1) — medido con Chrome sin cabeza, 1440 × 900', '']
  for (const [pagina, zoom] of [
    ['celular', null],
    ['celular', 0.6],
    ['iconos', null],
  ]) {
    const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const p = await ctx.newPage()
    const t0 = Date.now()
    await p.goto(`${WEB}/RC/pendientes/diseno/${pagina}`)
    await p.waitForSelector('.dz-marco, .dz-sis', { timeout: 20000 })
    const primera = Date.now() - t0
    await p.waitForTimeout(2500)
    // de cerca (60 %), los marcos pasan a vivos: es la prueba del tope de 12 iframes
    if (zoom) {
      await p.evaluate((z) => window.dispatchEvent(new CustomEvent('telar:diseno-viewport', { detail: { x: 40, y: 40, zoom: z } })), zoom)
      await p.waitForTimeout(2500)
    }
    const r = await p.evaluate(async () => {
      const lienzo = document.querySelector('.dz-lienzo .react-flow__pane') ?? document.querySelector('.dz-lienzo')
      const caja = lienzo.getBoundingClientRect()
      const cuadros = []
      let maxVivos = 0
      let ultimo = performance.now()
      let sigue = true
      const contar = (t) => {
        cuadros.push(t - ultimo)
        ultimo = t
        maxVivos = Math.max(maxVivos, document.querySelectorAll('iframe.dz-iframe').length)
        if (sigue) requestAnimationFrame(contar)
      }
      requestAnimationFrame(contar)
      // 3 s de desplazamiento con la rueda (como un trackpad)
      for (let i = 0; i < 180; i++) {
        lienzo.dispatchEvent(new WheelEvent('wheel', { deltaX: i % 60 < 30 ? 14 : -14, deltaY: i % 90 < 45 ? 22 : -22, clientX: caja.x + caja.width / 2, clientY: caja.y + caja.height / 2, bubbles: true }))
        await new Promise((ok) => setTimeout(ok, 16))
      }
      await new Promise((ok) => setTimeout(ok, 1500))
      sigue = false
      const lindos = cuadros.slice(2)
      const prom = lindos.reduce((a, b) => a + b, 0) / Math.max(1, lindos.length)
      return {
        fps: Math.round(1000 / prom),
        peor: Math.round(Math.max(...lindos)),
        maxVivos,
        memoria: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null,
      }
    })
    lineas.push(`${pagina}${zoom ? ` al ${zoom * 100} %` : ' (ver todo)'}: primera página ${primera} ms · ${r.fps} cuadros/s desplazando (peor cuadro ${r.peor} ms) · máximo de iframes vivos ${r.maxVivos} (tope 12) · memoria JS ${r.memoria ?? '?'} MB`)
    await ctx.close()
  }
  const assets = path.join(RAIZ, 'dist/web/assets')
  if (existsSync(assets)) {
    const trozos = readdirSync(assets).filter((f) => /^Diseno-.*\.(js|css)$/.test(f))
    const kb = (b) => `${(b / 1024).toFixed(1)} KB`
    for (const t of trozos) {
      const b = readFileSync(path.join(assets, t))
      lineas.push(`trozo ${t}: ${kb(statSync(path.join(assets, t)).size)} (${kb(gzipSync(b).length)} gzip)`)
    }
  }
  const archivo = path.join(SALIDA, 'P1-rendimiento.txt')
  writeFileSync(archivo, lineas.join('\n') + '\n')
  hechas.push(path.relative(RAIZ, archivo))
  console.log(lineas.join('\n'))
}

await nav.close()
console.log(`\n${hechas.length} capturas en ${path.relative(RAIZ, SALIDA)}${fallas.length ? `\nProblemas:\n- ${fallas.join('\n- ')}` : ''}`)
process.exit(fallas.length ? 1 : 0)
