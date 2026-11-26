// Piezas que comparten los objetos del lienzo: puntos de conexión, redimensionado, destello y candado.
// Todo lo que vive dentro del lienzo y tiene que medir lo mismo en pantalla con cualquier zoom usa la variable CSS
// --z (la escribe Lienzo.tsx directo al DOM): calc(N / var(--z)).
import { Handle, Position, useNodeId, useReactFlow } from '@xyflow/react'
import { Lock } from 'lucide-react'
import { useRef, useState, type PointerEvent as EventoPuntero } from 'react'
import { leerAjustesLienzo } from '../../../../../compartido/lienzo'
import type { Lado } from '../../../../../compartido/tipos'
import { useTienda } from '../../../estado/tienda'
import { useLienzo } from '../estado'
import type { NodoLienzo } from '../tipos'

export const LADOS: [Position, Lado][] = [
  [Position.Top, 'arriba'],
  [Position.Right, 'derecha'],
  [Position.Bottom, 'abajo'],
  [Position.Left, 'izquierda'],
]

/**
 * Cuatro puntos de conexión, uno por lado y afuera del objeto. Arrastrar desde uno empieza un conector; un clic sin
 * arrastrar crea "el siguiente paso" (lo maneja el lienzo). Cuándo se ven lo decide el CSS (lienzo.css).
 */
export function PuntosConexion() {
  const nodo = useNodeId()
  return (
    <>
      {LADOS.map(([pos, id]) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={pos}
          className="punto-conexion"
          data-lado={id}
          aria-label={`Conectar desde ${id}`}
          // Un clic sin arrastrar: "el siguiente paso" (5.7.5). React Flow no avisa de un clic sin arrastre (la conexión
          // empieza recién cuando el puntero se mueve), así que se avisa al lienzo con un evento.
          onClick={(e) => {
            e.stopPropagation()
            if (nodo) window.dispatchEvent(new CustomEvent('tablero:siguiente-paso', { detail: { id: nodo, lado: id } }))
          }}
        />
      ))}
    </>
  )
}

type Control = 'n' | 's' | 'e' | 'o' | 'ne' | 'no' | 'se' | 'so'

export interface PropsRedimensionar {
  id: string
  /** Manijas en las cuatro esquinas. */
  esquinas?: boolean
  /** Qué lados se pueden arrastrar (las líneas son invisibles: se ve el cursor). */
  lados?: 'todos' | 'horizontales' | 'ninguno'
  min: { ancho: number; alto: number }
  max?: { ancho?: number; alto?: number }
  /** Mantener la proporción siempre (imagen). Con Mayús se mantiene en cualquier objeto. */
  proporcion?: boolean
  /** El alto no se toca (texto, tarjeta): lo da el contenido. */
  altoAuto?: boolean
  /**
   * El alto es un mínimo que va en los datos del objeto (la nota: crece si su texto no entra). Mientras se arrastra se
   * cambia ese mínimo, no el alto del nodo.
   */
  altoEnDatos?: boolean
  /** Para el texto: las esquinas escalan la letra. Devuelve los datos a guardar para ese factor. */
  escalar?: (factor: number) => Record<string, unknown>
  /** Datos extra al terminar de arrastrar un lado (por ejemplo, el texto pasa a ancho fijo). */
  alArrastrarLado?: () => Record<string, unknown>
  /** Doble clic en un lado (el texto vuelve a ancho automático). */
  alDobleClicLado?: () => void
}

interface Inicio {
  control: Control
  px: number
  py: number
  x0: number
  y0: number
  w0: number
  h0: number
  zoom: number
  nodo: NodoLienzo
}

/** Manijas y líneas para cambiar el tamaño, con la etiqueta de medidas mientras se arrastra. Eventos de puntero. */
export function Redimensionar(p: PropsRedimensionar) {
  const rf = useReactFlow<NodoLienzo>()
  const inicio = useRef<Inicio | null>(null)
  const ultimo = useRef<{ x: number; y: number; w: number; h: number; datos?: Record<string, unknown> } | null>(null)
  const [medidas, setMedidas] = useState<{ w: number; h: number } | null>(null)

  const empezar = (control: Control) => (ev: EventoPuntero<HTMLDivElement>) => {
    if (ev.button !== 0) return
    ev.stopPropagation()
    ev.preventDefault()
    const n = rf.getNode(p.id)
    if (!n) return
    const e = n.data.elemento
    inicio.current = {
      control,
      px: ev.clientX,
      py: ev.clientY,
      x0: n.position.x,
      y0: n.position.y,
      w0: n.measured?.width ?? n.width ?? e.ancho,
      h0: n.measured?.height ?? n.height ?? e.alto,
      zoom: rf.getZoom(),
      nodo: n,
    }
    ultimo.current = null
    ev.currentTarget.setPointerCapture(ev.pointerId)
    useLienzo.getState().setInteraccion('redimension')
  }

  const mover = (ev: EventoPuntero<HTMLDivElement>) => {
    const i = inicio.current
    if (!i) return
    const dx = (ev.clientX - i.px) / i.zoom
    const dy = (ev.clientY - i.py) / i.zoom
    const c = i.control
    const izq = c.includes('o')
    const der = c.includes('e')
    const arr = c.startsWith('n')
    const aba = c.startsWith('s')
    const esquina = c.length === 2
    const centro = ev.altKey
    const k = centro ? 2 : 1
    let w = i.w0 + (der ? dx * k : izq ? -dx * k : 0)
    let h = i.h0 + (aba ? dy * k : arr ? -dy * k : 0)
    const proporcion = esquina && (p.proporcion || ev.shiftKey || !!p.escalar)
    if (proporcion) {
      const f = Math.max(w / i.w0, p.altoAuto ? 0 : h / i.h0)
      w = i.w0 * f
      h = i.h0 * f
    }
    const minW = p.min.ancho
    const minH = p.altoAuto ? 0 : p.min.alto
    const maxW = p.max?.ancho ?? Infinity
    const maxH = p.max?.alto ?? Infinity
    if (proporcion) {
      const f = Math.min(Math.max(w / i.w0, minW / i.w0, p.altoAuto ? 0 : minH / i.h0), maxW / i.w0, maxH / i.h0)
      w = i.w0 * f
      h = i.h0 * f
    } else {
      w = Math.min(Math.max(w, minW), maxW)
      h = Math.min(Math.max(h, minH), maxH)
    }
    let x = i.x0
    let y = i.y0
    if (centro) {
      x = i.x0 + (i.w0 - w) / 2
      if (!p.altoAuto && (arr || aba || proporcion)) y = i.y0 + (i.h0 - h) / 2
    } else {
      if (izq) x = i.x0 + (i.w0 - w)
      if (arr || (proporcion && izq && !aba)) y = i.y0 + (i.h0 - h)
    }
    // Con el imán a la grilla del tablero, el borde que se mueve se acomoda a la grilla (Ctrl/⌘ lo apaga).
    const ajustes = leerAjustesLienzo(useTienda.getState().tablero?.tablero.ajustes)
    if (ajustes.imanGrilla && !centro && !proporcion && !(ev.ctrlKey || ev.metaKey)) {
      const g = ajustes.grilla
      const al = (v: number) => Math.round(v / g) * g
      if (der) w = Math.max(minW, al(x + w) - x)
      if (izq) {
        const borde = Math.min(al(x), i.x0 + i.w0 - minW)
        w = i.x0 + i.w0 - borde
        x = borde
      }
      if (aba && !p.altoAuto) h = Math.max(minH, al(y + h) - y)
      if (arr && !p.altoAuto) {
        const borde = Math.min(al(y), i.y0 + i.h0 - minH)
        h = i.y0 + i.h0 - borde
        y = borde
      }
    }
    let datos: Record<string, unknown> | undefined
    if (p.escalar && esquina) datos = p.escalar(w / i.w0)
    else if (!esquina && p.alArrastrarLado) datos = p.alArrastrarLado()
    ultimo.current = { x, y, w, h, datos }
    const e = i.nodo.data.elemento
    const enDatos = p.altoEnDatos ? { alto: h, ancho: w } : {}
    rf.updateNode(p.id, {
      position: { x, y },
      width: w,
      ...(p.altoAuto || p.altoEnDatos ? {} : { height: h }),
      resizing: true,
      ...(datos || p.altoEnDatos ? { data: { elemento: { ...e, ...enDatos, datos: datos ? { ...e.datos, ...datos } : e.datos } } } : {}),
    })
    setMedidas({ w: Math.round(w), h: Math.round(p.altoAuto ? (rf.getNode(p.id)?.measured?.height ?? h) : h) })
  }

  const terminar = (ev: EventoPuntero<HTMLDivElement>) => {
    const i = inicio.current
    if (!i) return
    inicio.current = null
    setMedidas(null)
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    } catch {
      // ya estaba suelto
    }
    useLienzo.getState().setInteraccion(null)
    const u = ultimo.current
    rf.updateNode(p.id, { resizing: false })
    if (!u) return
    const medido = rf.getNode(p.id)?.measured?.height
    useTienda.getState().actualizarElementos(
      [
        {
          id: p.id,
          x: Math.round(u.x),
          y: Math.round(u.y),
          ancho: Math.round(u.w),
          alto: Math.round(p.altoAuto && !p.altoEnDatos ? (medido ?? u.h) : u.h),
          ...(u.datos ? { datos: u.datos } : {}),
        },
      ],
      { registrar: 'cambiar tamaño' },
    )
  }

  const control = (c: Control, clase: string) => (
    <div
      key={c}
      className={`${clase} ${clase}--${c} nodrag nopan`}
      onPointerDown={empezar(c)}
      onPointerMove={mover}
      onPointerUp={terminar}
      onPointerCancel={terminar}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (c.length === 1) p.alDobleClicLado?.()
      }}
    />
  )

  const lados = p.lados ?? 'todos'
  return (
    <>
      {lados !== 'ninguno' && (['e', 'o'] as Control[]).map((c) => control(c, 'redimension__lado'))}
      {lados === 'todos' && (['n', 's'] as Control[]).map((c) => control(c, 'redimension__lado'))}
      {p.esquinas !== false && (['no', 'ne', 'so', 'se'] as Control[]).map((c) => control(c, 'redimension__esquina'))}
      {medidas && (
        <span className="redimension__medidas" aria-hidden>
          {medidas.w} × {medidas.h}
        </span>
      )}
    </>
  )
}

export function Destello({ id }: { id: string }) {
  const d = useTienda((s) => s.destellos[id])
  if (!d || Date.now() - d > 1600) return null
  return <span key={d} className="nodo__destello" aria-hidden />
}

/** Candado de 12 px abajo a la derecha, del mismo tamaño con cualquier zoom. */
export function Candado() {
  return (
    <span className="nodo__candado" aria-label="Bloqueado">
      <Lock size={12} strokeWidth={2.4} />
    </span>
  )
}

export const guardarDatos = (id: string, datos: Record<string, unknown>, etiqueta = 'editar') =>
  useTienda.getState().actualizarElementos([{ id, datos }], { registrar: etiqueta })


// ───────── el nombre del objeto para el lector de pantalla (9.3) ─────────

const recorte = (t: string, n = 90) => {
  const una = t.replace(/\s+/g, ' ').trim()
  return una.length > n ? `${una.slice(0, n - 1)}…` : una
}

/** "Nota: Los clientes esperan…" (el texto plano, recortado). */
export function rotuloConTexto(nombre: string, texto: unknown, bloqueado?: boolean) {
  const t = typeof texto === 'string' ? recorte(texto) : ''
  return `${nombre}${t ? `: ${t}` : ' vacía'}${bloqueado ? ' (bloqueado)' : ''}`
}

/** El nombre del objeto, invisible: lo lee el lector de pantalla cuando el objeto tiene el foco (aria-labelledby). */
export function Rotulo({ id, texto }: { id: string; texto: string }) {
  return (
    <span id={`rotulo-${id}`} className="solo-lectores">
      {texto}
    </span>
  )
}
