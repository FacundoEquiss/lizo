// Dibujo estático del texto enriquecido: JSON de TipTap → React, sin dangerouslySetInnerHTML (no hace falta sanear
// HTML) y sin cargar TipTap. Misma estructura que el editor (párrafos, listas, tareas con su casilla) para que al
// entrar a editar el texto no se mueva. Lo desconocido se dibuja como su texto.
import { memo, type ReactNode } from 'react'
import { docDesdeTexto, enlaceSeguro, type DocRico, type MarcaRica, type NodoRico } from '../../../../../compartido/rico'

const esColor = (v: unknown) => typeof v === 'string' && /^[a-z]+$/.test(v)

function conMarcas(contenido: ReactNode, marcas: MarcaRica[] | undefined, clave: string): ReactNode {
  let r = contenido
  for (const m of [...(marcas ?? [])].reverse()) {
    switch (m.type) {
      case 'bold':
        r = <strong key={clave}>{r}</strong>
        break
      case 'italic':
        r = <em key={clave}>{r}</em>
        break
      case 'underline':
        r = <u key={clave}>{r}</u>
        break
      case 'strike':
        r = <s key={clave}>{r}</s>
        break
      case 'link': {
        const href = enlaceSeguro(m.attrs?.href)
        if (href)
          r = (
            <a
              key={clave}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="nodrag"
              // En el lienzo un clic selecciona: el enlace se abre con Ctrl/⌘ + clic.
              onClick={(e) => {
                e.preventDefault()
                if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener,noreferrer')
              }}
              title="Ctrl/⌘ + clic para abrir"
            >
              {r}
            </a>
          )
        break
      }
      case 'color':
        if (esColor(m.attrs?.color)) r = <span key={clave} data-color={String(m.attrs!.color)}>{r}</span>
        break
      case 'resaltado':
        r = <mark key={clave} data-resaltado={esColor(m.attrs?.color) ? String(m.attrs!.color) : 'amarillo'}>{r}</mark>
        break
      default:
        break
    }
  }
  return r
}

/**
 * El contenido de un párrafo o título como lo deja el editor: vacío mide un renglón, y si termina en un salto de línea
 * (Mayús + Enter) el renglón nuevo también se ve (ProseMirror agrega un <br> de cola en los dos casos).
 */
function enLinea(n: NodoRico, hijos: (l: NodoRico[] | undefined) => ReactNode[]): ReactNode {
  if (!n.content?.length) return <br />
  const ultimo = n.content[n.content.length - 1]!
  return ultimo.type === 'hardBreak' ? (
    <>
      {hijos(n.content)}
      <br />
    </>
  ) : (
    hijos(n.content)
  )
}

interface Contexto {
  tarea: { n: number }
  alAlternarTarea?: (indice: number) => void
}

function dibujar(n: NodoRico, clave: string, ctx: Contexto): ReactNode {
  const hijos = (lista: NodoRico[] | undefined) => (lista ?? []).map((h, i) => dibujar(h, `${clave}.${i}`, ctx))
  switch (n.type) {
    case 'text':
      return conMarcas(n.text ?? '', n.marks, clave)
    case 'hardBreak':
      return <br key={clave} />
    case 'paragraph':
      return <p key={clave}>{enLinea(n, hijos)}</p>
    case 'heading':
      return Number(n.attrs?.level) === 1 ? <h1 key={clave}>{enLinea(n, hijos)}</h1> : <h2 key={clave}>{enLinea(n, hijos)}</h2>
    case 'bulletList':
      return <ul key={clave}>{hijos(n.content)}</ul>
    case 'orderedList': {
      const inicio = Number(n.attrs?.start ?? 1)
      return (
        <ol key={clave} start={inicio !== 1 ? inicio : undefined}>
          {hijos(n.content)}
        </ol>
      )
    }
    case 'listItem':
      return <li key={clave}>{hijos(n.content)}</li>
    case 'taskList':
      return (
        <ul key={clave} data-type="taskList">
          {hijos(n.content)}
        </ul>
      )
    case 'taskItem': {
      const indice = ctx.tarea.n++
      const marcada = Boolean(n.attrs?.checked)
      return (
        <li key={clave} data-type="taskItem" data-checked={marcada}>
          <label contentEditable={false} className="nodrag">
            <input
              type="checkbox"
              checked={marcada}
              aria-label={marcada ? 'Desmarcar la tarea' : 'Marcar la tarea'}
              onChange={() => ctx.alAlternarTarea?.(indice)}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!ctx.alAlternarTarea}
            />
            <span />
          </label>
          <div>{hijos(n.content)}</div>
        </li>
      )
    }
    default:
      if (n.content) return <span key={clave}>{hijos(n.content)}</span>
      return n.text ? <span key={clave}>{n.text}</span> : null
  }
}

export interface PropsVistaRica {
  doc?: DocRico | null
  texto?: string
  className?: string
  estilo?: React.CSSProperties
  marcador?: string
  /** Tildar una tarea sin entrar a editar (un paso de deshacer). */
  alAlternarTarea?: (indice: number) => void
}

/** Memorizada por referencia del documento: un objeto que no cambió no se vuelve a dibujar. */
export const VistaRica = memo(function VistaRica({ doc, texto, className, estilo, marcador, alAlternarTarea }: PropsVistaRica) {
  const d = doc ?? docDesdeTexto(texto ?? '')
  const vacio = !(d.content ?? []).some(function hay(n: NodoRico): boolean {
    return (n.type === 'text' && !!n.text) || (n.content ?? []).some(hay)
  })
  const ctx: Contexto = { tarea: { n: 0 }, alAlternarTarea }
  return (
    <div className={className} style={estilo}>
      <div className={`rico${vacio ? ' rico--vacio' : ''}`} data-marcador={vacio ? marcador : undefined}>
        {(d.content ?? []).map((n, i) => dibujar(n, String(i), ctx))}
      </div>
    </div>
  )
})
