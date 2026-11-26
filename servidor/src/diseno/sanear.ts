// Saneado de todo HTML, CSS y SVG que entra a Diseño (por la API, el MCP o el importador). Plan 4.3.
// Tres barreras independientes: esto (lista blanca), el iframe sin scripts (sandbox sin allow-scripts) y la política de
// contenido del documento. Acá se usa parse5 (analizador de HTML conforme a la especificación) para leer lo que llega; la
// salida la escribe el serializador propio de compartido/diseno/html.ts, que es lo que después leen el armador de
// documentos y el árbol de capas en los tres lados.
import { customAlphabet } from 'nanoid'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { partirCss, quitarComentarios } from '../../../compartido/diseno/css'
import { crearElemento, crearTexto, serializarHtml, agregarHijo, type ElementoHtml } from '../../../compartido/diseno/html'
import { ErrorDominio } from '../dominio/servicio'

type P5Nodo = DefaultTreeAdapterMap['childNode']
type P5Elemento = DefaultTreeAdapterMap['element']

export const nuevoIdCapa = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)

export const TOPE_HTML = 1.5 * 1024 * 1024
export const TOPE_CSS = 1024 * 1024
const TOPE_DATA = 200 * 1024

const HTML_PERMITIDAS = new Set(
  (
    'div span p h1 h2 h3 h4 h5 h6 ul ol li a img picture source figure figcaption section header footer main nav article aside ' +
    'button label small strong em b i u s sup sub br hr table thead tbody tfoot tr td th caption col colgroup ' +
    'input textarea select option optgroup blockquote pre code kbd mark time abbr cite q dl dt dd fieldset legend progress meter ' +
    'details summary output address hgroup var samp del ins wbr'
  ).split(' '),
)
const SVG_PERMITIDAS = new Set(
  (
    'svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask use symbol ' +
    'title desc pattern image filter feGaussianBlur feOffset feBlend feColorMatrix feFlood feComposite feMerge feMergeNode feDropShadow feMorphology'
  ).split(' '),
)
const CAMPOS_INERTES = new Set(['input', 'textarea', 'select'])
/** Se van con todo su contenido. */
const SE_VAN = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'template', 'noscript', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas', 'title', 'head', 'math', 'portal', 'slot'])
const ATTRS_PROHIBIDOS = new Set(['srcdoc', 'formaction', 'action', 'background', 'lowsrc', 'dynsrc', 'ping', 'autofocus', 'contenteditable', 'is', 'nonce', 'manifest', 'srcset', 'sizes', 'integrity', 'crossorigin', 'referrerpolicy', 'xmlns:xlink'])

export interface Saneado {
  html: string
  /** El contenido de los <style> que vinieron en el HTML (va al CSS del marco). */
  css: string
  /** Lo que se sacó sin avisar con un error (atributos on*, etiquetas no permitidas…), para contárselo a quien escribió. */
  avisos: string[]
  /** Ids de las capas que se crearon. */
  idsNuevos: string[]
}

export interface OpcionesSaneado {
  /** Ids que ya existen en el marco (para no repetir al insertar). */
  idsExistentes?: Set<string>
  /** Poner data-id a todo elemento (de fábrica sí). Las piezas y plantillas no los llevan. */
  conIds?: boolean
  tope?: number
  /** Qué es, para los mensajes ("la pieza «boton»"). */
  que?: string
}

function errorUrl(url: string, tipo: 'imagen' | 'fuente' | 'recurso' = 'imagen'): never {
  const corta = url.length > 90 ? url.slice(0, 87) + '…' : url
  if (/^\s*javascript:/i.test(url)) throw new ErrorDominio(`«${corta}» no es una dirección válida: los marcos no corren código.`, 400)
  if (/^(https?:)?\/\//i.test(url.trim()))
    throw new ErrorDominio(
      `La ${tipo} ${corta} es de afuera. Subila primero con subir_activo y usá la ruta que devuelve (/archivos/diseno/…).`,
      400,
    )
  throw new ErrorDominio(
    `La ruta «${corta}» no sirve en un marco: solo valen rutas de Telar (/archivos/…, las que devuelve subir_activo) o data:image/… de hasta 200 KB.`,
    400,
  )
}

/** Una URL de imagen (o fuente) aceptable: /archivos/… o data:image|font/… chica. Devuelve la URL limpia o falla. */
export function validarUrl(url: string, tipo: 'imagen' | 'fuente' | 'recurso' = 'imagen'): string {
  const u = url.trim()
  if (u === '') return ''
  if (u.startsWith('#')) return u // referencias internas de SVG (url(#degradado))
  if (/^\/archivos\/[^\s"'<>\\]+$/.test(u) && !u.includes('..')) return u
  const data = /^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|font\/(woff2?|ttf|otf)|application\/font-woff2?)(;[\w=.-]+)*(;base64)?,/i.exec(u)
  if (data) {
    if (u.length > TOPE_DATA * 1.37 + 100) throw new ErrorDominio(`La imagen en data: pesa más de 200 KB. Subila con subir_activo y usá la ruta.`, 400)
    if (/^data:image\/svg/i.test(u) && /<script|on\w+\s*=|javascript:/i.test(decodeURIComponentSeguro(u))) throw new ErrorDominio('El SVG en data: trae código: no se acepta.', 400)
    return u
  }
  errorUrl(u, tipo)
}

function decodeURIComponentSeguro(s: string) {
  try {
    if (/;base64,/i.test(s)) return Buffer.from(s.slice(s.indexOf(',') + 1), 'base64').toString('utf8')
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** CSS de un marco, una pieza o una hoja. Rechaza @import, expression(), javascript: y recursos de afuera. */
export function sanearCss(css: string, op: { tope?: number; que?: string } = {}): string {
  if (css.length > (op.tope ?? TOPE_CSS)) throw new ErrorDominio(`El CSS${op.que ? ` de ${op.que}` : ''} pasa de 1 MB.`, 413)
  const sin = quitarComentarios(css)
  if (/@import\b/i.test(sin)) throw new ErrorDominio('El CSS no puede tener @import: todo el CSS va en el marco (o en una hoja del proyecto).', 400)
  if (/expression\s*\(/i.test(sin)) throw new ErrorDominio('El CSS no puede tener expression().', 400)
  if (/javascript\s*:/i.test(sin)) throw new ErrorDominio('El CSS no puede tener javascript:.', 400)
  if (/-moz-binding|(?<![-\w])behavior\s*:/i.test(sin)) throw new ErrorDominio('El CSS no puede tener -moz-binding ni behavior.', 400)
  if (/<\/?\s*style/i.test(sin)) throw new ErrorDominio('El CSS no puede tener etiquetas <style>: mandá solo las reglas.', 400)
  // url(…) e image-set("…"): solo recursos de Telar
  for (const m of sin.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    const enFuente = /@font-face[^{]*\{[^}]*$/i.test(sin.slice(0, m.index))
    validarUrl(m[2]!, enFuente ? 'fuente' : 'imagen')
  }
  for (const m of sin.matchAll(/image-set\(([^)]*)\)/gi)) for (const s of m[1]!.matchAll(/(['"])([^'"]+)\1/g)) validarUrl(s[2]!)
  // Que se pueda partir (llaves balanceadas): si no, el marco se vería roto sin explicación.
  const abre = (sin.match(/\{/g) ?? []).length
  const cierra = (sin.match(/\}/g) ?? []).length
  if (abre !== cierra) throw new ErrorDominio(`El CSS tiene llaves sin cerrar (${abre} "{" y ${cierra} "}").`, 400)
  void partirCss
  return css
}

/** Estilo en línea: las mismas reglas que el CSS, sobre declaraciones sueltas. */
export function sanearEstiloEnLinea(estilo: string): string {
  if (/expression\s*\(|javascript\s*:|-moz-binding|(?<![-\w])behavior\s*:|@import/i.test(estilo)) throw new ErrorDominio('El estilo en línea trae algo que no se acepta (expression, javascript:, @import).', 400)
  for (const m of estilo.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) validarUrl(m[2]!)
  return estilo.replace(/[<>]/g, '')
}

/** Un SVG que se sube como archivo: sin scripts, sin eventos, sin recursos de afuera. */
export function sanearSvg(texto: string): string {
  if (/<script\b/i.test(texto)) throw new ErrorDominio('El SVG trae un <script>: no se acepta.', 400)
  if (/\son\w+\s*=/i.test(texto)) throw new ErrorDominio('El SVG trae atributos de eventos (onload, onclick…): no se acepta.', 400)
  if (/javascript\s*:/i.test(texto)) throw new ErrorDominio('El SVG trae javascript:: no se acepta.', 400)
  if (/<foreignObject\b/i.test(texto)) throw new ErrorDominio('El SVG trae <foreignObject>: no se acepta.', 400)
  for (const m of texto.matchAll(/(?:href|src)\s*=\s*(['"])([^'"]*)\1/gi))
    if (!m[2]!.startsWith('#') && !m[2]!.startsWith('data:image/')) throw new ErrorDominio(`El SVG pide un recurso (${m[2]}): tiene que ser autocontenido.`, 400)
  for (const m of texto.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi))
    if (!m[2]!.startsWith('#') && !m[2]!.startsWith('data:')) throw new ErrorDominio(`El SVG pide un recurso (${m[2]}): tiene que ser autocontenido.`, 400)
  return texto
}

const esSvg = (el: P5Elemento) => el.namespaceURI === 'http://www.w3.org/2000/svg'

/** Sanea un fragmento de HTML. Lanza ErrorDominio (400) con un mensaje que dice qué hacer. */
export function sanearHtml(html: string, op: OpcionesSaneado = {}): Saneado {
  const tope = op.tope ?? TOPE_HTML
  if (html.length > tope) throw new ErrorDominio(`El HTML${op.que ? ` de ${op.que}` : ''} pasa de ${Math.round(tope / 1024 / 1024 * 10) / 10} MB.`, 413)
  // Los problemas se juntan y se informan todos juntos: a un modelo le sirve más una lista completa que ir de a uno.
  const problemas: string[] = []
  if (/<script\b/i.test(html))
    problemas.push('Los marcos no pueden tener <script>: no corre ningún código. Sacalo; los estados se hacen con :hover y :active en el CSS.')
  const probar = <T,>(fn: () => T): T | null => {
    try {
      return fn()
    } catch (e) {
      if (e instanceof ErrorDominio && e.estado === 400) {
        if (!problemas.includes(e.message)) problemas.push(e.message)
        return null
      }
      throw e
    }
  }
  const conIds = op.conIds !== false
  const ids = new Set(op.idsExistentes ?? [])
  const vistos = new Set<string>()
  const idsNuevos: string[] = []
  const avisos = new Set<string>()
  const css: string[] = []
  const frag = parseFragment(html)
  const raiz = crearElemento('#raiz')

  const idUnico = () => {
    let id = nuevoIdCapa()
    while (ids.has(id) || vistos.has(id)) id = nuevoIdCapa()
    return id
  }

  const bajar = (nodos: P5Nodo[], destino: ElementoHtml, enSvg: boolean, enPieza: boolean) => {
    for (const n of nodos) {
      if (n.nodeName === '#text') {
        const t = (n as DefaultTreeAdapterMap['textNode']).value
        if (t) agregarHijo(destino, crearTexto(t))
        continue
      }
      if (n.nodeName === '#comment' || n.nodeName === '#documentType') continue
      const el = n as P5Elemento
      const etiqueta = el.tagName
      const bajo = etiqueta.toLowerCase()
      if (bajo === 'style') {
        const texto = el.childNodes.map((c) => (c.nodeName === '#text' ? (c as DefaultTreeAdapterMap['textNode']).value : '')).join('')
        const limpio = probar(() => sanearCss(texto))
        if (limpio !== null) css.push(limpio)
        continue
      }
      if (SE_VAN.has(bajo) && !(esSvg(el) && bajo === 'title')) {
        if (bajo !== 'head' && bajo !== 'title' && bajo !== 'meta') avisos.add(`Saqué <${bajo}>: no se usa en un marco.`)
        continue
      }
      const svg = esSvg(el)
      const permitida = svg ? SVG_PERMITIDAS.has(etiqueta) : HTML_PERMITIDAS.has(bajo) || bajo === 'form'
      if (!permitida) {
        // desconocida (o un <body>, <html>): se queda el contenido
        if (!['html', 'body'].includes(bajo)) avisos.add(`<${bajo}> no está permitido: dejé su contenido.`)
        bajar(el.childNodes, destino, enSvg, enPieza)
        continue
      }
      const nuevo = crearElemento(bajo === 'form' ? 'div' : svg ? etiqueta : bajo)
      for (const a of el.attrs) {
        const nombre = (a.prefix ? `${a.prefix}:${a.name}` : a.name).trim()
        const nb = nombre.toLowerCase()
        let valor = a.value
        if (nb.startsWith('on')) {
          avisos.add('Saqué atributos de eventos (onclick, onerror…): los marcos no corren código.')
          continue
        }
        if (ATTRS_PROHIBIDOS.has(nb)) continue
        if (nb === 'style') {
          const v = probar(() => sanearEstiloEnLinea(valor))
          if (v === null || !v.trim()) continue
          valor = v
        } else if (nb === 'src' || nb === 'poster') {
          if (bajo === 'source') continue
          const v = probar(() => validarUrl(valor))
          if (v === null) continue
          valor = v
        } else if (nb === 'href' || nb === 'xlink:href') {
          if (svg && (etiqueta === 'use' || etiqueta === 'image' || etiqueta === 'pattern' || etiqueta === 'linearGradient' || etiqueta === 'radialGradient')) {
            if (etiqueta === 'image') {
              const v = probar(() => validarUrl(valor))
              if (v === null) continue
              valor = v
            } else if (!valor.startsWith('#')) {
              avisos.add('Un <use> solo puede apuntar a algo del mismo marco (href="#…").')
              continue
            }
          } else {
            // un enlace no navega: queda como dato
            if (valor && !/^\s*javascript:/i.test(valor)) nuevo.attrs.push(['data-href', valor])
            continue
          }
        } else if (/^(fill|stroke|filter|clip-path|mask|marker-\w+)$/.test(nb) && /url\(/i.test(valor)) {
          let mal = false
          for (const m of valor.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) if (!m[2]!.startsWith('#')) mal = probar(() => errorUrl(m[2]!, 'recurso')) === null
          if (mal) continue
        } else if (/^data-id$/.test(nb)) {
          if (!conIds) continue
          if (!/^[a-z0-9_-]{1,24}$/i.test(valor) || vistos.has(valor)) continue
        }
        if (/^[^\s"'>/=]+$/.test(nombre)) nuevo.attrs.push([svg ? nombre : nb, valor])
      }
      if (CAMPOS_INERTES.has(bajo)) {
        if (!nuevo.attrs.some((x) => x[0] === 'disabled')) nuevo.attrs.push(['disabled', ''])
        nuevo.attrs = nuevo.attrs.filter((x) => x[0] !== 'tabindex')
        nuevo.attrs.push(['tabindex', '-1'])
      }
      if (conIds && !enPieza) {
        const actual = nuevo.attrs.find((x) => x[0] === 'data-id')
        if (actual) vistos.add(actual[1])
        else {
          const id = idUnico()
          vistos.add(id)
          idsNuevos.push(id)
          nuevo.attrs.unshift(['data-id', id])
        }
      } else if (!conIds) nuevo.attrs = nuevo.attrs.filter((x) => x[0] !== 'data-id')
      agregarHijo(destino, nuevo)
      const esInstancia = nuevo.attrs.some((x) => x[0] === 'data-pieza')
      if (esInstancia) {
        const props = nuevo.attrs.find((x) => x[0] === 'data-props')
        if (props) {
          try {
            const v = JSON.parse(props[1])
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
          } catch {
            problemas.push(
              `Las propiedades de la instancia «${nuevo.attrs.find((x) => x[0] === 'data-pieza')![1]}» no son JSON válido: usá data-props='{"color":"verde"}' (comillas simples afuera, dobles adentro).`,
            )
          }
        }
        continue // el contenido de una instancia lo pone su pieza
      }
      const hijos = bajo === 'template' ? [] : el.childNodes
      bajar(hijos, nuevo, enSvg || svg, enPieza)
    }
  }
  bajar(frag.childNodes, raiz, false, false)
  if (problemas.length) throw new ErrorDominio(problemas.length === 1 ? problemas[0]! : `No guardé nada; hay ${problemas.length} cosas para arreglar:\n- ${problemas.join('\n- ')}`, 400)
  return { html: serializarHtml(raiz).trim(), css: css.join('\n').trim(), avisos: [...avisos], idsNuevos }
}
