// La barra contextual única (5.8): una sola, dibujada por el lienzo según la selección. Va en coordenadas de pantalla,
// encima de todo (mide lo mismo con cualquier zoom y nada la tapa), centrada sobre la selección a 12 px; si arriba no
// entra, va debajo; si el objeto es más grande que la pantalla, queda fija arriba al centro. Se esconde mientras se
// arrastra, se redimensiona o se mueve el lienzo, y vuelve 120 ms después.
// En el teléfono (`abajo`) va abajo, en el lugar de la barra de herramientas, como en las apps de pizarras: las opciones
// se desplazan de costado (con un aviso de que hay más) y Borrar y ⋯ quedan fijos a la derecha, siempre a la vista.
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as EventoTecla, type ReactNode } from 'react'
import { NOMBRES_TIPO } from '../../../../../compartido/lienzo'
import { useTienda } from '../../../estado/tienda'
import { useAccionesLienzo } from '../acciones'
import { useAlCambiarVista } from '../alCambiarVista'
import { esCreacion } from '../crear'
import { useLienzo } from '../estado'
import { useSeleccionLienzo, type SeleccionLienzo } from '../seleccion'
import { useEditorActivo } from '../texto/editorActivo'
import {
  SeccionAbrir,
  SeccionAlinear,
  SeccionBloqueado,
  SeccionConector,
  SeccionForma,
  SeccionGrafico,
  SeccionMarco,
  SeccionMultiple,
  SeccionNota,
  SeccionOrden,
  SeccionTabla,
  SeccionTarjeta,
  SeccionTexto,
  Separador,
} from './secciones'
import { BotonBarra } from './piezas'

const ARRIBA = 68 // los paneles de arriba
const ABAJO = 92 // la barra de herramientas
const SEPARACION = 12

/** Rectángulo de la selección en pantalla (con el título de los marcos y la etiqueta de los conectores). */
function rectSeleccion(sel: SeleccionLienzo): DOMRect | null {
  const rects: DOMRect[] = []
  for (const e of sel.nodos) {
    const el = document.querySelector<HTMLElement>(`.lienzo .react-flow__node[data-id="${CSS.escape(e.id)}"]`)
    if (!el) continue
    rects.push(el.getBoundingClientRect())
    if (e.tipo === 'marco') {
      const t = el.querySelector('.marco__titulo')
      if (t) rects.push(t.getBoundingClientRect())
    }
  }
  for (const c of sel.conectores) {
    const etiqueta = document.querySelector<HTMLElement>(`.lienzo [data-etiqueta-conector="${CSS.escape(c.id)}"]`)
    const ancla = etiqueta ?? document.querySelector<HTMLElement>(`.lienzo [data-ancla-conector="${CSS.escape(c.id)}"]`)
    if (ancla) rects.push(ancla.getBoundingClientRect())
  }
  if (!rects.length) return null
  const x1 = Math.min(...rects.map((r) => r.left))
  const y1 = Math.min(...rects.map((r) => r.top))
  const x2 = Math.max(...rects.map((r) => r.right))
  const y2 = Math.max(...rects.map((r) => r.bottom))
  return new DOMRect(x1, y1, x2 - x1, y2 - y1)
}

function nombreSeleccion(sel: SeleccionLienzo) {
  if (sel.tipo === 'mixta') return 'Opciones de la selección'
  if (sel.tipo === 'conector') return 'Opciones del conector'
  if (!sel.tipo) return 'Opciones'
  const n = NOMBRES_TIPO[sel.tipo].toLowerCase()
  const art = ['nota', 'forma', 'tarjeta', 'imagen', 'lista', 'tabla'].includes(sel.tipo) ? 'de la' : 'del'
  return `Opciones ${art} ${n}`
}

/**
 * Lo que va en la barra según lo seleccionado. `acoplada` (la barra de abajo del teléfono): sin el ⋯ ni "Sacar del
 * lienzo" al final, porque esa barra los tiene fijos a la derecha.
 */
export function ContenidoBarra({ sel, alReemplazarImagen, acoplada }: { sel: SeleccionLienzo; alReemplazarImagen?: () => void; acoplada?: boolean }) {
  if (sel.nodos.length && sel.nodos.every((e) => e.bloqueado) && !sel.conectores.length) return <SeccionBloqueado />
  const n = sel.nodos.length + sel.conectores.length
  // Varios del mismo tipo: la cantidad adelante y, si son objetos (no conectores), también Alinear.
  const cuenta: ReactNode =
    n > 1 && sel.tipo !== 'mixta' ? (
      <>
        <span className="barra-ctx__cuenta">{n}</span>
        {sel.nodos.length > 1 && <SeccionAlinear />}
      </>
    ) : null
  const fin = acoplada ? null : (
    <>
      <Separador />
      <SeccionOrden />
    </>
  )
  switch (sel.tipo) {
    case 'nota':
      return (
        <>
          {cuenta}
          {cuenta && <Separador />}
          <SeccionNota />
          {fin}
        </>
      )
    case 'texto':
      return (
        <>
          {cuenta}
          {cuenta && <Separador />}
          <SeccionTexto acoplada={acoplada} />
          {fin}
        </>
      )
    case 'forma':
      return (
        <>
          {cuenta}
          {cuenta && <Separador />}
          <SeccionForma />
          {fin}
        </>
      )
    case 'marco':
      return (
        <>
          {cuenta}
          {cuenta && <Separador />}
          <SeccionMarco />
          {fin}
        </>
      )
    case 'tarjeta':
      return (
        <>
          {cuenta}
          <SeccionTarjeta sinSacar={acoplada} />
          {fin}
        </>
      )
    case 'conector':
      return (
        <>
          {cuenta}
          <SeccionConector />
          {fin}
        </>
      )
    case 'tabla':
      return (
        <>
          {cuenta}
          {cuenta && <Separador />}
          <SeccionTabla />
          {fin}
        </>
      )
    case 'grafico':
      return (
        <>
          {cuenta}
          {cuenta && <Separador />}
          <SeccionGrafico />
          {fin}
        </>
      )
    case 'imagen':
    case 'enlace':
    case 'figma':
    case 'lista':
      return (
        <>
          <SeccionAbrir alReemplazar={alReemplazarImagen} />
          {fin}
        </>
      )
    case 'mixta':
      return (
        <>
          <SeccionMultiple />
          {fin}
        </>
      )
    default:
      return null
  }
}

/** Foco itinerante con flechas (y Esc devuelve el foco al objeto): igual en las dos barras. */
function teclaBarra(e: EventoTecla<HTMLDivElement>, raiz: HTMLElement | null, sel: SeleccionLienzo) {
  const botones = [...(raiz?.querySelectorAll<HTMLElement>('.barra-ctx__boton, .barra-ctx__contenido button') ?? [])].filter(
    (b, i, todos) => todos.indexOf(b) === i && !b.hasAttribute('disabled'),
  )
  const i = botones.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape') {
    e.stopPropagation()
    const id = sel.nodos[0]?.id
    const nodo = id ? document.querySelector<HTMLElement>(`.lienzo .react-flow__node[data-id="${CSS.escape(id)}"]`) : null
    nodo?.focus()
    return
  }
  if (i === -1) return
  let j = i
  if (e.key === 'ArrowRight') j = (i + 1) % botones.length
  else if (e.key === 'ArrowLeft') j = (i - 1 + botones.length) % botones.length
  else if (e.key === 'Home') j = 0
  else if (e.key === 'End') j = botones.length - 1
  else return
  e.preventDefault()
  e.stopPropagation()
  botones[j]!.focus()
  // En la barra de abajo del teléfono, la fila se corre para que se vea el botón enfocado.
  if (botones[j]!.closest('.barra-ctx__desliza')) botones[j]!.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function BarraContextual({ alReemplazarImagen, abajo }: { alReemplazarImagen?: () => void; abajo?: boolean }) {
  return abajo ? <BarraAbajo alReemplazarImagen={alReemplazarImagen} /> : <BarraFlotante alReemplazarImagen={alReemplazarImagen} />
}

/** Escritorio: flotando sobre la selección. */
function BarraFlotante({ alReemplazarImagen }: { alReemplazarImagen?: () => void }) {
  const sel = useSeleccionLienzo()
  const interaccion = useLienzo((s) => s.interaccion)
  const herramienta = useTienda((s) => s.herramienta)
  const editando = useTienda((s) => s.editando)
  // El celular puede escribir con una barra propia (EditorRico barra={false}): entonces esta no se muestra.
  const sinBarra = useEditorActivo((s) => !s.barra && !!s.editor)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; lugar: 'arriba' | 'abajo' | 'fija' } | null>(null)
  const [oculta, setOculta] = useState(false)
  // Con la mano solo se mueve el lienzo: la barra de lo elegido vuelve al volver a Seleccionar.
  const hay = sel.nodos.length + sel.conectores.length > 0 && !esCreacion(herramienta) && herramienta !== 'mano' && !sinBarra
  // Mientras se escribe, la barra no corre de costado cada vez que el texto crece: queda donde se abrió.
  const fija = useRef<{ id: string; x: number } | null>(null)
  const idEditando = sel.nodos.length === 1 && sel.nodos[0]!.id === editando ? editando : null
  if (!idEditando) fija.current = null

  // Se esconde mientras se arrastra, se redimensiona o se mueve el lienzo; vuelve 120 ms después de parar.
  useEffect(() => {
    if (interaccion) {
      setOculta(true)
      return
    }
    const t = setTimeout(() => setOculta(false), 120)
    return () => clearTimeout(t)
  }, [interaccion])

  const calcular = useCallback(() => {
    const el = ref.current
    const cont = el?.parentElement
    if (!el || !cont) return
    const r = rectSeleccion(sel)
    if (!r) return setPos(null)
    const c = cont.getBoundingClientRect()
    const bw = el.offsetWidth
    const bh = el.offsetHeight || 40
    let y = r.top - SEPARACION - bh
    let lugar: 'arriba' | 'abajo' | 'fija' = 'arriba'
    if (y < c.top + ARRIBA) {
      const abajo = r.bottom + SEPARACION
      if (abajo + bh <= c.bottom - ABAJO && abajo >= c.top + ARRIBA) {
        y = abajo
        lugar = 'abajo'
      } else {
        // Más grande que la pantalla (o fuera de ella): fija arriba al centro.
        y = c.top + ARRIBA
        lugar = 'fija'
      }
    }
    let x = lugar === 'fija' && (r.left < c.left || r.right > c.right) ? c.left + c.width / 2 - bw / 2 : r.left + r.width / 2 - bw / 2
    // Con un conector, la barra no tapa sus extremos (que se arrastran para reengancharlo): si los tapa, va debajo.
    if (sel.conectores.length && lugar === 'arriba') {
      const extremos = [...document.querySelectorAll<HTMLElement>('.lienzo .conector__extremo')].map((el) => el.getBoundingClientRect())
      const tapa = (yy: number) => extremos.some((e) => e.right + 6 > x && e.left - 6 < x + bw && e.bottom + 6 > yy && e.top - 6 < yy + bh)
      const abajo = r.bottom + SEPARACION
      if (tapa(y) && !tapa(abajo) && abajo + bh <= c.bottom - ABAJO) {
        y = abajo
        lugar = 'abajo'
      }
    }
    if (idEditando) {
      // Se queda donde estaba mientras siga encima del objeto.
      const f = fija.current
      if (f?.id === idEditando && f.x + bw > r.left && f.x < r.right) x = f.x
      else fija.current = { id: idEditando, x }
    }
    x = Math.min(Math.max(x, c.left + 12), c.right - 12 - bw)
    setPos({ x: Math.round(x - c.left), y: Math.round(y - c.top), lugar })
  }, [sel, idEditando])

  useLayoutEffect(() => {
    if (hay && !oculta) calcular()
  }, [hay, oculta, calcular])

  // Cualquier movimiento del lienzo (también los encuadres y el zoom con teclado, que React Flow no avisa como
  // "empezó a moverse") la esconde, y vuelve a ubicarse 120 ms después del último cuadro. Directo al DOM.
  const relojMovimiento = useRef<ReturnType<typeof setTimeout> | null>(null)
  useAlCambiarVista(() => {
    const el = ref.current
    if (!el) return
    fija.current = null
    el.dataset.moviendo = 'si'
    if (relojMovimiento.current) clearTimeout(relojMovimiento.current)
    relojMovimiento.current = setTimeout(() => {
      calcular()
      delete el.dataset.moviendo
    }, 120)
  })
  useEffect(() => () => {
    if (relojMovimiento.current) clearTimeout(relojMovimiento.current)
  }, [])

  // Lo seleccionado puede cambiar de tamaño (un texto mientras se escribe): se vuelve a ubicar.
  useEffect(() => {
    if (!hay) return
    const ro = new ResizeObserver(() => calcular())
    for (const e of sel.nodos) {
      const el = document.querySelector(`.lienzo .react-flow__node[data-id="${CSS.escape(e.id)}"]`)
      if (el) ro.observe(el)
    }
    if (ref.current) ro.observe(ref.current)
    window.addEventListener('resize', calcular)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', calcular)
    }
  }, [hay, sel, calcular])

  if (!hay) return null
  return (
    <div
      ref={ref}
      className="barra-ctx"
      role="toolbar"
      aria-label={nombreSeleccion(sel)}
      data-oculta={oculta || !pos || undefined}
      data-lugar={pos?.lugar}
      style={pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : { visibility: 'hidden' }}
      onKeyDown={(e) => teclaBarra(e, ref.current, sel)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="barra-ctx__contenido">
        <ContenidoBarra sel={sel} alReemplazarImagen={alReemplazarImagen} />
      </div>
    </div>
  )
}

/**
 * Teléfono: abajo, en el lugar de la barra de herramientas (que se esconde mientras hay algo elegido). Las opciones del
 * tipo elegido se desplazan de costado; cuando hay más de las que entran, el borde se desvanece y aparece una flecha que
 * corre la fila. Borrar y ⋯ (todo lo demás: duplicar, capas, bloquear, convertir…) quedan fijos a la derecha.
 */
function BarraAbajo({ alReemplazarImagen }: { alReemplazarImagen?: () => void }) {
  const sel = useSeleccionLienzo()
  const acciones = useAccionesLienzo()
  const interaccion = useLienzo((s) => s.interaccion)
  const herramienta = useTienda((s) => s.herramienta)
  const sinBarra = useEditorActivo((s) => !s.barra && !!s.editor)
  const ref = useRef<HTMLDivElement>(null)
  const desliza = useRef<HTMLDivElement>(null)
  const [bordes, setBordes] = useState({ izq: false, der: false })
  const hay = sel.nodos.length + sel.conectores.length > 0 && !esCreacion(herramienta) && herramienta !== 'mano' && !sinBarra
  const clave = `${sel.tipo}:${sel.nodos.map((e) => e.id).join(',')}:${sel.conectores.map((c) => c.id).join(',')}`

  const medir = useCallback(() => {
    const el = desliza.current
    if (!el) return
    const izq = el.scrollLeft > 2
    const der = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setBordes((b) => (b.izq === izq && b.der === der ? b : { izq, der }))
  }, [])

  // Otra selección: la fila vuelve al principio.
  useLayoutEffect(() => {
    if (desliza.current) desliza.current.scrollLeft = 0
    medir()
  }, [clave, medir])

  useEffect(() => {
    const el = desliza.current
    if (!hay || !el) return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [hay, medir])

  if (!hay) return null
  const bloqueados = sel.nodos.length > 0 && sel.nodos.every((e) => e.bloqueado) && !sel.conectores.length
  const soloTarjetas = sel.nodos.length > 0 && sel.nodos.every((e) => e.tipo === 'tarjeta') && !sel.conectores.length
  const correr = (sentido: 1 | -1) => {
    const el = desliza.current
    if (el) el.scrollBy({ left: sentido * el.clientWidth * 0.7, behavior: 'smooth' })
  }

  return (
    <div
      ref={ref}
      className="barra-ctx barra-ctx--abajo"
      role="toolbar"
      aria-label={nombreSeleccion(sel)}
      data-oculta={interaccion === 'arrastre' || interaccion === 'redimension' || undefined}
      // Tocar la barra (también entre botones, para deslizarla) no cierra el teclado del texto que se escribe.
      data-conserva-foco
      onKeyDown={(e) => teclaBarra(e, ref.current, sel)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div ref={desliza} className="barra-ctx__desliza" onScroll={medir}>
        <div className="barra-ctx__contenido">
          {/* Los avisos de "hay más" van adentro de lo que se desliza (pegados al borde): deslizar sobre ellos también corre la fila. */}
          {bordes.izq && (
            <span className="barra-ctx__borde barra-ctx__borde--izq">
              <button type="button" className="barra-ctx__correr" onClick={() => correr(-1)} aria-label="Ver las opciones anteriores" tabIndex={-1}>
                <ChevronLeft size={18} />
              </button>
            </span>
          )}
          <ContenidoBarra sel={sel} alReemplazarImagen={alReemplazarImagen} acoplada />
          {bordes.der && (
            <span className="barra-ctx__borde barra-ctx__borde--der">
              <button type="button" className="barra-ctx__correr" onClick={() => correr(1)} aria-label="Ver más opciones" tabIndex={-1}>
                <ChevronRight size={18} />
              </button>
            </span>
          )}
        </div>
      </div>
      {!bloqueados && (
        <div className="barra-ctx__fijos">
          <BotonBarra
            tam="grande"
            peligro
            etiqueta={soloTarjetas ? 'Sacar del lienzo: la tarjeta sigue en su lista' : 'Borrar'}
            icono={<Trash2 size={18} />}
            onClick={() => acciones.borrar()}
          />
          <SeccionOrden tam="grande" />
        </div>
      )}
    </div>
  )
}
