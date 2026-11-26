import MarkdownIt, { type Token } from 'markdown-it'
import DOMPurify from 'dompurify'
import { extraerMenciones, resolverExacto } from '../../../compartido/menciones'
import type { Miembro } from '../../../compartido/tipos'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true })

// Los links abren en otra pestaña y sin pasar referencia.
const original = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('target', '_blank')
  tokens[idx]!.attrSet('rel', 'noopener noreferrer')
  return original(tokens, idx, options, env, self)
}

// ───────── Menciones (plan de la IA integrada, 14.3) ─────────
// Un `@alias` que existe se dibuja como una pastilla; uno que no existe queda como texto. Es una regla de markdown-it sobre
// los pedazos de texto (y no un reemplazo sobre el HTML): así no toca lo que está en código ni dentro de un link. Qué es
// una mención lo decide `extraerMenciones` (el mismo extractor del servidor: no cuenta mails, direcciones ni código) y a
// quién nombra, `resolverExacto` (alias exacto, o nombre exacto, y nunca un miembro archivado): lo que se ve como pastilla
// es lo que el servidor toma como mención.

interface EntornoMarkdown {
  miembros?: readonly Miembro[]
}

function pastilla(texto: string, miembro: Miembro, Clase: typeof Token): Token {
  const t = new Clase('mencion', 'span', 0)
  t.content = texto
  t.meta = { id: miembro.id, nombre: miembro.nombre, ia: miembro.tipo === 'ia' }
  return t
}

md.core.ruler.before('text_join', 'menciones', (estado) => {
  const miembros = (estado.env as EntornoMarkdown).miembros?.filter((m) => m.alias)
  if (!miembros?.length) return
  const candidatos = miembros.map((m) => ({ id: m.id, alias: m.alias!, nombre: m.nombre, archivado: m.archivado }))
  for (const bloque of estado.tokens) {
    if (bloque.type !== 'inline' || !bloque.children) continue
    let dentroDeLink = 0
    const hijos: Token[] = []
    for (const t of bloque.children) {
      if (t.type === 'link_open') dentroDeLink++
      else if (t.type === 'link_close') dentroDeLink--
      if (t.type !== 'text' || dentroDeLink > 0 || !t.content.includes('@')) {
        hijos.push(t)
        continue
      }
      let desde = 0
      for (const m of extraerMenciones(t.content)) {
        const quien = resolverExacto(m.alias, candidatos)
        const miembro = quien && miembros.find((x) => x.id === quien.id)
        if (!miembro) continue
        if (m.desde > desde) hijos.push(Object.assign(new estado.Token('text', '', 0), { content: t.content.slice(desde, m.desde) }))
        hijos.push(pastilla(t.content.slice(m.desde, m.hasta), miembro, estado.Token))
        desde = m.hasta
      }
      if (desde === 0) hijos.push(t)
      else if (desde < t.content.length) hijos.push(Object.assign(new estado.Token('text', '', 0), { content: t.content.slice(desde) }))
    }
    bloque.children = hijos
  }
})

md.renderer.rules.mencion = (tokens, idx) => {
  const t = tokens[idx]!
  const { id, nombre, ia } = t.meta as { id: string; nombre: string; ia: boolean }
  const e = md.utils.escapeHtml
  return `<span class="md-mencion${ia ? ' md-mencion--ia' : ''}" data-miembro="${e(id)}" data-nombre="${e(nombre)}" title="${e(nombre)}">${e(t.content)}</span>`
}

/**
 * Markdown → HTML limpio (DOMPurify saca cualquier script o atributo raro). Con la lista de miembros, los `@alias` que
 * existen se dibujan como pastillas (`.md-mencion`); sin ella, todo queda como texto.
 */
export function aHtml(texto: string, miembros?: readonly Miembro[]): string {
  // Las claves de tarjeta (RC-12) quedan resaltadas y se pueden tocar.
  const html = md.render(texto, { miembros } satisfies EntornoMarkdown)
  const conClaves = html.replace(
    /(^|[\s(>])([A-Z][A-Z0-9]{0,9}-\d+)(?=[\s).,:;!?<]|$)/g,
    '$1<a class="md-clave" data-clave="$2" href="?tarjeta=$2">$2</a>',
  )
  return DOMPurify.sanitize(conClaves, { ADD_ATTR: ['target', 'data-clave', 'data-miembro', 'data-nombre'] })
}
