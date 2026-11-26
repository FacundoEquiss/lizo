// Texto enriquecido del lienzo (notas, textos y formas). El documento es el JSON nativo de TipTap/ProseMirror
// ({ type, content, marks, attrs }, con claves en inglés porque es el formato de la biblioteca). Al lado de `rico`
// siempre se guarda `texto` (texto plano): lo usan el buscador, el MCP, la actividad y cualquier cliente viejo.
// Markdown → documento (docDesdeMarkdown) está en rico-markdown.ts: necesita markdown-it (~35 KB comprimidos), lo usa
// solo el servidor, y la web importa este archivo desde el arranque.

export interface MarcaRica {
  type: string
  attrs?: Record<string, unknown>
}

export interface NodoRico {
  type: string
  attrs?: Record<string, unknown>
  content?: NodoRico[]
  marks?: MarcaRica[]
  text?: string
}

export interface DocRico extends NodoRico {
  type: 'doc'
}

export const esDocRico = (v: unknown): v is DocRico =>
  !!v && typeof v === 'object' && (v as NodoRico).type === 'doc' && (!(v as NodoRico).content || Array.isArray((v as NodoRico).content))

/** Protocolos que puede tener un enlace del lienzo (lo demás, por ejemplo javascript:, se descarta). */
export function enlaceSeguro(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (/^(https?:|mailto:)/i.test(h)) return h
  if (/^www\./i.test(h)) return `https://${h}`
  return null
}

/** Texto plano de un documento: un renglón por párrafo; las listas con "- ", "1. " o "- [ ] " adelante. */
export function textoPlano(doc: NodoRico | null | undefined): string {
  if (!doc) return ''
  const renglones: string[] = []
  const recorrer = (n: NodoRico, prefijo: string) => {
    switch (n.type) {
      case 'text':
        return
      case 'bulletList':
        for (const li of n.content ?? []) recorrer(li, '- ')
        return
      case 'orderedList': {
        let i = Number(n.attrs?.start ?? 1) || 1
        for (const li of n.content ?? []) recorrer(li, `${i++}. `)
        return
      }
      case 'taskList':
        for (const li of n.content ?? []) recorrer(li, n.type === 'taskList' ? (li.attrs?.checked ? '- [x] ' : '- [ ] ') : '- ')
        return
      case 'listItem':
      case 'taskItem': {
        let primero = true
        for (const hijo of n.content ?? []) {
          recorrer(hijo, primero ? prefijo : '  ')
          primero = false
        }
        return
      }
      case 'paragraph':
      case 'heading':
        renglones.push(prefijo + textoEnLinea(n))
        return
      default:
        if (n.content) for (const hijo of n.content) recorrer(hijo, prefijo)
        else if (typeof n.text === 'string') renglones.push(prefijo + n.text)
    }
  }
  for (const hijo of doc.content ?? []) recorrer(hijo, '')
  // Sin renglones vacíos al final (un párrafo vacío que quedó al terminar de escribir).
  while (renglones.length && !renglones[renglones.length - 1]!.trim()) renglones.pop()
  return renglones.join('\n')
}

function textoEnLinea(n: NodoRico): string {
  let s = ''
  for (const h of n.content ?? []) {
    if (h.type === 'text') s += h.text ?? ''
    else if (h.type === 'hardBreak') s += '\n'
    else if (h.content) s += textoEnLinea(h)
  }
  return s
}

/** ¿El documento no tiene nada escrito? */
export function docVacio(doc: NodoRico | null | undefined): boolean {
  const hayTexto = (n: NodoRico): boolean => (n.type === 'text' && !!n.text?.trim()) || (n.content ?? []).some(hayTexto)
  return !doc || !hayTexto(doc)
}

/** Texto plano → documento: un párrafo por renglón. */
export function docDesdeTexto(texto: string): DocRico {
  const renglones = (texto ?? '').replace(/\r\n?/g, '\n').split('\n')
  return {
    type: 'doc',
    content: renglones.map((r) => (r ? { type: 'paragraph', content: [{ type: 'text', text: r }] } : { type: 'paragraph' })),
  }
}

// ───────── documento → Markdown (lo que lee la IA por MCP) ─────────

/** Las marcas que se escriben en Markdown, en el orden en que se abren (el enlace, por fuera). */
const MARCAS_MD: Record<string, { abre: (m: MarcaRica) => string; cierra: (m: MarcaRica) => string }> = {
  link: { abre: () => '[', cierra: (m) => `](${String(m.attrs?.href ?? '')})` },
  bold: { abre: () => '**', cierra: () => '**' },
  italic: { abre: () => '*', cierra: () => '*' },
  strike: { abre: () => '~~', cierra: () => '~~' },
  underline: { abre: () => '<u>', cierra: () => '</u>' },
}
const ORDEN_MD = Object.keys(MARCAS_MD)

/** Escapa lo que Markdown leería como formato (asteriscos, corchetes, ~~, _ al borde de una palabra…), y nada más. */
function escaparMd(t: string, inicioDeRenglon: boolean): string {
  let s = t
    .replace(/([\\`*[\]<>])/g, '\\$1')
    .replace(/~(?=~)|(?<=~)~/g, '\\~')
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
  // Al principio del renglón, lo que parecería un título, una lista o una cita.
  if (inicioDeRenglon) s = s.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s)/, '$1\\$2')
  return s
}

/** El contenido en línea de un párrafo o título, con sus marcas (negrita, cursiva, tachado, subrayado y enlaces). */
function enLineaMd(n: NodoRico): string {
  let s = ''
  let abiertas: MarcaRica[] = []
  const clave = (m: MarcaRica) => (m.type === 'link' ? `link:${String(m.attrs?.href ?? '')}` : m.type)
  const cerrarHasta = (i: number) => {
    while (abiertas.length > i) {
      const m = abiertas.pop()!
      s += MARCAS_MD[m.type]!.cierra(m)
    }
  }
  for (const h of n.content ?? []) {
    if (h.type === 'hardBreak') {
      cerrarHasta(0)
      s += '\n'
      continue
    }
    if (h.type !== 'text' || !h.text) continue
    const quiere = (h.marks ?? []).filter((m) => MARCAS_MD[m.type]).sort((a, b) => ORDEN_MD.indexOf(a.type) - ORDEN_MD.indexOf(b.type))
    // Se cierra desde la primera marca abierta que ya no sigue, y se abren las que faltan.
    let comun = 0
    while (comun < abiertas.length && comun < quiere.length && clave(abiertas[comun]!) === clave(quiere[comun]!)) comun++
    cerrarHasta(comun)
    for (const m of quiere.slice(comun)) {
      s += MARCAS_MD[m.type]!.abre(m)
      abiertas.push(m)
    }
    s += escaparMd(h.text, s === '' || s.endsWith('\n'))
  }
  cerrarHasta(0)
  abiertas = []
  return s
}

/**
 * Documento → Markdown: la vuelta de `docDesdeMarkdown` (párrafos, títulos, negrita, cursiva, tachado, <u>subrayado</u>,
 * enlaces y listas con viñetas, numeradas y de tareas). El color y el resaltado de partes del texto no tienen
 * Markdown: quedan como texto.
 */
export function markdownDesdeDoc(doc: NodoRico | null | undefined): string {
  if (!doc) return ''
  const bloques: string[] = []
  const lista = (n: NodoRico, sangria: string): string[] => {
    const renglones: string[] = []
    let i = Number(n.attrs?.start ?? 1) || 1
    for (const item of n.content ?? []) {
      const vineta = n.type === 'orderedList' ? `${i++}. ` : n.type === 'taskList' ? (item.attrs?.checked ? '- [x] ' : '- [ ] ') : '- '
      let primero = true
      for (const hijo of item.content ?? []) {
        if (hijo.type === 'bulletList' || hijo.type === 'orderedList' || hijo.type === 'taskList') {
          renglones.push(...lista(hijo, sangria + '  '))
          continue
        }
        const texto = hijo.type === 'paragraph' || hijo.type === 'heading' ? enLineaMd(hijo) : textoPlano({ type: 'doc', content: [hijo] })
        const lineas = texto.split('\n')
        renglones.push((primero ? sangria + vineta : sangria + '  ') + lineas[0], ...lineas.slice(1).map((l) => sangria + '  ' + l))
        primero = false
      }
      if (primero) renglones.push(sangria + vineta.trimEnd())
    }
    return renglones
  }
  for (const n of doc.content ?? []) {
    switch (n.type) {
      case 'paragraph':
        bloques.push(enLineaMd(n))
        break
      case 'heading':
        bloques.push(`${Number(n.attrs?.level) === 1 ? '#' : '##'} ${enLineaMd(n)}`)
        break
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        bloques.push(lista(n, '').join('\n'))
        break
      default:
        bloques.push(textoPlano({ type: 'doc', content: [n] }))
    }
  }
  // Sin párrafos vacíos al final; los del medio se mantienen (separan como en el lienzo).
  while (bloques.length && !bloques[bloques.length - 1]!.trim()) bloques.pop()
  return bloques.join('\n\n')
}

/** Cambia el estado de la casilla número `indice` (en orden de aparición) de una lista de tareas. */
export function alternarTarea(doc: DocRico, indice: number): DocRico {
  let n = 0
  const copiar = (x: NodoRico): NodoRico => {
    const c: NodoRico = { ...x }
    if (x.type === 'taskItem') {
      if (n === indice) c.attrs = { ...x.attrs, checked: !x.attrs?.checked }
      n++
    }
    if (x.content) c.content = x.content.map(copiar)
    return c
  }
  return copiar(doc) as DocRico
}

/** ¿Todo el texto del documento tiene esa marca? (para mostrar B, I, U, S activos sin abrir el editor). */
export function marcaEnTodo(doc: NodoRico | null | undefined, tipo: string): boolean {
  let hay = false
  let todos = true
  const ver = (n: NodoRico) => {
    if (n.type === 'text' && n.text?.trim()) {
      hay = true
      if (!(n.marks ?? []).some((m) => m.type === tipo)) todos = false
    }
    for (const h of n.content ?? []) ver(h)
  }
  if (doc) ver(doc)
  return hay && todos
}

/** Valor de un atributo de marca en el primer texto que la tiene (color o resaltado sin abrir el editor). */
export function atributoDeMarca(doc: NodoRico | null | undefined, tipo: string, attr: string): unknown {
  let r: unknown = undefined
  const ver = (n: NodoRico): boolean => {
    if (n.type === 'text') {
      const m = (n.marks ?? []).find((x) => x.type === tipo)
      if (m) {
        r = m.attrs?.[attr]
        return true
      }
    }
    return (n.content ?? []).some(ver)
  }
  if (doc) ver(doc)
  return r
}

/** Tipos de bloque de primer nivel del documento (para el menú de listas sin abrir el editor). */
export function bloquesDe(doc: NodoRico | null | undefined): Set<string> {
  return new Set((doc?.content ?? []).map((n) => n.type))
}

/** El documento sin una marca (por ejemplo, al poner el color del objeto entero se sacan los colores sueltos). */
export function quitarMarca<T extends NodoRico>(doc: T, tipo: string): T {
  const copiar = (x: NodoRico): NodoRico => {
    const c: NodoRico = { ...x }
    if (x.marks) {
      const marcas = x.marks.filter((m) => m.type !== tipo)
      if (marcas.length) c.marks = marcas
      else delete c.marks
    }
    if (x.content) c.content = x.content.map(copiar)
    return c
  }
  return copiar(doc) as T
}
