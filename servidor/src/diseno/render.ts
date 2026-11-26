// Render en el servidor (decisión D7): un Chromium sin cabeza dibuja el mismo documento que ve la persona
// (compartido/diseno/documento.ts) y devuelve la imagen, las cajas de cada capa y los avisos de calidad.
//   · Local: playwright-core con el Chrome instalado (channel 'chrome' o TABLERO_CHROME). Un navegador vivo que se cierra a
//     los 60 s sin uso.
//   · Vercel: la función aparte render.func usa @sparticuz/chromium (configurarRender({ chromium: 'empaquetado' })); la
//     función principal le pide la imagen por HTTP con la clave (ver motor remoto en servicio-diseno.ts).
// Todos los pedidos de la página se interceptan: /archivos/** se contesta desde el almacén (sin HTTP ni cookies) y
// cualquier otro se aborta. La política de contenido del documento impide cualquier script.
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { documentoDeMarco, expandirPiezas, cssEnEstilo, type HojaParaDocumento } from '../../../compartido/diseno/documento'
import { analizarHtml, VACIOS, type ElementoHtml, type NodoHtml } from '../../../compartido/diseno/html'
import { detalleDeElemento, type DetalleCapa } from '../../../compartido/diseno/reglas'
import type { Caja, DatosMarco, DatosPieza } from '../../../compartido/diseno/tipos'
import { ErrorDominio } from '../dominio/servicio'

export type LeerArchivo = (ruta: string) => Promise<{ datos: Uint8Array; mime: string } | null>

export interface EntradaRender {
  marco: { html: string; css: string; ancho: number; alto: number; hojas: string[]; datos: DatosMarco; origen: 'propio' | 'importado'; nombre?: string }
  hojas: HojaParaDocumento[]
  cssTokens: string
  piezas: Record<string, DatosPieza>
}

export interface OpcionesRender {
  /** px de imagen por px de marco. */
  escala?: number
  formato?: 'png' | 'jpg' | 'webp' | 'svg'
  calidad?: number
  capa?: string
  modo?: string
  estados?: boolean
  sinFondo?: boolean
  /** Fondo detrás de un marco transparente (para ver sprites blancos). */
  sobre?: 'claro' | 'oscuro' | 'transparente'
  /** Solo cajas, estilos y avisos (sin imagen). */
  soloMedir?: boolean
  /** Lado mayor máximo de la imagen (miniaturas: 640). */
  ladoMax?: number
  /** Id de una capa para inspeccionar a fondo (reglas que le aplican, estilos calculados, HTML). */
  detalle?: string
}

export interface ResultadoRender {
  bytes: Uint8Array | null
  mime: string
  /** Medidas de la imagen. */
  ancho: number
  alto: number
  avisos: string[]
  cajas: Record<string, Caja>
  estilos: Record<string, string>
  ms: number
  detalle?: DetalleCapa | null
}

const ORIGEN = 'http://telar.local'
/** tsx (esbuild con keepNames) envuelve las funciones con __name(): en la página no existe. Se define antes de todo. */
export const DEFINIR_NAME = 'globalThis.__name = globalThis.__name || ((f) => f)'
let modo: 'chrome' | 'empaquetado' = 'chrome'
let navegador: Promise<Browser> | null = null
let reloj: ReturnType<typeof setTimeout> | null = null
let enUso = 0
const cola: (() => void)[] = []
const MAX_PARALELO = 2

/** En la función de Vercel: el Chromium empaquetado. */
export function configurarRender(o: { chromium: 'chrome' | 'empaquetado' }) {
  modo = o.chromium
}
export const modoRender = () => modo

async function lanzar(): Promise<Browser> {
  const { chromium } = await import('playwright-core')
  if (modo === 'empaquetado') {
    const sp = (await import('@sparticuz/chromium')).default
    return chromium.launch({ executablePath: await sp.executablePath(), args: sp.args, headless: true })
  }
  const ruta = process.env.TABLERO_CHROME
  try {
    return await chromium.launch(ruta ? { executablePath: ruta, headless: true } : { channel: 'chrome', headless: true })
  } catch (e) {
    if (!ruta) {
      try {
        return await chromium.launch({ headless: true })
      } catch {
        // sigue abajo
      }
    }
    throw new ErrorDominio(
      `No pude abrir Chrome para dibujar el marco (${(e as Error).message.split('\n')[0]}). Instalá Google Chrome o poné su ruta en TABLERO_CHROME.`,
      503,
    )
  }
}

/** Borra lo que Chromium deja en /tmp (carpetas de perfil y de sesión de Playwright). No toca el binario descomprimido. Solo en la función de Vercel, donde se abre un navegador por vez. */
async function limpiarTemporales(): Promise<void> {
  try {
    const { readdir, rm } = await import('node:fs/promises')
    const nombres = await readdir('/tmp').catch(() => [] as string[])
    await Promise.all(
      nombres
        .filter((n) => /^(playwright[-_]|\.org\.chromium\.|chromium-)/i.test(n) && n !== 'chromium')
        .map((n) => rm(`/tmp/${n}`, { recursive: true, force: true }).catch(() => {})),
    )
  } catch {
    /* limpiar es un favor: si falla, el dibujo sigue */
  }
}

/** Cuando Chromium se cae online, deja en el registro cuánto espacio queda en /tmp y qué lo ocupa (el dibujo se cae si faltan unos 64 MB). */
async function diagnosticarDisco(): Promise<void> {
  try {
    const { execFileSync } = await import('node:child_process')
    const df = execFileSync('df', ['-k', '/tmp'], { encoding: 'utf8', timeout: 3000 }).trim().split('\n').slice(-1)[0]
    const du = execFileSync('sh', ['-c', 'du -sk /tmp/* /tmp/.[!.]* 2>/dev/null | sort -n | tail -6'], { encoding: 'utf8', timeout: 4000 }).trim().replace(/\n/g, ' | ')
    console.error(`[tablero] disco: ${df} · mayores: ${du}`)
  } catch {
    /* es solo un diagnóstico */
  }
}

async function conNavegador<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  // El Chromium empaquetado corre en un solo proceso (--single-process, sin eso no arranca en la función): al cerrar el
  // contexto de un dibujo se lleva puesto al navegador entero. En la función de Vercel se abre uno por dibujo y de a uno
  // (arranca en ~0,3 s una vez descomprimido; con 2 GB no conviene tener dos a la vez).
  if (modo === 'empaquetado') {
    if (enUso >= 1) await new Promise<void>((r) => cola.push(r))
    enUso++
    let b: Browser | null = null
    try {
      await limpiarTemporales()
      b = await lanzar()
      return await fn(b)
    } catch (e) {
      await diagnosticarDisco()
      throw e
    } finally {
      await b?.close().catch(() => {})
      // Con --single-process, cerrar el contexto mata al navegador antes de que Playwright borre su carpeta de perfil: en una
      // función «caliente» esas carpetas se acumulan hasta llenar /tmp y Chromium se cae («menos de 64 MB libres»).
      await limpiarTemporales()
      enUso--
      cola.shift()?.()
    }
  }
  if (enUso >= MAX_PARALELO) await new Promise<void>((r) => cola.push(r))
  enUso++
  if (reloj) clearTimeout(reloj)
  try {
    if (!navegador) navegador = lanzar().catch((e) => {
      navegador = null
      throw e
    })
    let b = await navegador
    if (!b.isConnected()) {
      navegador = lanzar()
      b = await navegador
    }
    return await fn(b)
  } finally {
    enUso--
    cola.shift()?.()
    if (enUso === 0) {
      reloj = setTimeout(() => {
        const n = navegador
        navegador = null
        void n?.then((b) => b.close()).catch(() => {})
      }, 60_000)
      ;(reloj as { unref?: () => void }).unref?.()
    }
  }
}

export async function cerrarRender() {
  const n = navegador
  navegador = null
  await n?.then((b) => b.close()).catch(() => {})
}

async function prepararContexto(b: Browser, ancho: number, alto: number, escala: number, documento: string, leer: LeerArchivo): Promise<{ ctx: BrowserContext; page: Page; fallidos: string[] }> {
  const ctx = await b.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: escala, serviceWorkers: 'block' })
  await ctx.addInitScript(DEFINIR_NAME)
  const fallidos: string[] = []
  await ctx.route('**/*', async (ruta) => {
    const url = ruta.request().url()
    if (url === `${ORIGEN}/__marco`) return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: documento })
    if (url.startsWith(`${ORIGEN}/archivos/`)) {
      try {
        const rel = decodeURIComponent(new URL(url).pathname.replace(/^\/archivos\//, ''))
        const a = await leer(rel)
        if (a) return ruta.fulfill({ status: 200, contentType: a.mime || mimeDeRuta(rel), body: Buffer.from(a.datos) })
      } catch {
        // cae abajo
      }
      fallidos.push(new URL(url).pathname)
      return ruta.fulfill({ status: 404, body: '' })
    }
    if (url.startsWith('data:')) return ruta.continue()
    fallidos.push(url)
    return ruta.abort('blockedbyclient')
  })
  const page = await ctx.newPage()
  return { ctx, page, fallidos }
}

export function mimeDeRuta(r: string): string {
  const ext = r.split('?')[0]!.split('.').pop()?.toLowerCase()
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      avif: 'image/avif',
      css: 'text/css; charset=utf-8',
      woff2: 'font/woff2',
      woff: 'font/woff',
      ttf: 'font/ttf',
      otf: 'font/otf',
    } as Record<string, string>
  )[ext ?? ''] ?? 'application/octet-stream'
}

/** Espera fuentes e imágenes (con tope) para que la foto salga completa. */
async function esperarRecursos(page: Page) {
  await page
    .evaluate(async () => {
      const tope = new Promise((r) => setTimeout(r, 4000))
      const imagenes = Promise.all(
        [...document.images].map((img) => (img.complete ? Promise.resolve() : new Promise((r) => ((img.onload = r), (img.onerror = r))))),
      )
      await Promise.race([Promise.all([document.fonts.ready, imagenes]), tope])
      // fondos con url(): se esperan cargando la misma imagen
      const urls = new Set<string>()
      for (const el of document.querySelectorAll('*')) {
        const bg = getComputedStyle(el).backgroundImage
        for (const m of bg.matchAll(/url\("?([^")]+)"?\)/g)) urls.add(m[1]!)
        if (urls.size > 400) break
      }
      await Promise.race([
        Promise.all(
          [...urls].map(
            (u) =>
              new Promise((r) => {
                const i = new Image()
                i.onload = i.onerror = r
                i.src = u
              }),
          ),
        ),
        new Promise((r) => setTimeout(r, 3000)),
      ])
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return true
    })
    .catch(() => {})
}

interface Medicion {
  cajas: Record<string, Caja>
  estilos: Record<string, string>
  avisos: string[]
}

/** Corre por el protocolo de depuración (no es código de la página: la página no tiene scripts). */
async function medir(page: Page, propio: boolean): Promise<Medicion> {
  return page.evaluate((propio: boolean) => {
    const W = innerWidth
    const H = innerHeight
    const r = (n: number) => Math.round(n)
    const cajas: Record<string, [number, number, number, number]> = {}
    const estilos: Record<string, string> = {}
    const avisos: string[] = []
    const fuera = new Set<Element>()
    const nombre = (el: Element) => {
      const n = el.getAttribute('data-nombre') || el.getAttribute('aria-label')
      if (n) return `«${n}»`
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (t) return `"${t.length > 30 ? t.slice(0, 29) + '…' : t}"`
      return el.tagName.toLowerCase() + (el.classList[0] ? '.' + el.classList[0] : '')
    }
    const hex = (c: string) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c)
      if (!m) return c
      const h = (x: string) => Math.round(Number(x)).toString(16).padStart(2, '0')
      const a = m[4] === undefined ? 1 : Number(m[4])
      return `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}${a < 1 ? h(String(a * 255)) : ''}`
    }
    const declaradas = new Set([...document.fonts].map((f) => f.family.replace(/["']/g, '').toLowerCase()))
    const genericas = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'inherit', 'initial'])
    const familiasFaltan = new Map<string, string>()
    const els = document.querySelectorAll('[data-id]')
    let n = 0
    for (const el of els) {
      const id = el.getAttribute('data-id')!
      const b = el.getBoundingClientRect()
      cajas[id] = [r(b.x), r(b.y), r(b.width), r(b.height)]
      if (++n > 4000) continue
      const cs = getComputedStyle(el)
      const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0
      const textoPropio = [...el.childNodes].some((c) => c.nodeType === 3 && (c.textContent || '').trim())
      if (textoPropio) {
        const fam = cs.fontFamily.split(',')[0]!.replace(/["']/g, '').trim()
        estilos[id] = `${fam} ${cs.fontWeight} ${Math.round(parseFloat(cs.fontSize) * 10) / 10}px ${hex(cs.color)}`
        if (visible && parseFloat(cs.fontSize) < 9 && propio) avisos.push(`texto chico en \`${id}\` ${nombre(el)}: ${parseFloat(cs.fontSize).toFixed(1)} px a tamaño real (menos de 9 px no se lee)`)
        if (fam && !declaradas.has(fam.toLowerCase()) && !genericas.has(fam.toLowerCase()) && propio) familiasFaltan.set(fam, id)
      } else if (cs.backgroundImage !== 'none') estilos[id] = `fondo imagen${cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ' sobre ' + hex(cs.backgroundColor) : ''}`
      else if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') estilos[id] = `fondo ${hex(cs.backgroundColor)}`
      if (!visible || !propio) continue
      // fuera del marco (se informa la capa de más arriba, no todos sus hijos)
      if (b.right > W + 2 || b.bottom > H + 2 || b.left < -2 || b.top < -2) {
        let p = el.parentElement
        let yaContado = false
        while (p) {
          if (fuera.has(p)) yaContado = true
          p = p.parentElement
        }
        fuera.add(el)
        if (!yaContado) {
          const lados = [b.left < -2 && `${r(-b.left)} px a la izquierda`, b.top < -2 && `${r(-b.top)} px arriba`, b.right > W + 2 && `${r(b.right - W)} px a la derecha`, b.bottom > H + 2 && `${r(b.bottom - H)} px abajo`].filter(Boolean)
          avisos.push(`capa fuera del marco: \`${id}\` ${nombre(el)} se sale ${lados.join(' y ')}`)
        }
      }
      // texto cortado: contenido más grande que la caja y desborde escondido
      const oculta = /hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY) || cs.textOverflow === 'ellipsis'
      // tolerancia: los rasgos de las letras (descendentes, itálicas) asoman unos px sin que falte texto; un renglón cortado
      // asoma al menos medio cuerpo de letra
      const cuerpo = parseFloat(cs.fontSize) || 16
      if (oculta && (el.textContent || '').trim() && (el.scrollWidth > el.clientWidth + Math.max(2, cuerpo * 0.2) || el.scrollHeight > el.clientHeight + Math.max(2, cuerpo * 0.4)))
        avisos.push(
          `texto cortado en \`${id}\` ${nombre(el)}: el contenido mide ${el.scrollWidth}×${el.scrollHeight} y entra ${el.clientWidth}×${el.clientHeight}. Achicá la letra, agrandá la caja o acortá el texto.`,
        )
    }
    // texto que se sale del marco aunque la caja no (texto largo sin ajuste)
    if (propio) {
      const docW = document.documentElement.scrollWidth
      const docH = document.documentElement.scrollHeight
      if ((docW > W + 2 || docH > H + 2) && !avisos.some((a) => a.startsWith('capa fuera'))) avisos.push(`el contenido mide ${docW}×${docH} y el marco ${W}×${H}: algo se sale y queda recortado`)
    }
    for (const img of document.images) {
      if (img.complete && img.naturalWidth === 0) {
        const id = img.getAttribute('data-id') || img.closest('[data-id]')?.getAttribute('data-id') || '?'
        avisos.push(`imagen sin cargar en \`${id}\`: ${img.getAttribute('src')?.slice(0, 120)}`)
      }
    }
    for (const f of document.fonts) if (f.status === 'error') avisos.push(`la fuente «${f.family}» no cargó`)
    for (const [fam, id] of familiasFaltan) avisos.push(`la fuente «${fam}» no está en el proyecto (capa \`${id}\`): se ve otra en su lugar. Subila con subir_activo (familia, pesos) o usá una de leer_diseno sistema: fuentes`)
    return { cajas, estilos, avisos: [...new Set(avisos)].slice(0, 40) }
  }, propio)
}

/** Dibuja un marco. */
export async function renderizar(e: EntradaRender, leer: LeerArchivo, op: OpcionesRender = {}): Promise<ResultadoRender> {
  const t0 = Date.now()
  if (op.formato === 'svg') {
    const svg = await svgDeMarco(e, leer, op)
    return { bytes: new TextEncoder().encode(svg), mime: 'image/svg+xml', ancho: e.marco.ancho, alto: e.marco.alto, avisos: [], cajas: {}, estilos: {}, ms: Date.now() - t0 }
  }
  const { ancho, alto } = e.marco
  let escala = Math.min(4, Math.max(0.05, op.escala ?? 1))
  // Chrome dibuja a 1x como mínimo: lo que va más chico se achica después, en un lienzo.
  const reducir = escala < 1 ? escala : 1
  if (escala < 1) escala = 1
  const transparente = op.sinFondo || op.sobre === 'transparente'
  const documento = documentoDeMarco({
    marco: e.marco,
    hojas: e.hojas,
    cssTokens: e.cssTokens,
    piezas: e.piezas,
    opciones: {
      pausar: true,
      estados: op.estados,
      modo: op.modo,
      transparente: op.sinFondo,
      extraCss: !op.sinFondo && op.sobre && op.sobre !== 'transparente' && !e.marco.datos.fondo && e.marco.origen === 'importado' ? `html{background:${op.sobre === 'oscuro' ? '#2b2c30' : '#f4efe6'}}` : undefined,
    },
  })
  return conNavegador(async (b) => {
    const { ctx, page, fallidos } = await prepararContexto(b, ancho, alto, escala, documento, leer)
    try {
      await page.goto(`${ORIGEN}/__marco`, { waitUntil: 'load', timeout: 20_000 })
      await esperarRecursos(page)
      const m = await medir(page, e.marco.origen === 'propio')
      for (const f of fallidos) if (!m.avisos.some((a) => a.includes(f))) m.avisos.push(`no se encontró ${f}`)
      let detalle: DetalleCapa | null = null
      if (op.detalle) {
        const h = await page.$(`[data-id="${op.detalle.replace(/[^\w-]/g, '')}"]`)
        if (h) {
          const hojas = Object.fromEntries(e.hojas.filter((x) => x.url).map((x) => [x.url!, x.clave]))
          detalle = await h.evaluate(detalleDeElemento, { hojas, maxHtml: 6000 })
        }
      }
      if (op.soloMedir) return { bytes: null, mime: '', ancho, alto, avisos: m.avisos, cajas: m.cajas, estilos: m.estilos, ms: Date.now() - t0, detalle }
      let clip: { x: number; y: number; width: number; height: number } | undefined
      if (op.capa) {
        const c = m.cajas[op.capa]
        if (!c) throw new ErrorDominio(`No existe la capa \`${op.capa}\` en este marco.`, 404)
        const x = Math.max(0, c[0])
        const y = Math.max(0, c[1])
        clip = { x, y, width: Math.max(1, Math.min(ancho, c[0] + c[2]) - x), height: Math.max(1, Math.min(alto, c[1] + c[3]) - y) }
      }
      const formatoChrome = op.formato === 'jpg' ? 'jpeg' : 'png'
      let bytes: Uint8Array = await page.screenshot({
        type: formatoChrome,
        quality: formatoChrome === 'jpeg' ? Math.round((op.calidad ?? 0.9) * 100) : undefined,
        omitBackground: transparente,
        clip,
        animations: 'disabled',
        caret: 'hide',
      })
      let w = Math.round((clip?.width ?? ancho) * escala)
      let h = Math.round((clip?.height ?? alto) * escala)
      const tope = op.ladoMax ?? 0
      let factor = reducir
      if (tope && Math.max(w, h) * factor > tope) factor = tope / Math.max(w, h)
      let mime = formatoChrome === 'jpeg' ? 'image/jpeg' : 'image/png'
      if (factor < 1 || op.formato === 'webp') {
        const conv = await convertir(b, bytes, mime, { factor, formato: op.formato === 'webp' ? 'image/webp' : mime, calidad: op.calidad ?? 0.82 })
        bytes = conv.bytes
        w = conv.ancho
        h = conv.alto
        mime = conv.mime
      }
      return { bytes, mime, ancho: w, alto: h, avisos: m.avisos, cajas: m.cajas, estilos: m.estilos, ms: Date.now() - t0, detalle }
    } finally {
      await ctx.close().catch(() => {})
    }
  })
}

/** Achica y/o cambia de formato una imagen en un lienzo (Chrome no saca WebP ni capturas a menos de 1x). */
async function convertir(b: Browser, bytes: Uint8Array, mime: string, o: { factor: number; formato: string; calidad: number }) {
  const ctx = await b.newContext({ viewport: { width: 64, height: 64 } })
  await ctx.addInitScript(DEFINIR_NAME)
  try {
    const page = await ctx.newPage()
    const r = await page.evaluate(
      async ({ b64, mime, factor, formato, calidad }) => {
        const img = new Image()
        img.src = `data:${mime};base64,${b64}`
        await img.decode()
        const w = Math.max(1, Math.round(img.naturalWidth * factor))
        const h = Math.max(1, Math.round(img.naturalHeight * factor))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')!
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'high'
        g.drawImage(img, 0, 0, w, h)
        const url = c.toDataURL(formato, calidad)
        return { url, w, h }
      },
      { b64: Buffer.from(bytes).toString('base64'), mime, factor: o.factor, formato: o.formato, calidad: o.calidad },
    )
    const coma = r.url.indexOf(',')
    const salida = r.url.slice(5, r.url.indexOf(';'))
    return { bytes: new Uint8Array(Buffer.from(r.url.slice(coma + 1), 'base64')), mime: salida, ancho: r.w, alto: r.h }
  } finally {
    await ctx.close().catch(() => {})
  }
}

/** Varias imágenes en una grilla con su nombre (ver_diseno con marcos: [...]). */
export async function componerGrilla(imagenes: { nombre: string; bytes: Uint8Array; mime: string; ancho: number; alto: number }[], anchoTotal = 1600): Promise<{ bytes: Uint8Array; ancho: number; alto: number }> {
  const cols = imagenes.length <= 1 ? 1 : imagenes.length <= 4 ? 2 : 3
  const celda = Math.floor((anchoTotal - 32 * (cols + 1)) / cols)
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#e8e0d2;font:600 22px system-ui,sans-serif;color:#29241e}
    .g{display:grid;grid-template-columns:repeat(${cols},${celda}px);gap:32px;padding:32px;align-items:start}
    figure{margin:0}figcaption{margin:0 0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    figcaption small{color:#786e62;font-weight:500;margin-left:8px}
    img{display:block;max-width:${celda}px;max-height:${celda * 1.6}px;box-shadow:0 2px 10px rgba(0,0,0,.18);background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px}
  </style><div class="g">${imagenes
    .map((i) => `<figure><figcaption>${esc(i.nombre)}<small>${i.ancho}×${i.alto}</small></figcaption><img src="data:${i.mime};base64,${Buffer.from(i.bytes).toString('base64')}"></figure>`)
    .join('')}</div>`
  return conNavegador(async (b) => {
    const ctx = await b.newContext({ viewport: { width: anchoTotal, height: 400 }, deviceScaleFactor: 1 })
    await ctx.addInitScript(DEFINIR_NAME)
    try {
      const page = await ctx.newPage()
      await page.setContent(html, { waitUntil: 'load' })
      const alto = await page.evaluate(() => document.documentElement.scrollHeight)
      const bytes = await page.screenshot({ type: 'png', fullPage: true })
      return { bytes, ancho: anchoTotal, alto }
    } finally {
      await ctx.close().catch(() => {})
    }
  })
}

// ───────── SVG (foreignObject con todo embebido) ─────────

const aDataUrl = (a: { datos: Uint8Array; mime: string }, ruta: string) => `data:${a.mime || mimeDeRuta(ruta)};base64,${Buffer.from(a.datos).toString('base64')}`

async function embeber(css: string, leer: LeerArchivo, cache: Map<string, string>): Promise<string> {
  const rutas = new Set<string>()
  for (const m of css.matchAll(/url\(\s*(['"]?)(\/archivos\/[^'")]+)\1\s*\)/g)) rutas.add(m[2]!)
  for (const r of rutas) {
    if (cache.has(r)) continue
    const a = await leer(decodeURIComponent(r.replace(/^\/archivos\//, '')))
    cache.set(r, a ? aDataUrl(a, r) : '')
  }
  return css.replace(/url\(\s*(['"]?)(\/archivos\/[^'")]+)\1\s*\)/g, (_t, _q, r: string) => `url("${cache.get(r) ?? ''}")`)
}

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&#160;')
const escAttrXml = (s: string) => escXml(s).replace(/"/g, '&quot;')

function xhtml(n: NodoHtml, urls: Map<string, string>): string {
  if (n.tipo === 'tx') return escXml(n.texto)
  if (n.etiqueta === '#raiz') return n.hijos.map((h) => xhtml(h, urls)).join('')
  const el = n as ElementoHtml
  let s = `<${el.etiqueta}`
  for (const [k, v0] of el.attrs) {
    let v = v0
    if ((k === 'src' || k === 'href') && urls.has(v)) v = urls.get(v)!
    if (k === 'style') v = v.replace(/url\(\s*(['"]?)(\/archivos\/[^'")]+)\1\s*\)/g, (_t, _q, r: string) => `url("${urls.get(r) ?? ''}")`)
    s += ` ${k}="${escAttrXml(v)}"`
  }
  if (VACIOS.has(el.etiqueta.toLowerCase())) return s + '/>'
  return s + '>' + el.hijos.map((h) => xhtml(h, urls)).join('') + `</${el.etiqueta}>`
}

/** SVG para web: se ve igual en un navegador; no es un vector editable (eso es v2). */
export async function svgDeMarco(e: EntradaRender, leer: LeerArchivo, op: OpcionesRender = {}): Promise<string> {
  const cache = new Map<string, string>()
  const partesCss: string[] = []
  for (const h of e.hojas) {
    if (h.url) {
      const a = await leer(decodeURIComponent(h.url.replace(/^\/archivos\//, '')))
      if (a) partesCss.push(new TextDecoder().decode(a.datos))
    } else if (h.css) partesCss.push(h.css)
  }
  partesCss.push(e.cssTokens, ...Object.values(e.piezas).map((p) => p.css), e.marco.css)
  const { ancho, alto, datos } = e.marco
  const fondo = op.sinFondo ? 'transparent' : datos.fondo || (e.marco.origen === 'propio' ? '#ffffff' : 'transparent')
  partesCss.unshift(
    `html,body{margin:0;padding:0;width:${ancho}px;height:${alto}px;overflow:hidden}html{background:${fondo}}${e.marco.origen === 'propio' ? 'body{position:relative;container-type:size;font-family:system-ui,sans-serif}' : ''}`,
  )
  partesCss.push('*,*::before,*::after{animation-delay:-60s!important;animation-play-state:paused!important;transition:none!important}')
  const css = await embeber(partesCss.join('\n'), leer, cache)
  const cuerpo = analizarHtml(expandirPiezas(e.marco.html, e.piezas))
  // imágenes del HTML
  const rutas = new Set<string>()
  const juntar = (n: NodoHtml) => {
    if (n.tipo !== 'el') return
    for (const [k, v] of n.attrs) {
      if ((k === 'src' || k === 'href') && v.startsWith('/archivos/')) rutas.add(v)
      if (k === 'style') for (const m of v.matchAll(/url\(\s*(['"]?)(\/archivos\/[^'")]+)\1\s*\)/g)) rutas.add(m[2]!)
    }
    n.hijos.forEach(juntar)
  }
  juntar(cuerpo)
  for (const r of rutas) {
    if (cache.has(r)) continue
    const a = await leer(decodeURIComponent(r.replace(/^\/archivos\//, '')))
    cache.set(r, a ? aDataUrl(a, r) : '')
  }
  const claseBody = [datos.raizClase, datos.estiloRaiz?.body?.clase].filter(Boolean).join(' ')
  const escala = Object.entries(datos.escala ?? {})
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
  const estiloBody = [escala, datos.estiloRaiz?.body?.estilo].filter(Boolean).join(';')
  const cdata = cssEnEstilo(css).replace(/\]\]>/g, ']]]]><![CDATA[>')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">` +
    `<foreignObject x="0" y="0" width="${ancho}" height="${alto}">` +
    `<html xmlns="http://www.w3.org/1999/xhtml"${datos.modo || op.modo ? ` data-modo="${escAttrXml(op.modo ?? datos.modo ?? '')}"` : ''}><head><style><![CDATA[${cdata}]]></style></head>` +
    `<body${claseBody ? ` class="${escAttrXml(claseBody)}"` : ''}${estiloBody ? ` style="${escAttrXml(estiloBody)}"` : ''}>${xhtml(cuerpo, cache)}</body></html>` +
    `</foreignObject></svg>`
  )
}

// ───────── foto de una página de la app (ver_lienzo) ─────────
// El lienzo se fotografía como lo ve una persona: el mismo Chromium abre la app de verdad (`/RC/<tablero>/lienzo?foto=…`)
// con la clave del MCP en cada pedido a su propio origen, espera a que la página avise que terminó de dibujar
// (<html data-foto-lista>) y saca la captura. Lo que no es de la app no carga, salvo imágenes (las de los objetos).

export interface PedidoFotoPagina {
  /** Origen de la app (https://telarapp.vercel.app o http://127.0.0.1:4318). */
  base: string
  /** Ruta con su ?foto=… */
  ruta: string
  /** Lo que se recorta, en px de pantalla desde arriba a la izquierda. */
  ancho: number
  alto: number
  tema: 'claro' | 'oscuro'
  clave: string
}

export interface ResultadoFotoPagina {
  bytes: Uint8Array
  mime: string
  ancho: number
  alto: number
  avisos: string[]
  objetos: number
  ms: number
}

/** La ventana mínima: con menos, la app se abre como la del celular. */
const VENTANA_MINIMA = { ancho: 1280, alto: 800 }
const ESPERA_FOTO = 30_000 // ms

const esLocal = (u: URL) => u.hostname === '127.0.0.1' || u.hostname === 'localhost'

/** Abre una página de la app y devuelve su captura y la revisión que dejó la página (window.__telarFoto). */
export async function fotografiarPagina(p: PedidoFotoPagina): Promise<ResultadoFotoPagina> {
  const t0 = Date.now()
  const base = new URL(p.base)
  // Local, npm run dev manda la web a Vite (otro puerto): cualquier puerto de esta computadora es la app.
  const delaApp = (u: URL) => u.origin === base.origin || (esLocal(base) && esLocal(u))
  return conNavegador(async (b) => {
    const ctx = await b.newContext({
      viewport: { width: Math.max(VENTANA_MINIMA.ancho, p.ancho), height: Math.max(VENTANA_MINIMA.alto, p.alto) },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      colorScheme: p.tema === 'oscuro' ? 'dark' : 'light',
    })
    await ctx.addInitScript(DEFINIR_NAME)
    await ctx.addInitScript((tema: string) => {
      try {
        localStorage.setItem('tablero.tema', tema)
      } catch {
        // sin almacenamiento: queda el del sistema (colorScheme)
      }
    }, p.tema)
    await ctx.route('**/*', async (ruta) => {
      const pedido = ruta.request()
      let u: URL
      try {
        u = new URL(pedido.url())
      } catch {
        return ruta.abort('blockedbyclient')
      }
      if (u.protocol === 'data:' || u.protocol === 'blob:') return ruta.continue()
      if (delaApp(u)) return ruta.continue({ headers: { ...pedido.headers(), 'x-tablero-clave': p.clave } })
      if (pedido.resourceType() === 'image' && u.protocol === 'https:') return ruta.continue()
      return ruta.abort('blockedbyclient')
    })
    try {
      const page = await ctx.newPage()
      await page.goto(new URL(p.ruta, base).toString(), { waitUntil: 'domcontentloaded', timeout: ESPERA_FOTO })
      try {
        await page.waitForSelector('html[data-foto-lista]', { state: 'attached', timeout: ESPERA_FOTO })
      } catch {
        const visto = await page.evaluate(() => document.body?.innerText.slice(0, 200) ?? '').catch(() => '')
        throw new ErrorDominio(`El lienzo no terminó de dibujarse en ${ESPERA_FOTO / 1000} s${visto ? ` (la página decía: «${visto.replace(/\s+/g, ' ')}»)` : ''}. Probá de nuevo o pedí un área más chica (un marco).`, 504)
      }
      const revision = await page.evaluate(
        () => (window as unknown as { __telarFoto?: { avisos: string[]; objetos: number } }).__telarFoto ?? { avisos: [], objetos: 0 },
      )
      const bytes = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: p.ancho, height: p.alto }, animations: 'disabled', caret: 'hide' })
      return { bytes, mime: 'image/png', ancho: p.ancho, alto: p.alto, avisos: revision.avisos, objetos: revision.objetos, ms: Date.now() - t0 }
    } finally {
      await ctx.close().catch(() => {})
    }
  })
}
