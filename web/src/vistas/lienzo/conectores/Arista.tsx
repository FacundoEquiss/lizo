// Un conector (5.7): trazo curvo, en ángulo o recto; puntas dibujadas a mano; línea sólida, rayada o punteada; color y
// grosor. Seleccionado conserva su color y lleva un halo debajo; sus dos extremos se pueden arrastrar a otro objeto
// (reenganchar). Al crearse, se dibuja de punta a punta.
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Position,
  useInternalNode,
  useReactFlow,
  useViewport,
  type EdgeProps,
} from '@xyflow/react'
import { memo, useContext, useEffect, useRef, useState, type PointerEvent as EventoPuntero } from 'react'
import { createPortal } from 'react-dom'
import { NOMBRES_TIPO } from '../../../../../compartido/lienzo'
import type { Conector, ElementoLienzo, TarjetaResumen } from '../../../../../compartido/tipos'
import { porId, useTienda } from '../../../estado/tienda'
import { ContextoLienzo } from '../acciones'
import { useLienzo } from '../estado'
import { useEditorActivo } from '../texto/editorActivo'
import type { AristaConector, NodoLienzo } from '../tipos'
import { marcarDestino, nodoBajoPuntero } from './destino'
import { Punta, retroceso } from './Punta'
import { cajaDe, ladosAuto, POSICION_DE_LADO, puntoEnLado, type Caja } from './rutas'

const NORMAL: Record<Position, { x: number; y: number }> = {
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
}

export const colorConector = (c: Pick<Conector, 'color'>) => (c.color ? `var(--e-${c.color}-s)` : 'var(--c-texto-3)')

/** El patrón de la línea, proporcional al grosor (a grosor 2: rayada 8 6, punteada 1 6 con puntas redondas). */
export function patronLinea(guion: Conector['guion'], grosor: number): { dasharray?: string; linecap: 'round' | 'butt' } {
  if (guion === 'rayado') return { dasharray: `${4 * grosor} ${3 * grosor}`, linecap: 'butt' }
  if (guion === 'punteado') return { dasharray: `${0.5 * grosor} ${3 * grosor}`, linecap: 'round' }
  return { linecap: 'round' }
}

/** El camino de un conector entre dos puntos, con su trazo (la misma cuenta para el conector y la línea en curso). */
export function caminoConector(
  trazo: Conector['trazo'],
  pa: { x: number; y: number },
  la: Position,
  pb: { x: number; y: number },
  lb: Position,
): [string, number, number] {
  const p = { sourceX: pa.x, sourceY: pa.y, sourcePosition: la, targetX: pb.x, targetY: pb.y, targetPosition: lb }
  const [d, lx, ly] =
    trazo === 'recto'
      ? getStraightPath(p)
      : trazo === 'ortogonal'
        ? getSmoothStepPath({ ...p, borderRadius: 12, offset: 24 })
        : getBezierPath({ ...p, curvature: 0.32 })
  return [d, lx, ly]
}

export interface GeometriaConector {
  ruta: string
  rutaCompleta: string
  lx: number
  ly: number
  pa: { x: number; y: number }
  pb: { x: number; y: number }
  anguloInicio: number
  anguloFin: number
}

type Estilo = Pick<Conector, 'desdeLado' | 'hastaLado' | 'trazo' | 'puntaInicio' | 'puntaFin' | 'grosor'>

/**
 * Extremos, ángulos de llegada y caminos (el acortado por las puntas, para la línea; el completo, para el halo).
 * `b` es la caja del otro objeto o un punto suelto (la línea en curso, un extremo que se arrastra).
 */
export function geometria(c: Estilo, ca: Caja, b: Caja | { punto: { x: number; y: number } }): GeometriaConector {
  const suelto = 'punto' in b
  const cajaB = suelto ? { x: b.punto.x, y: b.punto.y, w: 0, h: 0 } : b
  const [autoA, autoB] = ladosAuto(ca, cajaB)
  const la = c.desdeLado ? POSICION_DE_LADO[c.desdeLado] : autoA
  const lb = !suelto && c.hastaLado ? POSICION_DE_LADO[c.hastaLado] : autoB
  const pa = puntoEnLado(ca, la)
  const pb = suelto ? b.punto : puntoEnLado(cajaB, lb)
  const recto = c.trazo === 'recto'
  // Hacia dónde apunta cada punta: en recto, a lo largo de la línea; en curvo y en ángulo, entrando por el lado.
  const anguloFin = recto ? Math.atan2(pb.y - pa.y, pb.x - pa.x) : Math.atan2(-NORMAL[lb].y, -NORMAL[lb].x)
  const anguloInicio = recto ? Math.atan2(pa.y - pb.y, pa.x - pb.x) : Math.atan2(-NORMAL[la].y, -NORMAL[la].x)
  const rf = retroceso(c.puntaFin, c.grosor)
  const ri = retroceso(c.puntaInicio, c.grosor)
  const pb2 = { x: pb.x - Math.cos(anguloFin) * rf, y: pb.y - Math.sin(anguloFin) * rf }
  const pa2 = { x: pa.x - Math.cos(anguloInicio) * ri, y: pa.y - Math.sin(anguloInicio) * ri }
  const [ruta, lx, ly] = caminoConector(c.trazo, pa2, la, pb2, lb)
  const [rutaCompleta] = ri || rf ? caminoConector(c.trazo, pa, la, pb, lb) : [ruta]
  return { ruta, rutaCompleta, lx, ly, pa, pb, anguloInicio, anguloFin }
}

type Extremo = 'desde' | 'hasta'

/**
 * Los dos extremos del conector seleccionado, en la capa de pantalla de arriba de todo (por encima de los objetos y
 * de la barra contextual, que si no los taparía): 10 px con cualquier zoom. Siguen al lienzo cuando se mueve.
 */
function ExtremosConector({
  puntos,
  arrastrando,
  empezar,
  mover,
  soltar,
}: {
  puntos: [Extremo, { x: number; y: number }][]
  arrastrando: Extremo | null
  empezar: (e: Extremo) => (ev: EventoPuntero<HTMLDivElement>) => void
  mover: (ev: EventoPuntero<HTMLDivElement>) => void
  soltar: (ev: EventoPuntero<HTMLDivElement>) => void
}) {
  // Solo el conector seleccionado se suscribe al lienzo (para seguirlo cuando se mueve).
  const { x: tx, y: ty, zoom } = useViewport()
  const contenedor = useContext(ContextoLienzo)?.contenedor()
  if (!contenedor) return null
  return createPortal(
    <div className="conector__extremos">
      {puntos.map(([extremo, p]) => (
        <div
          key={extremo}
          className={`conector__extremo${arrastrando === extremo ? ' conector__extremo--arrastrando' : ''}`}
          style={{ transform: `translate(${p.x * zoom + tx}px, ${p.y * zoom + ty}px)` }}
          onPointerDown={empezar(extremo)}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          role="button"
          aria-label={extremo === 'desde' ? 'Mover el comienzo del conector' : 'Mover el final del conector'}
        />
      ))}
    </div>,
    contenedor,
  )
}

const claveDe = (tarjetas: readonly TarjetaResumen[] | undefined, id: string | null | undefined) => (tarjetas && id ? porId(tarjetas).get(id)?.clave : undefined)

/** «Cliente entra», el marco «Mecánicas», la tarjeta RC-3… (para el nombre del conector). */
function nombreExtremo(e: ElementoLienzo | undefined, clave?: string): string {
  if (!e) return 'un objeto'
  if (e.tipo === 'marco') return `el marco «${String(e.datos.titulo ?? '') || 'sin nombre'}»`
  if (e.tipo === 'tarjeta') return clave ? `la tarjeta ${clave}` : 'una tarjeta'
  const t = String(e.datos.texto ?? e.datos.titulo ?? '').split('\n')[0]!.trim()
  return t ? `«${t.length > 40 ? `${t.slice(0, 39)}…` : t}»` : NOMBRES_TIPO[e.tipo].toLowerCase()
}

export const Arista = memo(function Arista({ id, source, target, data, selected }: EdgeProps<AristaConector>) {
  const a = useInternalNode<NodoLienzo>(source)
  const b = useInternalNode<NodoLienzo>(target)
  const rf = useReactFlow<NodoLienzo, AristaConector>()
  const c = data!.conector
  const editando = useLienzo((s) => s.etiquetaEditando === id)
  const nuevo = useTienda((s) => s.nuevos.has(id))
  const claveA = useTienda((s) => claveDe(s.tablero?.tarjetas, a?.data.elemento.tarjetaId))
  const claveB = useTienda((s) => claveDe(s.tablero?.tarjetas, b?.data.elemento.tarjetaId))
  const [texto, setTexto] = useState(c.etiqueta)
  const [arrastre, setArrastre] = useState<{ extremo: Extremo; punto: { x: number; y: number } } | null>(null)
  const destino = useRef<string | null>(null)
  const cancelada = useRef(false)
  useEffect(() => setTexto(c.etiqueta), [c.etiqueta])
  // Empezar a escribir con el conector seleccionado: esa tecla va primero en la etiqueta.
  useEffect(() => {
    if (!editando) return
    const p = useEditorActivo.getState().pendiente
    if (p) {
      useEditorActivo.getState().set({ pendiente: '' })
      setTexto((t) => t + p)
    }
  }, [editando])
  if (!a || !b) return null

  // Mientras se arrastra un extremo, la línea lo sigue. Si es el comienzo, se calcula al revés (el extremo suelto
  // queda como "hasta") con las puntas dadas vuelta.
  const alReves = arrastre?.extremo === 'desde'
  const estilo: Estilo = alReves ? { ...c, desdeLado: c.hastaLado, hastaLado: null, puntaInicio: c.puntaFin, puntaFin: c.puntaInicio } : c
  const g = geometria(estilo, alReves ? cajaDe(b) : cajaDe(a), arrastre ? { punto: arrastre.punto } : cajaDe(b))
  const color = colorConector(c)
  const patron = patronLinea(c.guion, c.grosor)
  const puntoDesde = alReves ? g.pb : g.pa
  const puntoHasta = alReves ? g.pa : g.pb
  const dibujando = nuevo && !arrastre

  const guardarEtiqueta = () => {
    useLienzo.getState().set({ etiquetaEditando: null })
    if (cancelada.current) {
      cancelada.current = false
      setTexto(c.etiqueta)
      return
    }
    if (texto.trim() !== c.etiqueta) void useTienda.getState().actualizarConector(c.id, { etiqueta: texto.trim() })
  }

  // ───── reenganchar un extremo ─────
  const aLienzo = (ev: { clientX: number; clientY: number }) => rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
  const empezar = (extremo: Extremo) => (ev: EventoPuntero<HTMLDivElement>) => {
    if (ev.button !== 0) return
    ev.stopPropagation()
    ev.preventDefault()
    ev.currentTarget.setPointerCapture(ev.pointerId)
    setArrastre({ extremo, punto: aLienzo(ev) })
    useLienzo.getState().setInteraccion('arrastre')
  }
  const mover = (ev: EventoPuntero<HTMLDivElement>) => {
    if (!arrastre) return
    const punto = aLienzo(ev)
    setArrastre({ ...arrastre, punto })
    const fijo = arrastre.extremo === 'desde' ? c.hastaId : c.desdeId
    const n = nodoBajoPuntero(rf, punto, [fijo], { x: ev.clientX, y: ev.clientY })
    destino.current = n?.id ?? null
    marcarDestino(destino.current)
  }
  const soltar = (ev: EventoPuntero<HTMLDivElement>) => {
    if (!arrastre) return
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    } catch {
      // ya estaba suelto
    }
    const d = destino.current
    const extremo = arrastre.extremo
    destino.current = null
    marcarDestino(null)
    setArrastre(null)
    useLienzo.getState().setInteraccion(null)
    // Soltado en el vacío (o en el mismo objeto): el extremo vuelve a su lugar con un resorte.
    if (!d || d === (extremo === 'desde' ? c.desdeId : c.hastaId)) return
    void useTienda.getState().actualizarConector(c.id, extremo === 'desde' ? { desdeId: d, desdeLado: null } : { hastaId: d, hastaLado: null })
  }

  return (
    <>
      {/* El nombre para el lector de pantalla (aria-labelledby del conector): de dónde a dónde y su etiqueta. */}
      <desc id={`rotulo-${id}`}>{`Conector de ${nombreExtremo(a?.data.elemento, claveA)} a ${nombreExtremo(b?.data.elemento, claveB)}${c.etiqueta ? `, etiqueta ${c.etiqueta}` : ''}`}</desc>
      {/* Halo de selección (y del mouse encima): debajo de la línea, que conserva su color. */}
      <path d={g.rutaCompleta} className="conector__halo" style={{ strokeWidth: c.grosor + 6 }} />
      <BaseEdge
        id={id}
        path={g.ruta}
        className={`conector__linea${dibujando ? (c.guion === 'solido' ? ' conector__linea--dibujando' : ' conector__linea--apareciendo') : ''}`}
        style={{ stroke: color, strokeWidth: c.grosor, strokeDasharray: patron.dasharray, strokeLinecap: patron.linecap }}
        interactionWidth={22}
        {...(dibujando && c.guion === 'solido' ? { pathLength: 1 } : {})}
      />
      <g className={`conector__puntas${dibujando ? ' conector__puntas--nuevas' : ''}`}>
        <Punta tipo={estilo.puntaInicio} x={g.pa.x} y={g.pa.y} angulo={g.anguloInicio} grosor={c.grosor} color={color} />
        <Punta tipo={estilo.puntaFin} x={g.pb.x} y={g.pb.y} angulo={g.anguloFin} grosor={c.grosor} color={color} />
      </g>
      {selected && (
        <ExtremosConector
          puntos={[
            ['desde', puntoDesde],
            ['hasta', puntoHasta],
          ]}
          arrastrando={arrastre?.extremo ?? null}
          empezar={empezar}
          mover={mover}
          soltar={soltar}
        />
      )}
      {(c.etiqueta || editando) && !arrastre && (
        <EdgeLabelRenderer>
          <div
            data-etiqueta-conector={id}
            className={`conector__etiqueta nodrag nopan${selected ? ' conector__etiqueta--sel' : ''}${editando ? ' conector__etiqueta--editando' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${g.lx}px, ${g.ly}px)` }}
            onDoubleClick={() => useLienzo.getState().set({ etiquetaEditando: id })}
          >
            {editando ? (
              <input
                autoFocus
                value={texto}
                size={Math.max(4, texto.length + 1)}
                placeholder="Etiqueta"
                aria-label="Etiqueta del conector"
                onChange={(e) => setTexto(e.target.value)}
                onFocus={(e) => {
                  const fin = e.target.value.length
                  e.target.setSelectionRange(fin, fin)
                }}
                onBlur={guardarEtiqueta}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') {
                    cancelada.current = true
                    ;(e.target as HTMLInputElement).blur()
                  } else if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            ) : (
              c.etiqueta
            )}
          </div>
        </EdgeLabelRenderer>
      )}
      {/* Ancla para la barra contextual (que va arriba de la etiqueta, o del medio de la línea si no hay). */}
      {selected && !c.etiqueta && !editando && (
        <EdgeLabelRenderer>
          <div data-ancla-conector={id} className="conector__ancla" style={{ transform: `translate(${g.lx}px, ${g.ly}px)` }} />
        </EdgeLabelRenderer>
      )}
    </>
  )
})
