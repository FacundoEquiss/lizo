// Markdown → documento del lienzo (lo usa el MCP: la IA manda Markdown y el lienzo lo muestra con formato). Va aparte
// de rico.ts porque necesita markdown-it, y rico.ts lo importa la web desde el arranque (ver su cabecera).
import MarkdownIt from 'markdown-it'
import { enlaceSeguro, type DocRico, type MarcaRica, type NodoRico } from './rico'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

type Token = ReturnType<typeof md.parse>[number]

/**
 * Markdown → documento (lo usa el MCP: la IA manda Markdown y el lienzo lo muestra con formato).
 * Entiende párrafos, títulos (# y ##; los demás quedan como título 2), negrita, cursiva, tachado, enlaces, listas con
 * viñetas, numeradas y de tareas ("- [ ] " y "- [x] "). Lo demás (código, citas, imágenes) queda como texto.
 */
export function docDesdeMarkdown(markdown: string): DocRico {
  const tokens = md.parse(markdown ?? '', {})
  const raiz: NodoRico = { type: 'doc', content: [] }
  const pila: NodoRico[] = [raiz]
  const actual = () => pila[pila.length - 1]!
  const agregar = (n: NodoRico) => {
    const p = actual()
    ;(p.content ??= []).push(n)
    return n
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    switch (t.type) {
      case 'paragraph_open':
        pila.push(agregar({ type: 'paragraph' }))
        break
      case 'heading_open': {
        const nivel = Number(t.tag.slice(1)) === 1 ? 1 : 2
        pila.push(agregar({ type: 'heading', attrs: { level: nivel } }))
        break
      }
      case 'bullet_list_open': {
        // ¿Es una lista de tareas? Si el primer renglón de cada ítem empieza con [ ] o [x].
        const tareas = esListaDeTareas(tokens, i)
        pila.push(agregar({ type: tareas ? 'taskList' : 'bulletList' }))
        break
      }
      case 'ordered_list_open': {
        const inicio = Number(t.attrGet('start') ?? 1) || 1
        pila.push(agregar({ type: 'orderedList', attrs: inicio !== 1 ? { start: inicio } : {} }))
        break
      }
      case 'list_item_open': {
        const lista = actual()
        if (lista.type === 'taskList') {
          const inline = tokens.slice(i).find((x) => x.type === 'inline')
          const marcado = /^\s*\[[xX]\]/.test(inline?.content ?? '')
          pila.push(agregar({ type: 'taskItem', attrs: { checked: marcado } }))
        } else pila.push(agregar({ type: 'listItem' }))
        break
      }
      case 'blockquote_open':
        break
      case 'paragraph_close':
      case 'heading_close':
      case 'bullet_list_close':
      case 'ordered_list_close':
      case 'list_item_close':
        pila.pop()
        break
      case 'inline': {
        const padre = actual()
        if (padre.type === 'doc' || padre.type === 'bulletList' || padre.type === 'orderedList' || padre.type === 'taskList') {
          pila.push(agregar({ type: 'paragraph' }))
          enLinea(t, actual(), false)
          pila.pop()
        } else enLinea(t, padre, padre.type === 'paragraph' && esPrimerParrafoDeTarea(pila))
        break
      }
      case 'fence':
      case 'code_block':
        for (const r of t.content.replace(/\n$/, '').split('\n'))
          agregar(r ? { type: 'paragraph', content: [{ type: 'text', text: r }] } : { type: 'paragraph' })
        break
      default:
        break
    }
  }
  if (!raiz.content?.length) raiz.content = [{ type: 'paragraph' }]
  return repartirListasMixtas(raiz) as DocRico
}

const esCasilla = /^\s*\[([ xX])\]\s?/

/**
 * Una lista con viñetas donde algunos renglones son tareas ("- [ ] …") y otros no: el editor no las mezcla en una sola
 * lista, así que se parte en tramos seguidos (viñetas, tareas, viñetas…), en el mismo orden.
 */
function repartirListasMixtas(n: NodoRico): NodoRico {
  if (!n.content) return n
  const contenido: NodoRico[] = []
  for (const hijo of n.content.map(repartirListasMixtas)) {
    if (hijo.type !== 'bulletList' || !hijo.content?.some(esItemTarea)) {
      contenido.push(hijo)
      continue
    }
    let lista: NodoRico | undefined
    for (const item of hijo.content) {
      const tipo = esItemTarea(item) ? 'taskList' : 'bulletList'
      if (!lista || lista.type !== tipo) {
        lista = { type: tipo, content: [] }
        contenido.push(lista)
      }
      lista.content!.push(tipo === 'taskList' ? aTarea(item) : item)
    }
  }
  return { ...n, content: contenido }
}

function primerTexto(item: NodoRico): NodoRico | undefined {
  const p = item.content?.[0]
  return p?.type === 'paragraph' ? p.content?.find((x) => x.type === 'text') : undefined
}

const esItemTarea = (item: NodoRico) => item.type === 'listItem' && esCasilla.test(primerTexto(item)?.text ?? '')

function aTarea(item: NodoRico): NodoRico {
  const t = primerTexto(item)!
  const marcado = /x/i.test(esCasilla.exec(t.text ?? '')?.[1] ?? '')
  const [p, ...resto] = item.content!
  const contenido = (p!.content ?? []).map((x) => (x === t ? { ...x, text: (x.text ?? '').replace(esCasilla, '') } : x)).filter((x) => x.type !== 'text' || x.text)
  return { type: 'taskItem', attrs: { checked: marcado }, content: [{ ...p!, content: contenido }, ...resto] }
}

function esPrimerParrafoDeTarea(pila: NodoRico[]): boolean {
  const item = pila[pila.length - 2]
  return !!item && item.type === 'taskItem' && (item.content?.length ?? 0) === 1
}

function esListaDeTareas(tokens: Token[], desde: number): boolean {
  let nivel = 0
  let items = 0
  let tareas = 0
  for (let j = desde; j < tokens.length; j++) {
    const t = tokens[j]!
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') nivel++
    if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') {
      nivel--
      if (nivel === 0) break
    }
    if (nivel === 1 && t.type === 'list_item_open') {
      items++
      const inline = tokens.slice(j).find((x) => x.type === 'inline')
      if (/^\s*\[[ xX]\]\s/.test(inline?.content ?? '')) tareas++
    }
  }
  return items > 0 && tareas === items
}

function enLinea(t: Token, destino: NodoRico, quitarCasilla: boolean) {
  const marcas: MarcaRica[] = []
  const hijos = t.children ?? []
  let primero = quitarCasilla
  const empujar = (n: NodoRico) => ((destino.content ??= []).push(n), n)
  for (const h of hijos) {
    switch (h.type) {
      case 'text':
      case 'code_inline': {
        let texto = h.content
        if (primero) {
          texto = texto.replace(/^\s*\[[ xX]\]\s?/, '')
          primero = false
        }
        // Subrayado: Markdown no lo tiene; se escribe <u>así</u> (con el HTML apagado llega como texto).
        for (const trozo of h.type === 'text' ? texto.split(/(<\/?u>)/i) : [texto]) {
          if (/^<u>$/i.test(trozo)) {
            marcas.push({ type: 'underline' })
            continue
          }
          if (/^<\/u>$/i.test(trozo)) {
            quitar(marcas, 'underline')
            continue
          }
          if (!trozo) continue
          const anterior = destino.content?.[destino.content.length - 1]
          const mismas = (a: MarcaRica[] | undefined, b: MarcaRica[]) => JSON.stringify(a ?? []) === JSON.stringify(b)
          if (anterior?.type === 'text' && mismas(anterior.marks, marcas)) anterior.text = (anterior.text ?? '') + trozo
          else empujar(marcas.length ? { type: 'text', text: trozo, marks: marcas.map((m) => ({ ...m })) } : { type: 'text', text: trozo })
        }
        break
      }
      case 'softbreak':
      case 'hardbreak':
        empujar({ type: 'hardBreak' })
        break
      case 'strong_open':
        marcas.push({ type: 'bold' })
        break
      case 'em_open':
        marcas.push({ type: 'italic' })
        break
      case 's_open':
        marcas.push({ type: 'strike' })
        break
      case 'link_open': {
        const href = enlaceSeguro(h.attrGet('href'))
        marcas.push(href ? { type: 'link', attrs: { href } } : { type: 'sin-enlace' })
        break
      }
      case 'strong_close':
        quitar(marcas, 'bold')
        break
      case 'em_close':
        quitar(marcas, 'italic')
        break
      case 's_close':
        quitar(marcas, 'strike')
        break
      case 'link_close':
        if (!quitar(marcas, 'link')) quitar(marcas, 'sin-enlace')
        break
      case 'image':
        if (h.content) empujar({ type: 'text', text: h.content })
        break
      default:
        break
    }
  }
  // Las marcas ficticias (un enlace inseguro) no se guardan.
  for (const n of destino.content ?? []) {
    if (n.marks) n.marks = n.marks.filter((m) => m.type !== 'sin-enlace')
    if (n.marks && n.marks.length === 0) delete n.marks
  }
}

function quitar(marcas: MarcaRica[], tipo: string): boolean {
  for (let i = marcas.length - 1; i >= 0; i--)
    if (marcas[i]!.type === tipo) {
      marcas.splice(i, 1)
      return true
    }
  return false
}
