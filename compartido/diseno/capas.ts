// Capas: el nombre y la clase de cada una, y el árbol compacto en texto (una línea por capa) que muestran el panel de Capas
// y el MCP. Un solo lugar para las reglas de nombre: la persona y Claude ven lo mismo.
import { attr, clases, elementosHijos, textoDe, textoPropio, analizarHtml, type ElementoHtml } from './html'
import { propiedadesDe, type ValorProp } from './documento'
import type { Caja, DatosPieza } from './tipos'

export type ClaseCapa = 'pieza' | 'instancia' | 'texto' | 'imagen' | 'svg' | 'campo' | 'caja'

/** Lo mínimo que hace falta saber de un elemento (sirve para el árbol guardado y para el DOM vivo del iframe). */
export interface ElementoCapa {
  etiqueta: string
  attr: (nombre: string) => string | null
  /** Texto propio (de los nodos de texto hijos directos). */
  textoPropio: string
  /** Texto completo. */
  texto: string
  /** Cantidad de hijos que son elementos. */
  hijosElemento: number
}

const ETIQUETAS_TEXTO = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'small', 'strong', 'em', 'b', 'i', 'u', 's', 'a', 'li', 'figcaption', 'button', 'td', 'th', 'sup', 'sub', 'text', 'tspan'])

export function claseDeCapa(e: ElementoCapa): ClaseCapa {
  const et = e.etiqueta.toLowerCase()
  if (e.attr('data-pieza') !== null) return 'instancia'
  if (et === 'img' || et === 'picture') return 'imagen'
  if (et === 'svg') return 'svg'
  if (et === 'input' || et === 'textarea' || et === 'select') return 'campo'
  if (e.textoPropio.trim() && (e.hijosElemento === 0 || ETIQUETAS_TEXTO.has(et))) return 'texto'
  return 'caja'
}

const recortarTexto = (s: string, n = 28) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** "/archivos/diseno/p/abc123def456.png" → nombre del activo si se conoce, si no el archivo sin extensión. */
export function nombreDeRuta(ruta: string, activos?: Map<string, string>): string {
  const limpia = ruta.split('?')[0]!
  const conocido = activos?.get(limpia)
  if (conocido) return conocido
  if (limpia.startsWith('data:')) return 'imagen'
  const base = limpia.split('/').pop() ?? limpia
  return base.replace(/\.[a-z0-9]+$/i, '')
}

/** Nombre de una capa, en este orden: data-nombre · aria-label · activo · texto · primera clase · etiqueta. */
export function nombreCapa(e: ElementoCapa, activos?: Map<string, string>): string {
  const n = e.attr('data-nombre')
  if (n?.trim()) return n.trim()
  const pieza = e.attr('data-pieza')
  if (pieza) return pieza
  const aria = e.attr('aria-label')
  if (aria?.trim()) return aria.trim()
  const et = e.etiqueta.toLowerCase()
  if (et === 'img') {
    const src = e.attr('src')
    if (src) return nombreDeRuta(src, activos)
    const alt = e.attr('alt')
    if (alt?.trim()) return alt.trim()
  }
  const texto = (e.textoPropio.trim() ? e.textoPropio : e.hijosElemento <= 2 ? e.texto : '').trim()
  if (texto) return `"${recortarTexto(texto)}"`
  const c = (e.attr('class') ?? '').split(/\s+/).filter(Boolean)[0]
  if (c) return '.' + c
  return et
}

export function elementoCapaDeHtml(el: ElementoHtml): ElementoCapa {
  return {
    etiqueta: el.etiqueta,
    attr: (n) => attr(el, n),
    textoPropio: textoPropio(el),
    texto: textoDe(el),
    hijosElemento: elementosHijos(el).length,
  }
}

export interface NodoCapa {
  id: string
  etiqueta: string
  clase: ClaseCapa
  nombre: string
  /** "div.fondo", "img", "h1"… */
  descriptor: string
  profundidad: number
  hijos: NodoCapa[]
  texto?: string
  pieza?: string
  props?: Record<string, ValorProp>
  oculto?: boolean
}

/** Árbol de capas desde el HTML guardado. Solo cuentan los elementos con data-id; el resto se saltea (sus hijos suben). */
export function arbolDeHtml(html: string, op: { activos?: Map<string, string>; piezas?: Record<string, DatosPieza> } = {}): NodoCapa[] {
  const raiz = analizarHtml(html)
  const armar = (el: ElementoHtml, prof: number): NodoCapa[] => {
    const r: NodoCapa[] = []
    for (const h of elementosHijos(el)) {
      const id = attr(h, 'data-id')
      const et = h.etiqueta.toLowerCase()
      if (et === 'style' || et === 'script') continue
      if (!id) {
        r.push(...armar(h, prof))
        continue
      }
      const ec = elementoCapaDeHtml(h)
      const clase = claseDeCapa(ec)
      const nodo: NodoCapa = {
        id,
        etiqueta: et,
        clase,
        nombre: nombreCapa(ec, op.activos),
        descriptor: et + (clases(h)[0] ? '.' + clases(h)[0] : ''),
        profundidad: prof,
        hijos: clase === 'instancia' ? [] : armar(h, prof + 1),
      }
      if (clase === 'texto') nodo.texto = textoDe(h).replace(/\s+/g, ' ').trim()
      if (clase === 'instancia') {
        nodo.pieza = attr(h, 'data-pieza') ?? undefined
        nodo.props = propiedadesDe(h, nodo.pieza ? op.piezas?.[nodo.pieza] : undefined)
      }
      if (/(^|;)\s*display\s*:\s*none/i.test(attr(h, 'style') ?? '') || attr(h, 'hidden') !== null) nodo.oculto = true
      r.push(nodo)
    }
    return r
  }
  return armar(raiz, 0)
}

export function aplanar(nodos: NodoCapa[]): NodoCapa[] {
  const r: NodoCapa[] = []
  const bajar = (ns: NodoCapa[]) => {
    for (const n of ns) {
      r.push(n)
      bajar(n.hijos)
    }
  }
  bajar(nodos)
  return r
}

const valorCorto = (v: ValorProp) => (typeof v === 'boolean' ? String(v) : /^[\w-]{1,24}$/.test(v) ? v : `"${recortarTexto(v, 40)}"`)

/** Una línea por capa: "a1b2c3 h1 "2x1 en hamburguesas"   80,640 920×312  Fraunces 800 132px". */
export function lineaDeCapa(n: NodoCapa, caja?: Caja, estilo?: string): string {
  const sangria = '  '.repeat(n.profundidad)
  let desc: string
  if (n.clase === 'instancia') {
    const props = Object.entries(n.props ?? {})
      .map(([k, v]) => `${k}: ${valorCorto(v)}`)
      .join(', ')
    desc = `◇ ${n.pieza}${props ? ` {${props}}` : ''}`
  } else {
    desc = n.descriptor
    if (n.nombre && n.nombre !== n.etiqueta && n.nombre !== '.' + n.descriptor.split('.')[1]) desc += n.nombre.startsWith('"') ? ` ${n.nombre}` : ` «${n.nombre}»`
  }
  const izq = `${sangria}${n.id} ${desc}${n.oculto ? ' (oculta)' : ''}`
  const medidas = caja ? `${caja[0]},${caja[1]} ${caja[2]}×${caja[3]}` : ''
  const partes = [izq.padEnd(Math.max(38, Math.min(70, izq.length + 2)))]
  if (medidas) partes.push(medidas.padEnd(18))
  if (estilo) partes.push(estilo)
  return partes.join(' ').trimEnd()
}

/** El árbol entero en texto, con tope de caracteres y paginado ("… y 212 más. Pedí `desde: 200`"). */
export function arbolCompacto(
  nodos: NodoCapa[],
  op: { cajas?: Record<string, Caja>; estilos?: Record<string, string>; desde?: number; tope?: number } = {},
): { texto: string; total: number; mostradas: number; siguiente: number | null } {
  const todas = aplanar(nodos)
  const desde = Math.max(0, op.desde ?? 0)
  const tope = op.tope ?? 6000
  const lineas: string[] = []
  let largo = 0
  let i = desde
  for (; i < todas.length; i++) {
    const n = todas[i]!
    const l = lineaDeCapa(n, op.cajas?.[n.id], op.estilos?.[n.id])
    if (largo + l.length + 1 > tope && lineas.length) break
    lineas.push(l)
    largo += l.length + 1
  }
  const resto = todas.length - i
  if (resto > 0) lineas.push(`… y ${resto} más. Pedí \`desde: ${i}\``)
  return { texto: lineas.join('\n'), total: todas.length, mostradas: i - desde, siguiente: resto > 0 ? i : null }
}
