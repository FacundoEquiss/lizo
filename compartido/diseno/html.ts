// Árbol HTML chico y sin dependencias, para el HTML **ya saneado** de los marcos y las piezas.
//
// Por qué uno propio: el servidor sanea todo lo que entra con parse5 (servidor/src/diseno/sanear.ts), y la salida del
// saneado la escribe `serializarHtml` de acá. Así este analizador solo tiene que leer HTML bien formado que él mismo
// conoce (comillas dobles, entidades mínimas, cierre explícito), y puede correr igual en el navegador, en el servidor y en
// el importador: el armador de documentos (documento.ts) y el árbol de capas (capas.ts) son idénticos en los tres lados.
// Es tolerante (no falla con HTML a medio cerrar), pero no es un analizador de HTML de uso general.

export interface ElementoHtml {
  tipo: 'el'
  etiqueta: string
  attrs: [string, string][]
  hijos: NodoHtml[]
  padre: ElementoHtml | null
}
export interface TextoHtml {
  tipo: 'tx'
  texto: string
  padre: ElementoHtml | null
}
export type NodoHtml = ElementoHtml | TextoHtml

export const VACIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const CRUDOS = new Set(['style', 'script', 'textarea', 'title'])

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  deg: '°',
  times: '×',
  iexcl: '¡',
  iquest: '¿',
}

export function decodificar(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (todo, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : todo
    }
    return ENTIDADES[e] ?? todo
  })
}

export const escaparTexto = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;')
export const escaparAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;')

export function crearElemento(etiqueta: string, attrs: [string, string][] = [], hijos: NodoHtml[] = []): ElementoHtml {
  const el: ElementoHtml = { tipo: 'el', etiqueta, attrs, hijos: [], padre: null }
  for (const h of hijos) agregarHijo(el, h)
  return el
}
export const crearTexto = (texto: string): TextoHtml => ({ tipo: 'tx', texto, padre: null })

/** Analiza un fragmento. Devuelve una raíz falsa (etiqueta "#raiz") con los nodos de arriba como hijos. */
export function analizarHtml(html: string): ElementoHtml {
  const raiz = crearElemento('#raiz')
  let actual = raiz
  let i = 0
  const n = html.length
  const textoHasta = (fin: number) => {
    if (fin > i) {
      const t = decodificar(html.slice(i, fin))
      const ultimo = actual.hijos[actual.hijos.length - 1]
      if (ultimo && ultimo.tipo === 'tx') ultimo.texto += t
      else agregarHijo(actual, crearTexto(t))
    }
  }
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      textoHasta(n)
      break
    }
    textoHasta(lt)
    i = lt
    if (html.startsWith('<!--', i)) {
      const fin = html.indexOf('-->', i + 4)
      i = fin < 0 ? n : fin + 3
      continue
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const fin = html.indexOf('>', i)
      i = fin < 0 ? n : fin + 1
      continue
    }
    if (html[i + 1] === '/') {
      const fin = html.indexOf('>', i)
      const nombre = html.slice(i + 2, fin < 0 ? n : fin).trim().toLowerCase()
      i = fin < 0 ? n : fin + 1
      // Sube hasta el elemento que se cierra; si no está abierto, se ignora el cierre.
      let p: ElementoHtml | null = actual
      while (p && p !== raiz && p.etiqueta.toLowerCase() !== nombre) p = p.padre
      if (p && p !== raiz) actual = p.padre ?? raiz
      continue
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(html.slice(i, i + 64))
    if (!m) {
      // un "<" suelto: es texto
      agregarTextoSuelto(actual, '<')
      i++
      continue
    }
    const etiqueta = m[1]!
    i += m[0].length
    const attrs: [string, string][] = []
    let autocierre = false
    // atributos
    for (;;) {
      while (i < n && /\s/.test(html[i]!)) i++
      if (i >= n) break
      if (html[i] === '>') {
        i++
        break
      }
      if (html[i] === '/' && html[i + 1] === '>') {
        autocierre = true
        i += 2
        break
      }
      const ma = /^([^\s"'>/=]+)/.exec(html.slice(i, i + 256))
      if (!ma) {
        i++
        continue
      }
      const nombre = ma[1]!
      i += nombre.length
      while (i < n && /\s/.test(html[i]!)) i++
      let valor = ''
      if (html[i] === '=') {
        i++
        while (i < n && /\s/.test(html[i]!)) i++
        const q = html[i]
        if (q === '"' || q === "'") {
          const fin = html.indexOf(q, i + 1)
          valor = html.slice(i + 1, fin < 0 ? n : fin)
          i = fin < 0 ? n : fin + 1
        } else {
          const mv = /^[^\s>]*/.exec(html.slice(i))!
          valor = mv[0]
          i += valor.length
        }
      }
      attrs.push([nombre, decodificar(valor)])
    }
    const el = crearElemento(etiqueta, attrs)
    agregarHijo(actual, el)
    const bajo = etiqueta.toLowerCase()
    if (autocierre || VACIOS.has(bajo)) continue
    if (CRUDOS.has(bajo)) {
      const fin = html.toLowerCase().indexOf(`</${bajo}`, i)
      const contenido = html.slice(i, fin < 0 ? n : fin)
      if (contenido) agregarHijo(el, crearTexto(bajo === 'textarea' || bajo === 'title' ? decodificar(contenido) : contenido))
      const cierre = fin < 0 ? n : html.indexOf('>', fin)
      i = cierre < 0 ? n : cierre + 1
      continue
    }
    actual = el
  }
  return raiz
}

function agregarTextoSuelto(el: ElementoHtml, t: string) {
  const ultimo = el.hijos[el.hijos.length - 1]
  if (ultimo && ultimo.tipo === 'tx') ultimo.texto += t
  else agregarHijo(el, crearTexto(t))
}

export function serializarHtml(nodos: NodoHtml | NodoHtml[]): string {
  const lista = Array.isArray(nodos) ? nodos : nodos.tipo === 'el' && nodos.etiqueta === '#raiz' ? nodos.hijos : [nodos]
  let s = ''
  for (const nodo of lista) s += serializarNodo(nodo)
  return s
}

function serializarNodo(n: NodoHtml): string {
  if (n.tipo === 'tx') {
    const p = n.padre?.etiqueta.toLowerCase()
    if (p === 'style' || p === 'script') return n.texto
    return escaparTexto(n.texto)
  }
  if (n.etiqueta === '#raiz') return serializarHtml(n.hijos)
  let s = `<${n.etiqueta}`
  for (const [k, v] of n.attrs) s += v === '' && BOOLEANOS.has(k) ? ` ${k}` : ` ${k}="${escaparAttr(v)}"`
  s += '>'
  if (VACIOS.has(n.etiqueta.toLowerCase())) return s
  for (const h of n.hijos) s += serializarNodo(h)
  return s + `</${n.etiqueta}>`
}
const BOOLEANOS = new Set(['disabled', 'hidden', 'checked', 'selected', 'readonly', 'multiple', 'open'])

// ───────── ayudas para manipular ─────────

export function attr(el: ElementoHtml, nombre: string): string | null {
  for (const [k, v] of el.attrs) if (k === nombre) return v
  return null
}
export function ponerAttr(el: ElementoHtml, nombre: string, valor: string) {
  for (const a of el.attrs)
    if (a[0] === nombre) {
      a[1] = valor
      return
    }
  el.attrs.push([nombre, valor])
}
export function quitarAttr(el: ElementoHtml, nombre: string) {
  el.attrs = el.attrs.filter((a) => a[0] !== nombre)
}
export function clases(el: ElementoHtml): string[] {
  return (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean)
}

export function agregarHijo(padre: ElementoHtml, hijo: NodoHtml, indice?: number) {
  if (hijo.padre) quitarNodo(hijo)
  hijo.padre = padre
  if (indice === undefined || indice >= padre.hijos.length) padre.hijos.push(hijo)
  else padre.hijos.splice(Math.max(0, indice), 0, hijo)
}
export function quitarNodo(n: NodoHtml) {
  const p = n.padre
  if (!p) return
  const i = p.hijos.indexOf(n)
  if (i >= 0) p.hijos.splice(i, 1)
  n.padre = null
}
export function insertarAntes(referencia: NodoHtml, nuevo: NodoHtml) {
  const p = referencia.padre
  if (!p) throw new Error('El nodo de referencia no tiene padre.')
  if (nuevo.padre) quitarNodo(nuevo)
  agregarHijo(p, nuevo, p.hijos.indexOf(referencia))
}
export function insertarDespues(referencia: NodoHtml, nuevo: NodoHtml) {
  const p = referencia.padre
  if (!p) throw new Error('El nodo de referencia no tiene padre.')
  if (nuevo.padre) quitarNodo(nuevo)
  agregarHijo(p, nuevo, p.hijos.indexOf(referencia) + 1)
}
export function reemplazarHijos(el: ElementoHtml, hijos: NodoHtml[]) {
  for (const h of el.hijos) h.padre = null
  el.hijos = []
  for (const h of hijos) agregarHijo(el, h)
}

export function elementosHijos(el: ElementoHtml): ElementoHtml[] {
  return el.hijos.filter((h): h is ElementoHtml => h.tipo === 'el')
}

/** Recorre en orden de documento. Si `fn` devuelve false, no baja a los hijos de ese elemento. */
export function recorrer(raiz: ElementoHtml, fn: (el: ElementoHtml, profundidad: number) => boolean | void, profundidad = 0) {
  for (const h of [...raiz.hijos]) {
    if (h.tipo !== 'el') continue
    if (fn(h, profundidad) === false) continue
    recorrer(h, fn, profundidad + 1)
  }
}

export function buscar(raiz: ElementoHtml, prueba: (el: ElementoHtml) => boolean): ElementoHtml | null {
  let hallado: ElementoHtml | null = null
  recorrer(raiz, (el) => {
    if (hallado) return false
    if (prueba(el)) {
      hallado = el
      return false
    }
  })
  return hallado
}
export function buscarTodos(raiz: ElementoHtml, prueba: (el: ElementoHtml) => boolean): ElementoHtml[] {
  const r: ElementoHtml[] = []
  recorrer(raiz, (el) => {
    if (prueba(el)) r.push(el)
  })
  return r
}
export const buscarPorId = (raiz: ElementoHtml, id: string) => buscar(raiz, (el) => attr(el, 'data-id') === id)

/** Texto plano de un elemento (sin los de <style>). */
export function textoDe(n: NodoHtml): string {
  if (n.tipo === 'tx') return n.texto
  if (n.etiqueta.toLowerCase() === 'style' || n.etiqueta.toLowerCase() === 'script') return ''
  let s = ''
  for (const h of n.hijos) s += textoDe(h)
  return s
}

/** Texto directo (solo los nodos de texto hijos, no los de los hijos elementos). */
export function textoPropio(el: ElementoHtml): string {
  let s = ''
  for (const h of el.hijos) if (h.tipo === 'tx') s += h.texto
  return s
}

export function clonar<T extends NodoHtml>(n: T): T {
  if (n.tipo === 'tx') return { tipo: 'tx', texto: n.texto, padre: null } as T
  const el = crearElemento(
    n.etiqueta,
    n.attrs.map(([k, v]) => [k, v] as [string, string]),
  )
  for (const h of n.hijos) agregarHijo(el, clonar(h))
  return el as T
}

// ───────── estilos en línea ─────────

export function leerEstilo(el: ElementoHtml): Map<string, string> {
  const m = new Map<string, string>()
  for (const parte of separarDeclaraciones(attr(el, 'style') ?? '')) {
    const i = parte.indexOf(':')
    if (i < 0) continue
    const k = parte.slice(0, i).trim().toLowerCase()
    const v = parte.slice(i + 1).trim()
    if (k) m.set(k.startsWith('--') ? parte.slice(0, i).trim() : k, v)
  }
  return m
}
export function escribirEstilo(el: ElementoHtml, m: Map<string, string>) {
  const s = [...m].map(([k, v]) => `${k}: ${v}`).join('; ')
  if (s) ponerAttr(el, 'style', s)
  else quitarAttr(el, 'style')
}

/** Separa "a: b; c: url(x;y)" respetando paréntesis y comillas. */
export function separarDeclaraciones(s: string): string[] {
  const r: string[] = []
  let prof = 0
  let q: string | null = null
  let ini = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") q = c
    else if (c === '(') prof++
    else if (c === ')') prof = Math.max(0, prof - 1)
    else if (c === ';' && prof === 0) {
      r.push(s.slice(ini, i))
      ini = i + 1
    }
  }
  r.push(s.slice(ini))
  return r.map((x) => x.trim()).filter(Boolean)
}
