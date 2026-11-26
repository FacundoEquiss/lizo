// El armador de documentos (decisión D6): una función pura que usan el iframe de la web, el render del servidor y la
// exportación. Lo que ve la persona, lo que ve Claude por MCP y lo que se exporta salen de acá, idénticos.
import { estadosDeCss } from './css'
import {
  agregarHijo,
  analizarHtml,
  attr,
  clases,
  crearElemento,
  crearTexto,
  elementosHijos,
  escaparAttr,
  escribirEstilo,
  leerEstilo,
  ponerAttr,
  quitarAttr,
  quitarNodo,
  reemplazarHijos,
  serializarHtml,
  type ElementoHtml,
  type NodoHtml,
} from './html'
import type { DatosMarco, DatosPieza, Origen } from './tipos'

/** Política de contenido de todo marco: nada de afuera, ningún script. */
export const CSP_MARCO =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'"

export interface HojaParaDocumento {
  clave: string
  url?: string
  urlEstados?: string
  css?: string
}

export interface OpcionesDocumento {
  /** Animaciones congeladas (en su estado final) y sin transiciones: todo marco que no está en modo Probar. */
  pausar?: boolean
  /** Suma las hojas de pseudo-estados (.es-hover, .es-active, .es-focus). */
  estados?: boolean
  /** Sin fondo (exportar con transparencia). */
  transparente?: boolean
  /** Modo de los tokens (data-modo en <html>). */
  modo?: string
  /** CSS extra al final ("Probar un valor"). */
  extraCss?: string
  /** Sin la política de contenido (solo para el SVG exportado, que ya trae todo embebido). */
  sinCsp?: boolean
}

export interface EntradaDocumento {
  marco: { html: string; css: string; ancho: number; alto: number; hojas: string[]; datos: DatosMarco; origen?: Origen }
  hojas: HojaParaDocumento[]
  cssTokens: string
  piezas: Record<string, DatosPieza>
  opciones?: OpcionesDocumento
}

const PAUSAR =
  '*,*::before,*::after{animation-delay:-60s!important;animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}'

/** CSS seguro para meter en un <style> (no puede cerrarlo). */
export const cssEnEstilo = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')

export function documentoDeMarco(e: EntradaDocumento): string {
  const { marco } = e
  const o = e.opciones ?? {}
  const d = marco.datos ?? {}
  const propio = marco.origen !== 'importado'
  const fondo = o.transparente ? 'transparent' : d.fondo || (propio ? '#ffffff' : 'transparent')
  const cuerpo = expandirPiezas(marco.html, e.piezas)
  const conEstados = o.estados || /\bdata-estado="/.test(cuerpo) || /\bes-(hover|active|focus)\b/.test(cuerpo)
  const cabeza: string[] = ['<meta charset="utf-8">']
  if (!o.sinCsp) cabeza.push(`<meta http-equiv="Content-Security-Policy" content="${CSP_MARCO}">`)
  cabeza.push(
    `<style data-telar="base">html,body{margin:0;padding:0;width:${marco.ancho}px;height:${marco.alto}px;overflow:hidden}html{background:${fondo.replace(/[;{}<>]/g, '')}}${
      propio ? 'body{position:relative;container-type:size;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}' : ''
    }[data-pieza]{box-sizing:border-box}</style>`,
  )
  for (const h of e.hojas) {
    if (h.url) cabeza.push(`<link rel="stylesheet" href="${escaparAttr(h.url)}">`)
    else if (h.css) cabeza.push(`<style data-hoja="${escaparAttr(h.clave)}">${cssEnEstilo(h.css)}</style>`)
    if (conEstados) {
      if (h.urlEstados) cabeza.push(`<link rel="stylesheet" href="${escaparAttr(h.urlEstados)}">`)
      else if (h.css) cabeza.push(`<style>${cssEnEstilo(estadosDeCss(h.css))}</style>`)
    }
  }
  if (e.cssTokens) cabeza.push(`<style data-telar="tokens">${cssEnEstilo(e.cssTokens)}</style>`)
  const cssPiezas = Object.values(e.piezas)
    .map((p) => p.css)
    .filter(Boolean)
    .join('\n')
  if (cssPiezas) {
    cabeza.push(`<style data-telar="piezas">${cssEnEstilo(cssPiezas)}</style>`)
    if (conEstados) cabeza.push(`<style>${cssEnEstilo(estadosDeCss(cssPiezas))}</style>`)
  }
  if (marco.css) {
    cabeza.push(`<style data-telar="marco">${cssEnEstilo(marco.css)}</style>`)
    if (conEstados) cabeza.push(`<style>${cssEnEstilo(estadosDeCss(marco.css))}</style>`)
  }
  if (o.extraCss) cabeza.push(`<style data-telar="extra">${cssEnEstilo(o.extraCss)}</style>`)
  if (o.pausar) cabeza.push(`<style data-telar="pausa">${PAUSAR}</style>`)

  const raizHtml = d.estiloRaiz?.html
  const raizBody = d.estiloRaiz?.body
  const claseBody = [d.raizClase, raizBody?.clase].filter(Boolean).join(' ').trim()
  const escala = Object.entries(d.escala ?? {})
    .filter(([k]) => /^--[\w-]+$/.test(k))
    .map(([k, v]) => `${k}:${String(v).replace(/[;{}<>"]/g, '')}`)
    .join(';')
  const estiloBody = [escala, raizBody?.estilo].filter(Boolean).join(';')
  const modo = o.modo ?? d.modo
  const attrsHtml = [
    'lang="es"',
    modo ? `data-modo="${escaparAttr(modo)}"` : '',
    raizHtml?.clase ? `class="${escaparAttr(raizHtml.clase)}"` : '',
    raizHtml?.estilo ? `style="${escaparAttr(raizHtml.estilo)}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const attrsBody = [claseBody ? `class="${escaparAttr(claseBody)}"` : '', estiloBody ? `style="${escaparAttr(estiloBody)}"` : '']
    .filter(Boolean)
    .join(' ')
  return `<!doctype html><html ${attrsHtml}><head>${cabeza.join('')}</head><body${attrsBody ? ' ' + attrsBody : ''}>${cuerpo}</body></html>`
}

/** Las hojas que necesita un marco: las suyas y las de las piezas que usa, sin repetir y en orden. */
export function hojasNecesarias(hojasMarco: string[], piezas: Record<string, DatosPieza>): string[] {
  const r: string[] = []
  for (const h of [...hojasMarco, ...Object.values(piezas).flatMap((p) => p.hojas ?? [])]) if (!r.includes(h)) r.push(h)
  return r
}

/** Claves de las piezas que usa un HTML (también las que usan esas piezas, hasta 4 niveles). */
export function piezasUsadas(html: string, todas?: Record<string, DatosPieza>): string[] {
  const r = new Set<string>()
  const buscarEn = (h: string, prof: number) => {
    for (const m of h.matchAll(/\bdata-pieza="([^"]+)"/g)) {
      const clave = m[1]!
      if (r.has(clave)) continue
      r.add(clave)
      const p = todas?.[clave]
      if (p && prof < 4) buscarEn([p.html ?? '', ...Object.values(p.variantes ?? {})].join(''), prof + 1)
    }
  }
  buscarEn(html, 0)
  return [...r]
}

export type ValorProp = string | boolean

/** Propiedades de una instancia, completadas con los valores por defecto de la pieza. */
export function propiedadesDe(inst: ElementoHtml, pieza: DatosPieza | undefined): Record<string, ValorProp> {
  let dados: Record<string, unknown> = {}
  try {
    const crudo = JSON.parse(attr(inst, 'data-props') || '{}')
    if (crudo && typeof crudo === 'object' && !Array.isArray(crudo)) dados = crudo as Record<string, unknown>
  } catch {
    dados = {}
  }
  const r: Record<string, ValorProp> = {}
  for (const p of pieza?.propiedades ?? []) {
    const v = dados[p.nombre]
    if (p.clase === 'booleano') r[p.nombre] = v === undefined || v === null ? Boolean(p.defecto) : v === true || v === 'true' || v === 'si' || v === 1
    else r[p.nombre] = v === undefined || v === null ? String(p.defecto ?? '') : String(v)
  }
  for (const [k, v] of Object.entries(dados)) if (!(k in r) && /^[\w-]{1,40}$/.test(k)) r[k] = typeof v === 'boolean' ? v : String(v ?? '')
  return r
}

/** Elige el HTML de la pieza para esas propiedades. */
export function fuenteDePieza(pieza: DatosPieza, props: Record<string, ValorProp>): string {
  if (pieza.variantes && Object.keys(pieza.variantes).length) {
    const pv = pieza.propiedades.find((p) => p.clase === 'variante')
    const elegida = String(pv ? props[pv.nombre] : (props.variante ?? ''))
    return pieza.variantes[elegida] ?? Object.values(pieza.variantes)[0]!
  }
  return pieza.html ?? ''
}

const URL_IMAGEN = /^(\/archivos\/[^\s"'()<>]+|data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);base64,[a-z0-9+/=]+)$/i

function sustituir(texto: string, props: Record<string, ValorProp>, esUrl: boolean): string {
  if (!texto.includes('{{')) return texto
  return texto.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_t, nombre: string) => {
    const v = props[nombre]
    if (v === undefined || typeof v === 'boolean') return v === true ? 'true' : ''
    if (esUrl) return URL_IMAGEN.test(v) ? v : ''
    return v
  })
}

const ATTRS_URL = new Set(['src', 'href', 'xlink:href', 'poster'])
const verdadero = (v: ValorProp | undefined) => v === true || (typeof v === 'string' && v !== '' && v !== 'false' && v !== 'no' && v !== '0')

function aplicarPlantilla(n: NodoHtml, props: Record<string, ValorProp>): boolean {
  if (n.tipo === 'tx') {
    n.texto = sustituir(n.texto, props, false)
    return true
  }
  const si = attr(n, 'data-si')
  if (si !== null) {
    const negado = si.startsWith('!')
    const valor = verdadero(props[si.replace(/^!/, '')])
    if (negado ? valor : !valor) return false
    quitarAttr(n, 'data-si')
  }
  for (const a of n.attrs) a[1] = sustituir(a[1], props, ATTRS_URL.has(a[0]) || (a[0] === 'style' && /url\(/.test(a[1])))
  quitarAttr(n, 'data-id')
  n.hijos = n.hijos.filter((h) => {
    const queda = aplicarPlantilla(h, props)
    if (!queda) h.padre = null
    return queda
  })
  return true
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^\w-]/g, '-').toLowerCase()

/**
 * Reemplaza el contenido de cada instancia (`<div data-pieza="boton" data-props='{"color":"verde"}'>`) por el HTML de su
 * pieza: elige la variante, reemplaza `{{nombre}}`, quita lo que tiene `data-si` en falso y copia cada propiedad como
 * `data-<nombre>` en la instancia (para que el CSS de la pieza la estile). La instancia guarda solo sus propiedades.
 */
export function expandirPiezas(html: string, piezas: Record<string, DatosPieza>): string {
  if (!html.includes('data-pieza')) return html
  const raiz = analizarHtml(html)
  expandirEn(raiz, piezas, 0)
  return serializarHtml(raiz)
}

function instancias(raiz: ElementoHtml): ElementoHtml[] {
  const r: ElementoHtml[] = []
  const bajar = (el: ElementoHtml) => {
    for (const h of el.hijos) {
      if (h.tipo !== 'el') continue
      if (attr(h, 'data-pieza') !== null) r.push(h)
      else bajar(h)
    }
  }
  bajar(raiz)
  return r
}

function expandirEn(raiz: ElementoHtml, piezas: Record<string, DatosPieza>, prof: number) {
  for (const inst of instancias(raiz)) {
    const clave = attr(inst, 'data-pieza')!
    const pieza = piezas[clave]
    if (!pieza) {
      reemplazarHijos(inst, [
        crearElemento(
          'div',
          [['style', 'display:grid;place-items:center;width:100%;height:100%;min-height:40px;min-width:80px;border:2px dashed #e5484d;color:#c62f34;font:600 13px system-ui;padding:6px;box-sizing:border-box;text-align:center']],
          [crearTexto(`Falta la pieza «${clave}»`)],
        ),
      ])
      continue
    }
    const props = propiedadesDe(inst, pieza)
    const plantilla = analizarHtml(fuenteDePieza(pieza, props))
    plantilla.hijos = plantilla.hijos.filter((h) => {
      const queda = aplicarPlantilla(h, props)
      if (!queda) h.padre = null
      return queda
    })
    for (const p of pieza.propiedades) {
      if (p.clase === 'imagen') continue
      const v = props[p.nombre]
      const texto = typeof v === 'boolean' ? String(v) : String(v ?? '')
      if (texto.length <= 200) ponerAttr(inst, `data-${kebab(p.nombre)}`, texto)
    }
    if (pieza.escala && Object.keys(pieza.escala).length) {
      const estilo = leerEstilo(inst)
      for (const [k, v] of Object.entries(pieza.escala)) if (/^--[\w-]+$/.test(k) && !estilo.has(k)) estilo.set(k, String(v))
      escribirEstilo(inst, estilo)
    }
    const estado = attr(inst, 'data-estado')
    const primero = elementosHijos(plantilla)[0]
    if (estado && primero) {
      for (const e of estado.split(/\s+/).filter(Boolean)) {
        if (e === 'normal') continue
        if (e === 'apagado') {
          ponerAttr(primero, 'aria-disabled', 'true')
          ponerAttr(primero, 'class', [...clases(primero), 'es-apagado'].join(' '))
        } else ponerAttr(primero, 'class', [...clases(primero), `es-${e === 'encima' ? 'hover' : e === 'apretado' ? 'active' : e}`].join(' '))
      }
    }
    const hijos = [...plantilla.hijos]
    for (const h of hijos) quitarNodo(h)
    reemplazarHijos(inst, [])
    for (const h of hijos) agregarHijo(inst, h)
    if (prof < 4) expandirEn(inst, piezas, prof + 1)
  }
}
